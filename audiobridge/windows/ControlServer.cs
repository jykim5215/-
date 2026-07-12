using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AudioBridge.Win;

/// <summary>컨트롤 채널 서버 (TCP, JSON Lines — PROTOCOL.md §2). 동시에 한 세션만 유지.</summary>
public sealed class ControlServer
{
    private readonly string _name;
    private readonly int _ctlPort;
    private readonly int _modeAPort;
    private readonly int _modeBPort;
    private Session? _current;

    public ControlServer(string name, int ctlPort, int modeAPort, int modeBPort)
    {
        _name = name;
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
            Console.WriteLine($"[오류] 컨트롤 포트 {_ctlPort}이(가) 이미 사용 중입니다. --ctl-port 옵션으로 다른 포트를 지정하세요.");
            return;
        }
        Console.WriteLine($"[컨트롤] TCP {_ctlPort} 대기 중 — 폰 앱에서 이 PC를 선택하세요");
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
            _current = new Session(client, _name, _modeAPort, _modeBPort);
            _current.Start();
        }
    }

    private sealed class Session
    {
        private readonly TcpClient _client;
        private readonly string _name;
        private readonly int _modeAPort;
        private readonly int _modeBPort;
        private readonly IPAddress _phone;
        private readonly StreamWriter _writer;
        private readonly StreamReader _reader;
        private readonly object _sendLock = new();
        private volatile bool _closed;
        private long _lastPongMs = Environment.TickCount64;

        private ModeASender? _senderA;
        private ModeBPlayer? _playerB;

        public Session(TcpClient client, string name, int modeAPort, int modeBPort)
        {
            _client = client;
            _name = name;
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
            Console.WriteLine($"[연결] 폰 접속: {_phone}");
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
                    try { doc = JsonDocument.Parse(line); } catch { continue; }
                    using (doc)
                    {
                        Handle(doc.RootElement);
                    }
                }
            }
            catch
            {
                // 연결 끊김
            }
            Close();
            Console.WriteLine("[연결] 폰 연결 종료");
        }

        private void Handle(JsonElement m)
        {
            switch (GetString(m, "type"))
            {
                case "hello":
                    if (GetInt(m, "version", -1) != Protocol.Version)
                    {
                        Send(new { type = "error", message = "프로토콜 버전이 다릅니다" });
                        Close();
                        return;
                    }
                    Console.WriteLine($"[연결] 기기: {GetString(m, "name") ?? "?"}");
                    Send(new { type = "hello", name = _name, version = Protocol.Version, kind = "pc" });
                    break;
                case "ping":
                    Send(new { type = "pong" });
                    break;
                case "clk":
                    // 시계 동기 (PROTOCOL.md §7): 수신측 질의를 즉시 에코 + 내 시계 첨부
                    if (!m.TryGetProperty("t1", out _))
                    {
                        Send(new { type = "clk", t0 = GetLong(m, "t0", 0), t1 = Clock.Us });
                    }
                    break;
                case "pong":
                    _lastPongMs = Environment.TickCount64;
                    break;
                case "bye":
                    Close();
                    break;
                case "vol":
                    _playerB?.SetGain(GetInt(m, "gain", 100));
                    break;
                case "modeA":
                    HandleModeA(m);
                    break;
                case "modeB":
                    HandleModeB(m);
                    break;
            }
        }

        private void HandleModeA(JsonElement m)
        {
            string action = GetString(m, "action") ?? "";
            if (action == "stop")
            {
                _senderA?.Dispose();
                _senderA = null;
                Send(new { type = "modeA", status = "ok" });
                return;
            }
            if (action != "start") return;
            if (GetInt(m, "codec", 0) != Protocol.CodecPcm16)
            {
                Send(new { type = "modeA", status = "error", message = "지원하지 않는 코덱입니다 (PCM16만 지원)" });
                return;
            }
            bool tcp = GetString(m, "transport") == "tcp";
            int udpPort = GetInt(m, "udpPort", 48552);
            if (udpPort is < 1 or > 65535)
            {
                Send(new { type = "modeA", status = "error", message = "잘못된 포트" });
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

        private void HandleModeB(JsonElement m)
        {
            string action = GetString(m, "action") ?? "";
            if (action == "stop")
            {
                _playerB?.Dispose();
                _playerB = null;
                Send(new { type = "modeB", status = "ok" });
                return;
            }
            if (action != "start") return;
            if (GetInt(m, "codec", 0) != Protocol.CodecPcm16)
            {
                Send(new { type = "modeB", status = "error", message = "지원하지 않는 코덱입니다 (PCM16만 지원)" });
                return;
            }
            bool tcp = GetString(m, "transport") == "tcp";
            _playerB?.Dispose();
            _playerB = null;
            try
            {
                var player = new ModeBPlayer(_phone, _modeBPort, tcp);
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
                Thread.Sleep(5000);
                if (_closed) return;
                Send(new { type = "ping" });
                if (Environment.TickCount64 - _lastPongMs > 15000)
                {
                    Console.WriteLine("[연결] 폰 응답 없음 — 연결을 정리합니다");
                    Close();
                    return;
                }
            }
        }

        private void Send(object obj)
        {
            if (_closed) return;
            try
            {
                lock (_sendLock)
                {
                    _writer.WriteLine(JsonSerializer.Serialize(obj));
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
            try { _client.Close(); } catch { }
        }

        private static string? GetString(JsonElement m, string key) =>
            m.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static int GetInt(JsonElement m, string key, int def) =>
            m.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : def;

        private static long GetLong(JsonElement m, string key, long def) =>
            m.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt64() : def;
    }
}
