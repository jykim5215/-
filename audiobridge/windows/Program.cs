using System.Text;

namespace AudioBridge.Win;

public static class Program
{
    public static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { }

        int ctlPort = Protocol.DefaultCtlPort;
        int modeAPort = 48552; // TCP 오디오(모드 A) 리스너 포트
        int modeBPort = Protocol.DefaultModeBPort;
        string name = Environment.MachineName;

        foreach (var arg in args)
        {
            if (arg is "-h" or "--help")
            {
                Console.WriteLine("사용법: AudioBridgeWin [--name=표시이름] [--ctl-port=48550] [--mode-a-port=48552] [--mode-b-port=48553]");
                return 0;
            }
            if (arg.StartsWith("--name=")) name = arg["--name=".Length..];
            else if (arg.StartsWith("--ctl-port=")) _ = int.TryParse(arg["--ctl-port=".Length..], out ctlPort);
            else if (arg.StartsWith("--mode-a-port=")) _ = int.TryParse(arg["--mode-a-port=".Length..], out modeAPort);
            else if (arg.StartsWith("--mode-b-port=")) _ = int.TryParse(arg["--mode-b-port=".Length..], out modeBPort);
        }
        if (ctlPort is < 1 or > 65535 || modeAPort is < 1 or > 65535 || modeBPort is < 1 or > 65535)
        {
            Console.WriteLine("[오류] 포트는 1~65535 사이여야 합니다");
            return 1;
        }

        Console.WriteLine("""
            ╔══════════════════════════════════════════╗
            ║  AudioBridge — 윈도우 동반 프로그램 v1.0  ║
            ╚══════════════════════════════════════════╝
            """);
        Console.WriteLine($"PC 이름: {name}");
        Console.WriteLine("· 폰과 PC가 같은 Wi-Fi/LAN에 있어야 합니다.");
        Console.WriteLine("· 처음 실행 시 Windows 방화벽 허용 창이 뜨면 '개인 네트워크'를 허용하세요.");
        Console.WriteLine("· 종료: Ctrl+C 또는 창 닫기");
        Console.WriteLine();

        using var discovery = new DiscoveryResponder(name, ctlPort);
        discovery.Start();
        new ControlServer(name, ctlPort, modeAPort, modeBPort).Run();
        return 0;
    }
}
