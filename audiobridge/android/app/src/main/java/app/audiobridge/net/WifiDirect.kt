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
import android.os.Handler
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
    private val onDiscovering: (Boolean) -> Unit,
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
    private val main = Handler(Looper.getMainLooper())

    // CONNECTION_CHANGED는 sticky 브로드캐스트라 onResume에서 재등록할 때마다 다시 온다.
    // 그룹이 새로 형성됐을 때(또는 그룹장이 바뀌었을 때)만 onConnected를 호출하도록 기억해 둔다.
    private var formedGroup: Pair<Boolean, String?>? = null
    private var connecting = false

    private val discoverTimeout = Runnable {
        onDiscovering(false)
    }
    private val connectTimeout = Runnable {
        // 상대가 초대를 거절하거나 응답이 없으면 일부 기기는 아무 브로드캐스트도 주지 않는다.
        connecting = false
        val ch = channel
        if (manager != null && ch != null) runCatching { manager.cancelConnect(ch, null) }
        onStatus(null)
        onError("상대 폰이 응답하지 않아요 — 상대 화면의 연결 요청을 수락했는지 확인해 주세요")
    }

    val available: Boolean get() = manager != null

    fun register() {
        val mgr = manager ?: run { onUnsupported(); return }
        if (registered) return
        // 채널은 한 번만 만든다(재개할 때마다 initialize하면 채널이 쌓인다). 프레임워크가 끊으면 다시 만든다.
        if (channel == null) {
            channel = mgr.initialize(context, Looper.getMainLooper()) { channel = null }
        }
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
        main.removeCallbacks(discoverTimeout)
        onDiscovering(false)
    }

    @SuppressLint("MissingPermission") // 권한은 UI에서 확인 후 discover 호출
    fun discover() {
        val mgr = manager ?: return
        val ch = channel ?: return
        onDiscovering(true)
        main.removeCallbacks(discoverTimeout)
        main.postDelayed(discoverTimeout, DISCOVER_TIMEOUT_MS)
        mgr.discoverPeers(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {}
            override fun onFailure(reason: Int) {
                main.removeCallbacks(discoverTimeout)
                onDiscovering(false)
                onError("주변 기기 검색을 시작할 수 없어요 (Wi-Fi·위치가 켜져 있는지 확인)")
            }
        })
    }

    @SuppressLint("MissingPermission")
    private fun requestPeers() {
        val mgr = manager ?: return
        val ch = channel ?: return
        mgr.requestPeers(ch) { list ->
            val peers = list.deviceList.map { dev -> displayName(dev) to dev.deviceAddress }
            onPeers(peers)
            // 검색 시작 직후 빈 목록 알림이 먼저 오기도 하므로, 실제로 찾았을 때만 검색 표시를 끈다.
            if (peers.isNotEmpty()) {
                main.removeCallbacks(discoverTimeout)
                onDiscovering(false)
            }
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
        connecting = true
        main.removeCallbacks(connectTimeout)
        main.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS)
        mgr.connect(ch, config, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {}
            override fun onFailure(reason: Int) {
                main.removeCallbacks(connectTimeout)
                connecting = false
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
                main.removeCallbacks(connectTimeout)
                connecting = false
                onStatus("connected")
                val group = info.isGroupOwner to info.groupOwnerAddress?.hostAddress
                if (group != formedGroup) {
                    formedGroup = group
                    onConnected(group.first, group.second)
                }
            } else {
                formedGroup = null
                // 연결 요청 중에 오는 '아직 그룹 없음' 알림은 무시(타임아웃이 정리한다)
                if (!connecting) onStatus(null)
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
        main.removeCallbacks(connectTimeout)
        connecting = false
        formedGroup = null
        onStatus(null)
    }

    private companion object {
        const val DISCOVER_TIMEOUT_MS = 20_000L
        const val CONNECT_TIMEOUT_MS = 45_000L
    }
}
