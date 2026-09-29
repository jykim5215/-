package android.net.wifi.p2p;

import android.content.Context;
import android.os.Looper;

/** 실제 API 모양 그대로, 동작은 가상 세계(Backend)가 결정한다. */
public class WifiP2pManager {
    public static final String WIFI_P2P_STATE_CHANGED_ACTION = "android.net.wifi.p2p.STATE_CHANGED";
    public static final String WIFI_P2P_PEERS_CHANGED_ACTION = "android.net.wifi.p2p.PEERS_CHANGED";
    public static final String WIFI_P2P_CONNECTION_CHANGED_ACTION = "android.net.wifi.p2p.CONNECTION_STATE_CHANGE";
    public static final int ERROR = 0, P2P_UNSUPPORTED = 1, BUSY = 2;

    public interface ActionListener { void onSuccess(); void onFailure(int reason); }
    public interface ChannelListener { void onChannelDisconnected(); }
    public interface PeerListListener { void onPeersAvailable(WifiP2pDeviceList peers); }
    public interface ConnectionInfoListener { void onConnectionInfoAvailable(WifiP2pInfo info); }

    public static class Channel {
        public final ChannelListener listener;
        public Channel(ChannelListener listener) { this.listener = listener; }
    }

    public interface Backend {
        Channel initialize(ChannelListener listener);
        void discoverPeers(Channel c, ActionListener l);
        void requestPeers(Channel c, PeerListListener l);
        void connect(Channel c, WifiP2pConfig config, ActionListener l);
        void cancelConnect(Channel c, ActionListener l);
        void requestConnectionInfo(Channel c, ConnectionInfoListener l);
        void removeGroup(Channel c, ActionListener l);
    }

    private final Backend backend;
    public WifiP2pManager(Backend backend) { this.backend = backend; }

    public Channel initialize(Context ctx, Looper looper, ChannelListener listener) { return backend.initialize(listener); }
    public void discoverPeers(Channel c, ActionListener l) { backend.discoverPeers(c, l); }
    public void requestPeers(Channel c, PeerListListener l) { backend.requestPeers(c, l); }
    public void connect(Channel c, WifiP2pConfig config, ActionListener l) { backend.connect(c, config, l); }
    public void cancelConnect(Channel c, ActionListener l) { backend.cancelConnect(c, l); }
    public void requestConnectionInfo(Channel c, ConnectionInfoListener l) { backend.requestConnectionInfo(c, l); }
    public void removeGroup(Channel c, ActionListener l) { backend.removeGroup(c, l); }
}
