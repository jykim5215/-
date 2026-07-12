package app.audiobridge.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import android.os.SystemClock
import app.audiobridge.net.Protocol
import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max

/**
 * 수신 재생기 — 상대가 보내는 오디오를 이 기기에서 재생한다.
 *
 * 시간 동기 재생: 각 패킷의 소스 타임스탬프를 시계 오프셋([offsetUsProvider],
 * PROTOCOL.md §7)으로 로컬 시각으로 바꾸고, "소스 시각 + 목표 지연 + 미세 조정"
 * 시점에 맞춰 재생한다. 여러 스피커가 같은 소스에 물리면 같은 시점에 소리가 난다.
 * 오프셋이 없으면(구버전 PC 등) 첫 패킷 도착 기준으로 잠정 오프셋을 잡는다.
 */
class ModeAPlayer(
    private val delayMsProvider: () -> Int,
    private val nudgeMsProvider: () -> Int,
    private val offsetUsProvider: () -> Long?,
    private val onStats: (lossPct: Double, level: Float, bufferedMs: Int) -> Unit,
    private val onError: (String) -> Unit,
) {
    private val jitter = JitterBuffer()
    @Volatile private var running = false
    private var udpSocket: DatagramSocket? = null
    private var tcpSocket: Socket? = null
    private var serverSocket: ServerSocket? = null

    private fun nowUs() = SystemClock.elapsedRealtimeNanos() / 1000

    /** UDP 수신 시작. 포트 바인드 실패 시 false. */
    fun startUdp(listenPort: Int, allowedHost: String): Boolean {
        val allowed = runCatching { InetAddress.getByName(allowedHost) }.getOrNull()
            ?: run { onError("상대 주소를 확인할 수 없어요"); return false }
        val socket = try {
            DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(listenPort))
            }
        } catch (e: Exception) {
            onError("소리 받을 통로(${listenPort})를 열 수 없어요")
            return false
        }
        udpSocket = socket
        running = true
        thread(name = "ab-a-rx") { udpLoop(socket, allowed) }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    /** TCP(안정) 모드: 상대에게 접속해 스트림을 읽는다. */
    fun startTcp(host: String, port: Int): Boolean {
        val socket = try {
            Socket().apply {
                tcpNoDelay = true
                connect(InetSocketAddress(host, port), 4000)
            }
        } catch (e: Exception) {
            onError("소리 통로 접속 실패: ${e.message}")
            return false
        }
        tcpSocket = socket
        running = true
        thread(name = "ab-a-rx") { tcpLoop(socket) }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    /** TCP 서버 모드: 이 기기가 리스너가 되어 상대의 접속을 받는다. */
    fun startTcpServer(listenPort: Int, allowedHost: String): Boolean {
        val allowed = runCatching { InetAddress.getByName(allowedHost) }.getOrNull()
            ?: run { onError("상대 주소를 확인할 수 없어요"); return false }
        val server = try {
            ServerSocket(listenPort)
        } catch (e: Exception) {
            onError("소리 받을 통로(${listenPort})를 열 수 없어요")
            return false
        }
        serverSocket = server
        running = true
        thread(name = "ab-a-rx") {
            try {
                while (running) {
                    val s = server.accept()
                    if (s.inetAddress != allowed) {
                        runCatching { s.close() } // 페어링된 상대 외 접속 거부
                        continue
                    }
                    s.tcpNoDelay = true
                    tcpSocket = s
                    tcpLoop(s)
                    break
                }
            } catch (_: Exception) {
                // 리스너 닫힘
            }
        }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    fun stop() {
        running = false
        runCatching { udpSocket?.close() }
        runCatching { tcpSocket?.close() }
        runCatching { serverSocket?.close() }
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
            if (pkt.address != allowed) continue // 페어링된 상대 외 무시
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
            if (running) onError("소리 스트림이 끊어졌어요")
        }
    }

    private fun playLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        // 첫 패킷으로 포맷 파악 (상대 준비·동의 시간을 고려해 30초 대기)
        var waited = 0
        while (running && jitter.format == null) {
            Thread.sleep(20)
            waited += 20
            if (waited > 30000) {
                if (running) onError("상대 기기에서 소리가 오지 않아요 (같은 Wi-Fi·방화벽 확인)")
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
                .setBufferSizeInBytes(max(minBuf, frameBytes * 4))
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                .build()
        } catch (e: Exception) {
            onError("소리 재생을 시작할 수 없어요: ${e.message}")
            return
        }
        track.play()
        val silence = ByteArray(frameBytes)
        val frameDurUs = Protocol.FRAME_MS * 1000L
        var fallbackOffset: Long? = null
        var level = 0f
        var lastStats = 0L
        try {
            while (running) {
                val head = jitter.peek()
                if (head == null) {
                    // 데이터 없음 — 무음으로 트랙을 채우며 대기 (write가 실시간 페이스 유지)
                    track.write(silence, 0, silence.size)
                    level = 0f
                    continue
                }
                val offset = offsetUsProvider() ?: run {
                    if (fallbackOffset == null) fallbackOffset = nowUs() - head.tsUs
                    fallbackOffset!!
                }
                val targetUs = head.tsUs + offset +
                    delayMsProvider().coerceIn(20, 500) * 1000L +
                    nudgeMsProvider().coerceIn(-200, 200) * 1000L
                val lead = targetUs - nowUs()
                when {
                    lead > frameDurUs * 2 -> {
                        // 아직 이르다 — 무음 한 프레임으로 시간을 보낸다
                        track.write(silence, 0, silence.size)
                    }
                    lead < -60_000 -> {
                        // 너무 늦었다 — 버린다
                        jitter.poll()
                    }
                    else -> {
                        val frame = jitter.poll() ?: continue
                        track.write(frame.data, 0, frame.data.size)
                        var peak = 0
                        var i = 0
                        while (i + 1 < frame.data.size) {
                            val s = (frame.data[i].toInt() and 0xFF) or (frame.data[i + 1].toInt() shl 8)
                            peak = max(peak, abs(s))
                            i += 8
                        }
                        level = level * 0.7f + (peak / 32768f) * 0.3f
                    }
                }
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
