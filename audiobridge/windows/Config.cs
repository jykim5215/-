namespace AudioBridge.Win;

/// <summary>전역 설정. 이름은 %APPDATA%\AudioBridge\name.txt에 저장.</summary>
public static class Config
{
    public static volatile string Name = Environment.MachineName;

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
