using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AudioBridge.Win;

/// <summary>TCP JSON-lines control server described in PROTOCOL.md.</summary>
public sealed class ControlServer
{
    private readonly int _ctlPort;
    private readonly int _modeAPort;
    private readonly int _modeBPort;
    private Session? _current;

    public ControlServer(int ctlPort, int modeAPort, int modeBPort)
    {
        _ctlPort = ctlPort;
        _modeAPort = modeAPort;
        _modeBPort = modeBPort;
    }

    public void Run()
    {
        TcpListener listener;
        try
        {
            listener = new TcpListener(IPAddress.Any, _ctlPort);
            listener.Start();
        }
        catch (SocketException)
        {
            Console.WriteLine($"[오류] 제어 포트 {_ctlPort}을(를) 이미 사용 중입니다. --ctl-port 옵션으로 다른 포트를 지정하세요.");
            return;
        }

        Console.WriteLine($"[대기] TCP {_ctlPort} · Android의 기기 목록에서 이 PC를 선택하세요.");
        while (true)
        {
            TcpClient client;
            try
            {
                client = listener.AcceptTcpClient();
            }
            catch
            {
                return;
            }
            _current?.Close();
            _current = new Session(client, _modeAPort, _modeBPort);
            _current.Start();
        }
    }

    private sealed class Session
    {
        private readonly TcpClient _client;
        private readonly int _modeAPort;
        private readonly int _modeBPort;
        private readonly IPAddress _phone;
        private readonly StreamWriter _writer;
        private readonly StreamReader _reader;
        private readonly object _sendLock = new();
        private readonly ClockSync _clock = new();
        private volatile bool _closed;
        private long _lastPongMs = Environment.TickCount64;
        private ModeASender? _senderA;
        private ModeBPlayer? _playerB;
        private AcousticCalibrationResponder? _calibration;

        public Session(TcpClient client, int modeAPort, int modeBPort)
        {
            _client = client;
            _modeAPort = modeAPort;
            _modeBPort = modeBPort;
            _client.NoDelay = true;
            _phone = ((IPEndPoint)client.Client.RemoteEndPoint!).Address;
            var stream = client.GetStream();
            _writer = new StreamWriter(stream, new UTF8Encoding(false)) { NewLine = "\n" };
            _reader = new StreamReader(stream, Encoding.UTF8);
        }

        public void Start()
        {
            new Thread(ReadLoop) { IsBackground = true, Name = "ab-ctl-read" }.Start();
            new Thread(PingLoop) { IsBackground = true, Name = "ab-ctl-ping" }.Start();
            new Thread(ClockLoop) { IsBackground = true, Name = "ab-ctl-clock" }.Start();
            Console.WriteLine($"[연결] 휴대폰 연결 · {_phone}");
        }

        private void ReadLoop()
        {
            try
            {
                while (!_closed)
                {
                    string? line = _reader.ReadLine();
                    if (line == null || line.Length > 4096) break;
                    JsonDocument doc;
                    try { doc = JsonDocument.Parse(line); }
                    catch { continue; }
                    using (doc) Handle(doc.RootElement);
                }
            }
            catch
            {
                // The close path below updates the UI and releases audio resources.
            }
            Close();
            Console.WriteLine("[연결] 휴대폰 연결 종료");
        }

        private void Handle(JsonElement message)
        {
            switch (GetString(message, "type"))
            {
                case "hello":
                    if (GetInt(message, "version", -1) != Protocol.Version)
                    {
                        Send(new { type = "error", message = "프로토콜 버전이 다릅니다. 두 기기의 앱을 업데이트하세요." });
                        Close();
                        return;
                    }
                    Console.WriteLine($"[연결] 기기 이름 · {GetString(message, "name") ?? "알 수 없음"}");
                    Send(new { type = "hello", name = Config.Name, version = Protocol.Version, kind = "pc" });
                    break;
                case "ping":
                    Send(new { type = "pong" });
                    break;
                case "pong":
                    _lastPongMs = Environment.TickCount64;
                    break;
                case "clk":
                    if (message.TryGetProperty("t1", out _))
                    {
                        _clock.OnReply(GetLong(message, "t0", 0), GetLong(message, "t1", 0));
                    }
                    else
                    {
                        Send(new { type = "clk", t0 = GetLong(message, "t0", 0), t1 = Clock.Us });
                    }
                    break;
                case "bye":
                    Close();
                    break;
                case "vol":
                    _playerB?.SetGain(GetInt(message, "gain", 100));
                    break;
                case "modeA":
                    HandleModeA(message);
                    break;
                case "modeB":
                    HandleModeB(message);
                    break;
                case "cal":
                    HandleCalibration(message);
                    break;
            }
        }

        private void HandleCalibration(JsonElement message)
        {
            string action = GetString(message, "action") ?? "";
            if (action != "prepare") return;
            string id = GetString(message, "id") ?? "";
            if (id.Length is 0 or > 64) return;
            if (_senderA != null || _playerB != null)
            {
                Send(new { type = "cal", action = "error", id, message = "Windows에서 오디오가 재생 중이에요. 먼저 소리를 꺼 주세요." });
                return;
            }

            _calibration?.Dispose();
            var calibration = new AcousticCalibrationResponder(
                id,
                GetInt(message, "holdMs", 350),
                Send);
            _calibration = calibration;
            calibration.Start();
        }

        private void HandleModeA(JsonElement message)
        {
            string action = GetString(message, "action") ?? "";
            if (action == "stop")
            {
                _senderA?.Dispose();
                _senderA = null;
                Send(new { type = "modeA", status = "ok" });
                return;
            }
            if (action != "start") return;
            _calibration?.Dispose();
            _calibration = null;
            if (GetInt(message, "codec", 0) != Protocol.CodecPcm16)
            {
                Send(new { type = "modeA", status = "error", message = "지원하지 않는 코덱입니다. PCM16만 지원합니다." });
                return;
            }

            bool tcp = GetString(message, "transport") == "tcp";
            int udpPort = GetInt(message, "udpPort", 48552);
            if (udpPort is < 1 or > 65535)
            {
                Send(new { type = "modeA", status = "error", message = "잘못된 오디오 포트입니다." });
                return;
            }

            _senderA?.Dispose();
            _senderA = null;
            try
            {
                var sender = new ModeASender(_phone, udpPort, tcp, _modeAPort);
                sender.Start();
                _senderA = sender;
                if (tcp) Send(new { type = "modeA", status = "ok", tcpPort = _modeAPort });
                else Send(new { type = "modeA", status = "ok" });
            }
            catch (Exception e)
            {
                Send(new { type = "modeA", status = "error", message = e.Message });
            }
        }

        private void HandleModeB(JsonElement message)
        {
            string action = GetString(message, "action") ?? "";
            if (action == "stop")
            {
                _playerB?.Dispose();
                _playerB = null;
                Send(new { type = "modeB", status = "ok" });
                return;
            }
            if (action != "start") return;
            _calibration?.Dispose();
            _calibration = null;
            if (GetInt(message, "codec", 0) != Protocol.CodecPcm16)
            {
                Send(new { type = "modeB", status = "error", message = "지원하지 않는 코덱입니다. PCM16만 지원합니다." });
                return;
            }

            bool tcp = GetString(message, "transport") == "tcp";
            int delayMs = Protocol.NormalizePlayoutDelayMs(
                GetInt(message, "delayMs", Protocol.DefaultPlayoutDelayMs));
            _playerB?.Dispose();
            _playerB = null;
            try
            {
                // Do not wait for the periodic clock thread when playback starts.
                Send(new { type = "clk", t0 = Clock.Us });
                var player = new ModeBPlayer(_phone, _modeBPort, tcp, delayMs, () => _clock.OffsetUs);
                player.Start();
                _playerB = player;
                if (tcp) Send(new { type = "modeB", status = "ok", tcpPort = _modeBPort });
                else Send(new { type = "modeB", status = "ok", udpPort = _modeBPort });
            }
            catch (Exception e)
            {
                Send(new { type = "modeB", status = "error", message = e.Message });
            }
        }

        private void PingLoop()
        {
            while (!_closed)
            {
                Thread.Sleep(5_000);
                if (_closed) return;
                Send(new { type = "ping" });
                if (Environment.TickCount64 - _lastPongMs > 15_000)
                {
                    Console.WriteLine("[연결] 휴대폰 응답이 없어 연결을 정리합니다.");
                    Close();
                    return;
                }
            }
        }

        private void ClockLoop()
        {
            Thread.Sleep(200);
            while (!_closed)
            {
                _clock.AgeBestSample();
                Send(new { type = "clk", t0 = Clock.Us });
                Thread.Sleep(_clock.OffsetUs == null ? 400 : 3_000);
            }
        }

        private void Send(object value)
        {
            if (_closed) return;
            try
            {
                lock (_sendLock)
                {
                    _writer.WriteLine(JsonSerializer.Serialize(value));
                    _writer.Flush();
                }
            }
            catch
            {
                Close();
            }
        }

        public void Close()
        {
            if (_closed) return;
            _closed = true;
            _senderA?.Dispose();
            _senderA = null;
            _playerB?.Dispose();
            _playerB = null;
            _calibration?.Dispose();
            _calibration = null;
            try { _client.Close(); } catch { }
        }

        private static string? GetString(JsonElement message, string key) =>
            message.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;

        private static int GetInt(JsonElement message, string key, int fallback) =>
            message.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number
                ? value.GetInt32()
                : fallback;

        private static long GetLong(JsonElement message, string key, long fallback) =>
            message.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number
                ? value.GetInt64()
                : fallback;
    }
}
