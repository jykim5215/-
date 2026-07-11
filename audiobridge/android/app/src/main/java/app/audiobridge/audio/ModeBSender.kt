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
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max

enum class CaptureSource { MIC, INTERNAL }

/**
 * 모드 B: 폰 오디오(마이크 또는 내부 재생 캡처)를 PC로 송신한다 (PC = 폰의 스피커).
 * 마이크 = 모노, 내부 캡처 = 스테레오. UDP 기본, TCP 옵션.
 */
class ModeBSender(
    private val host: String,
    private val port: Int,
    private val useTcp: Boolean,
    private val source: CaptureSource,
    private val projection: MediaProjection?,
    private val onLevel: (Float) -> Unit,
    private val onError: (String) -> Unit,
) {
    @Volatile private var running = false
    private var record: AudioRecord? = null

    val channels: Int get() = if (source == CaptureSource.INTERNAL) 2 else 1

    fun start(): Boolean {
        val rec = try {
            createRecord()
        } catch (e: Exception) {
            onError("오디오 캡처 시작 실패: ${e.message}")
            return false
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            onError(
                if (source == CaptureSource.MIC) "마이크를 열 수 없습니다 (다른 앱이 사용 중일 수 있음)"
                else "내부 소리 캡처를 시작할 수 없습니다"
            )
            return false
        }
        record = rec
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
            if (Build.VERSION.SDK_INT < 29) throw IllegalStateException("내부 소리 캡처는 Android 10 이상에서만 가능합니다")
            val proj = projection ?: throw IllegalStateException("화면 녹화 권한이 없습니다")
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
            if (useTcp) {
                tcpSocket = Socket().apply {
                    tcpNoDelay = true
                    connect(InetSocketAddress(host, port), 4000)
                }
                tcpOut = DataOutputStream(tcpSocket.getOutputStream())
            } else {
                udp = DatagramSocket()
                udp.connect(InetAddress.getByName(host), port)
            }
            rec.startRecording()
            if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                onError("캡처가 시작되지 않았습니다 (기기 정책으로 차단되었을 수 있음)")
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
                        onError("오디오 캡처 오류 (code $n)")
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
                    udp?.send(DatagramPacket(packet, len))
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
            if (running) onError("전송 실패: ${e.message}")
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
