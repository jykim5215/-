using System.IO;
using System.Net;
using System.Net.Sockets;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge.Win;

/// <summary>
/// Receives phone audio and schedules every frame against the shared source clock.
/// WasapiOut.GetPosition is used as the hardware playout head, so different endpoint
/// buffer sizes do not turn into different audible start times.
/// </summary>
public sealed class ModeBPlayer : IDisposable
{
    private sealed record AudioFrame(long TimestampUs, byte[] Data);

    private readonly IPAddress _phone;
    private readonly bool _useTcp;
    private readonly int _delayMs;
    private readonly Func<long?> _offsetUsProvider;
    private readonly object _queueGate = new();
    private readonly object _outputGate = new();
    private readonly PriorityQueue<AudioFrame, long> _frames = new();

    public int Port { get; }

    private UdpClient? _udp;
    private TcpListener? _tcp;
    private volatile bool _running;
    private WasapiOut? _output;
    private BufferedWaveProvider? _provider;
    private WaveFormat? _format;
    private Thread? _playThread;
    private long _writtenBytes;
    private long _lastPlayedTimestampUs = -1;
    private long? _fallbackOffsetUs;
    private volatile float _gain = 1f;

    public void SetGain(int percent) => _gain = Math.Clamp(percent, 0, 100) / 100f;

    public ModeBPlayer(
        IPAddress phone,
        int port,
        bool useTcp,
        int delayMs,
        Func<long?> offsetUsProvider)
    {
        _phone = phone;
        Port = port;
        _useTcp = useTcp;
        _delayMs = Protocol.NormalizePlayoutDelayMs(delayMs);
        _offsetUsProvider = offsetUsProvider;
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
                throw new InvalidOperationException($"PC 포트 {Port}을(를) 이미 사용 중입니다.");
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
                throw new InvalidOperationException($"PC 포트 {Port}을(를) 이미 사용 중입니다.");
            }
            _running = true;
            new Thread(UdpLoop) { IsBackground = true, Name = "ab-b-rx" }.Start();
        }
        Console.WriteLine($"[수신] 휴대폰 오디오 대기 중 · {(_useTcp ? "TCP" : "UDP")} {Port} · 목표 지연 {_delayMs}ms");
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
            if (!ep.Address.Equals(_phone)) continue;
            var info = Protocol.ParseHeader(data);
            if (info == null || Protocol.HeaderSize + info.PayloadLen != data.Length) continue;
            Enqueue(info, data.AsSpan(Protocol.HeaderSize, info.PayloadLen));
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
                Enqueue(info, payload.AsSpan(0, info.PayloadLen));
            }
        }
        catch
        {
            if (_running) Console.WriteLine("[수신] 휴대폰 오디오 연결이 끊어졌습니다.");
        }
        finally
        {
            client?.Close();
        }
    }

    private static void ReadFully(NetworkStream stream, byte[] buffer, int length)
    {
        int offset = 0;
        while (offset < length)
        {
            int read = stream.Read(buffer, offset, length - offset);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
    }

    private void Enqueue(PacketInfo info, ReadOnlySpan<byte> payload)
    {
        if (!EnsureOutput(info)) return;
        if (_format!.SampleRate != info.SampleRate || _format.Channels != info.Channels) return;

        var data = payload.ToArray();
        ApplyGain(data, _gain);
        lock (_queueGate)
        {
            if ((info.Flags & Protocol.FlagFirst) != 0)
            {
                _frames.Clear();
                _lastPlayedTimestampUs = -1;
                _fallbackOffsetUs = null;
            }
            if (info.TimestampUs <= _lastPlayedTimestampUs) return;
            _frames.Enqueue(new AudioFrame(info.TimestampUs, data), info.TimestampUs);
            while (_frames.Count > 400) _frames.Dequeue();
            Monitor.PulseAll(_queueGate);
        }
    }

    private bool EnsureOutput(PacketInfo info)
    {
        if (_provider != null) return true;
        lock (_outputGate)
        {
            if (_provider != null) return true;
            try
            {
                _format = new WaveFormat(info.SampleRate, 16, info.Channels);
                _provider = new BufferedWaveProvider(_format)
                {
                    BufferDuration = TimeSpan.FromSeconds(2),
                    DiscardOnBufferOverflow = true,
                    ReadFully = true,
                };
                _output = new WasapiOut(AudioClientShareMode.Shared, true, 30);
                _output.Init(_provider);

                // Prime the endpoint before Play so the implicit ReadFully silence is
                // always represented in _writtenBytes and the hardware-head math stays exact.
                var silence = new byte[Protocol.FrameBytes(info.Channels)];
                for (int i = 0; i < 8; i++) WriteToDeviceQueue(silence);
                _output.Play();
                _playThread = new Thread(PlayLoop)
                {
                    IsBackground = true,
                    Name = "ab-b-play",
                    Priority = ThreadPriority.Highest,
                };
                _playThread.Start();
                Console.WriteLine($"[재생] 동기 재생 시작 · {info.SampleRate}Hz/{info.Channels}ch");
                return true;
            }
            catch (Exception e)
            {
                Console.WriteLine("[오류] PC 스피커 출력을 시작하지 못했습니다: " + e.Message);
                _running = false;
                return false;
            }
        }
    }

    private void PlayLoop()
    {
        var format = _format!;
        int frameBytes = Protocol.FrameBytes(format.Channels);
        long frameDurationUs = Protocol.FrameMs * 1_000L;
        var silence = new byte[frameBytes];

        while (_running)
        {
            AudioFrame? head;
            lock (_queueGate)
            {
                _frames.TryPeek(out head, out _);
                if (head == null) Monitor.Wait(_queueGate, 2);
            }

            if (head == null)
            {
                if (PendingDeviceUs(format) < 30_000) WriteToDeviceQueue(silence);
                else Thread.Sleep(1);
                continue;
            }

            long offset = _offsetUsProvider() ?? GetFallbackOffset(head.TimestampUs);
            long targetUs = head.TimestampUs + offset + _delayMs * 1_000L;
            long nextWritePlaysAtUs = Clock.Us + PendingDeviceUs(format);
            long leadUs = targetUs - nextWritePlaysAtUs;

            if (leadUs > frameDurationUs)
            {
                WriteToDeviceQueue(silence);
                continue;
            }
            if (leadUs < -20_000)
            {
                DequeueHead(head.TimestampUs);
                continue;
            }

            var frame = DequeueHead(head.TimestampUs);
            if (frame != null)
            {
                WriteToDeviceQueue(frame.Data);
                _lastPlayedTimestampUs = frame.TimestampUs;
            }
        }
    }

    private AudioFrame? DequeueHead(long expectedTimestamp)
    {
        lock (_queueGate)
        {
            if (!_frames.TryPeek(out var current, out _) || current.TimestampUs != expectedTimestamp)
                return null;
            return _frames.Dequeue();
        }
    }

    private long GetFallbackOffset(long sourceTimestampUs)
    {
        _fallbackOffsetUs ??= Clock.Us - sourceTimestampUs;
        return _fallbackOffsetUs.Value;
    }

    private long PendingDeviceUs(WaveFormat format)
    {
        var output = _output;
        if (output == null) return 0;
        long playedBytes = (long)output.GetPosition();
        long writtenBytes = Interlocked.Read(ref _writtenBytes);
        if (playedBytes > writtenBytes)
        {
            Interlocked.Exchange(ref _writtenBytes, playedBytes);
            writtenBytes = playedBytes;
        }
        long pendingBytes = Math.Max(0, writtenBytes - playedBytes);
        return pendingBytes * 1_000_000L / format.AverageBytesPerSecond;
    }

    private void WriteToDeviceQueue(byte[] data)
    {
        _provider!.AddSamples(data, 0, data.Length);
        Interlocked.Add(ref _writtenBytes, data.Length);
    }

    private static void ApplyGain(byte[] data, float gain)
    {
        if (gain >= 0.99f) return;
        float safeGain = Math.Clamp(gain, 0f, 1f);
        for (int i = 0; i + 1 < data.Length; i += 2)
        {
            short sample = (short)(data[i] | (data[i + 1] << 8));
            int value = Math.Clamp((int)(sample * safeGain), short.MinValue, short.MaxValue);
            data[i] = (byte)value;
            data[i + 1] = (byte)(value >> 8);
        }
    }

    public void Dispose()
    {
        _running = false;
        lock (_queueGate) Monitor.PulseAll(_queueGate);
        _udp?.Dispose();
        try { _tcp?.Stop(); } catch { }
        try { _output?.Stop(); } catch { }
        _output?.Dispose();
        Console.WriteLine("[수신] 재생을 중지했습니다.");
    }
}
