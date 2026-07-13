using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace AudioBridge.Win;

/// <summary>Material-inspired companion UI that follows the Android app's card hierarchy.</summary>
public sealed class MainWindow : Window
{
    private static readonly Brush Primary = Brush("#0B57D0");
    private static readonly Brush PrimaryContainer = Brush("#DCE6FF");
    private static readonly Brush OnPrimaryContainer = Brush("#173B73");
    private static readonly Brush SecondaryContainer = Brush("#E7EEFF");
    private static readonly Brush Surface = Brush("#FFFFFF");
    private static readonly Brush SurfaceVariant = Brush("#EEF2F8");
    private static readonly Brush Outline = Brush("#D8DEE9");
    private static readonly Brush Muted = Brush("#5F6673");
    private static readonly Brush BackgroundBrush = Brush("#F7F9FC");
    private static readonly Brush Success = Brush("#197A4B");

    private readonly TextBlock _statusTitle;
    private readonly TextBlock _statusDetail;
    private readonly Border _statusDot;
    private readonly ListBox _log;
    private readonly Border _updateBanner;
    private readonly TextBlock _updateText;
    private readonly Button _updateButton;
    private readonly TextBox _nameBox;
    private UpdateInfo? _availableUpdate;

    public MainWindow(int ctlPort, int modeAPort, int modeBPort)
    {
        Title = "AudioBridge";
        Width = 500;
        Height = 780;
        MinWidth = 440;
        MinHeight = 650;
        Background = BackgroundBrush;
        FontFamily = new FontFamily("Segoe UI Variable Text, Segoe UI");
        WindowStartupLocation = WindowStartupLocation.CenterScreen;

        var content = new StackPanel { Margin = new Thickness(24, 20, 24, 24) };

        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition());
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = new StackPanel();
        title.Children.Add(new TextBlock
        {
            Text = "AudioBridge",
            FontSize = 24,
            FontWeight = FontWeights.SemiBold,
            Foreground = Brush("#1B1B1F"),
        });
        title.Children.Add(new TextBlock
        {
            Text = $"{Config.Name}  ·  v{UpdateService.CurrentVersionName}",
            FontSize = 12,
            Foreground = Muted,
            Margin = new Thickness(0, 3, 0, 0),
        });
        titleRow.Children.Add(title);
        var readyChip = Pill("●  실행 중", Success, Brush("#E3F5EA"));
        Grid.SetColumn(readyChip, 1);
        titleRow.Children.Add(readyChip);
        content.Children.Add(titleRow);

        _updateBanner = Card(SecondaryContainer, 20, new Thickness(16, 13, 12, 13));
        _updateBanner.Margin = new Thickness(0, 18, 0, 0);
        _updateBanner.Visibility = Visibility.Collapsed;
        var updateRow = new Grid();
        updateRow.ColumnDefinitions.Add(new ColumnDefinition());
        updateRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _updateText = new TextBlock
        {
            Text = "새 버전이 있습니다.",
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = OnPrimaryContainer,
            FontWeight = FontWeights.SemiBold,
        };
        updateRow.Children.Add(_updateText);
        _updateButton = RoundedButton("업데이트", Primary, Brushes.White);
        _updateButton.Click += InstallUpdateAsync;
        Grid.SetColumn(_updateButton, 1);
        updateRow.Children.Add(_updateButton);
        _updateBanner.Child = updateRow;
        content.Children.Add(_updateBanner);

        var hero = Card(PrimaryContainer, 28, new Thickness(22));
        hero.Margin = new Thickness(0, 18, 0, 0);
        var heroStack = new StackPanel();
        var devices = new Grid();
        devices.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        devices.ColumnDefinitions.Add(new ColumnDefinition());
        devices.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        devices.Children.Add(Avatar("PC"));
        var dots = new TextBlock
        {
            Text = "•   •   •",
            Foreground = Brush("#7692C5"),
            FontSize = 18,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(dots, 1);
        devices.Children.Add(dots);
        var phone = Avatar("▯");
        Grid.SetColumn(phone, 2);
        devices.Children.Add(phone);
        heroStack.Children.Add(devices);

        var statusRow = new Grid { Margin = new Thickness(0, 18, 0, 0) };
        statusRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        statusRow.ColumnDefinitions.Add(new ColumnDefinition());
        _statusDot = new Border
        {
            Width = 10,
            Height = 10,
            CornerRadius = new CornerRadius(5),
            Background = Brush("#7692C5"),
            Margin = new Thickness(0, 6, 12, 0),
            VerticalAlignment = VerticalAlignment.Top,
        };
        statusRow.Children.Add(_statusDot);
        var statusText = new StackPanel();
        _statusTitle = new TextBlock
        {
            Text = "연결을 기다리고 있어요",
            Foreground = OnPrimaryContainer,
            FontSize = 17,
            FontWeight = FontWeights.SemiBold,
        };
        _statusDetail = new TextBlock
        {
            Text = "Android에서 기기 찾기를 누르고 이 PC를 선택하세요.",
            Foreground = OnPrimaryContainer,
            Opacity = 0.76,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 4, 0, 0),
        };
        statusText.Children.Add(_statusTitle);
        statusText.Children.Add(_statusDetail);
        Grid.SetColumn(statusText, 1);
        statusRow.Children.Add(statusText);
        heroStack.Children.Add(statusRow);
        hero.Child = heroStack;
        content.Children.Add(hero);

        var nameCard = Card(Surface, 22, new Thickness(18, 16, 14, 16));
        nameCard.BorderBrush = Outline;
        nameCard.BorderThickness = new Thickness(1);
        nameCard.Margin = new Thickness(0, 14, 0, 0);
        var nameGrid = new Grid();
        nameGrid.ColumnDefinitions.Add(new ColumnDefinition());
        nameGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var nameStack = new StackPanel();
        nameStack.Children.Add(Label("이 PC의 이름"));
        _nameBox = new TextBox
        {
            Text = Config.Name,
            MaxLength = 20,
            FontSize = 15,
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent,
            Foreground = Brush("#1B1B1F"),
            Padding = new Thickness(0, 6, 0, 3),
        };
        nameStack.Children.Add(_nameBox);
        nameGrid.Children.Add(nameStack);
        var save = RoundedButton("저장", Primary, Brushes.White);
        save.Margin = new Thickness(12, 0, 0, 0);
        save.VerticalAlignment = VerticalAlignment.Center;
        save.Click += (_, _) =>
        {
            Config.SaveName(_nameBox.Text);
            _nameBox.Text = Config.Name;
            Console.WriteLine($"[설정] PC 이름 변경 · {Config.Name}");
        };
        Grid.SetColumn(save, 1);
        nameGrid.Children.Add(save);
        nameCard.Child = nameGrid;
        content.Children.Add(nameCard);

        var syncCard = Card(Surface, 22, new Thickness(18));
        syncCard.BorderBrush = Outline;
        syncCard.BorderThickness = new Thickness(1);
        syncCard.Margin = new Thickness(0, 14, 0, 0);
        var syncStack = new StackPanel();
        syncStack.Children.Add(new TextBlock
        {
            Text = "가상 지휘자 · 동기화 엔진",
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            Foreground = Brush("#1B1B1F"),
        });
        syncStack.Children.Add(new TextBlock
        {
            Text = "모든 스피커가 같은 시각의 프레임을 재생하도록 계속 보정합니다.",
            FontSize = 12,
            Foreground = Muted,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 4, 0, 10),
        });
        syncStack.Children.Add(FeatureRow("공통 시계", "왕복 시간이 짧은 표본으로 기기 시계를 맞춤"));
        syncStack.Children.Add(FeatureRow("하드웨어 예약 재생", "WASAPI 실제 재생 헤드에 맞춰 프레임을 배치"));
        syncStack.Children.Add(FeatureRow("장시간 드리프트 보정", "재생 중에도 시계 속도 차이를 부드럽게 추적"));
        syncCard.Child = syncStack;
        content.Children.Add(syncCard);

        var logCard = Card(Surface, 22, new Thickness(14));
        logCard.BorderBrush = Outline;
        logCard.BorderThickness = new Thickness(1);
        logCard.Margin = new Thickness(0, 14, 0, 0);
        var logStack = new StackPanel();
        var logHeader = new Grid { Margin = new Thickness(4, 0, 4, 8) };
        logHeader.ColumnDefinitions.Add(new ColumnDefinition());
        logHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        logHeader.Children.Add(new TextBlock
        {
            Text = "활동 기록",
            FontWeight = FontWeights.SemiBold,
            FontSize = 14,
        });
        var checkButton = RoundedButton("업데이트 확인", SurfaceVariant, OnPrimaryContainer);
        checkButton.Padding = new Thickness(12, 6, 12, 6);
        checkButton.Click += async (_, _) => await CheckUpdatesAsync(true);
        Grid.SetColumn(checkButton, 1);
        logHeader.Children.Add(checkButton);
        logStack.Children.Add(logHeader);
        _log = new ListBox
        {
            Height = 170,
            BorderThickness = new Thickness(0),
            Background = SurfaceVariant,
            FontFamily = new FontFamily("Cascadia Mono, Consolas"),
            FontSize = 11,
            Padding = new Thickness(8),
        };
        logStack.Children.Add(_log);
        logCard.Child = logStack;
        content.Children.Add(logCard);

        var scroll = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = content,
        };
        Content = scroll;

        Console.SetOut(new UiWriter(this));
        Console.WriteLine($"[시작] PC 이름 · {Config.Name}");
        Console.WriteLine("[안내] Windows 방화벽 창이 뜨면 개인 네트워크를 허용하세요.");

        Loaded += async (_, _) => await CheckUpdatesAsync(false);
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
        Environment.Exit(0);
    }

    private async Task CheckUpdatesAsync(bool reportCurrent)
    {
        var update = await UpdateService.CheckAsync();
        if (update == null)
        {
            if (reportCurrent) Console.WriteLine("[업데이트] 최신 버전입니다.");
            return;
        }
        _availableUpdate = update;
        _updateText.Text = $"새 버전 {update.VersionName}을 사용할 수 있어요";
        _updateButton.Content = "업데이트";
        _updateButton.IsEnabled = true;
        _updateBanner.Visibility = Visibility.Visible;
    }

    private async void InstallUpdateAsync(object sender, RoutedEventArgs e)
    {
        var update = _availableUpdate;
        if (update == null) return;
        _updateButton.IsEnabled = false;
        try
        {
            var progress = new Progress<double>(value =>
                _updateButton.Content = $"{Math.Round(value * 100):0}%");
            await UpdateService.StageAndRestartAsync(update, progress);
            _updateButton.Content = "다시 시작 중";
            Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            _updateButton.Content = "다시 시도";
            _updateButton.IsEnabled = true;
            Console.WriteLine("[업데이트] 실패 · " + ex.Message);
        }
    }

    private void Append(string line)
    {
        Dispatcher.BeginInvoke(() =>
        {
            _log.Items.Add($"{DateTime.Now:HH:mm:ss}  {line}");
            while (_log.Items.Count > 300) _log.Items.RemoveAt(0);
            _log.ScrollIntoView(_log.Items[^1]);

            if (line.StartsWith("[연결] 휴대폰 연결 ·"))
                SetStatus("휴대폰과 연결됐어요", "소리가 나올 기기는 Android에서 선택할 수 있어요.", Primary);
            else if (line.Contains("연결 종료") || line.Contains("응답이 없어"))
                SetStatus("연결을 기다리고 있어요", "Android에서 기기 찾기를 누르고 이 PC를 선택하세요.", Brush("#7692C5"));
            else if (line.StartsWith("[재생]"))
                SetStatus("이 PC에서 재생 중", "공통 시각과 실제 출력 위치를 기준으로 동기화하고 있어요.", Success);
            else if (line.StartsWith("[송신]"))
                SetStatus("PC 소리를 보내는 중", "연결된 스피커들이 같은 시각에 재생하도록 전송하고 있어요.", Success);
            else if (line.StartsWith("[수신] 재생을 중지") || line.StartsWith("[송신] 중지"))
                SetStatus("휴대폰과 연결됐어요", "소리가 나올 기기는 Android에서 선택할 수 있어요.", Primary);
        });
    }

    private void SetStatus(string title, string detail, Brush dot)
    {
        _statusTitle.Text = title;
        _statusDetail.Text = detail;
        _statusDot.Background = dot;
    }

    private static Border FeatureRow(string title, string detail)
    {
        var row = new Border
        {
            Background = SurfaceVariant,
            CornerRadius = new CornerRadius(14),
            Padding = new Thickness(12, 9, 12, 9),
            Margin = new Thickness(0, 5, 0, 0),
        };
        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.Children.Add(new TextBlock
        {
            Text = "●",
            Foreground = Success,
            FontSize = 10,
            Margin = new Thickness(0, 3, 10, 0),
        });
        var text = new StackPanel();
        text.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold, FontSize = 12 });
        text.Children.Add(new TextBlock { Text = detail, Foreground = Muted, FontSize = 11, TextWrapping = TextWrapping.Wrap });
        Grid.SetColumn(text, 1);
        grid.Children.Add(text);
        row.Child = grid;
        return row;
    }

    private static Border Avatar(string glyph) => new()
    {
        Width = 48,
        Height = 48,
        CornerRadius = new CornerRadius(24),
        Background = Surface,
        Child = new TextBlock
        {
            Text = glyph,
            Foreground = Primary,
            FontSize = glyph == "PC" ? 13 : 26,
            FontWeight = FontWeights.Bold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        },
    };

    private static Border Pill(string text, Brush foreground, Brush background) => new()
    {
        CornerRadius = new CornerRadius(20),
        Background = background,
        Padding = new Thickness(11, 6, 11, 6),
        VerticalAlignment = VerticalAlignment.Center,
        Child = new TextBlock { Text = text, Foreground = foreground, FontSize = 11, FontWeight = FontWeights.SemiBold },
    };

    private static TextBlock Label(string text) => new()
    {
        Text = text,
        Foreground = Muted,
        FontSize = 11,
        FontWeight = FontWeights.SemiBold,
    };

    private static Border Card(Brush background, double radius, Thickness padding) => new()
    {
        Background = background,
        CornerRadius = new CornerRadius(radius),
        Padding = padding,
    };

    private static Button RoundedButton(string text, Brush background, Brush foreground)
    {
        var button = new Button
        {
            Content = text,
            Background = background,
            Foreground = foreground,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(16, 8, 16, 8),
            Cursor = System.Windows.Input.Cursors.Hand,
            FontWeight = FontWeights.SemiBold,
        };
        var border = new FrameworkElementFactory(typeof(Border));
        border.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(Control.BackgroundProperty));
        border.SetValue(Border.CornerRadiusProperty, new CornerRadius(18));
        border.SetValue(Border.PaddingProperty, new TemplateBindingExtension(Control.PaddingProperty));
        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(HorizontalAlignmentProperty, HorizontalAlignment.Center);
        presenter.SetValue(VerticalAlignmentProperty, VerticalAlignment.Center);
        border.AppendChild(presenter);
        button.Template = new ControlTemplate(typeof(Button)) { VisualTree = border };
        return button;
    }

    private static SolidColorBrush Brush(string hex)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        brush.Freeze();
        return brush;
    }

    private sealed class UiWriter : TextWriter
    {
        private readonly MainWindow _window;
        private readonly StringBuilder _buffer = new();

        public UiWriter(MainWindow window) => _window = window;
        public override Encoding Encoding => Encoding.UTF8;

        public override void Write(char value)
        {
            if (value == '\n')
            {
                string line = _buffer.ToString().TrimEnd('\r');
                _buffer.Clear();
                if (line.Length > 0) _window.Append(line);
            }
            else
            {
                _buffer.Append(value);
            }
        }
    }
}
