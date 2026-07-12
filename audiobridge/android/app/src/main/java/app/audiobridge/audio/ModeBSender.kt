package app.audiobridge.audio

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Process
import android.os.SystemClock
import app.audiobridge.net.Protocol
import java.io.DataOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max

enum class CaptureSource { MIC, INTERNAL }

/**
 * 이 기기 소리(마이크 또는 미디어 캡처)를 상대(들)에게 보낸다.
 * UDP는 [targetsProvider]가 주는 여러 목적지에 같은 패킷을 복제 송신(다대일 스피커),
 * TCP(안정)는 단일 목적지 전용.
 * 패킷 타임스탬프는 clk 동기와 같은 시계(elapsedRealtimeNanos)를 쓴다.
 */
class ModeBSender(
    private val targetsProvider: () -> List<InetSocketAddress>,
    private val tcpTarget: InetSocketAddress?,
    private val source: CaptureSource,
    private val projection: MediaProjection?,
    private val onLevel: (Float) -> Unit,
    private val onError: (String) -> Unit,
) {
    @Volatile private var running = false

    val channels: Int get() = if (source == CaptureSource.INTERNAL) 2 else 1

    fun start(): Boolean {
        val rec = try {
            createRecord()
        } catch (e: Exception) {
            onError("소리 담기를 시작할 수 없어요: ${e.message}")
            return false
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            onError(
                if (source == CaptureSource.MIC) "마이크를 열 수 없어요 (다른 앱이 사용 중일 수 있어요)"
                else "미디어 소리 담기를 시작할 수 없어요"
            )
            return false
        }
        running = true
        thread(name = "ab-b-tx") { loop(rec) }
        return true
    }

    fun stop() {
        running = false
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO는 UI에서 확인 후 호출
    private fun createRecord(): AudioRecord {
        val channelMask = if (channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
        val minBuf = AudioRecord.getMinBufferSize(Protocol.SAMPLE_RATE, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        val bufSize = max(minBuf, Protocol.frameBytes(channels) * 8)
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(Protocol.SAMPLE_RATE)
            .setChannelMask(channelMask)
            .build()
        return if (source == CaptureSource.INTERNAL) {
            if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("Android 10 이상에서만 가능해요")
            val proj = projection ?: throw IllegalStateException("화면 소리 공유 동의가 없어요")
            val config = AudioPlaybackCaptureConfiguration.Builder(proj)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufSize)
                .setAudioPlaybackCaptureConfig(config)
                .build()
        } else {
            AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.MIC)
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufSize)
                .build()
        }
    }

    private fun loop(rec: AudioRecord) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val frameBytes = Protocol.frameBytes(channels)
        val frame = ByteArray(frameBytes)
        val packet = ByteArray(Protocol.HEADER_SIZE + frameBytes)
        var udp: DatagramSocket? = null
        var tcpOut: DataOutputStream? = null
        var tcpSocket: Socket? = null
        try {
            if (tcpTarget != null) {
                tcpSocket = Socket().apply {
                    tcpNoDelay = true
                    connect(tcpTarget, 4000)
                }
                tcpOut = DataOutputStream(tcpSocket.getOutputStream())
            } else {
                udp = DatagramSocket()
            }
            rec.startRecording()
            if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                onError("소리 담기가 시작되지 않았어요")
                return
            }
            var seq = 0
            var level = 0f
            var lastLevel = 0L
            while (running) {
                var off = 0
                while (off < frameBytes && running) {
                    val n = rec.read(frame, off, frameBytes - off)
                    if (n < 0) {
                        onError("소리 담기 오류 (code $n)")
                        return
                    }
                    off += n
                }
                if (!running) break
                val flags = if (seq == 0) Protocol.FLAG_FIRST else 0
                val len = Protocol.buildPacket(
                    packet, frame, frameBytes, seq, Protocol.SAMPLE_RATE, channels, flags,
                    SystemClock.elapsedRealtimeNanos() / 1000
                )
                seq++
                if (tcpOut != null) {
                    tcpOut.write(packet, 0, len)
                } else {
                    val dests = targetsProvider()
                    for (d in dests) {
                        runCatching { udp?.send(DatagramPacket(packet, len, d)) }
                    }
                }
                val now = SystemClock.elapsedRealtime()
                if (now - lastLevel > 100) {
                    lastLevel = now
                    var peak = 0
                    var i = 0
                    while (i + 1 < frameBytes) {
                        val s = (frame[i].toInt() and 0xFF) or (frame[i + 1].toInt() shl 8)
                        peak = max(peak, abs(s))
                        i += 8
                    }
                    level = level * 0.6f + (peak / 32768f) * 0.4f
                    onLevel(level)
                }
            }
        } catch (e: Exception) {
            if (running) onError("보내기 실패: ${e.message}")
        } finally {
            runCatching { rec.stop() }
            rec.release()
            runCatching { udp?.close() }
            runCatching { tcpOut?.close() }
            runCatching { tcpSocket?.close() }
            onLevel(0f)
        }
    }
}
