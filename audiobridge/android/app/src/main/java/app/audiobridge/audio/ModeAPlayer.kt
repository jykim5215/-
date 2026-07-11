package app.audiobridge.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import app.audiobridge.net.Protocol
import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max

/**
 * 모드 A: PC가 보내는 오디오를 받아 재생한다 (폰 = PC의 스피커).
 * UDP 수신(기본) 또는 TCP 스트림(안정성 우선) 지원.
 */
class ModeAPlayer(
    private val bufferMsProvider: () -> Int,
    private val onStats: (lossPct: Double, level: Float, bufferedMs: Int) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val jitter = JitterBuffer()
    @Volatile private var running = false
    private var udpSocket: DatagramSocket? = null
    private var tcpSocket: Socket? = null

    /** UDP 수신 시작. 포트 바인드 실패 시 false. */
    fun startUdp(listenPort: Int, allowedHost: String): Boolean {
        val allowed = runCatching { InetAddress.getByName(allowedHost) }.getOrNull()
            ?: run { onError("PC 주소를 확인할 수 없습니다"); return false }
        val socket = try {
            DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(listenPort))
            }
        } catch (e: Exception) {
            onError("포트 ${listenPort}을(를) 사용할 수 없습니다: ${e.message}")
            return false
        }
        udpSocket = socket
        running = true
        thread(name = "ab-a-rx") { udpLoop(socket, allowed) }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    /** TCP 모드: PC의 오디오 포트로 접속해 스트림을 읽는다. */
    fun startTcp(host: String, port: Int): Boolean {
        val socket = try {
            Socket().apply {
                tcpNoDelay = true
                connect(InetSocketAddress(host, port), 4000)
            }
        } catch (e: Exception) {
            onError("PC 오디오 스트림 접속 실패: ${e.message}")
            return false
        }
        tcpSocket = socket
        running = true
        thread(name = "ab-a-rx") { tcpLoop(socket) }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    fun stop() {
        running = false
        runCatching { udpSocket?.close() }
        runCatching { tcpSocket?.close() }
        jitter.clear()
    }

    private fun udpLoop(socket: DatagramSocket, allowed: InetAddress) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val buf = ByteArray(2048)
        while (running) {
            val pkt = DatagramPacket(buf, buf.size)
            try {
                socket.receive(pkt)
            } catch (_: Exception) {
                if (running) continue else break
            }
            if (pkt.address != allowed) continue // 페어링된 PC 외 무시
            val info = Protocol.parseHeader(buf) ?: continue
            if (Protocol.HEADER_SIZE + info.payloadLen != pkt.length) continue
            jitter.push(info, buf.copyOfRange(Protocol.HEADER_SIZE, Protocol.HEADER_SIZE + info.payloadLen))
        }
    }

    private fun tcpLoop(socket: Socket) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        try {
            val input = DataInputStream(socket.getInputStream().buffered())
            val header = ByteArray(Protocol.HEADER_SIZE)
            while (running) {
                input.readFully(header)
                val info = Protocol.parseHeader(header) ?: break
                val payload = ByteArray(info.payloadLen)
                input.readFully(payload)
                jitter.push(info, payload)
            }
        } catch (e: Exception) {
            if (running) onError("오디오 스트림 끊김: ${e.message}")
        }
    }

    private fun playLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        // 첫 패킷으로 포맷 파악
        var waited = 0
        while (running && jitter.format == null) {
            Thread.sleep(20)
            waited += 20
            if (waited > 8000) {
                if (running) onError("PC에서 오디오가 오지 않습니다 (방화벽/포트 확인)")
                return
            }
        }
        val fmt = jitter.format ?: return
        val channelMask = if (fmt.channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
        val minBuf = AudioTrack.getMinBufferSize(fmt.sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        val frameBytes = fmt.sampleRate / 1000 * Protocol.FRAME_MS * 2 * fmt.channels
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(fmt.sampleRate)
                        .setChannelMask(channelMask)
                        .build()
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(max(minBuf, frameBytes * 8))
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                .build()
        } catch (e: Exception) {
            onError("오디오 출력 초기화 실패: ${e.message}")
            return
        }
        track.play()
        val silence = ByteArray(frameBytes)
        var buffering = true
        var level = 0f
        var lastStats = 0L
        try {
            while (running) {
                val targetBytes = bufferMsProvider().coerceIn(20, 500) * fmt.bytesPerMs
                if (buffering) {
                    if (jitter.bufferedBytes() >= targetBytes) {
                        buffering = false
                    } else {
                        // 무음 기록이 실시간 속도로 대기를 겸한다
                        track.write(silence, 0, silence.size)
                        continue
                    }
                }
                val frame = jitter.poll()
                if (frame == null) {
                    buffering = true
                    level = 0f
                    continue
                }
                track.write(frame, 0, frame.size)
                // 피크 레벨 (간단히 4샘플 간격 샘플링)
                var peak = 0
                var i = 0
                while (i + 1 < frame.size) {
                    val s = (frame[i].toInt() and 0xFF) or (frame[i + 1].toInt() shl 8)
                    peak = max(peak, abs(s))
                    i += 8
                }
                level = level * 0.7f + (peak / 32768f) * 0.3f
                val now = System.currentTimeMillis()
                if (now - lastStats > 400) {
                    lastStats = now
                    onStats(jitter.lossPercent(), level, jitter.bufferedBytes() / fmt.bytesPerMs)
                }
            }
        } finally {
            runCatching { track.stop() }
            track.release()
        }
    }
}
