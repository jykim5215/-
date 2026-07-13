using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AudioBridge.Win;

/// <summary>
/// 안드로이드 앱과 같은 아이덴티티(블루 + 흰 카드)의 간단한 상태 창.
/// Console 출력을 가로채 활동 기록으로 보여준다.
/// </summary>
public sealed class MainWindow : Window
{
    private static readonly Brush Blue = new SolidColorBrush(Color.FromRgb(0x0B, 0x57, 0xD0));
    private static readonly Brush BlueSoft = new SolidColorBrush(Color.FromRgb(0xE8, 0xF0, 0xFE));
    private static readonly Brush BlueDeep = new SolidColorBrush(Color.FromRgb(0x17, 0x4E, 0xA6));
    private static readonly Brush Gray = new SolidColorBrush(Color.FromRgb(0x5F, 0x63, 0x68));
    private static readonly Brush Bg = new SolidColorBrush(Color.FromRgb(0xF8, 0xFA, 0xFD));

    private readonly TextBlock _status;
    private readonly ListBox _log;

    public MainWindow(int ctlPort, int modeAPort, int modeBPort)
    {
        Title = "AudioBridge";
        Width = 430;
        Height = 560;
        Background = Bg;

        var root = new DockPanel();

        // 헤더
        var header = new Border { Background = Blue, Padding = new Thickness(20, 16, 20, 16) };
        var headerStack = new StackPanel();
        headerStack.Children.Add(new TextBlock
        {
            Text = "AudioBridge",
            Foreground = Brushes.White,
            FontSize = 20,
            FontWeight = FontWeights.SemiBold,
        });
        headerStack.Children.Add(new TextBlock
        {
            Text = "같은 Wi-Fi의 폰에서 이 PC를 선택하세요",
            Foreground = Brushes.White,
            Opacity = 0.85,
            FontSize = 12,
            Margin = new Thickness(0, 4, 0, 0),
        });
        header.Child = headerStack;
        DockPanel.SetDock(header, Dock.Top);
        root.Children.Add(header);

        var body = new StackPanel { Margin = new Thickness(20, 16, 20, 16) };

        body.Children.Add(new TextBlock { Text = "PC 이름 (폰 검색 목록에 표시)", Foreground = Gray, FontSize = 12 });
        var nameRow = new DockPanel { Margin = new Thickness(0, 6, 0, 0) };
        var saveBtn = new Button
        {
            Content = "저장",
            Padding = new Thickness(14, 6, 14, 6),
            Margin = new Thickness(8, 0, 0, 0),
            Background = Blue,
            Foreground = Brushes.White,
            BorderThickness = new Thickness(0),
        };
        DockPanel.SetDock(saveBtn, Dock.Right);
        var nameBox = new TextBox
        {
            Text = Config.Name,
            Padding = new Thickness(8, 6, 8, 6),
            MaxLength = 20,
            VerticalContentAlignment = VerticalAlignment.Center,
        };
        saveBtn.Click += (_, _) =>
        {
            Config.SaveName(nameBox.Text);
            nameBox.Text = Config.Name;
            Console.WriteLine($"[설정] PC 이름 변경: {Config.Name}");
        };
        nameRow.Children.Add(saveBtn);
        nameRow.Children.Add(nameBox);
        body.Children.Add(nameRow);

        var statusCard = new Border
        {
            Background = BlueSoft,
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(14, 12, 14, 12),
            Margin = new Thickness(0, 14, 0, 0),
        };
        _status = new TextBlock
        {
            Text = "대기 중 — 연결을 기다리고 있어요",
            Foreground = BlueDeep,
            FontSize = 13,
            TextWrapping = TextWrapping.Wrap,
        };
        statusCard.Child = _status;
        body.Children.Add(statusCard);

        body.Children.Add(new TextBlock
        {
            Text = "활동 기록",
            Foreground = Gray,
            FontSize = 12,
            Margin = new Thickness(0, 14, 0, 6),
        });
        DockPanel.SetDock(body, Dock.Top);
        root.Children.Add(body);

        _log = new ListBox
        {
            Margin = new Thickness(20, 0, 20, 16),
            BorderThickness = new Thickness(0),
            Background = Brushes.White,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 11.5,
        };
        root.Children.Add(_log);

        Content = root;

        Console.SetOut(new UiWriter(this));
        Console.WriteLine($"[시작] PC 이름: {Config.Name}");
        Console.WriteLine("[안내] 방화벽 허용 창이 뜨면 '개인 네트워크'를 허용하세요");

        // 서버들은 백그라운드에서 상시 대기
        Task.Run(() =>
        {
            var discovery = new DiscoveryResponder(ctlPort);
            discovery.Start();
            new ControlServer(ctlPort, modeAPort, modeBPort).Run();
        });
    }

    protected override void OnClosed(EventArgs e)
    {
        base.OnClosed(e);
        Environment.Exit(0); // 백그라운드 소켓 스레드 정리
    }

    private void Append(string line)
    {
        Dispatcher.BeginInvoke(() =>
        {
            _log.Items.Add($"{DateTime.Now:HH:mm:ss}  {line}");
            while (_log.Items.Count > 300) _log.Items.RemoveAt(0);
            _log.ScrollIntoView(_log.Items[^1]);

            if (line.Contains("폰 접속")) _status.Text = "연결됨 — 폰과 연결되어 있어요";
            else if (line.Contains("연결 종료") || line.Contains("응답 없음")) _status.Text = "대기 중 — 연결을 기다리고 있어요";
            else if (line.Contains("재생 시작")) _status.Text = "재생 중 — 폰의 소리를 이 PC에서 재생하고 있어요";
            else if (line.Contains("송신 시작")) _status.Text = "보내는 중 — PC 소리를 폰으로 보내고 있어요";
            else if (line.Contains("송신 중지") || line.Contains("수신 중지")) _status.Text = "연결됨 — 폰과 연결되어 있어요";
        });
    }

    /// <summary>Console 출력 → 창 로그.</summary>
    private sealed class UiWriter : TextWriter
    {
        private readonly MainWindow _win;
        private readonly StringBuilder _buf = new();

        public UiWriter(MainWindow win) => _win = win;

        public override Encoding Encoding => Encoding.UTF8;

        public override void Write(char value)
        {
            if (value == '\n')
            {
                var line = _buf.ToString().TrimEnd('\r');
                _buf.Clear();
                if (line.Length > 0) _win.Append(line);
            }
            else
            {
                _buf.Append(value);
            }
        }
    }
}
