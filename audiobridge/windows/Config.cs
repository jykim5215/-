using System.IO;

namespace AudioBridge.Win;

/// <summary>전역 설정. 이름은 %APPDATA%\AudioBridge\name.txt, 스피커 소리 맞추기 보정은 sync.txt(µs)에 저장.</summary>
public static class Config
{
    public static volatile string Name = Environment.MachineName;

    private static long _calibrationUs;
    /** 스피커 소리 맞추기로 소스 폰이 정해 준 이 PC의 추가 지연 (µs) — 스피커 내부 처리 지연 차이를 메운다 */
    public static long CalibrationUs => Interlocked.Read(ref _calibrationUs);

    private static string SyncFile => Path.Combine(Dir, "sync.txt");

    public static void SaveCalibrationUs(long us)
    {
        long v = Math.Clamp(us, 0, Protocol.MaxCalibrationUs);
        Interlocked.Exchange(ref _calibrationUs, v);
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(SyncFile, v.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        catch { }
    }

    private static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AudioBridge");

    private static string NameFile => Path.Combine(Dir, "name.txt");

    public static void Load()
    {
        try
        {
            if (File.Exists(NameFile))
            {
                var n = File.ReadAllText(NameFile).Trim();
                if (n.Length > 0) Name = n[..Math.Min(n.Length, 20)];
            }
            if (File.Exists(SyncFile) &&
                long.TryParse(File.ReadAllText(SyncFile).Trim(), System.Globalization.NumberStyles.Integer,
                    System.Globalization.CultureInfo.InvariantCulture, out long us))
            {
                Interlocked.Exchange(ref _calibrationUs, Math.Clamp(us, 0, Protocol.MaxCalibrationUs));
            }
        }
        catch { }
    }

    public static void SaveName(string name)
    {
        var n = name.Trim();
        if (n.Length == 0) n = Environment.MachineName;
        Name = n[..Math.Min(n.Length, 20)];
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(NameFile, Name);
        }
        catch { }
    }
}
