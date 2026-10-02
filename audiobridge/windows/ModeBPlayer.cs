using System.IO;
using System.Net;
using System.Net.Sockets;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge.Win;

/// <summary>
/// Receives phone audio and schedules every sample against the shared source clock.
/// WasapiOut.GetPosition is used as the hardware playout head, so different endpoint
/// buffer sizes do not turn into different audible start times; PlayoutScheduler aligns
/// to the sample and follows the clock-rate difference by dropping/repeating single samples.
/// </summary>
public sealed class ModeBPlayer : IDisposable
{
    private sealed record AudioFrame(long TimestampUs, byte[] Data);

    private readonly IPAddress _phone;
    private readonly bool _useTcp;
    private volatile int _delayMs;
    private readonly DelayAdvisor _advisor = new();
    /** 스피커 소리 맞추기 시험음을 낼 소스 시각들 (µs) */
    private readonly System.Collections.Concurrent.ConcurrentQueue<long> _syncTones = new();
    /** WASAPI 공유 모드 버퍼(30ms) + 믹서 주기 — 프레임이 목표 시각보다 이만큼 먼저 와 있어야 한다 */
    private const long OutputLatencyUs = 40_000;
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

    /** 소스가 자동으로 정한 공통 지연 ("delay" 메시지) */
    public void SetDelayMs(int ms) => _delayMs = Protocol.NormalizePlayoutDelayMs(ms);

    /** 끊김 없이 쓸 수 있는 최소 공통 지연(ms) — 소스에 "need"로 보고한다 */
    public int? NeedMs() => _advisor.NeedMs(Clock.Us);

    /** 소스 시각 atSourceUs부터 50ms를 시험음으로 낸다 (스피커 소리 맞추기) */
    public void ScheduleSyncTone(long atSourceUs) => _syncTones.Enqueue(atSourceUs);

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

        if (_offsetUsProvider() is long offset)
        {
            long now = Clock.Us;
            _advisor.OnArrival(now, now - (info.TimestampUs + offset));
        }
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
        int bytesPerSampleFrame = 2 * format.Channels;
        int frameBytes = Protocol.FrameBytes(format.Channels);
        int frameSamples = frameBytes / bytesPerSampleFrame;
        var silence = new byte[frameBytes];
        // 한 프레임 + 반복 샘플(최대 2개)을 담을 작업 버퍼
        var chunk = new byte[frameBytes + 2 * bytesPerSampleFrame];
        var scheduler = new PlayoutScheduler(format.SampleRate, frameSamples);
        int cursor = 0; // 머리 프레임에서 이미 쓰거나 건너뛴 샘플 수

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
                // 출력 대기열이 바닥나기 직전에만 무음으로 채운다 (실제로 끊긴 것 → 다음 데이터에서 다시 맞춤)
                if (PendingDeviceUs(format) < 30_000)
                {
                    var gap = scheduler.Decide(null, 0);
                    WriteToDeviceQueue(silence, gap.Samples * bytesPerSampleFrame);
                }
                else Thread.Sleep(1);
                continue;
            }

            long offset = _offsetUsProvider() ?? GetFallbackOffset(head.TimestampUs);
            // 머리 프레임에서 다음에 쓸 샘플의 목표 재생 시각 vs 지금 쓰면 실제로 나올 시각
            long targetUs = head.TimestampUs + offset + _delayMs * 1_000L + Config.CalibrationUs +
                cursor * 1_000_000L / format.SampleRate;
            long nextWritePlaysAtUs = Clock.Us + PendingDeviceUs(format);
            _advisor.OnOutputDepth(Clock.Us, OutputLatencyUs);
            int headSamples = head.Data.Length / bytesPerSampleFrame;
            var decision = scheduler.Decide(nextWritePlaysAtUs - targetUs, headSamples - cursor);

            switch (decision.Kind)
            {
                case PlayoutScheduler.Kind.Silence:
                    // 아직 이르다 — 정확히 모자란 만큼만 무음
                    WriteToDeviceQueue(silence, decision.Samples * bytesPerSampleFrame);
                    break;

                case PlayoutScheduler.Kind.Skip:
                    // 늦었다 — 정확히 늦은 만큼만 건너뛴다
                    cursor += decision.Samples;
                    if (cursor >= headSamples)
                    {
                        DequeueHead(head.TimestampUs);
                        cursor = 0;
                    }
                    break;

                case PlayoutScheduler.Kind.Play:
                    var frame = DequeueHead(head.TimestampUs);
                    int from = cursor * bytesPerSampleFrame;
                    cursor = 0;
                    if (frame == null) break;
                    // Adjust<0: 끝 샘플을 빼서 따라잡기, >0: 마지막 샘플을 반복해 기다리기 (클럭 속도 차 보정)
                    int body = Math.Max(0, frame.Data.Length - from + Math.Min(0, decision.Adjust) * bytesPerSampleFrame);
                    Buffer.BlockCopy(frame.Data, from, chunk, 0, body);
                    int length = body;
                    for (int i = 0; i < decision.Adjust && length >= bytesPerSampleFrame; i++)
                    {
                        Buffer.BlockCopy(chunk, length - bytesPerSampleFrame, chunk, length, bytesPerSampleFrame);
                        length += bytesPerSampleFrame;
                    }
                    if (!_syncTones.IsEmpty)
                        InjectSyncTones(chunk, length, frame.TimestampUs + from / bytesPerSampleFrame * 1_000_000L / format.SampleRate, format);
                    WriteToDeviceQueue(chunk, length);
                    _lastPlayedTimestampUs = frame.TimestampUs;
                    break;
            }
        }
    }

    /** chunk 첫 샘플이 소스 시각 chunkSrcUs일 때, 예약된 시험음 구간의 샘플을 시험음으로 바꾼다 (볼륨과 무관한 고정 크기). */
    private void InjectSyncTones(byte[] chunk, int length, long chunkSrcUs, WaveFormat format)
    {
        while (_syncTones.TryPeek(out long first) && first + SyncChirp.DurationUs < chunkSrcUs) _syncTones.TryDequeue(out _);
        int bytesPerSampleFrame = 2 * format.Channels;
        int samples = length / bytesPerSampleFrame;
        double usPerSample = 1_000_000d / format.SampleRate;
        foreach (long at in _syncTones)
        {
            if (at > chunkSrcUs + samples * usPerSample) continue;
            for (int j = 0; j < samples; j++)
            {
                double t = chunkSrcUs + j * usPerSample - at;
                if (t < 0 || t >= SyncChirp.DurationUs) continue;
                short v = (short)(SyncChirp.Value(t) * 32767);
                for (int c = 0; c < format.Channels; c++)
                {
                    int i = j * bytesPerSampleFrame + c * 2;
                    chunk[i] = (byte)v;
                    chunk[i + 1] = (byte)(v >> 8);
                }
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

    private void WriteToDeviceQueue(byte[] data) => WriteToDeviceQueue(data, data.Length);

    private void WriteToDeviceQueue(byte[] data, int length)
    {
        if (length <= 0) return;
        _provider!.AddSamples(data, 0, length);
        Interlocked.Add(ref _writtenBytes, length);
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
