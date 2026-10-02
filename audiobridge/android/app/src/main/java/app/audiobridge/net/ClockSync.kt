package app.audiobridge.net

import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Maps the source monotonic clock to this device's monotonic clock.
 *
 * Every reply gives one offset sample whose error is at most half of its round trip,
 * so only the fastest round trips are trusted: the offset and the clock-rate drift are
 * fitted as a line through the lowest-RTT quarter of the last [WINDOW_US] of samples.
 * A sample that disagrees by more than [JUMP_US] while having a normal round trip means
 * the clocks really jumped (sleep/resume), so the history is dropped and re-locked.
 */
class ClockSync(private val send: (JSONObject) -> Unit) {
    private class Sample(val localUs: Long, val offsetUs: Double, val rttUs: Long)

    /** offset(local) = offsetAtT0 + (local - t0) * slope */
    private class Model(val t0: Long, val offsetAtT0: Double, val slope: Double)

    private val samples = ArrayDeque<Sample>()
    @Volatile private var model: Model? = null

    val offsetUs: Long?
        get() {
            val m = model ?: return null
            return (m.offsetAtT0 + (nowUs() - m.t0) * m.slope).roundToLong()
        }

    fun nowUs(): Long = SystemClock.elapsedRealtimeNanos() / 1000

    fun tick() {
        send(JSONObject().put("type", "clk").put("t0", nowUs()))
    }

    /**
     * How long to wait before the next [tick]. Queries are tiny, and more low-RTT samples shrink the
     * offset bias that would otherwise sit in every speaker's timing (sim/sync: p99 0.88ms → 0.44ms at 250ms).
     */
    @Synchronized
    fun nextTickDelayMs(): Long = if (samples.size < LOCK_SAMPLES) FAST_TICK_MS else TICK_MS

    /** Handles {"type":"clk","t0":localSend,"t1":sourceClock} replies. */
    @Synchronized
    fun onReply(t0: Long, t1: Long) {
        val t2 = nowUs()
        val rtt = t2 - t0
        if (rtt < 0 || rtt > 2_000_000) return
        val measured = (t0 + t2) / 2.0 - t1

        val m = model
        if (m != null && rtt <= samples.minOf { it.rttUs } + 5_000 &&
            abs(measured - (m.offsetAtT0 + (t2 - m.t0) * m.slope)) > JUMP_US
        ) {
            samples.clear()
        }
        samples.addLast(Sample(t2, measured, rtt))
        while (samples.size > MAX_SAMPLES || t2 - samples.first().localUs > WINDOW_US) samples.removeFirst()
        model = fit(m?.slope ?: 0.0)
    }

    private fun fit(previousSlope: Double): Model {
        val best = samples.sortedBy { it.rttUs }.take(maxOf(MIN_FIT_SAMPLES, samples.size / 4))
        val n = best.size.toDouble()
        val meanT = best.sumOf { it.localUs.toDouble() } / n
        val meanO = best.sumOf { it.offsetUs } / n
        val span = best.maxOf { it.localUs } - best.minOf { it.localUs }
        val slope = if (best.size >= MIN_FIT_SAMPLES && span >= MIN_SLOPE_SPAN_US) {
            val sxx = best.sumOf { (it.localUs - meanT) * (it.localUs - meanT) }
            val sxy = best.sumOf { (it.localUs - meanT) * (it.offsetUs - meanO) }
            (sxy / sxx).coerceIn(-MAX_DRIFT, MAX_DRIFT)
        } else {
            previousSlope
        }
        return Model(meanT.roundToLong(), meanO, slope)
    }

    @Synchronized
    fun reset() {
        samples.clear()
        model = null
    }

    companion object {
        const val FAST_TICK_MS = 250L
        const val TICK_MS = 250L
        private const val LOCK_SAMPLES = 8
        private const val MAX_SAMPLES = 360
        private const val WINDOW_US = 90_000_000L
        private const val MIN_FIT_SAMPLES = 4
        private const val MIN_SLOPE_SPAN_US = 5_000_000L
        private const val JUMP_US = 200_000.0
        /** 500ppm: far beyond real crystal error, only guards against a bad fit */
        private const val MAX_DRIFT = 500e-6
    }
}
