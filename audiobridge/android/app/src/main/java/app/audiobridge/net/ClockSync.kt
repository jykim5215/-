package app.audiobridge.net

import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Maps the source monotonic clock to this device's monotonic clock.
 *
 * Low-RTT samples establish the offset. A bounded drift estimate then keeps the
 * speakers aligned during long sessions instead of assuming that every device's
 * oscillator runs at exactly the same speed.
 */
class ClockSync(private val send: (JSONObject) -> Unit) {
    @Volatile private var ready = false
    @Volatile private var anchorLocalUs = 0L
    @Volatile private var anchorOffsetUs = 0.0
    @Volatile private var driftPpm = 0.0
    private var bestRttUs = Long.MAX_VALUE
    private var driftSampleLocalUs = 0L
    private var driftSampleOffsetUs = 0.0

    val offsetUs: Long?
        get() {
            if (!ready) return null
            val now = nowUs()
            return (anchorOffsetUs +
                (now - anchorLocalUs) * driftPpm / 1_000_000.0).roundToLong()
        }

    fun nowUs(): Long = SystemClock.elapsedRealtimeNanos() / 1000

    fun tick() {
        synchronized(this) {
            if (bestRttUs != Long.MAX_VALUE) {
                bestRttUs = (bestRttUs + 2_000).coerceAtMost(200_000)
            }
        }
        send(JSONObject().put("type", "clk").put("t0", nowUs()))
    }

    /** Handles {"type":"clk","t0":localSend,"t1":sourceClock} replies. */
    @Synchronized
    fun onReply(t0: Long, t1: Long) {
        val t2 = nowUs()
        val rtt = t2 - t0
        if (rtt < 0 || rtt > 2_000_000) return
        if (bestRttUs != Long.MAX_VALUE && rtt > bestRttUs + 5_000) return
        bestRttUs = minOf(bestRttUs, rtt)

        val measuredOffset = (t0 + t2) / 2.0 - t1
        if (!ready) {
            anchorLocalUs = t2
            anchorOffsetUs = measuredOffset
            driftSampleLocalUs = t2
            driftSampleOffsetUs = measuredOffset
            ready = true
            return
        }

        val predicted = anchorOffsetUs +
            (t2 - anchorLocalUs) * driftPpm / 1_000_000.0
        val residual = measuredOffset - predicted
        if (abs(residual) > 200_000) {
            // Sleep/resume can invalidate the old relationship. Re-lock quickly.
            anchorLocalUs = t2
            anchorOffsetUs = measuredOffset
            driftPpm = 0.0
            driftSampleLocalUs = t2
            driftSampleOffsetUs = measuredOffset
            return
        }

        val sampleSpan = t2 - driftSampleLocalUs
        if (sampleSpan >= 5_000_000) {
            val measuredPpm = ((measuredOffset - driftSampleOffsetUs) *
                1_000_000.0 / sampleSpan).coerceIn(-250.0, 250.0)
            driftPpm = driftPpm * 0.9 + measuredPpm * 0.1
            driftSampleLocalUs = t2
            driftSampleOffsetUs = measuredOffset
        }
        anchorLocalUs = t2
        anchorOffsetUs = predicted + residual * 0.2
    }

    @Synchronized
    fun reset() {
        ready = false
        anchorLocalUs = 0
        anchorOffsetUs = 0.0
        driftPpm = 0.0
        bestRttUs = Long.MAX_VALUE
        driftSampleLocalUs = 0
        driftSampleOffsetUs = 0.0
    }
}
