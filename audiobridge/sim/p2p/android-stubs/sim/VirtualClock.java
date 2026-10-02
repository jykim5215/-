package sim;

import java.util.ArrayList;
import java.util.List;

/** 가상 시계: Handler·프레임워크 콜백을 가상 시간 순서대로 실행한다(실제로 기다리지 않음). */
public final class VirtualClock {
    private static final class Task {
        final long at; final long seq; final Runnable r;
        Task(long at, long seq, Runnable r) { this.at = at; this.seq = seq; this.r = r; }
    }
    private static final List<Task> queue = new ArrayList<>();
    private static long now = 0, seq = 0;

    public static long now() { return now; }

    public static void reset() { queue.clear(); now = 0; seq = 0; }

    public static void schedule(long delayMs, Runnable r) {
        queue.add(new Task(now + Math.max(0, delayMs), seq++, r));
    }

    public static void cancel(Runnable r) { queue.removeIf(t -> t.r == r); }

    /** [ms]만큼 시간을 흘리며 그 사이 예약된 일을 순서대로 실행한다. */
    public static void advance(long ms) {
        long end = now + ms;
        while (true) {
            Task next = null;
            for (Task t : queue) {
                if (t.at > end) continue;
                if (next == null || t.at < next.at || (t.at == next.at && t.seq < next.seq)) next = t;
            }
            if (next == null) break;
            queue.remove(next);
            now = next.at;
            next.r.run();
        }
        now = end;
    }
}
