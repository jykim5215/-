using System.Diagnostics;

namespace AudioBridge.Win;

/// <summary>
/// 프로세스 전역 단조 시계 (마이크로초). 오디오 패킷 타임스탬프와
/// clk 시계 동기 응답이 반드시 같은 시계를 써야 한다 (PROTOCOL.md §7).
/// </summary>
public static class Clock
{
    private static readonly Stopwatch Sw = Stopwatch.StartNew();

    public static long Us => Sw.Elapsed.Ticks / 10;
}
