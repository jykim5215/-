package app.audiobridge.audio

import app.audiobridge.net.Protocol

/**
 * 수신기 쪽 "끊김 없이 쓸 수 있는 최소 공통 지연" 추정 (순수 Kotlin, 가상 시뮬 공용).
 *
 * 한 프레임이 제시간에 소리 나려면 (도착까지 걸린 시간) + (출력 버퍼 깊이) ≤ 공통 지연 이어야 한다.
 *  - 도착까지 걸린 시간(transit) = 도착 시각 − (소스 타임스탬프 + 시계 오프셋): 캡처·송신·Wi-Fi 지연 전부.
 *  - 출력 버퍼 깊이 = 지금 쓰는 샘플이 실제로 나올 때까지 남은 시간.
 * 최근 [WINDOW_S]초의 최댓값(Wi-Fi가 잠깐 멈추는 꼬리까지)에 안전 여유를 더해 10ms 단위로 올린다.
 */
class DelayAdvisor {
    private val maxTransit = LongArray(WINDOW_S) { Long.MIN_VALUE }
    private val maxDepth = LongArray(WINDOW_S) { Long.MIN_VALUE }
    private var bucketSecond = Long.MIN_VALUE
    private var firstSecond = Long.MIN_VALUE

    @Synchronized
    fun onArrival(nowUs: Long, transitUs: Long) {
        val i = bucket(nowUs)
        if (transitUs > maxTransit[i]) maxTransit[i] = transitUs
    }

    @Synchronized
    fun onOutputDepth(nowUs: Long, depthUs: Long) {
        val i = bucket(nowUs)
        if (depthUs > maxDepth[i]) maxDepth[i] = depthUs
    }

    /** 끊김 없이 쓸 수 있는 최소 공통 지연(ms). 자료가 [MIN_DATA_S]초 미만이면 null. */
    @Synchronized
    fun needMs(nowUs: Long): Int? {
        bucket(nowUs)
        if (firstSecond == Long.MIN_VALUE || nowUs / 1_000_000 - firstSecond < MIN_DATA_S) return null
        val transit = maxTransit.max()
        val depth = maxDepth.max()
        if (transit == Long.MIN_VALUE || depth == Long.MIN_VALUE) return null
        val needUs = transit + depth + SAFETY_US
        val ms = ((needUs + 9_999) / 10_000 * 10).toInt()
        return ms.coerceIn(Protocol.MIN_PLAYOUT_DELAY_MS, Protocol.MAX_PLAYOUT_DELAY_MS)
    }

    @Synchronized
    fun reset() {
        maxTransit.fill(Long.MIN_VALUE)
        maxDepth.fill(Long.MIN_VALUE)
        bucketSecond = Long.MIN_VALUE
        firstSecond = Long.MIN_VALUE
    }

    /** 현재 초의 칸 번호. 초가 바뀌면 그 사이 지나간 칸을 비운다. */
    private fun bucket(nowUs: Long): Int {
        val sec = nowUs / 1_000_000
        if (firstSecond == Long.MIN_VALUE) firstSecond = sec
        if (bucketSecond == Long.MIN_VALUE) bucketSecond = sec
        if (sec > bucketSecond) {
            val steps = minOf(sec - bucketSecond, WINDOW_S.toLong()).toInt()
            for (k in 1..steps) {
                val j = ((bucketSecond + k) % WINDOW_S).toInt()
                maxTransit[j] = Long.MIN_VALUE
                maxDepth[j] = Long.MIN_VALUE
            }
            bucketSecond = sec
        }
        return (Math.floorMod(sec, WINDOW_S.toLong())).toInt()
    }

    companion object {
        const val WINDOW_S = 60
        const val MIN_DATA_S = 5
        /** 재생 스레드 깨어남·관측 잡음 여유 */
        const val SAFETY_US = 15_000L
    }
}

/**
 * 송신기 쪽 공통 지연 결정 (순수 Kotlin, 가상 시뮬 공용).
 * 모든 스피커가 같은 지연을 써야 소리가 맞으므로, 스피커들이 보고한 필요 지연 중 가장 큰 값을 쓴다.
 * 늘릴 때는 바로(이미 끊김이 났다는 뜻), 줄일 때는 [HOLD_MS] 동안 계속 여유가 있을 때만 줄인다.
 */
class DelayCoordinator(startMs: Int = Protocol.AUTO_START_DELAY_MS) {
    var currentMs = startMs
        private set
    private val needs = HashMap<Int, Pair<Int, Long>>()
    private var lowSinceMs: Long? = null

    /** @return 공통 지연이 바뀌었으면 새 값, 아니면 null */
    @Synchronized
    fun report(id: Int, needMs: Int, nowMs: Long): Int? {
        needs[id] = needMs to nowMs
        return evaluate(nowMs)
    }

    @Synchronized
    fun remove(id: Int) {
        needs.remove(id)
    }

    @Synchronized
    fun evaluate(nowMs: Long): Int? {
        needs.entries.removeAll { nowMs - it.value.second > STALE_MS }
        if (needs.isEmpty()) return null
        val target = needs.values.maxOf { it.first }
        if (target > currentMs) {
            currentMs = target
            lowSinceMs = null
            return currentMs
        }
        if (target <= currentMs - DECREASE_STEP_MS) {
            val since = lowSinceMs ?: nowMs.also { lowSinceMs = it }
            if (nowMs - since >= HOLD_MS) {
                currentMs = target
                lowSinceMs = null
                return currentMs
            }
        } else {
            lowSinceMs = null
        }
        return null
    }

    companion object {
        const val STALE_MS = 10_000L
        const val DECREASE_STEP_MS = 20
        const val HOLD_MS = 20_000L
        /** 수신기가 필요 지연을 보고하는 간격 */
        const val REPORT_INTERVAL_MS = 2_000L
    }
}
