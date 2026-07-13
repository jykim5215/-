using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace AudioBridge.Win;

/// <summary>Compact Windows companion UI with the same visual language as Android.</summary>
public sealed class MainWindow : Window
{
    private static readonly Brush Primary = FrozenBrush("#0B57D0");
    private static readonly Brush PrimaryContainer = FrozenBrush("#DCE6FF");
    private static readonly Brush OnPrimaryContainer = FrozenBrush("#173B73");
    private static readonly Brush SecondaryContainer = FrozenBrush("#E7EEFF");
    private static readonly Brush Surface = FrozenBrush("#FFFFFF");
    private static readonly Brush SurfaceVariant = FrozenBrush("#EEF2F8");
    private static readonly Brush Outline = FrozenBrush("#D8DEE9");
    private static readonly Brush Muted = FrozenBrush("#606773");
    private static readonly Brush BackgroundBrush = FrozenBrush("#F7F9FC");
    private static readonly Brush Success = FrozenBrush("#197A4B");
    private static readonly Brush Warning = FrozenBrush("#B05A00");

    private readonly TextBlock _statusTitle;
    private readonly TextBlock _statusDetail;
    private readonly Border _statusDot;
    private readonly Border _updateBanner;
    private readonly TextBlock _updateText;
    private readonly Button _updateButton;
    private readonly TextBlock _updateStatus;
    private readonly TextBlock _deviceLine;
    private readonly TextBox _nameBox;
    private UpdateInfo? _availableUpdate;

    public MainWindow(int ctlPort, int modeAPort, int modeBPort)
    {
        Title = "AudioBridge";
        Width = 460;
        Height = 560;
        MinWidth = 420;
        MinHeight = 520;
        Background = BackgroundBrush;
        FontFamily = new FontFamily("Segoe UI");
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        UseLayoutRounding = true;
        SnapsToDevicePixels = true;
        TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
        TextOptions.SetTextRenderingMode(this, TextRenderingMode.ClearType);
        TextOptions.SetTextHintingMode(this, TextHintingMode.Fixed);

        var appIcon = LoadAppIcon();
        if (appIcon != null) Icon = appIcon;

        var content = new StackPanel { Margin = new Thickness(24, 22, 24, 22) };

        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition());
        if (appIcon != null)
        {
            titleRow.Children.Add(new Image
            {
                Source = appIcon,
                Width = 46,
                Height = 46,
                Stretch = Stretch.Uniform,
                Margin = new Thickness(0, 0, 14, 0),
            });
        }
        var titleStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        titleStack.Children.Add(new TextBlock
        {
            Text = "AudioBridge",
            FontSize = 23,
            FontWeight = FontWeights.SemiBold,
            Foreground = FrozenBrush("#1B1B1F"),
        });
        _deviceLine = new TextBlock
        {
            Text = $"{Config.Name}  ·  v{UpdateService.CurrentVersionName}",
            FontSize = 12,
            Foreground = Muted,
            Margin = new Thickness(0, 2, 0, 0),
        };
        titleStack.Children.Add(_deviceLine);
        Grid.SetColumn(titleStack, 1);
        titleRow.Children.Add(titleStack);
        content.Children.Add(titleRow);

        _updateBanner = Card(SecondaryContainer, 20, new Thickness(16, 12, 12, 12));
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
            FontSize = 13,
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
        devices.Children.Add(Avatar("PC", 13));
        var dots = new TextBlock
        {
            Text = "•    •    •",
            Foreground = FrozenBrush("#7692C5"),
            FontSize = 17,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(dots, 1);
        devices.Children.Add(dots);
        var phone = Avatar("▯", 25);
        Grid.SetColumn(phone, 2);
        devices.Children.Add(phone);
        heroStack.Children.Add(devices);

        var statusRow = new Grid { Margin = new Thickness(0, 17, 0, 0) };
        statusRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        statusRow.ColumnDefinitions.Add(new ColumnDefinition());
        _statusDot = new Border
        {
            Width = 9,
            Height = 9,
            CornerRadius = new CornerRadius(5),
            Background = FrozenBrush("#7692C5"),
            Margin = new Thickness(0, 6, 11, 0),
            VerticalAlignment = VerticalAlignment.Top,
        };
        statusRow.Children.Add(_statusDot);
        var statusText = new StackPanel();
        _statusTitle = new TextBlock
        {
            Text = "연결을 기다리고 있어요",
            Foreground = OnPrimaryContainer,
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
        };
        _statusDetail = new TextBlock
        {
            Text = "Android에서 기기 찾기를 누르고 이 PC를 선택하세요.",
            Foreground = OnPrimaryContainer,
            Opacity = 0.75,
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

        var nameCard = Card(Surface, 22, new Thickness(18, 15, 14, 15));
        nameCard.BorderBrush = Outline;
        nameCard.BorderThickness = new Thickness(1);
        nameCard.Margin = new Thickness(0, 14, 0, 0);
        var nameGrid = new Grid();
        nameGrid.ColumnDefinitions.Add(new ColumnDefinition());
        nameGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var nameStack = new StackPanel();
        nameStack.Children.Add(new TextBlock
        {
            Text = "이 PC의 이름",
            Foreground = Muted,
            FontSize = 11,
        });
        _nameBox = new TextBox
        {
            Text = Config.Name,
            MaxLength = 20,
            FontSize = 15,
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent,
            Foreground = FrozenBrush("#1B1B1F"),
            Padding = new Thickness(0, 5, 0, 2),
        };
        nameStack.Children.Add(_nameBox);
        nameGrid.Children.Add(nameStack);
        var saveButton = RoundedButton("저장", Primary, Brushes.White);
        saveButton.Margin = new Thickness(12, 0, 0, 0);
        saveButton.VerticalAlignment = VerticalAlignment.Center;
        saveButton.Click += (_, _) =>
        {
            Config.SaveName(_nameBox.Text);
            _nameBox.Text = Config.Name;
            _deviceLine.Text = $"{Config.Name}  ·  v{UpdateService.CurrentVersionName}";
        };
        Grid.SetColumn(saveButton, 1);
        nameGrid.Children.Add(saveButton);
        nameCard.Child = nameGrid;
        content.Children.Add(nameCard);

        var footer = new Grid { Margin = new Thickness(2, 18, 2, 0) };
        footer.ColumnDefinitions.Add(new ColumnDefinition());
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _updateStatus = new TextBlock
        {
            Text = "개인 네트워크에서 대기 중",
            Foreground = Muted,
            FontSize = 11,
            VerticalAlignment = VerticalAlignment.Center,
        };
        footer.Children.Add(_updateStatus);
        var checkButton = RoundedButton("업데이트 확인", SurfaceVariant, OnPrimaryContainer);
        checkButton.Padding = new Thickness(13, 7, 13, 7);
        checkButton.Click += async (_, _) => await CheckUpdatesAsync(true);
        Grid.SetColumn(checkButton, 1);
        footer.Children.Add(checkButton);
        content.Children.Add(footer);

        Content = new ScrollViewer
        {
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = content,
        };

        Console.SetOut(new UiWriter(this));
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
        if (reportCurrent) _updateStatus.Text = "업데이트 확인 중…";
        var update = await UpdateService.CheckAsync();
        if (update == null)
        {
            if (reportCurrent) _updateStatus.Text = "현재 최신 버전이에요";
            return;
        }
        _availableUpdate = update;
        _updateText.Text = $"새 버전 {update.VersionName}을 사용할 수 있어요";
        _updateButton.Content = "업데이트";
        _updateButton.IsEnabled = true;
        _updateBanner.Visibility = Visibility.Visible;
        _updateStatus.Text = "새 업데이트가 있어요";
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
            SetStatus("업데이트하지 못했어요", ex.Message, Warning);
        }
    }

    private void HandleServiceMessage(string line)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (line.StartsWith("[연결] 휴대폰 연결 ·"))
                SetStatus("휴대폰과 연결됐어요", "소리가 나올 기기는 Android에서 선택할 수 있어요.", Primary);
            else if (line.Contains("연결 종료") || line.Contains("응답이 없어"))
                SetStatus("연결을 기다리고 있어요", "Android에서 기기 찾기를 누르고 이 PC를 선택하세요.", FrozenBrush("#7692C5"));
            else if (line.StartsWith("[재생]"))
                SetStatus("이 PC에서 재생 중", "연결된 기기와 소리 시점을 자동으로 맞추고 있어요.", Success);
            else if (line.StartsWith("[송신] PC 소리 전송 시작"))
                SetStatus("PC 소리를 보내는 중", "연결된 스피커로 소리를 보내고 있어요.", Success);
            else if (line.StartsWith("[수신] 재생을 중지") || line.StartsWith("[송신] 중지"))
                SetStatus("휴대폰과 연결됐어요", "소리가 나올 기기는 Android에서 선택할 수 있어요.", Primary);
            else if (line.StartsWith("[오류]"))
                SetStatus("확인이 필요해요", line[4..].Trim(), Warning);
        });
    }

    private void SetStatus(string title, string detail, Brush dot)
    {
        _statusTitle.Text = title;
        _statusDetail.Text = detail;
        _statusDot.Background = dot;
    }

    private static Border Avatar(string glyph, double fontSize) => new()
    {
        Width = 48,
        Height = 48,
        CornerRadius = new CornerRadius(24),
        Background = Surface,
        Child = new TextBlock
        {
            Text = glyph,
            Foreground = Primary,
            FontSize = fontSize,
            FontWeight = FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        },
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
            FontSize = 12,
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

    private static ImageSource? LoadAppIcon()
    {
        try
        {
            return BitmapFrame.Create(new Uri("pack://application:,,,/Assets/AudioBridge.png", UriKind.Absolute));
        }
        catch
        {
            return null;
        }
    }

    private static SolidColorBrush FrozenBrush(string hex)
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
                if (line.Length > 0) _window.HandleServiceMessage(line);
            }
            else
            {
                _buffer.Append(value);
            }
        }
    }
}
