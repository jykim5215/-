using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using NAudio.Wave;

namespace AudioBridge.Win;

/// <summary>
/// 모드 A: WASAPI loopback으로 PC 소리를 캡처해 48kHz/16-bit/스테레오로 변환 후
/// 폰으로 송신한다 (UDP 기본, TCP 옵션 — 폰이 이쪽 리스너로 접속).
/// </summary>
public sealed class ModeASender : IDisposable
{
    private readonly IPAddress _phone;
    private readonly bool _useTcp;
    private readonly int _tcpPort;

    private WasapiLoopbackCapture? _capture;
    private UdpClient? _udp;
    private IPEndPoint? _udpTarget;
    private TcpListener? _tcpListener;
    private volatile NetworkStream? _tcpStream;

    private readonly ByteRing _ring = new(Protocol.SampleRate * 4 * 2); // 2초 (48k * 4B * 2s)
    private volatile bool _running;
    private Thread? _sendThread;

    // 리샘플러 상태 (선형 보간, 청크 경계 연속성 유지)
    private int _srcRate = Protocol.SampleRate;
    private int _srcCh = 2;
    private double _pos;
    private float _prevL, _prevR;
    private bool _hasPrev;

    private int _seq;
    private bool _firstPacket = true;
    private readonly Stopwatch _clock = Stopwatch.StartNew();

    public ModeASender(IPAddress phone, int phoneUdpPort, bool useTcp, int tcpPort)
    {
        _phone = phone;
        _useTcp = useTcp;
        _tcpPort = tcpPort;
        if (!useTcp)
        {
            _udp = new UdpClient();
            _udpTarget = new IPEndPoint(phone, phoneUdpPort);
        }
    }

    /// <summary>시작. 실패 시 예외 — 메시지는 사용자에게 그대로 보여줄 수 있게 한국어.</summary>
    public void Start()
    {
        if (_useTcp)
        {
            try
            {
                _tcpListener = new TcpListener(IPAddress.Any, _tcpPort);
                _tcpListener.Start();
            }
            catch (SocketException)
            {
                throw new InvalidOperationException($"PC 포트 {_tcpPort}이(가) 이미 사용 중입니다");
            }
            var acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "ab-a-accept" };
            acceptThread.Start();
        }

        try
        {
            _capture = new WasapiLoopbackCapture();
        }
        catch (Exception e)
        {
            throw new InvalidOperationException("스피커 캡처를 열 수 없습니다: " + e.Message);
        }
        _srcRate = _capture.WaveFormat.SampleRate;
        _srcCh = _capture.WaveFormat.Channels;
        _capture.DataAvailable += OnData;
        _running = true;
        _sendThread = new Thread(SendLoop) { IsBackground = true, Name = "ab-a-send", Priority = ThreadPriority.Highest };
        _sendThread.Start();
        _capture.StartRecording();
        Console.WriteLine($"[송신] PC 소리 전송 시작 · {_phone} · {(_useTcp ? $"TCP {_tcpPort}" : "UDP")} · {_srcRate}Hz/{_srcCh}ch");
    }

    private void AcceptLoop()
    {
        while (_running || _tcpStream == null)
        {
            try
            {
                var client = _tcpListener!.AcceptTcpClient();
                var remote = ((IPEndPoint)client.Client.RemoteEndPoint!).Address;
                if (!remote.Equals(_phone))
                {
                    client.Close(); // 페어링된 폰 외 접속 거부
                    continue;
                }
                client.NoDelay = true;
                _tcpStream = client.GetStream();
                Console.WriteLine("[송신] 휴대폰이 TCP 오디오 스트림에 연결됐습니다.");
                return;
            }
            catch
            {
                return; // 리스너 닫힘
            }
        }
    }

    /// <summary>캡처 float 데이터 → 스테레오 다운믹스 → 48kHz 선형 리샘플 → s16le 링 버퍼.</summary>
    private void OnData(object? sender, WaveInEventArgs e)
    {
        int floats = e.BytesRecorded / 4;
        int frames = floats / _srcCh;
        if (frames == 0) return;

        // 소스 프레임 배열 구성: [prev, 이번 청크...] (경계 보간용)
        int total = frames + (_hasPrev ? 1 : 0);
        var left = new float[total];
        var right = new float[total];
        int w = 0;
        if (_hasPrev) { left[0] = _prevL; right[0] = _prevR; w = 1; }
        for (int f = 0; f < frames; f++)
        {
            int baseIdx = f * _srcCh * 4;
            float l = BitConverter.ToSingle(e.Buffer, baseIdx);
            float r = _srcCh >= 2 ? BitConverter.ToSingle(e.Buffer, baseIdx + 4) : l;
            left[w] = l; right[w] = r; w++;
        }

        double step = (double)_srcRate / Protocol.SampleRate;
        int maxOut = (int)((total - 1 - _pos) / step) + 2;
        var outBuf = new byte[Math.Max(maxOut, 4) * 4];
        int outLen = 0;
        while (_pos <= total - 1 - 1e-9)
        {
            int idx = (int)_pos;
            double frac = _pos - idx;
            int idx2 = Math.Min(idx + 1, total - 1);
            float l = (float)(left[idx] * (1 - frac) + left[idx2] * frac);
            float r = (float)(right[idx] * (1 - frac) + right[idx2] * frac);
            WriteSample(outBuf, ref outLen, l);
            WriteSample(outBuf, ref outLen, r);
            _pos += step;
        }
        _prevL = left[total - 1];
        _prevR = right[total - 1];
        _hasPrev = true;
        _pos -= total - 1;
        if (_pos < 0) _pos = 0;

        if (outLen > 0) _ring.Write(outBuf.AsSpan(0, outLen));
    }

    private static void WriteSample(byte[] buf, ref int len, float v)
    {
        if (len + 2 > buf.Length) return;
        int s = (int)(Math.Clamp(v, -1f, 1f) * 32767f);
        buf[len++] = (byte)s;
        buf[len++] = (byte)(s >> 8);
    }

    private void SendLoop()
    {
        int frameBytes = Protocol.FrameBytes(2);
        var frame = new byte[frameBytes];
        var packet = new byte[Protocol.HeaderSize + frameBytes];
        long lastReal = _clock.ElapsedMilliseconds;
        long lastSilence = 0;
        while (_running)
        {
            if (_ring.Read(frame, frameBytes))
            {
                SendFrame(frame, packet);
                lastReal = _clock.ElapsedMilliseconds;
                continue;
            }
            long now = _clock.ElapsedMilliseconds;
            if (now - lastReal > 100 && now - lastSilence >= Protocol.FrameMs)
            {
                // 재생 중인 소리가 없으면 무음으로 스트림 유지
                Array.Clear(frame);
                SendFrame(frame, packet);
                lastSilence = now;
            }
            Thread.Sleep(2);
        }
    }

    private void SendFrame(byte[] frame, byte[] packet)
    {
        int flags = _firstPacket ? Protocol.FlagFirst : 0;
        _firstPacket = false;
        int len = Protocol.BuildPacket(packet, frame, _seq++, Protocol.SampleRate, 2, flags, Clock.Us);
        try
        {
            if (_useTcp)
            {
                _tcpStream?.Write(packet, 0, len);
            }
            else
            {
                _udp!.Send(packet, len, _udpTarget!);
            }
        }
        catch
        {
            // 수신측 소멸 등 — 세션 종료 시 정리됨
        }
    }

    public void Dispose()
    {
        _running = false;
        try { _capture?.StopRecording(); } catch { }
        _capture?.Dispose();
        _udp?.Dispose();
        try { _tcpStream?.Dispose(); } catch { }
        try { _tcpListener?.Stop(); } catch { }
        Console.WriteLine("[송신] 중지");
    }
}
