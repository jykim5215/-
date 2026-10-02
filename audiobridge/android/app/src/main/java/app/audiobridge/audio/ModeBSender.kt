package app.audiobridge.audio

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTimestamp
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

/** 송신 목적지. [channel] 0=양쪽(원본), 1=왼쪽만(모노), 2=오른쪽만(모노) — 스테레오 페어용 */
data class SendTarget(val addr: InetSocketAddress, val channel: Int = 0)

/**
 * 이 기기 소리(마이크 또는 미디어 캡처)를 상대(들)에게 보낸다.
 * UDP는 [targetsProvider]가 주는 여러 목적지에 같은 패킷을 복제 송신(다대일 스피커),
 * TCP(안정)는 단일 목적지 전용.
 * 패킷 타임스탬프는 clk 동기와 같은 시계(elapsedRealtimeNanos)를 쓴다.
 */
class ModeBSender(
    private val targetsProvider: () -> List<SendTarget>,
    private val tcpTarget: InetSocketAddress?,
    private val source: CaptureSource,
    private val projection: MediaProjection?,
    private val onLevel: (Float) -> Unit,
    private val onError: (String) -> Unit,
) {
    @Volatile private var running = false

    val channels: Int get() = if (source == CaptureSource.INTERNAL) 2 else 1

    /** 마이크로 담는 중인가 (음향 보정이 이 녹음을 그대로 쓸 수 있다) */
    val capturesMic: Boolean get() = source == CaptureSource.MIC

    /** 음향 싱크 보정 중: 스피커로 보내는 소리를 무음으로 (시험음만 들리게) */
    @Volatile var muted = false

    /** 마이크로 담는 중이면 담은 프레임(모노, -1..1)과 첫 샘플의 녹음 시각을 넘긴다 — 음향 보정 녹음용 */
    @Volatile var micTap: ((FloatArray, Long) -> Unit)? = null

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

    /** 16bit LE 인터리브 → 모노 float(-1..1) */
    private fun toMono(frame: ByteArray, frameBytes: Int, ch: Int): FloatArray {
        val n = frameBytes / (2 * ch)
        return FloatArray(n) { i ->
            var sum = 0
            for (c in 0 until ch) {
                val b = (i * ch + c) * 2
                sum += (frame[b].toInt() and 0xFF) or (frame[b + 1].toInt() shl 8)
            }
            sum / ch / 32768f
        }
    }

    /** 스테레오 인터리브 16bit 프레임에서 한 채널만 뽑아 모노 페이로드 생성. */
    private fun extractChannel(frame: ByteArray, frameBytes: Int, chIdx: Int): ByteArray {
        val out = ByteArray(frameBytes / 2)
        var src = chIdx * 2
        var dst = 0
        while (src + 1 < frameBytes) {
            out[dst] = frame[src]
            out[dst + 1] = frame[src + 1]
            dst += 2
            src += 4
        }
        return out
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
            // 타임스탬프 = 이 프레임 첫 샘플이 실제로 녹음된 시각 (read 완료 시각은 드라이버가 몰아서 줘서 흔들린다)
            val frameSamples = frameBytes / (2 * channels)
            val timeline = CaptureTimeline(Protocol.SAMPLE_RATE)
            val hwTs = AudioTimestamp()
            var frameStart = 0L // 녹음 시작부터 센 이 프레임 첫 샘플 번호
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
                val readDoneUs = SystemClock.elapsedRealtimeNanos() / 1000
                // BOOTTIME = elapsedRealtimeNanos와 같은 시계 (수신기의 시계 동기 기준과 일치)
                val hwOk = rec.getTimestamp(hwTs, AudioTimestamp.TIMEBASE_BOOTTIME) == AudioRecord.SUCCESS
                val tsUs = timeline.frameStartUs(
                    frameStart, frameSamples, readDoneUs,
                    if (hwOk) hwTs.framePosition else null,
                    if (hwOk) hwTs.nanoTime / 1000 else null,
                )
                frameStart += frameSamples
                if (capturesMic) micTap?.invoke(toMono(frame, frameBytes, channels), tsUs)
                if (muted) java.util.Arrays.fill(frame, 0.toByte())
                if (tcpOut != null) {
                    val len = Protocol.buildPacket(
                        packet, frame, frameBytes, seq, Protocol.SAMPLE_RATE, channels, flags, tsUs
                    )
                    tcpOut.write(packet, 0, len)
                } else {
                    // 스테레오 페어: 목적지별로 양쪽/왼쪽/오른쪽 변형을 만들어 송신
                    var monoL: ByteArray? = null
                    var monoR: ByteArray? = null
                    for (d in targetsProvider()) {
                        val wantMono = channels == 2 && d.channel in 1..2
                        val payload: ByteArray
                        val payloadCh: Int
                        if (wantMono) {
                            if (d.channel == 1) {
                                if (monoL == null) monoL = extractChannel(frame, frameBytes, 0)
                                payload = monoL
                            } else {
                                if (monoR == null) monoR = extractChannel(frame, frameBytes, 1)
                                payload = monoR
                            }
                            payloadCh = 1
                        } else {
                            payload = frame
                            payloadCh = channels
                        }
                        val len = Protocol.buildPacket(
                            packet, payload, payload.size, seq, Protocol.SAMPLE_RATE, payloadCh, flags, tsUs
                        )
                        runCatching { udp?.send(DatagramPacket(packet, len, d.addr)) }
                    }
                }
                seq++
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
