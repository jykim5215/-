package app.audiobridge.net

import android.os.SystemClock
import org.json.JSONObject

/**
 * 컨트롤 채널 위의 NTP식 시계 동기 (PROTOCOL.md §7).
 * 재생(수신) 측이 질의하고, 소스 측이 자기 시계(t1)를 붙여 에코한다.
 * 왕복시간이 가장 짧은 샘플의 오프셋을 채택한다: toLocal(srcTs) = srcTs + offsetUs.
 */
class ClockSync(private val send: (JSONObject) -> Unit) {
    @Volatile var offsetUs: Long? = null
        private set
    private var bestRtt = Long.MAX_VALUE

    fun nowUs(): Long = SystemClock.elapsedRealtimeNanos() / 1000

    /** 주기적으로 호출 — 질의 발송. */
    fun tick() {
        // 오래된 최적 샘플이 계속 군림하지 않도록 서서히 완화
        if (bestRtt != Long.MAX_VALUE) bestRtt += 2000
        send(JSONObject().put("type", "clk").put("t0", nowUs()))
    }

    /** {"type":"clk","t0":보낸시각,"t1":상대시각} 응답 처리. */
    fun onReply(t0: Long, t1: Long) {
        val t2 = nowUs()
        val rtt = t2 - t0
        if (rtt < 0 || rtt > 2_000_000) return
        if (rtt <= bestRtt) {
            bestRtt = rtt
            offsetUs = (t0 + t2) / 2 - t1
        }
    }

    fun reset() {
        offsetUs = null
        bestRtt = Long.MAX_VALUE
    }
}
