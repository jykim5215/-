namespace AudioBridge.Win;

/// <summary>
/// 송신 프레임 타임스탬프 = 그 프레임 첫 샘플이 실제로 녹음된 시각 — android/.../audio/CaptureTimeline.kt와 같은 알고리즘.
/// 캡처 데이터가 손에 들어온 시각은 실제 녹음 시각보다 늦을 수만 있으므로, 그 "가장 이른 값"을 따라가는
/// 하한선(1,000ppm까지 느린 상승 허용)으로 흔들림을 없앤다. 남는 일정한 지연은 모든 수신기에 같다.
/// </summary>
public sealed class CaptureTimeline
{
    private const double Leak = 0.001;
    private readonly double _usPerSample;
    private double _baseUs = double.NaN;

    public CaptureTimeline(int sampleRate) => _usPerSample = 1_000_000d / sampleRate;

    /// <param name="frameStartSample">연속 구간 시작부터 센 이 프레임 첫 샘플 번호</param>
    /// <param name="availableUs">이 프레임의 마지막 샘플이 손에 들어온 시각</param>
    public long FrameStartUs(long frameStartSample, int frameSamples, long availableUs)
    {
        double candidate = availableUs - (frameStartSample + frameSamples) * _usPerSample;
        _baseUs = double.IsNaN(_baseUs) ? candidate : Math.Min(_baseUs + frameSamples * _usPerSample * Leak, candidate);
        return (long)(_baseUs + frameStartSample * _usPerSample);
    }

    public void Reset() => _baseUs = double.NaN;
}
