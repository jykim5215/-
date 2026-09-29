namespace AudioBridge.Win;

/// <summary>
/// 끊김 없이 쓸 수 있는 최소 공통 지연 추정 — android/.../audio/DelayAdvisor.kt와 같은 알고리즘.
/// (도착까지 걸린 시간 + 출력 버퍼 깊이)의 최근 60초 최댓값 + 여유 15ms를 10ms 단위로 올린다.
/// </summary>
public sealed class DelayAdvisor
{
    private const int WindowS = 60;
    private const int MinDataS = 5;
    private const long SafetyUs = 15_000;

    private readonly object _gate = new();
    private readonly long[] _maxTransit = Enumerable.Repeat(long.MinValue, WindowS).ToArray();
    private readonly long[] _maxDepth = Enumerable.Repeat(long.MinValue, WindowS).ToArray();
    private long _bucketSecond = long.MinValue;
    private long _firstSecond = long.MinValue;

    public void OnArrival(long nowUs, long transitUs)
    {
        lock (_gate)
        {
            int i = Bucket(nowUs);
            if (transitUs > _maxTransit[i]) _maxTransit[i] = transitUs;
        }
    }

    public void OnOutputDepth(long nowUs, long depthUs)
    {
        lock (_gate)
        {
            int i = Bucket(nowUs);
            if (depthUs > _maxDepth[i]) _maxDepth[i] = depthUs;
        }
    }

    public int? NeedMs(long nowUs)
    {
        lock (_gate)
        {
            Bucket(nowUs);
            if (_firstSecond == long.MinValue || nowUs / 1_000_000 - _firstSecond < MinDataS) return null;
            long transit = _maxTransit.Max();
            long depth = _maxDepth.Max();
            if (transit == long.MinValue || depth == long.MinValue) return null;
            long needUs = transit + depth + SafetyUs;
            int ms = (int)((needUs + 9_999) / 10_000 * 10);
            return Math.Clamp(ms, Protocol.MinPlayoutDelayMs, Protocol.MaxPlayoutDelayMs);
        }
    }

    private int Bucket(long nowUs)
    {
        long sec = nowUs / 1_000_000;
        if (_firstSecond == long.MinValue) _firstSecond = sec;
        if (_bucketSecond == long.MinValue) _bucketSecond = sec;
        if (sec > _bucketSecond)
        {
            int steps = (int)Math.Min(sec - _bucketSecond, WindowS);
            for (int k = 1; k <= steps; k++)
            {
                int j = (int)((_bucketSecond + k) % WindowS);
                _maxTransit[j] = long.MinValue;
                _maxDepth[j] = long.MinValue;
            }
            _bucketSecond = sec;
        }
        return (int)(((sec % WindowS) + WindowS) % WindowS);
    }
}

/// <summary>스피커 소리 맞추기 시험음 — android/.../audio/SyncChirp.kt의 value()와 같은 식 (1.5→6kHz, 50ms).</summary>
public static class SyncChirp
{
    public const long DurationUs = 50_000;
    private const double F0 = 1_500, F1 = 6_000, Amplitude = 0.5;

    public static double Value(double tUs)
    {
        if (tUs < 0 || tUs >= DurationUs) return 0;
        double t = tUs / 1e6, dur = DurationUs / 1e6;
        double phase = 2 * Math.PI * (F0 * t + (F1 - F0) / (2 * dur) * t * t);
        double window = 0.5 - 0.5 * Math.Cos(2 * Math.PI * t / dur);
        return Amplitude * window * Math.Sin(phase);
    }
}
