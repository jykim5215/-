namespace AudioBridge.Win;

/// <summary>
/// 소스 기기의 단조시계를 이 PC의 단조시계로 옮기는 오프셋 — android/.../net/ClockSync.kt와 같은 알고리즘.
/// 응답 하나의 오차는 왕복 시간의 절반 이하이므로 가장 빠른 왕복만 믿는다: 최근 90초 표본 중
/// 왕복이 짧은 1/4로 오프셋과 클럭 속도 차(기울기)를 직선 맞춤한다. 왕복은 정상인데 200ms 넘게
/// 어긋나면 실제로 시계가 튄 것(절전 복귀 등)이므로 기록을 버리고 다시 맞춘다.
/// </summary>
public sealed class ClockSync
{
    public const int FastTickMs = 250;
    public const int TickMs = 1_000;
    private const int LockSamples = 8;
    private const int MaxSamples = 120;
    private const long WindowUs = 90_000_000;
    private const int MinFitSamples = 4;
    private const long MinSlopeSpanUs = 5_000_000;
    private const double JumpUs = 200_000;
    private const double MaxDrift = 500e-6;

    private readonly record struct Sample(long LocalUs, double OffsetUs, long RttUs);
    private sealed record Model(long T0, double OffsetAtT0, double Slope);

    private readonly object _gate = new();
    private readonly LinkedList<Sample> _samples = new();
    private volatile Model? _model;

    public long? OffsetUs
    {
        get
        {
            var m = _model;
            if (m == null) return null;
            return (long)Math.Round(m.OffsetAtT0 + (Clock.Us - m.T0) * m.Slope);
        }
    }

    /// <summary>다음 clk 질의까지 기다릴 시간: 맞추는 동안 빠르게, 이후 1초.</summary>
    public int NextTickDelayMs()
    {
        lock (_gate) return _samples.Count < LockSamples ? FastTickMs : TickMs;
    }

    public void OnReply(long t0, long sourceT1)
    {
        long t2 = Clock.Us;
        long rtt = t2 - t0;
        if (rtt < 0 || rtt > 2_000_000) return;
        double measured = (t0 + t2) / 2d - sourceT1;

        lock (_gate)
        {
            var m = _model;
            if (m != null && rtt <= _samples.Min(s => s.RttUs) + 5_000 &&
                Math.Abs(measured - (m.OffsetAtT0 + (t2 - m.T0) * m.Slope)) > JumpUs)
            {
                _samples.Clear();
            }
            _samples.AddLast(new Sample(t2, measured, rtt));
            while (_samples.Count > MaxSamples || t2 - _samples.First!.Value.LocalUs > WindowUs) _samples.RemoveFirst();
            _model = Fit(m?.Slope ?? 0d);
        }
    }

    private Model Fit(double previousSlope)
    {
        var best = _samples.OrderBy(s => s.RttUs).Take(Math.Max(MinFitSamples, _samples.Count / 4)).ToList();
        double n = best.Count;
        double meanT = best.Sum(s => (double)s.LocalUs) / n;
        double meanO = best.Sum(s => s.OffsetUs) / n;
        long span = best.Max(s => s.LocalUs) - best.Min(s => s.LocalUs);
        double slope = previousSlope;
        if (best.Count >= MinFitSamples && span >= MinSlopeSpanUs)
        {
            double sxx = best.Sum(s => (s.LocalUs - meanT) * (s.LocalUs - meanT));
            double sxy = best.Sum(s => (s.LocalUs - meanT) * (s.OffsetUs - meanO));
            slope = Math.Clamp(sxy / sxx, -MaxDrift, MaxDrift);
        }
        return new Model((long)Math.Round(meanT), meanO, slope);
    }

    public void Reset()
    {
        lock (_gate)
        {
            _samples.Clear();
            _model = null;
        }
    }
}
