using System.IO;
using System.Net;
using System.Net.Sockets;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge.Win;

/// <summary>
/// 모드 B: 폰이 보내는 오디오를 받아 PC 스피커로 재생한다.
/// UDP 수신 기본, TCP 옵션(폰이 접속해 옴). 첫 패킷 헤더로 포맷을 정한다.
/// </summary>
public sealed class ModeBPlayer : IDisposable
{
    private readonly IPAddress _phone;
    private readonly bool _useTcp;
    public int Port { get; }

    private UdpClient? _udp;
    private TcpListener? _tcp;
    private volatile bool _running;

    private WasapiOut? _output;
    private BufferedWaveProvider? _provider;
    private volatile float _gain = 1f;

    /// <summary>원격 볼륨 (0~100).</summary>
    public void SetGain(int percent) => _gain = Math.Clamp(percent, 0, 100) / 100f;

    public ModeBPlayer(IPAddress phone, int port, bool useTcp)
    {
        _phone = phone;
        Port = port;
        _useTcp = useTcp;
    }

    public void Start()
    {
        if (_useTcp)
        {
            try
            {
                _tcp = new TcpListener(IPAddress.Any, Port);
                _tcp.Start();
            }
            catch (SocketException)
            {
                throw new InvalidOperationException($"PC 포트 {Port}이(가) 이미 사용 중입니다");
            }
            _running = true;
            new Thread(TcpLoop) { IsBackground = true, Name = "ab-b-rx" }.Start();
        }
        else
        {
            try
            {
                _udp = new UdpClient(Port);
            }
            catch (SocketException)
            {
                throw new InvalidOperationException($"PC 포트 {Port}이(가) 이미 사용 중입니다");
            }
            _running = true;
            new Thread(UdpLoop) { IsBackground = true, Name = "ab-b-rx" }.Start();
        }
        Console.WriteLine($"[모드 B] 폰 오디오 수신 대기 ({(_useTcp ? "TCP" : "UDP")} {Port})");
    }

    private void UdpLoop()
    {
        while (_running)
        {
            byte[] data;
            var ep = new IPEndPoint(IPAddress.Any, 0);
            try
            {
                data = _udp!.Receive(ref ep);
            }
            catch
            {
                if (!_running) return;
                continue;
            }
            if (!ep.Address.Equals(_phone)) continue; // 페어링된 폰 외 무시
            var info = Protocol.ParseHeader(data);
            if (info == null || Protocol.HeaderSize + info.PayloadLen != data.Length) continue;
            Play(info, data.AsSpan(Protocol.HeaderSize, info.PayloadLen));
        }
    }

    private void TcpLoop()
    {
        TcpClient? client = null;
        try
        {
            while (_running)
            {
                client = _tcp!.AcceptTcpClient();
                var remote = ((IPEndPoint)client.Client.RemoteEndPoint!).Address;
                if (!remote.Equals(_phone))
                {
                    client.Close();
                    continue;
                }
                break;
            }
            if (client == null || !_running) return;
            client.NoDelay = true;
            using var stream = client.GetStream();
            var header = new byte[Protocol.HeaderSize];
            var payload = new byte[Protocol.MaxPayload];
            while (_running)
            {
                ReadFully(stream, header, Protocol.HeaderSize);
                var info = Protocol.ParseHeader(header);
                if (info == null) return;
                ReadFully(stream, payload, info.PayloadLen);
                Play(info, payload.AsSpan(0, info.PayloadLen));
            }
        }
        catch
        {
            if (_running) Console.WriteLine("[모드 B] 폰 오디오 스트림이 끊어졌습니다");
        }
        finally
        {
            client?.Close();
        }
    }

    private static void ReadFully(NetworkStream s, byte[] buf, int len)
    {
        int off = 0;
        while (off < len)
        {
            int n = s.Read(buf, off, len - off);
            if (n <= 0) throw new EndOfStreamException();
            off += n;
        }
    }

    private void Play(PacketInfo info, ReadOnlySpan<byte> payload)
    {
        if (_provider == null)
        {
            _provider = new BufferedWaveProvider(new WaveFormat(info.SampleRate, 16, info.Channels))
            {
                BufferDuration = TimeSpan.FromSeconds(2),
                DiscardOnBufferOverflow = true,
            };
            try
            {
                _output = new WasapiOut(AudioClientShareMode.Shared, true, 60);
                _output.Init(_provider);
                _output.Play();
                Console.WriteLine($"[모드 B] 재생 시작 ({info.SampleRate}Hz/{info.Channels}ch)");
            }
            catch (Exception e)
            {
                Console.WriteLine("[모드 B] 스피커 출력을 열 수 없습니다: " + e.Message);
                _running = false;
                return;
            }
        }
        var buf = payload.ToArray();
        float g = _gain;
        if (g < 0.99f)
        {
            for (int i = 0; i + 1 < buf.Length; i += 2)
            {
                short s = (short)(buf[i] | (buf[i + 1] << 8));
                int v = Math.Clamp((int)(s * g), short.MinValue, short.MaxValue);
                buf[i] = (byte)v;
                buf[i + 1] = (byte)(v >> 8);
            }
        }
        _provider.AddSamples(buf, 0, buf.Length);
    }

    public void Dispose()
    {
        _running = false;
        _udp?.Dispose();
        try { _tcp?.Stop(); } catch { }
        try { _output?.Stop(); } catch { }
        _output?.Dispose();
        Console.WriteLine("[모드 B] 수신 중지");
    }
}
