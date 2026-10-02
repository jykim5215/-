package android.net.wifi.p2p;

import java.util.ArrayList;
import java.util.Collection;

public class WifiP2pDeviceList {
    private final Collection<WifiP2pDevice> devices;
    public WifiP2pDeviceList(Collection<WifiP2pDevice> devices) { this.devices = new ArrayList<>(devices); }
    public Collection<WifiP2pDevice> getDeviceList() { return devices; }
}
