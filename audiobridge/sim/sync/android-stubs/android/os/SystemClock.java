package android.os;

import java.util.function.LongSupplier;

/** 가상 시뮬용: 지금 코드를 실행 중인 가상 기기의 단조시계(ns)를 돌려준다. */
public final class SystemClock {
    public static LongSupplier current = () -> 0L;
    public static long elapsedRealtimeNanos() { return current.getAsLong(); }
}
