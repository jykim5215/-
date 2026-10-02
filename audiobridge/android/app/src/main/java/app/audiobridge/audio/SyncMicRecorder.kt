package app.audiobridge.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import app.audiobridge.net.Protocol
import kotlin.concurrent.thread
import kotlin.math.max

/**
 * 음향 싱크 보정용 마이크 녹음 — 송신 소스가 마이크가 아닐 때(미디어 소리 공유 중) 따로 연다.
 * 프레임마다 첫 샘플의 녹음 시각(ModeBSender와 같은 방식: 하드웨어 캡처 시각, 없으면 하한선 추정)을 붙여 넘긴다.
 */
class SyncMicRecorder(private val onFrame: (FloatArray, Long) -> Unit) {
    @Volatile private var running = false

    @SuppressLint("MissingPermission") // RECORD_AUDIO는 엔진이 확인 후 호출
    fun start(): Boolean {
        val minBuf = AudioRecord.getMinBufferSize(Protocol.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = runCatching {
            AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.MIC)
                .setAudioFormat(
                    AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(Protocol.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build()
                )
                .setBufferSizeInBytes(max(minBuf, Protocol.frameBytes(1) * 8))
                .build()
        }.getOrNull() ?: return false
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            return false
        }
        running = true
        thread(name = "ab-sync-mic") {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
            val frameBytes = Protocol.frameBytes(1)
            val frameSamples = frameBytes / 2
            val buf = ByteArray(frameBytes)
            val timeline = CaptureTimeline(Protocol.SAMPLE_RATE)
            val hw = AudioTimestamp()
            var frameStart = 0L
            try {
                rec.startRecording()
                while (running) {
                    var off = 0
                    while (off < frameBytes && running) {
                        val n = rec.read(buf, off, frameBytes - off)
                        if (n < 0) return@thread
                        off += n
                    }
                    val readDoneUs = SystemClock.elapsedRealtimeNanos() / 1000
                    val ok = rec.getTimestamp(hw, AudioTimestamp.TIMEBASE_BOOTTIME) == AudioRecord.SUCCESS
                    val ts = timeline.frameStartUs(
                        frameStart, frameSamples, readDoneUs,
                        if (ok) hw.framePosition else null, if (ok) hw.nanoTime / 1000 else null,
                    )
                    frameStart += frameSamples
                    onFrame(FloatArray(frameSamples) { i ->
                        ((buf[2 * i].toInt() and 0xFF) or (buf[2 * i + 1].toInt() shl 8)) / 32768f
                    }, ts)
                }
            } finally {
                runCatching { rec.stop() }
                rec.release()
            }
        }
        return true
    }

    fun stop() {
        running = false
    }
}

/** 타임스탬프가 붙은 녹음 프레임을 모아 하나의 연속 녹음으로 만든다. */
class SyncRecording(private val sampleRate: Int) {
    private val frames = ArrayList<Pair<Long, FloatArray>>()

    @Synchronized
    fun add(mono: FloatArray, tsUs: Long) {
        frames += tsUs to mono
    }

    /** (첫 샘플의 녹음 시각 µs, 샘플들) — 프레임은 자기 타임스탬프 위치에 놓는다 */
    @Synchronized
    fun build(): Pair<Long, FloatArray>? {
        if (frames.isEmpty()) return null
        val start = frames.first().first
        val usPerSample = 1_000_000.0 / sampleRate
        val last = frames.last()
        val total = ((last.first - start) / usPerSample).toInt() + last.second.size
        if (total <= 0 || total > sampleRate * 60) return null
        val out = FloatArray(total)
        for ((ts, f) in frames) {
            val i0 = Math.round((ts - start) / usPerSample).toInt()
            for (k in f.indices) if (i0 + k in out.indices) out[i0 + k] = f[k]
        }
        return start to out
    }
}
