package app.audiobridge.audio

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.SystemClock
import app.audiobridge.net.Protocol
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 두 기기의 실제 스피커와 마이크를 왕복하는 시험음으로 오디오 경로의 대략적인 지연을 잰다.
 * 네트워크 시계 보정과는 별개이며, 실패하면 호출자가 기존 설정을 그대로 유지한다.
 */
object AcousticCalibrator {
    const val REQUEST_FREQUENCY_HZ = 1_800.0
    const val RESPONSE_FREQUENCY_HZ = 3_000.0
    const val REPLY_HOLD_MS = 350

    private const val SAMPLE_RATE = 48_000
    private const val TONE_DURATION_MS = 140
    private const val DETECTION_TIMEOUT_MS = 8_000L
    private const val DETECTION_BLOCK_SAMPLES = 480 // 10ms
    private const val MIN_RMS = 280.0
    private const val MIN_TONE_RATIO = 0.10
    private const val REQUIRED_BLOCKS = 2

    data class Measurement(
        val roundTripMs: Int,
        val acousticOneWayMs: Int,
        val recommendedDelayMs: Int,
    )

    /** 요청음을 낸 뒤 상대의 응답음을 같은 기기의 마이크로 감지한다. */
    fun measureInitiator(): Measurement {
        ToneCapture(RESPONSE_FREQUENCY_HZ).use { capture ->
            capture.start()
            Thread.sleep(120)
            val emittedAt = SystemClock.elapsedRealtime()
            playTone(REQUEST_FREQUENCY_HZ)
            val detectedAt = capture.awaitTone(DETECTION_TIMEOUT_MS)
                ?: error("상대 기기의 응답음을 듣지 못했어요")
            val roundTripMs = (detectedAt - emittedAt).toInt().coerceAtLeast(0)
            val oneWayMs = ((roundTripMs - REPLY_HOLD_MS).coerceAtLeast(0) / 2)
            return Measurement(
                roundTripMs = roundTripMs,
                acousticOneWayMs = oneWayMs,
                recommendedDelayMs = Protocol.recommendedPlayoutDelayMs(oneWayMs),
            )
        }
    }

    /** 상대의 요청음을 마이크로 들은 뒤 고정 대기 후 응답음을 스피커로 낸다. */
    fun respond(holdMs: Int, onReady: () -> Unit) {
        ToneCapture(REQUEST_FREQUENCY_HZ).use { capture ->
            capture.start()
            onReady()
            capture.awaitTone(DETECTION_TIMEOUT_MS)
                ?: error("시험음을 듣지 못했어요. 두 기기의 볼륨과 거리를 확인해 주세요")
        }
        Thread.sleep(holdMs.coerceIn(200, 1_000).toLong())
        playTone(RESPONSE_FREQUENCY_HZ)
    }

    private fun playTone(frequencyHz: Double) {
        val sampleCount = SAMPLE_RATE * TONE_DURATION_MS / 1_000
        val pcm = ShortArray(sampleCount)
        val fadeSamples = SAMPLE_RATE / 100 // 10ms click 방지 페이드
        for (i in pcm.indices) {
            val edge = minOf(1.0, i.toDouble() / fadeSamples, (pcm.lastIndex - i).toDouble() / fadeSamples)
            val sample = sin(2.0 * PI * frequencyHz * i / SAMPLE_RATE) * 0.42 * edge
            pcm[i] = (sample * Short.MAX_VALUE).toInt().toShort()
        }
        val track = AudioTrack(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
            AudioFormat.Builder()
                .setSampleRate(SAMPLE_RATE)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
            pcm.size * 2,
            AudioTrack.MODE_STATIC,
            AudioManager.AUDIO_SESSION_ID_GENERATE,
        )
        try {
            check(track.state == AudioTrack.STATE_INITIALIZED) { "스피커를 열 수 없어요" }
            check(track.write(pcm, 0, pcm.size, AudioTrack.WRITE_BLOCKING) > 0) { "시험음을 만들 수 없어요" }
            track.play()
            Thread.sleep((TONE_DURATION_MS + 60).toLong())
        } finally {
            runCatching { track.stop() }
            track.release()
        }
    }

    @SuppressLint("MissingPermission")
    private class ToneCapture(private val frequencyHz: Double) : AutoCloseable {
        private val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        private val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            max(minBuffer, DETECTION_BLOCK_SAMPLES * 8),
        )

        fun start() {
            check(minBuffer > 0 && recorder.state == AudioRecord.STATE_INITIALIZED) { "마이크를 열 수 없어요" }
            recorder.startRecording()
            check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "마이크 녹음을 시작할 수 없어요" }
        }

        fun awaitTone(timeoutMs: Long): Long? {
            val deadline = SystemClock.elapsedRealtime() + timeoutMs
            val block = ShortArray(DETECTION_BLOCK_SAMPLES)
            var consecutive = 0
            while (SystemClock.elapsedRealtime() < deadline) {
                val count = recorder.read(block, 0, block.size, AudioRecord.READ_BLOCKING)
                if (count <= 0) continue
                if (containsTone(block, count, frequencyHz)) {
                    consecutive++
                    if (consecutive >= REQUIRED_BLOCKS) return SystemClock.elapsedRealtime()
                } else {
                    consecutive = 0
                }
            }
            return null
        }

        override fun close() {
            runCatching { recorder.stop() }
            recorder.release()
        }
    }

    /** Goertzel 검출: 전체 에너지 중 목표 주파수 성분이 충분히 큰지 본다. */
    private fun containsTone(samples: ShortArray, count: Int, frequencyHz: Double): Boolean {
        if (count < DETECTION_BLOCK_SAMPLES / 2) return false
        val coefficient = 2.0 * cos(2.0 * PI * frequencyHz / SAMPLE_RATE)
        var q1 = 0.0
        var q2 = 0.0
        var totalEnergy = 0.0
        for (i in 0 until count) {
            val value = samples[i].toDouble()
            val q0 = coefficient * q1 - q2 + value
            q2 = q1
            q1 = q0
            totalEnergy += value * value
        }
        if (totalEnergy <= 0.0 || sqrt(totalEnergy / count) < MIN_RMS) return false
        val tonePower = q1 * q1 + q2 * q2 - coefficient * q1 * q2
        return tonePower / (totalEnergy * count) >= MIN_TONE_RATIO
    }
}
