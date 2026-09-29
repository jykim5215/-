package app.audiobridge.audio

/**
 * 송신 프레임의 타임스탬프 = "그 프레임 첫 샘플이 실제로 녹음된 시각"(단조시계 µs).
 *
 * 예전처럼 read()가 돌아온 시각을 쓰면, 캡처 드라이버가 10~20ms씩 몰아서 넘겨주는 탓에 연속 프레임의
 * 타임스탬프가 들쭉날쭉해지고 수신기마다 그 들쭉날쭉함에 다르게 반응해 시차가 생긴다.
 *  - 하드웨어 타임스탬프(AudioRecord.getTimestamp 등)가 있으면: 그 기준점에서 샘플 수로 환산한다.
 *  - 없으면: read 완료 시각은 실제 녹음 시각보다 늦을 수만 있다는 점을 이용해 "가장 이른 값"을
 *    따라가는 하한선(느린 상승 허용 = 클럭 속도 차 추종)을 쓴다. 남는 일정한 지연은 모든 수신기에 같다.
 */
class CaptureTimeline(sampleRate: Int) {
    private val usPerSample = 1_000_000.0 / sampleRate
    private var baseUs = Double.NaN

    /**
     * @param frameStartSample 스트림 시작부터 센 이 프레임 첫 샘플의 번호
     * @param frameSamples 프레임 길이(샘플)
     * @param readDoneUs 이 프레임 read()가 끝난 시각
     * @param hwFramePos/hwTimeUs 하드웨어 타임스탬프(없으면 null): hwFramePos번 샘플이 hwTimeUs에 녹음됨
     */
    fun frameStartUs(
        frameStartSample: Long,
        frameSamples: Int,
        readDoneUs: Long,
        hwFramePos: Long? = null,
        hwTimeUs: Long? = null,
    ): Long {
        if (hwFramePos != null && hwTimeUs != null) {
            return (hwTimeUs + (frameStartSample - hwFramePos) * usPerSample).toLong()
        }
        val candidate = readDoneUs - (frameStartSample + frameSamples) * usPerSample
        baseUs = if (baseUs.isNaN()) candidate else minOf(baseUs + frameSamples * usPerSample * LEAK, candidate)
        return (baseUs + frameStartSample * usPerSample).toLong()
    }

    fun reset() { baseUs = Double.NaN }

    private companion object {
        /** 하한선이 올라갈 수 있는 최대 속도 = 1,000ppm (실제 클럭 차는 수십~수백 ppm) */
        const val LEAK = 0.001
    }
}
