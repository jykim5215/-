package app.audiobridge.net

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pManager
import android.os.Looper

/**
 * Wi-Fi Direct(Wi-Fi P2P) 연결 헬퍼 — 공유기 없이 폰끼리 직접 연결한다.
 *
 * 역할은 네트워크 계층 확보뿐이다: 그룹이 형성되면 그룹장(GO)은 192.168.49.1로 서버가 되고,
 * 상대는 그 IP의 기존 컨트롤/오디오 소켓에 붙는다 → 오디오·동기·다대일 로직은 그대로 재사용.
 *
 * 리시버는 액티비티 생명주기에 맞춰 [register]/[unregister]로 켜고 끈다.
 * (P2P 브로드캐스트는 동적 등록만 허용)
 */
class WifiDirect(
    private val context: Context,
    private val onPeers: (List<Pair<String, String>>) -> Unit,   // (표시이름, MAC주소)
    private val onStatus: (String?) -> Unit,                      // null / "connecting" / "connected"
    private val onConnected: (isGroupOwner: Boolean, groupOwnerHost: String?) -> Unit,
    private val onUnsupported: () -> Unit,
    private val onError: (String) -> Unit,
) {
    private val manager: WifiP2pManager? =
        context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
    private var channel: WifiP2pManager.Channel? = null
    private var receiver: BroadcastReceiver? = null
    private var registered = false

    val available: Boolean get() = manager != null

    fun register() {
        val mgr = manager ?: run { onUnsupported(); return }
        if (registered) return
        channel = mgr.initialize(context, Looper.getMainLooper(), null)
        val filter = IntentFilter().apply {
            addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        }
        receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                when (intent.action) {
                    // STATE_CHANGED는 참고용 — Wi-Fi가 잠깐 꺼져도 기능 자체를 숨기지 않는다.
                    WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> requestPeers()
                    WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> handleConnectionChanged()
                }
            }
        }
        // P2P 브로드캐스트는 시스템 보호 브로드캐스트 — NOT_EXPORTED로 등록(API 34+ 안전)
        ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        registered = true
    }

    fun unregister() {
        if (!registered) return
        runCatching { receiver?.let { context.unregisterReceiver(it) } }
        receiver = null
        registered = false
    }

    @SuppressLint("MissingPermission") // 권한은 UI에서 확인 후 discover 호출
    fun discover() {
        val mgr = manager ?: return
        val ch = channel ?: return
        onStatus(null)
        mgr.discoverPeers(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {}
            override fun onFailure(reason: Int) {
                onError("주변 기기 검색을 시작할 수 없어요 (Wi-Fi가 켜져 있는지 확인)")
            }
        })
    }

    @SuppressLint("MissingPermission")
    private fun requestPeers() {
        val mgr = manager ?: return
        val ch = channel ?: return
        mgr.requestPeers(ch) { list ->
            onPeers(list.deviceList.map { dev -> displayName(dev) to dev.deviceAddress })
        }
    }

    private fun displayName(dev: WifiP2pDevice): String =
        dev.deviceName?.takeIf { it.isNotBlank() } ?: dev.deviceAddress

    @SuppressLint("MissingPermission")
    fun connect(deviceAddress: String) {
        val mgr = manager ?: return
        val ch = channel ?: return
        val config = WifiP2pConfig().apply { this.deviceAddress = deviceAddress }
        onStatus("connecting")
        mgr.connect(ch, config, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {}
            override fun onFailure(reason: Int) {
                onStatus(null)
                onError("Wi-Fi Direct 연결에 실패했어요")
            }
        })
    }

    private fun handleConnectionChanged() {
        val mgr = manager ?: return
        val ch = channel ?: return
        mgr.requestConnectionInfo(ch) { info ->
            if (info.groupFormed) {
                onStatus("connected")
                onConnected(info.isGroupOwner, info.groupOwnerAddress?.hostAddress)
            } else {
                onStatus(null)
            }
        }
    }

    fun disconnect() {
        val mgr = manager ?: return
        val ch = channel ?: return
        runCatching {
            mgr.removeGroup(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {}
                override fun onFailure(reason: Int) {}
            })
        }
        onStatus(null)
    }
}
