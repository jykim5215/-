namespace AudioBridge.Win;

/// <summary>
/// Continuously maps the source device monotonic clock to this PC's monotonic clock.
/// Low-RTT samples establish the offset; a bounded drift estimate prevents speakers
/// from slowly separating during long playback sessions.
/// </summary>
public sealed class ClockSync
{
    private readonly object _gate = new();
    private long _bestRttUs = long.MaxValue;
    private long _anchorLocalUs;
    private double _anchorOffsetUs;
    private double _driftPpm;
    private bool _ready;
    private long _lastSampleLocalUs;
    private double _lastSampleOffsetUs;

    public long? OffsetUs
    {
        get
        {
            lock (_gate)
            {
                if (!_ready) return null;
                long now = Clock.Us;
                double predicted = _anchorOffsetUs +
                    (now - _anchorLocalUs) * _driftPpm / 1_000_000d;
                return (long)Math.Round(predicted);
            }
        }
    }

    public void AgeBestSample()
    {
        lock (_gate)
        {
            if (_bestRttUs != long.MaxValue)
                _bestRttUs = Math.Min(_bestRttUs + 2_000, 200_000);
        }
    }

    public void OnReply(long t0, long sourceT1)
    {
        long t2 = Clock.Us;
        long rtt = t2 - t0;
        if (rtt < 0 || rtt > 2_000_000) return;
        double measuredOffset = (t0 + t2) / 2d - sourceT1;

        lock (_gate)
        {
            if (_bestRttUs != long.MaxValue && rtt > _bestRttUs + 5_000) return;
            _bestRttUs = Math.Min(_bestRttUs, rtt);

            if (!_ready)
            {
                _anchorLocalUs = t2;
                _anchorOffsetUs = measuredOffset;
                _lastSampleLocalUs = t2;
                _lastSampleOffsetUs = measuredOffset;
                _ready = true;
                return;
            }

            double predicted = _anchorOffsetUs +
                (t2 - _anchorLocalUs) * _driftPpm / 1_000_000d;
            double residual = measuredOffset - predicted;

            // Resume/sleep can move the relationship abruptly. Re-lock instead of
            // spending minutes slewing toward a stale offset.
            if (Math.Abs(residual) > 200_000)
            {
                _anchorLocalUs = t2;
                _anchorOffsetUs = measuredOffset;
                _driftPpm = 0;
                _lastSampleLocalUs = t2;
                _lastSampleOffsetUs = measuredOffset;
            }
            else
            {
                long sampleSpan = t2 - _lastSampleLocalUs;
                if (sampleSpan >= 5_000_000)
                {
                    double measuredPpm = (measuredOffset - _lastSampleOffsetUs) *
                        1_000_000d / sampleSpan;
                    measuredPpm = Math.Clamp(measuredPpm, -250d, 250d);
                    _driftPpm = _driftPpm * 0.9d + measuredPpm * 0.1d;
                    _lastSampleLocalUs = t2;
                    _lastSampleOffsetUs = measuredOffset;
                }
                _anchorLocalUs = t2;
                _anchorOffsetUs = predicted + residual * 0.2d;
            }
        }
    }

    public void Reset()
    {
        lock (_gate)
        {
            _bestRttUs = long.MaxValue;
            _anchorLocalUs = 0;
            _anchorOffsetUs = 0;
            _driftPpm = 0;
            _ready = false;
            _lastSampleLocalUs = 0;
            _lastSampleOffsetUs = 0;
        }
    }
}
