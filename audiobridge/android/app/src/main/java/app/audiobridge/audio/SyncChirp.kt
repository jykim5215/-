package app.audiobridge.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/**
 * 스피커 싱크 보정용 시험음(처프)과 검출기 (순수 Kotlin — Android·가상 시뮬 공용, Windows는 같은 식을 옮김).
 *
 * 1.5→6kHz로 50ms 동안 올라가는 소리. 자기상관이 뾰족해서 녹음에서 도착 시각을 1샘플(21µs) 이하로 찾을 수 있다.
 * 수신기는 "소스 시각 atUs부터"의 샘플을 이 소리로 바꿔 재생한다 — 즉 실제 음악과 똑같은 경로(시계 동기·
 * 공통 지연·출력 버퍼·스피커 내부 처리)를 지나므로, 녹음된 도착 시각의 차이가 곧 스피커 간 실제 시차다.
 */
object SyncChirp {
    const val DURATION_US = 50_000L
    private const val F0 = 1_500.0
    private const val F1 = 6_000.0
    private const val AMPLITUDE = 0.5

    /** 시작부터 [tUs] 지난 순간의 값 (-1..1). 범위 밖이면 0. */
    fun value(tUs: Double): Double {
        if (tUs < 0 || tUs >= DURATION_US) return 0.0
        val t = tUs / 1e6
        val dur = DURATION_US / 1e6
        val phase = 2 * PI * (F0 * t + (F1 - F0) / (2 * dur) * t * t)
        val window = 0.5 - 0.5 * cos(2 * PI * t / dur) // 양 끝을 부드럽게 (딸깍 소리 방지)
        return AMPLITUDE * window * sin(phase)
    }

    fun template(sampleRate: Int): FloatArray {
        val n = (DURATION_US * sampleRate / 1_000_000).toInt()
        return FloatArray(n) { value(it * 1e6 / sampleRate).toFloat() }
    }

    /**
     * [signal]의 [from, to) 구간에서 처프가 시작하는 위치(샘플, 소수점 포함)를 찾는다.
     * 정규화한 상관의 최댓값이 주변 잡음보다 충분히 크지 않으면 null (안 들렸음).
     */
    fun find(signal: FloatArray, template: FloatArray, from: Int, to: Int): Double? {
        val start = from.coerceAtLeast(0)
        val end = (to - template.size).coerceAtMost(signal.size - template.size)
        if (end <= start + 2) return null
        val corr = DoubleArray(end - start)
        var tplEnergy = 0.0
        for (v in template) tplEnergy += v * v
        for (i in corr.indices) {
            var acc = 0.0
            val base = start + i
            for (k in template.indices) acc += signal[base + k] * template[k]
            corr[i] = abs(acc)
        }
        var best = 0
        for (i in corr.indices) if (corr[i] > corr[best]) best = i
        // 잡음 기준: 상관 크기의 중앙값
        val sorted = corr.copyOf().also { it.sort() }
        val median = sorted[sorted.size / 2]
        if (corr[best] < median * MIN_PEAK_TO_MEDIAN || corr[best] < tplEnergy * MIN_RELATIVE_LEVEL) return null
        // 꼭짓점 앞뒤로 포물선 보간 → 1샘플 이하 정밀도
        val offset = if (best in 1 until corr.size - 1) {
            val a = corr[best - 1]; val b = corr[best]; val c = corr[best + 1]
            val d = a - 2 * b + c
            if (d != 0.0) (0.5 * (a - c) / d).coerceIn(-0.5, 0.5) else 0.0
        } else 0.0
        return start + best + offset
    }

    private const val MIN_PEAK_TO_MEDIAN = 8.0
    /** 녹음 크기가 시험음의 1% 수준도 안 되면 못 들은 것으로 본다 */
    private const val MIN_RELATIVE_LEVEL = 0.01
}

/** 녹음으로 잰 스피커별 도착 시각 → 새 음향 보정값 (순수 Kotlin, 가상 시뮬 공용). */
object SyncCalibration {
    /** 스피커마다 시험음 간격 — 보정 전 시차가 이 절반(±[SEARCH_US])보다 작아야 서로 헷갈리지 않는다 */
    const val SPACING_US = 600_000L
    const val SEARCH_US = 250_000L
    /** 요청 후 첫 시험음까지 여유 (메시지가 스피커에 먼저 닿아야 한다) */
    const val LEAD_US = 400_000L
    /** 스피커마다 시험음을 몇 번 낼지 — 순간적인 흔들림을 중앙값으로 걸러 낸다 */
    const val ROUNDS = 3

    /** 스피커 [index](0부터)의 [round]번째 시험음 예약 시각 */
    fun toneAtUs(baseUs: Long, speakers: Int, index: Int, round: Int): Long =
        baseUs + (round.toLong() * speakers + index) * SPACING_US

    /**
     * 녹음에서 한 스피커의 시험음들을 찾아 "실제 소리 시각 − 예약 시각"의 중앙값(µs)을 낸다.
     * @param recStartUs 녹음 첫 샘플의 시각 (예약 시각과 같은 소스 시계)
     * @param expectedLagUs 대략 이만큼 늦게 들릴 것 (공통 지연 + 그 스피커의 추가 지연) — 이 근처 ±[SEARCH_US]만 찾는다
     * @return 절반 넘게 못 찾으면 null
     */
    fun measureLateUs(
        recording: FloatArray, recStartUs: Double, sampleRate: Int,
        toneAtUs: List<Long>, expectedLagUs: Double, template: FloatArray,
    ): Double? {
        val usPerSample = 1_000_000.0 / sampleRate
        val found = toneAtUs.mapNotNull { at ->
            val expected = at + expectedLagUs - recStartUs
            val from = ((expected - SEARCH_US) / usPerSample).toInt()
            val to = ((expected + SEARCH_US) / usPerSample).toInt()
            SyncChirp.find(recording, template, from, to)?.let { recStartUs + it * usPerSample - at }
        }.sorted()
        if (found.size * 2 <= toneAtUs.size) return null
        return found[found.size / 2]
    }

    /**
     * @param lateUs 스피커별 "실제 소리 시각 − 예약한 소스 시각" (녹음으로 잰 값). 늦을수록 크다.
     * @param currentUs 스피커별 지금 쓰고 있는 보정값
     * @return 스피커별 새 보정값: 가장 늦은 스피커에 나머지를 맞춰 늦추고, 가장 작은 값이 0이 되게 정규화
     */
    fun compute(lateUs: Map<Int, Double>, currentUs: Map<Int, Long>): Map<Int, Long> {
        val slowest = lateUs.values.max()
        val raw = lateUs.mapValues { (id, late) -> (currentUs[id] ?: 0L) + (slowest - late) }
        val floor = raw.values.min()
        return raw.mapValues { (_, v) ->
            (v - floor).toLong().coerceIn(0L, app.audiobridge.net.Protocol.MAX_CALIBRATION_US)
        }
    }
}
