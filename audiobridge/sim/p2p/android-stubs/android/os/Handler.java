package android.os;

import sim.VirtualClock;

/** 가상 시계 위에서 동작하는 Handler. */
public class Handler {
    public Handler(Looper looper) {}
    public final boolean post(Runnable r) { VirtualClock.schedule(0, r); return true; }
    public final boolean postDelayed(Runnable r, long delayMillis) { VirtualClock.schedule(delayMillis, r); return true; }
    public final void removeCallbacks(Runnable r) { VirtualClock.cancel(r); }
}
