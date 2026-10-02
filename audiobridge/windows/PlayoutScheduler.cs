namespace AudioBridge.Win;

/// <summary>
/// 샘플 단위 동기 재생 판단기 — android/.../audio/PlayoutScheduler.kt와 같은 알고리즘(값·순서 동일).
/// 입력 errUs = "다음에 쓸 샘플이 스피커에서 나올 예상 시각 - 그 샘플의 목표 시각"(양수=늦음).
/// 맞추기 전엔 정확히 그만큼 무음/건너뛰기, 맞춘 뒤엔 1~2샘플씩 빼거나 반복해 클럭 속도 차를 따라간다.
/// 가상 시뮬(sim/sync)은 Kotlin 판을 돌리므로, 이 파일을 바꾸면 Kotlin 판도 똑같이 바꿔야 한다.
/// </summary>
public sealed class PlayoutScheduler
{
    public enum Kind { Silence, Skip, Play }

    /// <summary>Silence: 무음 Samples개. Skip: 머리 프레임에서 Samples개 버림. Play: 남은 Samples개를 쓰되 Adjust&lt;0이면 끝에서 빼고 &gt;0이면 마지막 샘플 반복.</summary>
    public readonly record struct Decision(Kind Kind, int Samples, int Adjust = 0);

    public const long LockTolUs = 200;
    public const long RelockUs = 10_000;
    public const double SlewUs = 120;
    public const double SlewFastUs = 1_000;
    private const double FilterAlpha = 0.05;

    private readonly int _frameSamples;
    private readonly double _usPerSample;
    private double _filteredErrUs;

    public bool Locked { get; private set; }

    public PlayoutScheduler(int sampleRate, int frameSamples)
    {
        _frameSamples = frameSamples;
        _usPerSample = 1_000_000d / sampleRate;
    }

    /// <param name="errUs">null이면 재생할 데이터가 없음</param>
    /// <param name="headRemaining">머리 프레임에서 아직 안 쓴 샘플 수</param>
    public Decision Decide(long? errUs, int headRemaining)
    {
        if (errUs is not long err)
        {
            Locked = false;
            return new Decision(Kind.Silence, _frameSamples);
        }
        if (Locked && Math.Abs(err) > RelockUs) Locked = false;
        if (!Locked)
        {
            int n = (int)Math.Round(Math.Abs(err) / _usPerSample, MidpointRounding.AwayFromZero);
            if (err < -LockTolUs) return new Decision(Kind.Silence, Math.Min(n, _frameSamples));
            if (err > LockTolUs) return new Decision(Kind.Skip, Math.Min(n, headRemaining));
            Locked = true;
            _filteredErrUs = err;
            return new Decision(Kind.Play, headRemaining);
        }
        _filteredErrUs += (err - _filteredErrUs) * FilterAlpha;
        int adjust =
            _filteredErrUs > SlewFastUs ? -2 :
            _filteredErrUs > SlewUs ? -1 :
            _filteredErrUs < -SlewFastUs ? 2 :
            _filteredErrUs < -SlewUs ? 1 : 0;
        _filteredErrUs += adjust * _usPerSample;
        return new Decision(Kind.Play, headRemaining, adjust);
    }

    public void Reset()
    {
        Locked = false;
        _filteredErrUs = 0;
    }
}
