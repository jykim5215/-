package android.content;

public abstract class Context {
    public static final String WIFI_P2P_SERVICE = "wifip2p";
    public abstract Object getSystemService(String name);
    public abstract Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter, int flags);
    public abstract void unregisterReceiver(BroadcastReceiver receiver);
}
