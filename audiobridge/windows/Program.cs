namespace AudioBridge.Win;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        int ctlPort = Protocol.DefaultCtlPort;
        int modeAPort = 48552;
        int modeBPort = Protocol.DefaultModeBPort;

        Config.Load();

        foreach (var arg in args)
        {
            if (arg.StartsWith("--name=")) Config.SaveName(arg["--name=".Length..]);
            else if (arg.StartsWith("--ctl-port=")) _ = int.TryParse(arg["--ctl-port=".Length..], out ctlPort);
            else if (arg.StartsWith("--mode-a-port=")) _ = int.TryParse(arg["--mode-a-port=".Length..], out modeAPort);
            else if (arg.StartsWith("--mode-b-port=")) _ = int.TryParse(arg["--mode-b-port=".Length..], out modeBPort);
        }
        if (ctlPort is < 1 or > 65535 || modeAPort is < 1 or > 65535 || modeBPort is < 1 or > 65535)
        {
            ctlPort = Protocol.DefaultCtlPort;
            modeAPort = 48552;
            modeBPort = Protocol.DefaultModeBPort;
        }

        var app = new System.Windows.Application();
        return app.Run(new MainWindow(ctlPort, modeAPort, modeBPort));
    }
}
