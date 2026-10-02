package sim.sync

import android.os.SystemClock
import app.audiobridge.audio.CaptureTimeline
import app.audiobridge.audio.DelayAdvisor
import app.audiobridge.audio.DelayCoordinator
import app.audiobridge.audio.JitterBuffer
import app.audiobridge.audio.PlayoutScheduler
import app.audiobridge.audio.SyncCalibration
import app.audiobridge.audio.SyncChirp
import app.audiobridge.net.ClockSync
import app.audiobridge.net.PacketInfo
import java.util.PriorityQueue
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong
import kotlin.random.Random
import kotlin.system.exitProcess

/*
 * AudioBridge 동기 재생 가상 시뮬레이터 — 목표: "지연은 최소로, 여러 스피커의 소리는 같은 순간에".
 *
 * 실제 앱 코드를 그대로 돌린다: ClockSync.kt(시계 동기), JitterBuffer.kt(수신 버퍼), Protocol.kt,
 * PlayoutScheduler.kt(새 샘플 단위 재생 판단), CaptureTimeline.kt(새 송신 타임스탬프).
 * 비교용 기존 재생 판단(ModeAPlayer.playLoop의 5ms 프레임 판단)은 아래 legacyStep에 그대로 옮겼다.
 *
 * 가상 세계(모든 시간은 '진짜 시간' µs 기준):
 *  - 기기마다 단조시계 오프셋·속도 오차(ppm), 오디오 칩(ADC/DAC) 속도 오차(ppm)가 다르다.
 *  - 송신: 캡처 드라이버가 20ms씩 몰아서 넘겨주고, read() 완료 시각이 흔들린다(스레드 선점 포함).
 *  - Wi-Fi: 기본 지연 + 로그정규 지터 + 드문 스파이크 + 몰아서 멈추는 구간(stall) + 손실, 링크별 FIFO.
 *  - 수신: 출력 버퍼(블로킹 write), 재생 헤드 관측 잡음, 스레드 지연, OS가 모르는 스피커 내부(DSP) 지연.
 * 측정: 같은 소스 샘플이 각 스피커에서 '실제로 소리로 나온' 시각의 차(싱크 오차), 녹음→소리 지연, 끊김 횟수.
 */

const val FS = 48_000
const val FRAME = 240                       // 5ms
const val US_PER_SAMPLE = 1_000_000.0 / FS

// ───────────────────────── 이벤트 루프 ─────────────────────────

class Sim {
    private class Ev(val t: Double, val seq: Long, val fn: () -> Unit)
    private val q = PriorityQueue<Ev>(compareBy<Ev>({ it.t }, { it.seq }))
    private var seq = 0L
    var now = 0.0
        private set

    fun at(t: Double, fn: () -> Unit) { q.add(Ev(max(t, now), seq++, fn)) }
    fun run(until: Double) {
        while (q.isNotEmpty() && q.peek().t <= until) { val e = q.poll(); now = e.t; e.fn() }
        now = until
    }
}

// ───────────────────────── Wi-Fi ─────────────────────────

class NetProfile(
    val label: String,
    val baseUs: Double, val jitMedianUs: Double, val jitSigma: Double,
    val spikeProb: Double, val spikeMinUs: Double, val spikeMaxUs: Double,
    val stallPerSec: Double, val stallMinUs: Double, val stallMaxUs: Double,
    val lossProb: Double,
)

val GOOD = NetProfile("좋은 5GHz 공유기", 1_500.0, 700.0, 0.5, 0.001, 5_000.0, 20_000.0, 0.02, 10_000.0, 30_000.0, 0.001)
val HOME = NetProfile("보통 가정 Wi-Fi", 2_500.0, 1_500.0, 0.8, 0.01, 10_000.0, 60_000.0, 0.1, 30_000.0, 120_000.0, 0.005)
val BUSY = NetProfile("혼잡·절전 Wi-Fi", 3_000.0, 3_000.0, 1.0, 0.02, 20_000.0, 150_000.0, 0.3, 50_000.0, 300_000.0, 0.02)

/** 한 방향 링크. Wi-Fi 링크 계층은 순서를 지키므로 도착은 FIFO. null = 손실. */
class Link(private val p: NetProfile, private val rng: Random) {
    private var lastArrival = Double.NEGATIVE_INFINITY
    private var stallStart = Double.NEGATIVE_INFINITY
    private var stallEnd = Double.NEGATIVE_INFINITY
    private var nextStall = expo(p.stallPerSec)

    private fun expo(perSec: Double) = -ln(1 - rng.nextDouble()) / perSec * 1e6
    private fun gauss(): Double {
        var s: Double; var u: Double; var v: Double
        do { u = rng.nextDouble() * 2 - 1; v = rng.nextDouble() * 2 - 1; s = u * u + v * v } while (s >= 1 || s == 0.0)
        return u * kotlin.math.sqrt(-2 * ln(s) / s)
    }

    fun deliver(sendT: Double): Double? {
        while (sendT >= nextStall) {
            stallStart = nextStall
            stallEnd = nextStall + p.stallMinUs + rng.nextDouble() * (p.stallMaxUs - p.stallMinUs)
            nextStall = stallEnd + expo(p.stallPerSec)
        }
        if (rng.nextDouble() < p.lossProb) return null
        var arr = sendT + p.baseUs + p.jitMedianUs * exp(p.jitSigma * gauss())
        if (rng.nextDouble() < p.spikeProb) arr += p.spikeMinUs + rng.nextDouble() * (p.spikeMaxUs - p.spikeMinUs)
        if (sendT in stallStart..stallEnd) arr = max(arr, stallEnd + rng.nextDouble() * 1_000)
        arr = max(arr, lastArrival + 20)
        lastArrival = arr
        return arr
    }
}

// ───────────────────────── 기기 ─────────────────────────

class DeviceSpec(
    val name: String,
    val sysPpm: Double, val dacPpm: Double,
    val bufferMs: Int, val dspUs: Double, val headNoiseUs: Double,
)

val RECEIVERS = listOf(
    DeviceSpec("폰A 저지연", sysPpm = 12.0, dacPpm = -35.0, bufferMs = 20, dspUs = 2_300.0, headNoiseUs = 150.0),
    DeviceSpec("폰B 보급형", sysPpm = -28.0, dacPpm = 80.0, bufferMs = 40, dspUs = 9_100.0, headNoiseUs = 400.0),
    DeviceSpec("Windows PC", sysPpm = 6.0, dacPpm = 20.0, bufferMs = 30, dspUs = 1_400.0, headNoiseUs = 250.0),
)
const val SRC_ADC_PPM = 25.0
const val CAPTURE_PERIOD_US = 20_000.0      // 캡처 드라이버가 몰아서 넘겨주는 단위

enum class SrcTs(val label: String) { READ_DONE("read 완료 시각(현재)"), HW("하드웨어 캡처 시각"), ENVELOPE("하한선 추정") }
enum class Sched(val label: String) { LEGACY("5ms 프레임(현재)"), SAMPLE("샘플 단위") }
enum class Clk { V28, NEW }

/** 시계 동기 구현을 바꿔 끼우는 어댑터. 간격은 각 버전의 BridgeEngine 타이머와 같게 한다. */
interface ClockAdapter {
    fun tick(); fun onReply(t0: Long, t1: Long); val offsetUs: Long?; fun nextTickDelayMs(): Long
}

/** 공통 지연을 자동으로 정하는 설정값 (Config.delayMs에 넣는다) */
const val AUTO = -1

/** 스피커 내부(DSP) 지연 차이 보정: 없음 / 앱의 '추가 지연'(1ms 단위) / 정밀(µs, 안다고 가정) / 음향 보정으로 잰 값 */
enum class Comp { NONE, MS, EXACT, MEASURED }

class Config(
    val net: NetProfile, val delayMs: Int, val srcTs: SrcTs, val sched: Sched,
    val comp: Comp, val seconds: Int, val seed: Int = 7, val diag: Boolean = false, val clk: Clk = Clk.NEW,
)

class Result(
    val syncP50: Double, val syncP99: Double, val syncMax: Double, val latencyMs: Double,
    val lateGlitchPerMin: Double, val lossGlitchPerMin: Double, val coverage: Double,
    /** 도착은 했는데 늦어서 소리로 못 낸 프레임 비율 (손실 제외) */
    val lateFraction: Double,
    /** 자동 모드에서 측정 구간 동안 쓴 공통 지연 (최소~최대)과 바뀐 횟수(바뀔 때마다 한 번 건너뜀) */
    val delayRange: IntRange,
    val delayChanges: Int,
)

private class Rx(val spec: DeviceSpec, val cfg: Config, val sim: Sim, seedRng: Random, nFrames: Int) {
    val offUs = seedRng.nextDouble(1e9, 9e9)            // 기기마다 제각각인 부팅 후 경과 시간
    fun local(t: Double) = offUs + t * (1 + spec.sysPpm * 1e-6)
    val rng = Random(seedRng.nextInt())
    val jitter = JitterBuffer()
    val clock: ClockAdapter = when (cfg.clk) {
        Clk.NEW -> ClockSync { obj -> clkSend(obj.optLong("t0", 0)) }.let { c ->
            object : ClockAdapter {
                override fun tick() = c.tick()
                override fun onReply(t0: Long, t1: Long) = c.onReply(t0, t1)
                override val offsetUs get() = c.offsetUs
                override fun nextTickDelayMs() = c.nextTickDelayMs()
            }
        }
        Clk.V28 -> app.audiobridge.net.v28.ClockSync { obj -> clkSend(obj.optLong("t0", 0)) }.let { c ->
            object : ClockAdapter {
                override fun tick() = c.tick()
                override fun onReply(t0: Long, t1: Long) = c.onReply(t0, t1)
                override val offsetUs get() = c.offsetUs
                override fun nextTickDelayMs() = if (c.offsetUs == null) 400L else 3_000L   // v2.8 BridgeEngine 타이머
            }
        }
    }
    var clkSend: (Long) -> Unit = {}
    val sched = PlayoutScheduler(FS, FRAME)
    val rate = FS * (1 + spec.dacPpm * 1e-6) / 1e6    // 샘플/µs(진짜 시간)
    val capSamples = spec.bufferMs * FS / 1000

    var written = 0L
    var pos = 0.0
    var posT = 0.0
    var cursor = 0
    var fallbackOffset: Long? = null
    var extraUs = 0.0
    var delayMs = if (cfg.delayMs == AUTO) app.audiobridge.net.Protocol.AUTO_START_DELAY_MS else cfg.delayMs
    val advisor = DelayAdvisor()
    val toneQueue = ArrayDeque<Long>()
    val toneEmissions = ArrayList<Double>()
    val delayLog = ArrayList<Int>()
    val arrived = BooleanArray(nFrames)
    val emission = DoubleArray(nFrames) { Double.NaN }
    var lastWasAudio = false
    var lastWasDrop = false
    var lateGlitches = 0
    var lossGlitches = 0
    var measureFrom = Double.MAX_VALUE
    var measureTo = Double.MAX_VALUE
    val clockErrUs = ArrayList<Double>()

    fun <T> onThisDevice(fn: () -> T): T {
        SystemClock.current = java.util.function.LongSupplier { (local(sim.now) * 1000).toLong() }
        return fn()
    }

    fun updatePos(t: Double) { pos = min(written.toDouble(), pos + (t - posT) * rate); posT = t }

    /** 앱이 AudioTrack.getTimestamp로 계산하는 '다음 쓰는 샘플의 재생 시각'(이 기기 시계) + 관측 잡음 */
    fun presentLocalUs(t: Double): Long {
        val pendingUs = (written - pos) * US_PER_SAMPLE
        val noise = rng.nextDouble(-1.0, 1.0) * spec.headNoiseUs * 1.7   // σ≈headNoise 인 균등 잡음
        return (local(t) + pendingUs + noise).roundToLong()
    }

    private fun inWindow(t: Double) = t in measureFrom..measureTo

    private fun countGap(t: Double, loss: Boolean) {
        if (lastWasAudio && inWindow(t)) { if (loss) lossGlitches++ else lateGlitches++ }
        lastWasAudio = false; lastWasDrop = false
    }

    private fun countDrop(t: Double) {
        if (!lastWasDrop && lastWasAudio && inWindow(t)) lateGlitches++
        lastWasDrop = true
    }

    /** n개 샘플을 출력 버퍼에 쓴다. frameK/offsetInFrame: 소스 프레임 번호와 그 안의 시작 위치(무음이면 -1). */
    private fun write(t: Double, n: Int, frameK: Int, offsetInFrame: Int): Double {
        updatePos(t)
        val startT = if (pos < written) t + (written - pos) / rate else t
        if (frameK >= 0) {
            if (emission[frameK].isNaN()) emission[frameK] = startT + spec.dspUs - offsetInFrame / rate
            lastWasAudio = true; lastWasDrop = false
        }
        written += n
        val unblock = if (pos >= written - capSamples) t else t + (written - capSamples - pos) / rate
        return unblock + 30 + if (rng.nextDouble() < 0.002) rng.nextDouble(1_000.0, 8_000.0) else 0.0
    }

    private fun frameOf(payload: ByteArray): Int =
        ((payload[0].toInt() and 0xFF) shl 16 or ((payload[1].toInt() and 0xFF) shl 8) or (payload[2].toInt() and 0xFF)) - 1

    fun offsetFor(headTs: Long, t: Double): Long =
        onThisDevice { clock.offsetUs } ?: (fallbackOffset ?: (local(t).toLong() - headTs).also { fallbackOffset = it })

    /** ModeAPlayer.playLoop 한 바퀴 (기존 방식 그대로) */
    fun legacyStep(t: Double): Double {
        val head = jitter.peek()
        if (head == null) { countGap(t, loss = false); return write(t, FRAME, -1, 0) }
        val target = head.tsUs + offsetFor(head.tsUs, t) + delayMs * 1000L + extraUs.roundToLong()
        val lead = target - presentLocalUs(t)
        return when {
            lead > 5_000 -> { if (lastWasAudio) countGap(t, loss = false); write(t, FRAME, -1, 0) }
            lead < -20_000 -> { jitter.poll(); countDrop(t); t + 20 }
            else -> {
                val f = jitter.poll()!!
                val k = frameOf(f.data)
                if (k < 0) { countGap(t, loss = true); write(t, FRAME, -1, 0) } else write(t, FRAME, k, 0)
            }
        }
    }

    /** 새 방식: PlayoutScheduler(실제 앱 코드)로 샘플 단위 판단 */
    fun sampleStep(t: Double): Double {
        val head = jitter.peek()
        if (head == null) {
            val d = sched.decide(null, 0)
            countGap(t, loss = false); return write(t, d.samples, -1, 0)
        }
        val target = head.tsUs + offsetFor(head.tsUs, t) + delayMs * 1000L + extraUs.roundToLong() +
            (cursor * US_PER_SAMPLE).roundToLong()
        val d = sched.decide(presentLocalUs(t) - target, FRAME - cursor)
        val k = frameOf(head.data)
        return when (d.kind) {
            PlayoutScheduler.Kind.SILENCE -> { countGap(t, loss = false); write(t, d.samples, -1, 0) }
            PlayoutScheduler.Kind.SKIP -> {
                cursor += d.samples
                if (cursor >= FRAME) { jitter.poll(); cursor = 0 }
                countDrop(t); t + 20
            }
            PlayoutScheduler.Kind.PLAY -> {
                jitter.poll()
                val from = cursor; cursor = 0
                // 음향 보정 시험음: 이 조각이 예약된 소스 시각을 품고 있으면 그 샘플이 실제로 소리 나는 시각을 기록
                toneQueue.firstOrNull()?.let { at ->
                    val chunkSrcUs = head.tsUs + from * US_PER_SAMPLE
                    val idx = (at - chunkSrcUs) / US_PER_SAMPLE
                    if (idx < d.samples + d.adjust) {
                        toneQueue.removeFirst()
                        if (idx >= 0) {
                            updatePos(t)
                            val startT = if (pos < written) t + (written - pos) / rate else t
                            toneEmissions += startT + idx / rate + spec.dspUs
                        } else toneEmissions += Double.NaN   // 이미 지나감(건너뛴 구간) → 못 들림
                    }
                }
                if (k < 0) { countGap(t, loss = true); write(t, d.samples, -1, 0) }
                else write(t, max(0, d.samples + d.adjust), k, from)
            }
        }
    }

    fun step(t: Double) {
        advisor.onOutputDepth(local(t).toLong(), ((written - pos) * US_PER_SAMPLE).toLong())
        val next = if (cfg.sched == Sched.LEGACY) legacyStep(t) else sampleStep(t)
        sim.at(next) { step(sim.now) }
    }
}

fun simulate(cfg: Config): Result {
    val sim = Sim()
    val rng = Random(cfg.seed)
    val totalUs = cfg.seconds * 1e6
    val streamStart = 1e6
    val nFrames = ((totalUs - streamStart) / (FRAME * US_PER_SAMPLE)).toInt() + 10
    val srcOff = rng.nextDouble(1e9, 9e9)
    fun srcLocal(t: Double) = srcOff + t
    val rxs = RECEIVERS.map { Rx(it, cfg, sim, rng, nFrames) }
    if (cfg.comp != Comp.NONE) {
        // 기기별 스피커 내부 지연 차이를 재서 빠른 기기를 '추가 지연'으로 늦춘 경우
        val maxDsp = rxs.maxOf { it.spec.dspUs }
        rxs.forEach {
            val need = maxDsp - it.spec.dspUs
            it.extraUs = if (cfg.comp == Comp.MS) (need / 1000).roundToInt() * 1000.0 else need
        }
    }
    val warmup = streamStart + if (cfg.comp == Comp.MEASURED) 20e6 else 10e6
    val tailUs = (if (cfg.delayMs == AUTO) 1_000 else cfg.delayMs) * 1000.0
    rxs.forEach { it.measureFrom = warmup; it.measureTo = totalUs - tailUs - 200_000 }

    // 시계 동기: 수신기가 clk를 보내고 소스가 자기 시계로 답한다
    for (rx in rxs) {
        val up = Link(cfg.net, Random(rng.nextInt())); val down = Link(cfg.net, Random(rng.nextInt()))
        rx.clkSend = { t0 ->
            val sent = sim.now
            up.deliver(sent)?.let { atSrc ->
                sim.at(atSrc) {
                    val t1 = srcLocal(sim.now).toLong()
                    val proc = 200 + if (rx.rng.nextDouble() < 0.02) rx.rng.nextDouble(1_000.0, 8_000.0) else 0.0
                    down.deliver(sim.now + proc)?.let { back -> sim.at(back) { rx.onThisDevice { rx.clock.onReply(t0, t1) } } }
                }
            }
        }
        fun ticker() {
            rx.onThisDevice { rx.clock.tick() }
            // BridgeEngine의 시계 동기 타이머와 같은 간격 (ClockSync가 정한다)
            sim.at(sim.now + rx.onThisDevice { rx.clock.nextTickDelayMs() } * 1000.0) { ticker() }
        }
        sim.at(rng.nextDouble(0.0, 50_000.0)) { ticker() }
    }

    // 송신: 캡처 드라이버가 20ms씩 넘겨주면 5ms 프레임 4개를 연달아 읽어 보낸다
    val audioLinks = rxs.map { Link(cfg.net, Random(rng.nextInt())) }
    val adcRate = FS * (1 + SRC_ADC_PPM * 1e-6) / 1e6
    val timeline = CaptureTimeline(FS)
    val captureTrue = DoubleArray(nFrames)
    val started = BooleanArray(rxs.size)
    val framesPerPeriod = (CAPTURE_PERIOD_US / (FRAME * US_PER_SAMPLE)).toInt()
    val srcRng = Random(rng.nextInt())
    var k = 0
    fun period(j: Int) {
        val availT = streamStart + (j + 1) * framesPerPeriod * FRAME / adcRate
        var readT = availT + srcRng.nextDouble(300.0, 1_500.0) +
            if (srcRng.nextDouble() < 0.005) srcRng.nextDouble(3_000.0, 12_000.0) else 0.0
        val hwPos = ((j + 1) * framesPerPeriod * FRAME).toLong()
        val hwTime = (srcLocal(streamStart + hwPos / adcRate) + srcRng.nextDouble(-80.0, 80.0)).toLong()
        repeat(framesPerPeriod) {
            if (k >= nFrames) return
            val kk = k++
            readT += srcRng.nextDouble(10.0, 60.0)
            captureTrue[kk] = streamStart + kk.toLong() * FRAME / adcRate
            val readDoneUs = srcLocal(readT).toLong()
            val ts = when (cfg.srcTs) {
                SrcTs.READ_DONE -> readDoneUs
                SrcTs.HW -> timeline.frameStartUs(kk.toLong() * FRAME, FRAME, readDoneUs, hwPos, hwTime)
                SrcTs.ENVELOPE -> timeline.frameStartUs(kk.toLong() * FRAME, FRAME, readDoneUs)
            }
            val payload = ByteArray(FRAME * 2).also { p -> val v = kk + 1; p[0] = (v shr 16).toByte(); p[1] = (v shr 8).toByte(); p[2] = v.toByte() }
            val info = PacketInfo(1, if (kk == 0) 1 else 0, payload.size, kk, FS, ts)
            val sendT = readT + 50
            for ((i, rx) in rxs.withIndex()) {
                val arr = audioLinks[i].deliver(sendT) ?: continue
                sim.at(arr) {
                    rx.arrived[kk] = true
                    rx.onThisDevice { rx.clock.offsetUs }?.let { off ->
                        val now = rx.local(sim.now).toLong()
                        rx.advisor.onArrival(now, now - (ts + off))
                    }
                    rx.jitter.push(info, payload)
                    if (!started[i]) { started[i] = true; rx.posT = sim.now; rx.step(sim.now) }
                }
            }
        }
        sim.at(streamStart + (j + 2) * framesPerPeriod * FRAME / adcRate) { period(j + 1) }
    }
    sim.at(streamStart) { period(0) }
    // 자동 공통 지연: 수신기가 2초마다 필요 지연을 보고 → 송신기가 최댓값으로 정해 모두에게 알림 (메시지도 Wi-Fi를 탄다)
    if (cfg.delayMs == AUTO) {
        val coordinator = DelayCoordinator()
        val ctlUp = rxs.map { Link(cfg.net, Random(rng.nextInt())) }
        val ctlDown = rxs.map { Link(cfg.net, Random(rng.nextInt())) }
        fun report() {
            for ((i, rx) in rxs.withIndex()) {
                val need = rx.advisor.needMs(rx.local(sim.now).toLong()) ?: continue
                ctlUp[i].deliver(sim.now)?.let { atSrc ->
                    sim.at(atSrc) {
                        coordinator.report(i, need, (srcLocal(sim.now) / 1000).toLong())?.let { d ->
                            for ((j, r) in rxs.withIndex()) ctlDown[j].deliver(sim.now)?.let { back -> sim.at(back) { r.delayMs = d } }
                        }
                    }
                }
            }
            for (rx in rxs) rx.delayLog += rx.delayMs
            sim.at(sim.now + DelayCoordinator.REPORT_INTERVAL_MS * 1000.0) { report() }
        }
        sim.at(streamStart + 2e6) { report() }
    }
    // 음향 보정: 스피커를 송신 폰 옆에 모아 두고, 스피커마다 다른 소스 시각에 시험음 → 송신 폰 마이크 녹음에서 도착 시각 검출
    if (cfg.comp == Comp.MEASURED) {
        val calRng = Random(rng.nextInt())
        sim.at(streamStart + 8e6) {
            val base = srcLocal(sim.now).toLong() + SyncCalibration.LEAD_US
            val at = rxs.indices.map { i -> (0 until SyncCalibration.ROUNDS).map { r -> SyncCalibration.toneAtUs(base, rxs.size, i, r) } }
            rxs.forEachIndexed { i, rx -> rx.toneQueue.addAll(at[i]) }
            val total = SyncCalibration.LEAD_US + SyncCalibration.ROUNDS * rxs.size * SyncCalibration.SPACING_US
            sim.at(sim.now + total + rxs.maxOf { it.delayMs } * 1000.0 + 700_000) {
                calibrateAcoustically(rxs, at, ::srcLocal, calRng)
            }
        }
    }
    fun sampleClock() {
        if (sim.now > warmup) for (rx in rxs) {
            val est = rx.onThisDevice { rx.clock.offsetUs } ?: continue
            rx.clockErrUs += est - (rx.local(sim.now) - srcLocal(sim.now))
        }
        sim.at(sim.now + 100_000) { sampleClock() }
    }
    sim.at(warmup) { sampleClock() }
    sim.run(totalUs)
    if (cfg.diag) {
        fun pr(a: List<Double>) = a.sorted().let { x -> if (x.isEmpty()) "-" else
            "p1 ${f2(x[x.size / 100] / 1000)} / p50 ${f2(x[x.size / 2] / 1000)} / p99 ${f2(x[x.size * 99 / 100] / 1000)}ms" }
        val errs = rxs.map { rx -> (0 until k).filter { captureTrue[it] in warmup..(totalUs - tailUs - 500_000) && !rx.emission[it].isNaN() }
            .map { rx.emission[it] - (captureTrue[it] + rx.delayMs * 1000.0 + rx.extraUs + rx.spec.dspUs) } }
        val center = errs.flatten().sorted().let { it[it.size / 2] }
        for ((i, rx) in rxs.withIndex()) {
            println("    [진단] ${rx.spec.name}: 시계 오프셋 오차 ${pr(rx.clockErrUs)} · 소리 시각 오차 ${pr(errs[i].map { it - center })}")
        }
    }

    // 집계: 측정 구간에서 세 스피커 모두 소리로 낸 프레임만 비교
    val spreads = ArrayList<Double>(); val lat = ArrayList<Double>()
    var eligible = 0
    var arrivedCount = 0; var lateCount = 0
    for (f in 0 until k) {
        val c = captureTrue[f]
        if (c < warmup || c > totalUs - tailUs - 500_000) continue
        eligible++
        for (rx in rxs) if (rx.arrived[f]) { arrivedCount++; if (rx.emission[f].isNaN()) lateCount++ }
        val e = rxs.map { it.emission[f] }
        if (e.any { it.isNaN() }) continue
        spreads += e.max() - e.min()
        lat += e.average() - c
    }
    spreads.sort(); lat.sort()
    fun pct(a: List<Double>, p: Double) = if (a.isEmpty()) Double.NaN else a[min(a.size - 1, (a.size * p).toInt())]
    val minutes = rxs.first().let { (it.measureTo - it.measureFrom) / 60e6 }
    return Result(
        syncP50 = pct(spreads, 0.5) / 1000, syncP99 = pct(spreads, 0.99) / 1000, syncMax = (spreads.lastOrNull() ?: Double.NaN) / 1000,
        latencyMs = pct(lat, 0.5) / 1000,
        lateGlitchPerMin = rxs.sumOf { it.lateGlitches } / minutes / rxs.size,
        lossGlitchPerMin = rxs.sumOf { it.lossGlitches } / minutes / rxs.size,
        coverage = if (eligible == 0) 0.0 else spreads.size.toDouble() / eligible,
        lateFraction = if (arrivedCount == 0) 1.0 else lateCount.toDouble() / arrivedCount,
        delayRange = rxs.first().delayLog.drop(5).let { if (it.isEmpty()) cfg.delayMs..cfg.delayMs else it.min()..it.max() },
        delayChanges = rxs.first().delayLog.zipWithNext().count { (a, b) -> a != b },
    )
}

/**
 * 가상 마이크 녹음을 만들고 실제 앱 코드(SyncChirp.find → SyncCalibration.compute)로 보정값을 구해 적용한다.
 * 녹음 = 스피커별 시험음(스피커마다 음색이 다름) + 벽 반사 두 번 + 잡음. 기기들이 붙어 있어 공기 중 거리 차는 0.3ms 이내.
 */
private fun calibrateAcoustically(rxs: List<Rx>, atSrcUs: List<List<Long>>, srcLocal: (Double) -> Double, rng: Random) {
    // 기기를 송신 폰 옆에 붙여 둠: 스피커마다 공기 중 거리 차 0~0.3ms(약 10cm), 음색·음량·반사는 제각각
    val airUs = rxs.map { rng.nextDouble(0.0, 300.0) }
    val color = rxs.map { Triple(rng.nextDouble(0.15, 1.0), rng.nextDouble(0.2, 0.8),
        listOf(rng.nextDouble(3_000.0, 5_000.0) to 0.45, rng.nextDouble(6_000.0, 9_000.0) to 0.25)) }
    val emitSrc = rxs.mapIndexed { i, rx -> rx.toneEmissions.map { srcLocal(it) + airUs[i] } }
    val recStart = atSrcUs.flatten().min() - 50_000.0
    val recEnd = emitSrc.flatten().filter { !it.isNaN() }.max() + 400_000
    val n = ((recEnd - recStart) / US_PER_SAMPLE).toInt()
    val mic = FloatArray(n)
    for ((i, emits) in emitSrc.withIndex()) {
        val (gain, lp, echoes) = color[i]
        val raw = FloatArray(n)
        for (e in emits) {
            if (e.isNaN()) continue
            for ((delay, g) in listOf(0.0 to 1.0) + echoes) {
                val t0 = e + delay
                val j0 = ((t0 - recStart) / US_PER_SAMPLE).toInt().coerceAtLeast(0)
                val j1 = min(n, j0 + (SyncChirp.DURATION_US / US_PER_SAMPLE).toInt() + 2)
                for (j in j0 until j1) raw[j] += (gain * g * SyncChirp.value(recStart + j * US_PER_SAMPLE - t0)).toFloat()
            }
        }
        var y = 0f
        for (j in 0 until n) { y += (raw[j] - y) * lp.toFloat(); mic[j] += y }
    }
    for (j in 0 until n) mic[j] += (rng.nextDouble(-1.0, 1.0) * 0.02).toFloat()

    // 앱과 같은 계산: 스피커·회차마다 검출 → 스피커별 중앙값 → 새 보정값
    val template = SyncChirp.template(FS)
    val late = HashMap<Int, Double>()
    for ((i, rx) in rxs.withIndex()) {
        late[i] = SyncCalibration.measureLateUs(mic, recStart, FS, atSrcUs[i], rx.delayMs * 1000.0 + rx.extraUs, template)
            ?: error("${rx.spec.name} 시험음을 못 찾음")
    }
    val cal = SyncCalibration.compute(late, rxs.indices.associateWith { rxs[it].extraUs.toLong() })
    rxs.forEachIndexed { i, rx -> rx.extraUs = cal.getValue(i).toDouble() }
    if (System.getenv("SYNC_DIAG") != null) {
        val maxDsp = rxs.maxOf { it.spec.dspUs }
        val ideal = rxs.map { maxDsp - it.spec.dspUs }
        val got = rxs.map { it.extraUs }
        val shift = (got.zip(ideal).sumOf { it.first - it.second }) / rxs.size
        println("    [보정 진단] " + rxs.indices.joinToString(" / ") { "${rxs[it].spec.name} 오차 ${f2((got[it] - ideal[it] - shift) / 1000)}ms (거리 ${f2(airUs[it] / 1000)}ms)" })
    }
}

// ───────────────────────── 보고 ─────────────────────────

fun f1(x: Double) = if (x.isNaN()) "-" else "%.1f".format(x)
fun f2(x: Double) = if (x.isNaN()) "-" else "%.2f".format(x)

fun main(args: Array<String>) {
    val quick = "--quick" in args
    val diag = "--diag" in args
    val longSec = if (quick) 90 else 600
    val sweepSec = if (quick) 60 else 180
    val failures = mutableListOf<String>()

    println("AudioBridge 동기 재생 가상 시뮬레이션 — 소스 1대 → 스피커 3대")
    println("스피커: " + RECEIVERS.joinToString(" / ") {
        "${it.name}(출력버퍼 ${it.bufferMs}ms, 스피커 내부 ${f1(it.dspUs / 1000)}ms, DAC ${it.dacPpm.toInt()}ppm, 시계 ${it.sysPpm.toInt()}ppm)"
    })
    println("싱크 오차 = 같은 소스 샘플이 세 스피커에서 실제 소리로 나온 시각의 최대-최소. 목표 ≤ 1ms")

    println("\n[1] 무엇이 싱크를 깨는가 — 보통 가정 Wi-Fi, 공통 지연 600ms(v2.8 기본값), ${longSec / 60.0}분")
    println("| 구성 | 싱크 오차 중앙값 | p99 | 최대 | 끊김(지연)/분 | 끊김(손실)/분 |")
    println("|---|---:|---:|---:|---:|---:|")
    val rows = listOf(
        "현재 앱 그대로" to Config(HOME, 600, SrcTs.READ_DONE, Sched.LEGACY, Comp.NONE, longSec, clk = Clk.V28),
        "현재 앱 + 스피커 지연 수동 보정(1ms 단위)" to Config(HOME, 600, SrcTs.READ_DONE, Sched.LEGACY, Comp.MS, longSec, clk = Clk.V28),
        "  + 새 시계 동기만" to Config(HOME, 600, SrcTs.READ_DONE, Sched.LEGACY, Comp.MS, longSec),
        "  + 하드웨어 캡처 시각만" to Config(HOME, 600, SrcTs.HW, Sched.LEGACY, Comp.MS, longSec, clk = Clk.V28),
        "  + 샘플 단위 판단만" to Config(HOME, 600, SrcTs.READ_DONE, Sched.SAMPLE, Comp.MS, longSec, clk = Clk.V28),
        "새 방식(캡처 시각 + 샘플 단위 + 새 시계 동기), 보정 없음" to Config(HOME, 600, SrcTs.HW, Sched.SAMPLE, Comp.NONE, longSec),
        "새 방식 + 보정(1ms 단위, 현재 UI)" to Config(HOME, 600, SrcTs.HW, Sched.SAMPLE, Comp.MS, longSec),
        "새 방식 + 정밀 보정" to Config(HOME, 600, SrcTs.HW, Sched.SAMPLE, Comp.EXACT, longSec, diag = diag),
        "새 방식(하드웨어 시각 없는 기기) + 정밀 보정" to Config(HOME, 600, SrcTs.ENVELOPE, Sched.SAMPLE, Comp.EXACT, longSec),
        "새 방식 + 음향 보정(기기 붙여 놓고 잰 값)" to Config(HOME, 600, SrcTs.HW, Sched.SAMPLE, Comp.MEASURED, longSec),
        "새 방식 + 음향 보정 + 자동 지연" to Config(HOME, AUTO, SrcTs.HW, Sched.SAMPLE, Comp.MEASURED, longSec),
    )
    val results = rows.map { (label, cfg) ->
        simulate(cfg).also { r ->
            println("| $label | ${f2(r.syncP50)}ms | ${f2(r.syncP99)}ms | ${f2(r.syncMax)}ms | ${f2(r.lateGlitchPerMin)} | ${f2(r.lossGlitchPerMin)} |")
        }
    }
    for (i in listOf(7, 8, 9)) {
        val r = results[i]
        if (!(r.syncP99 <= 1.0)) failures += "${rows[i].first.trim()}: 싱크 오차 p99 ${f2(r.syncP99)}ms > 1ms"
        if (r.lateGlitchPerMin != 0.0) failures += "${rows[i].first.trim()}: 600ms에서 지연 끊김 발생"
    }
    if (!(results[7].syncP99 < results[0].syncP99)) failures += "새 방식이 현재 앱보다 싱크가 나쁨"
    if (!(results[10].syncP99 <= 1.0)) failures += "음향 보정 + 자동 지연: 싱크 오차 p99 ${f2(results[10].syncP99)}ms > 1ms"

    println("\n[2] 지연을 얼마나 줄일 수 있나 — 새 방식 + 정밀 보정, 공통 지연별 ${sweepSec / 60.0}분씩")
    println("    끊김/분(지연 탓) · 늦어서 못 낸 프레임 % · 싱크 p99(ms) · 녹음→소리 지연(ms)")
    val delays = listOf(40, 60, 80, 100, 120, 150, 200, 300, 450, 600)
    println("| 네트워크 | " + delays.joinToString(" | ") { "${it}ms" } + " |")
    println("|---|" + delays.joinToString("") { "---:|" })
    val minDelay = linkedMapOf<String, Pair<Int, Result>?>()
    for (net in listOf(GOOD, HOME, BUSY)) {
        val cells = delays.map { d -> d to simulate(Config(net, d, SrcTs.HW, Sched.SAMPLE, Comp.EXACT, sweepSec)) }
        println("| ${net.label} 끊김/분 | " + cells.joinToString(" | ") { f1(it.second.lateGlitchPerMin) } + " |")
        println("| └ 못 낸 % | " + cells.joinToString(" | ") { f2(it.second.lateFraction * 100) } + " |")
        println("| └ 싱크 p99 | " + cells.joinToString(" | ") { f2(it.second.syncP99) } + " |")
        println("| └ 지연 | " + cells.joinToString(" | ") { f1(it.second.latencyMs) } + " |")
        minDelay[net.label] = cells.firstOrNull { it.second.lateGlitchPerMin == 0.0 && it.second.lateFraction < 0.001 }
    }
    println("\n지연 탓 끊김이 없는 최소 공통 지연 (패킷 손실로 인한 끊김은 지연을 늘려도 못 막음):")
    minDelay.forEach { (net, v) ->
        println("  - $net: " + (v?.let { (d, r) -> "${d}ms → 녹음→소리 ${f1(r.latencyMs)}ms, 싱크 p99 ${f2(r.syncP99)}ms" } ?: "600ms 안에서 없음"))
    }
    val good = minDelay[GOOD.label]
    if (good == null || good.first > 150) failures += "좋은 Wi-Fi에서도 150ms 이하로 끊김 없이 못 줄임"

    println("\n[3] 자동 공통 지연 — 수신기가 잰 필요 지연을 송신기가 모아 정함 (새 방식 + 정밀 보정, ${longSec / 60.0}분)")
    println("| 네트워크 | 자동이 고른 지연 | 지연 변경 횟수 | 녹음→소리 중앙값 | 지연 탓 끊김/분 | 못 낸 % | 싱크 p99 |")
    println("|---|---:|---:|---:|---:|---:|---:|")
    for (net in listOf(GOOD, HOME, BUSY)) {
        val r = simulate(Config(net, AUTO, SrcTs.HW, Sched.SAMPLE, Comp.EXACT, longSec))
        println("| ${net.label} | ${r.delayRange.first}~${r.delayRange.last}ms | ${r.delayChanges} | ${f1(r.latencyMs)}ms | ${f2(r.lateGlitchPerMin)} | ${f2(r.lateFraction * 100)} | ${f2(r.syncP99)}ms |")
        if (net === GOOD && (r.latencyMs > 150 || r.lateFraction > 0.005)) failures += "자동 지연: 좋은 Wi-Fi에서 150ms 이하·못 낸 프레임 0.5% 미만을 못 지킴"
        if (!(r.syncP99 <= 2.0)) failures += "자동 지연: ${net.label} 싱크 p99 ${f2(r.syncP99)}ms > 2ms"
    }

    println()
    if (failures.isEmpty()) println("판정: 통과")
    else { println("판정: 실패"); failures.forEach { println("  ✗ $it") }; exitProcess(1) }
}
