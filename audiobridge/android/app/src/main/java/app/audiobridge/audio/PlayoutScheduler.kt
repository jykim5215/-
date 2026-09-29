package app.audiobridge.audio

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 샘플 단위 동기 재생 판단기 (Android/Windows/가상 시뮬 공용, 순수 Kotlin).
 *
 * 입력은 "다음에 쓸 샘플이 스피커에서 나올 예상 시각 - 그 샘플의 목표 시각"(errUs, 양수=늦음) 하나다.
 *  - 맞추기 전(또는 크게 어긋났을 때): 이르면 정확히 그만큼 무음을, 늦으면 정확히 그만큼 샘플을 건너뛴다.
 *    → 5ms 프레임 단위가 아니라 1샘플(≈21µs) 단위로 맞춘다.
 *  - 맞춘 뒤: 잡음을 걸러 낸 오차가 ±[SLEW_US]를 넘으면 프레임마다 1~2샘플을 빼거나 반복한다.
 *    → 소스·수신 기기의 오디오 클럭 속도 차이(수십~수백 ppm)를 끊김 없이 따라간다.
 *  - 데이터가 없거나 오차가 [RELOCK_US]를 넘으면 다시 맞춘다(이때만 들리는 끊김이 생긴다).
 */
class PlayoutScheduler(private val sampleRate: Int, private val frameSamples: Int) {
    enum class Kind { SILENCE, SKIP, PLAY }

    /**
     * [SILENCE]: 무음 [samples]개를 쓴다. [SKIP]: 머리 프레임에서 [samples]개를 버린다.
     * [PLAY]: 머리 프레임의 남은 [samples]개를 쓰되, [adjust]<0이면 끝에서 그만큼 빼고 >0이면 마지막 샘플을 그만큼 반복한다.
     */
    class Decision(val kind: Kind, val samples: Int, val adjust: Int = 0)

    var locked = false
        private set
    private var filteredErrUs = 0.0
    private val usPerSample = 1_000_000.0 / sampleRate

    /** @param errUs null이면 재생할 데이터가 없음. @param headRemaining 머리 프레임에서 아직 안 쓴 샘플 수 */
    fun decide(errUs: Long?, headRemaining: Int): Decision {
        if (errUs == null) {
            locked = false
            return Decision(Kind.SILENCE, frameSamples)
        }
        if (locked && abs(errUs) > RELOCK_US) locked = false
        if (!locked) {
            val n = (abs(errUs) / usPerSample).roundToInt()
            return when {
                errUs < -LOCK_TOL_US -> Decision(Kind.SILENCE, min(n, frameSamples))
                errUs > LOCK_TOL_US -> Decision(Kind.SKIP, min(n, headRemaining))
                else -> {
                    locked = true
                    filteredErrUs = errUs.toDouble()
                    Decision(Kind.PLAY, headRemaining)
                }
            }
        }
        filteredErrUs += (errUs - filteredErrUs) * FILTER_ALPHA
        val adjust = when {
            filteredErrUs > SLEW_FAST_US -> -2
            filteredErrUs > SLEW_US -> -1
            filteredErrUs < -SLEW_FAST_US -> 2
            filteredErrUs < -SLEW_US -> 1
            else -> 0
        }
        // 뺀(늦음 해소)/반복한(이름 해소) 만큼 오차가 즉시 줄어든 것으로 반영해 과보정을 막는다.
        filteredErrUs += adjust * usPerSample
        return Decision(Kind.PLAY, headRemaining, adjust)
    }

    fun reset() {
        locked = false
        filteredErrUs = 0.0
    }

    companion object {
        /** 이 안이면 맞춘 것으로 본다 (≈10샘플) */
        const val LOCK_TOL_US = 200L
        /** 맞춘 뒤 이만큼 어긋나면 다시 맞춘다 */
        const val RELOCK_US = 10_000L
        /**
         * 잡음을 거른 오차가 이보다 크면 1샘플씩 보정 (프레임당 1샘플 = 5ms마다 21µs ≈ 4,000ppm까지).
         * 재생 헤드 관측 잡음(σ 수백 µs)을 [FILTER_ALPHA]로 거르면 σ 수십 µs가 되므로, 그보다 조금 넓게 잡는다.
         */
        const val SLEW_US = 120.0
        const val SLEW_FAST_US = 1_000.0
        /** 프레임(5ms)마다 반영 비율 — 시간 상수 약 100ms */
        private const val FILTER_ALPHA = 0.05
    }
}
