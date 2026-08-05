using NAudio.Wave;

namespace AudioBridge.Win;

/// <summary>
/// Android가 낸 1.8kHz 시험음을 기본 마이크로 감지하고, 고정 대기 후 기본 스피커로
/// 3kHz 응답음을 내보낸다. UI에는 엔진 세부 정보를 노출하지 않는다.
/// </summary>
internal sealed class AcousticCalibrationResponder : IDisposable
{
    private const int SampleRate = 48_000;
    private const double RequestFrequencyHz = 1_800.0;
    private const double ResponseFrequencyHz = 3_000.0;
    private const int ToneDurationMs = 140;
    private const double MinRms = 280.0;
    private const double MinToneRatio = 0.10;

    private readonly string _id;
    private readonly int _holdMs;
    private readonly Action<object> _send;
    private readonly object _gate = new();
    private WaveInEvent? _input;
    private System.Threading.Timer? _timeout;
    private bool _disposed;
    private bool _detected;
    private int _consecutiveBlocks;

    public AcousticCalibrationResponder(string id, int holdMs, Action<object> send)
    {
        _id = id;
        _holdMs = Math.Clamp(holdMs, 200, 1_000);
        _send = send;
    }

    public void Start()
    {
        try
        {
            var input = new WaveInEvent
            {
                DeviceNumber = 0,
                WaveFormat = new WaveFormat(SampleRate, 16, 1),
                BufferMilliseconds = 20,
                NumberOfBuffers = 4,
            };
            input.DataAvailable += OnDataAvailable;
            input.RecordingStopped += OnRecordingStopped;
            _input = input;
            input.StartRecording();
            _timeout = new System.Threading.Timer(_ => OnTimeout(), null, 10_000, Timeout.Infinite);
            _send(new { type = "cal", action = "ready", id = _id });
        }
        catch (Exception e)
        {
            Dispose();
            _send(new
            {
                type = "cal",
                action = "error",
                id = _id,
                message = $"Windows 마이크를 열 수 없어요: {e.Message}",
            });
        }
    }

    private void OnTimeout()
    {
        lock (_gate)
        {
            if (_disposed || _detected) return;
        }
        _send(new
        {
            type = "cal",
            action = "error",
            id = _id,
            message = "시험음을 듣지 못했어요. 두 기기의 볼륨과 거리를 확인해 주세요.",
        });
        Dispose();
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (_disposed || _detected || e.BytesRecorded < 2) return;
        int sampleCount = e.BytesRecorded / 2;
        if (ContainsTone(e.Buffer, sampleCount, RequestFrequencyHz))
        {
            _consecutiveBlocks++;
            if (_consecutiveBlocks >= 2) BeginReply();
        }
        else
        {
            _consecutiveBlocks = 0;
        }
    }

    private void BeginReply()
    {
        lock (_gate)
        {
            if (_disposed || _detected) return;
            _detected = true;
        }

        try { _input?.StopRecording(); } catch { }
        _ = Task.Run(() =>
        {
            try
            {
                Thread.Sleep(_holdMs);
                if (_disposed) return;
                PlayTone(ResponseFrequencyHz);
                if (!_disposed) _send(new { type = "cal", action = "complete", id = _id });
            }
            catch (Exception e)
            {
                if (!_disposed)
                {
                    _send(new
                    {
                        type = "cal",
                        action = "error",
                        id = _id,
                        message = $"Windows 시험음을 재생할 수 없어요: {e.Message}",
                    });
                }
            }
            finally
            {
                Dispose();
            }
        });
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null && !_detected && !_disposed)
        {
            _send(new
            {
                type = "cal",
                action = "error",
                id = _id,
                message = $"Windows 마이크가 중지됐어요: {e.Exception.Message}",
            });
            Dispose();
        }
    }

    private static bool ContainsTone(byte[] buffer, int sampleCount, double frequencyHz)
    {
        double coefficient = 2.0 * Math.Cos(2.0 * Math.PI * frequencyHz / SampleRate);
        double q1 = 0;
        double q2 = 0;
        double totalEnergy = 0;
        for (int i = 0; i < sampleCount; i++)
        {
            double value = BitConverter.ToInt16(buffer, i * 2);
            double q0 = coefficient * q1 - q2 + value;
            q2 = q1;
            q1 = q0;
            totalEnergy += value * value;
        }

        if (totalEnergy <= 0 || Math.Sqrt(totalEnergy / sampleCount) < MinRms) return false;
        double tonePower = q1 * q1 + q2 * q2 - coefficient * q1 * q2;
        return tonePower / (totalEnergy * sampleCount) >= MinToneRatio;
    }

    private static void PlayTone(double frequencyHz)
    {
        int sampleCount = SampleRate * ToneDurationMs / 1_000;
        byte[] pcm = new byte[sampleCount * 2];
        int fadeSamples = SampleRate / 100;
        for (int i = 0; i < sampleCount; i++)
        {
            double edge = Math.Min(1.0, Math.Min((double)i / fadeSamples, (double)(sampleCount - 1 - i) / fadeSamples));
            short sample = (short)(Math.Sin(2.0 * Math.PI * frequencyHz * i / SampleRate) * 0.42 * short.MaxValue * edge);
            pcm[i * 2] = (byte)sample;
            pcm[i * 2 + 1] = (byte)(sample >> 8);
        }

        var provider = new BufferedWaveProvider(new WaveFormat(SampleRate, 16, 1))
        {
            DiscardOnBufferOverflow = true,
            ReadFully = false,
        };
        provider.AddSamples(pcm, 0, pcm.Length);
        using var output = new WaveOutEvent { DesiredLatency = 80 };
        output.Init(provider);
        output.Play();
        Thread.Sleep(ToneDurationMs + 100);
        output.Stop();
    }

    public void Dispose()
    {
        WaveInEvent? input;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            input = _input;
            _input = null;
        }
        if (input != null)
        {
            try { input.StopRecording(); } catch { }
            input.DataAvailable -= OnDataAvailable;
            input.RecordingStopped -= OnRecordingStopped;
            input.Dispose();
        }
        _timeout?.Dispose();
        _timeout = null;
    }
}
