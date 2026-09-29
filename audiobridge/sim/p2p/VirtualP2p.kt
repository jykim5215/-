package sim.p2p

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pDeviceList
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.net.wifi.p2p.WifiP2pManager.Channel
import sim.VirtualClock
import java.net.InetAddress
import kotlin.system.exitProcess

/*
 * AudioBridge Wi-Fi Direct 가상 시뮬레이터.
 *
 * 실제 앱 소스(android/.../net/WifiDirect.kt)를 그대로 컴파일해, 가상 Android 프레임워크 위의
 * 가상 폰 두 대에서 돌린다. 비교를 위해 수정 전 v2.8 원본(baseline/WifiDirectV28.kt)도 같은 조건으로 돌린다.
 *
 * 가상 프레임워크가 재현하는 실제 Android 동작:
 *  - WIFI_P2P_CONNECTION_CHANGED / STATE_CHANGED는 sticky → 리시버를 등록할 때마다 마지막 값이 다시 온다.
 *  - 리시버가 등록돼 있지 않을 때 온 일반 브로드캐스트는 사라진다.
 *  - 연결 요청 직후 '아직 그룹 없음(groupFormed=false)' 알림이 먼저 온다.
 *  - 상대가 초대를 거절하거나 무시하면 아무 알림도 오지 않는 기기가 있다.
 *  - discoverPeers가 BUSY 등으로 실패할 수 있고, 주변 기기가 없으면 PEERS_CHANGED가 안 올 수 있다.
 *  - 검색 시작 직후 빈 목록 PEERS_CHANGED가 먼저 오는 기기가 있다.
 *  - 프레임워크가 채널을 끊을 수 있다(onChannelDisconnected).
 * 모든 콜백은 가상 시계(sim.VirtualClock) 위에서 비동기로 전달된다.
 *
 * BridgeEngine은 오디오·소켓 의존성이 커서 통째로 올리지 않고, Wi-Fi Direct 진입점
 * (onWifiDirectConnected → connect → addLink)만 원본과 같은 순서로 옮긴 EngineModel을 쓴다.
 */

// ───────────────────────── 가상 세계 ─────────────────────────

enum class Invite { ACCEPT, IGNORE }
enum class PeersBroadcast { NORMAL, EARLY_EMPTY, NONE }

class World {
    val phones = linkedMapOf<String, VirtualPhone>()
    fun add(p: VirtualPhone) { phones[p.mac] = p }

    fun formGroup(go: VirtualPhone, client: VirtualPhone) {
        go.group = Group(isGo = true, peer = client)
        client.group = Group(isGo = false, peer = go)
        go.broadcast(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        client.broadcast(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
    }

    fun dissolve(p: VirtualPhone) {
        val peer = p.group?.peer ?: return
        for (x in listOf(p, peer)) {
            // 그룹이 사라지면 비그룹장의 소켓 링크도 끊긴다(엔진의 onLinkDropped)
            if (x.group?.isGo == false) x.engine.onLinkDropped(GO_ADDR)
            x.group = null
            x.broadcast(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        }
    }

    companion object { const val GO_ADDR = "192.168.49.1" }
}

class Group(val isGo: Boolean, val peer: VirtualPhone)

class VirtualPhone(val world: World, val name: String, val mac: String, val version: Version) : Context() {
    // 가상 프레임워크 상태
    var group: Group? = null
    var invite = Invite.ACCEPT
    var acceptDelayMs = 3_000L
    var discoverFail: Int? = null
    var peersMode = PeersBroadcast.NORMAL
    var peersFound = false
    var channelsCreated = 0
    var cancelConnectCalls = 0
    private var lastChannel: Channel? = null
    private val receivers = mutableListOf<Pair<BroadcastReceiver, IntentFilter>>()
    private val sticky = mutableSetOf<String>()

    // 앱 쪽 관찰값 (BridgeState에 해당)
    var p2pStatus: String? = null
    var discovering = false
    var peers: List<Pair<String, String>> = emptyList()
    val errors = mutableListOf<String>()
    val engine = EngineModel(dedupe = version == Version.CURRENT)

    private val manager = WifiP2pManager(Backend())
    val app: WifiDirectDriver = WifiDirectDriver.create(version, this)

    override fun getSystemService(name: String): Any? = if (name == WIFI_P2P_SERVICE) manager else null

    override fun registerReceiver(receiver: BroadcastReceiver, filter: IntentFilter, flags: Int): Intent? {
        receivers += receiver to filter
        for (action in filter.actions()) if (action in sticky) deliver(receiver, action)
        return null
    }

    override fun unregisterReceiver(receiver: BroadcastReceiver) {
        require(receivers.removeIf { it.first === receiver }) { "등록되지 않은 리시버 해제" }
    }

    fun broadcast(action: String) {
        if (action == WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION ||
            action == WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION) sticky += action
        for ((r, f) in receivers.toList()) if (f.hasAction(action)) deliver(r, action)
    }

    private fun deliver(r: BroadcastReceiver, action: String) = VirtualClock.schedule(0) {
        if (receivers.any { it.first === r }) r.onReceive(this, Intent(action))
    }

    fun killChannel() { lastChannel?.listener?.onChannelDisconnected() }

    // 생명주기 (MainActivity.onResume/onPause)
    fun resume() = app.register()
    fun pause() = app.unregister()

    private fun visiblePeers() = world.phones.values.filter { it !== this }.map { WifiP2pDevice(it.name, it.mac) }

    private inner class Backend : WifiP2pManager.Backend {
        override fun initialize(listener: WifiP2pManager.ChannelListener?): Channel {
            channelsCreated++
            return Channel(listener).also { lastChannel = it }
        }

        override fun discoverPeers(c: Channel, l: WifiP2pManager.ActionListener) = VirtualClock.schedule(50) {
            val fail = discoverFail
            if (fail != null) { l.onFailure(fail); return@schedule }
            l.onSuccess()
            if (peersMode == PeersBroadcast.EARLY_EMPTY)
                VirtualClock.schedule(250) { broadcast(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION) }
            if (peersMode != PeersBroadcast.NONE && visiblePeers().isNotEmpty())
                VirtualClock.schedule(1_450) { peersFound = true; broadcast(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION) }
        }

        override fun requestPeers(c: Channel, l: WifiP2pManager.PeerListListener) = VirtualClock.schedule(10) {
            l.onPeersAvailable(WifiP2pDeviceList(if (peersFound) visiblePeers() else emptyList()))
        }

        override fun connect(c: Channel, config: WifiP2pConfig, l: WifiP2pManager.ActionListener) {
            val me = this@VirtualPhone
            val target = world.phones[config.deviceAddress]
            VirtualClock.schedule(50) {
                if (target == null) { l.onFailure(WifiP2pManager.ERROR); return@schedule }
                l.onSuccess()
                VirtualClock.schedule(150) { broadcast(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION) } // 아직 그룹 없음
                if (target.invite == Invite.ACCEPT)
                    VirtualClock.schedule(target.acceptDelayMs) { if (me.group == null) world.formGroup(go = target, client = me) }
            }
        }

        override fun cancelConnect(c: Channel, l: WifiP2pManager.ActionListener?) {
            cancelConnectCalls++
            VirtualClock.schedule(10) { l?.onSuccess() }
        }

        override fun requestConnectionInfo(c: Channel, l: WifiP2pManager.ConnectionInfoListener) = VirtualClock.schedule(10) {
            val g = group
            l.onConnectionInfoAvailable(WifiP2pInfo().apply {
                groupFormed = g != null
                isGroupOwner = g?.isGo == true
                groupOwnerAddress = if (g != null) InetAddress.getByName(World.GO_ADDR) else null
            })
        }

        override fun removeGroup(c: Channel, l: WifiP2pManager.ActionListener?) = VirtualClock.schedule(20) {
            world.dissolve(this@VirtualPhone); l?.onSuccess()
        }
    }
}

/** BridgeEngine의 Wi-Fi Direct 진입점을 원본과 같은 순서로 옮긴 모델 (main.post → 조건 → connect → addLink). */
class EngineModel(private val dedupe: Boolean) {
    val links = mutableListOf<String>()
    val notices = mutableListOf<String>()
    var connectCalls = 0

    fun onWifiDirectConnected(isGroupOwner: Boolean, groupOwnerHost: String?) = VirtualClock.schedule(0) {
        if (isGroupOwner) {
            notices += "Wi-Fi Direct 준비됨 — 상대 기기가 연결하면 시작돼요"
        } else {
            val host = groupOwnerHost ?: run { notices += "상대 주소를 확인할 수 없어요"; return@schedule }
            if (dedupe && links.any { it == host }) return@schedule   // v2.8.1에서 추가된 검사
            connect(host)
        }
    }

    private fun connect(host: String) { connectCalls++; links += host }   // connect() → addLink()
    fun onLinkDropped(host: String) { links.removeAll { it == host } }
}

// ───────────────────────── 버전별 어댑터 (MainActivity 배선 재현) ─────────────────────────

enum class Version(val label: String) { V28("v2.8"), CURRENT("v2.8.1") }

interface WifiDirectDriver {
    fun register(); fun unregister(); fun discover(); fun connect(addr: String); fun disconnect()

    companion object {
        fun create(v: Version, p: VirtualPhone): WifiDirectDriver = when (v) {
            Version.CURRENT -> {
                val wd = app.audiobridge.net.WifiDirect(
                    context = p,
                    onPeers = { p.peers = it },
                    onDiscovering = { p.discovering = it },
                    onStatus = { p.p2pStatus = it },
                    onConnected = { go, host -> p.engine.onWifiDirectConnected(go, host) },
                    onUnsupported = { p.errors += "unsupported" },
                    onError = { p.errors += it },
                )
                object : WifiDirectDriver {
                    override fun register() = wd.register()
                    override fun unregister() = wd.unregister()
                    override fun discover() = wd.discover()
                    override fun connect(addr: String) = wd.connect(addr)
                    override fun disconnect() = wd.disconnect()
                }
            }
            Version.V28 -> {
                val wd = app.audiobridge.net.v28.WifiDirect(
                    context = p,
                    onPeers = { p.peers = it; p.discovering = false },
                    onStatus = { p.p2pStatus = it },
                    onConnected = { go, host -> p.engine.onWifiDirectConnected(go, host) },
                    onUnsupported = { p.errors += "unsupported" },
                    onError = { p.errors += it },
                )
                object : WifiDirectDriver {
                    override fun register() = wd.register()
                    override fun unregister() = wd.unregister()
                    override fun discover() { p.discovering = true; wd.discover() }
                    override fun connect(addr: String) = wd.connect(addr)
                    override fun disconnect() = wd.disconnect()
                }
            }
        }
    }
}

// ───────────────────────── 시나리오 ─────────────────────────

class Rig(v: Version) {
    val world = World()
    val a = VirtualPhone(world, "Galaxy A", "02:00:00:00:00:0a", v).also { world.add(it) }
    val b = VirtualPhone(world, "Pixel B", "02:00:00:00:00:0b", v).also { world.add(it) }
    init { VirtualClock.reset(); a.resume(); b.resume(); run(100) }
    fun run(ms: Long) = VirtualClock.advance(ms)
    /** A가 검색 → B를 찾아 연결 요청 → B가 수락해 그룹 형성(B가 그룹장). */
    fun pair() { a.app.discover(); run(2_000); a.app.connect(b.mac); run(5_000) }
}

/** @property expect 수정본(v2.8.1)이 만족해야 하는 조건 */
class Scenario(val title: String, val measure: String, val body: (Rig) -> Any?, val expect: (Any?) -> Boolean)

val scenarios = listOf(
    Scenario("기본 연결: 검색→초대 수락→소켓 연결", "A의 링크 / B 안내 수",
        { r -> r.pair(); "${r.a.engine.links.size} / ${r.b.engine.notices.size}" }, { it == "1 / 1" }),
    Scenario("연결 후 A가 앱 전환 5회(onPause→onResume)", "A의 링크 수",
        { r -> r.pair(); repeat(5) { r.a.pause(); r.run(1_000); r.a.resume(); r.run(1_000) }; r.a.engine.links.size }, { it == 1 }),
    Scenario("연결 후 그룹장 B가 앱 전환 5회", "B의 '준비됨' 안내 수",
        { r -> r.pair(); repeat(5) { r.b.pause(); r.run(1_000); r.b.resume(); r.run(1_000) }; r.b.engine.notices.size }, { it == 1 }),
    Scenario("검색 실패(BUSY)", "1초 뒤 '찾는 중' 표시",
        { r -> r.a.discoverFail = WifiP2pManager.BUSY; r.a.app.discover(); r.run(1_000); r.a.discovering }, { it == false }),
    Scenario("주변에 기기 없음(PEERS_CHANGED 없음)", "25초 뒤 '찾는 중' 표시",
        { r -> r.a.peersMode = PeersBroadcast.NONE; r.a.app.discover(); r.run(25_000); r.a.discovering }, { it == false }),
    Scenario("검색 직후 빈 목록 알림이 먼저 옴", "0.5초 / 2초 뒤 '찾는 중'",
        { r -> r.a.peersMode = PeersBroadcast.EARLY_EMPTY; r.a.app.discover(); r.run(500); val early = r.a.discovering
            r.run(1_500); "$early / ${r.a.discovering}" }, { it == "true / false" }),
    Scenario("연결 요청 직후 '아직 그룹 없음' 알림", "0.5초 뒤 상태",
        { r -> r.a.app.discover(); r.run(2_000); r.a.app.connect(r.b.mac); r.run(500); r.a.p2pStatus }, { it == "connecting" }),
    Scenario("상대가 초대를 무시(알림 없음)", "50초 뒤 상태 / cancelConnect",
        { r -> r.b.invite = Invite.IGNORE; r.a.app.discover(); r.run(2_000); r.a.app.connect(r.b.mac); r.run(50_000)
            "${r.a.p2pStatus} / ${r.a.cancelConnectCalls}" }, { it == "null / 1" }),
    Scenario("앱 재개 10회 후 채널 수", "initialize 호출 수",
        { r -> repeat(10) { r.a.pause(); r.a.resume(); r.run(100) }; r.a.channelsCreated }, { it == 1 }),
    Scenario("프레임워크가 채널을 끊은 뒤 재개 → 검색", "채널 수 / 기기 찾음",
        { r -> r.a.killChannel(); r.a.pause(); r.a.resume(); r.a.app.discover(); r.run(2_000)
            "${r.a.channelsCreated} / ${r.a.peers.isNotEmpty()}" }, { it == "2 / true" }),
    Scenario("그룹 해제 후 다시 연결", "connect 호출 수 / 현재 링크",
        { r -> r.pair(); r.a.app.disconnect(); r.run(1_000); r.a.app.connect(r.b.mac); r.run(5_000)
            "${r.a.engine.connectCalls} / ${r.a.engine.links.size}" }, { it == "2 / 1" }),
    Scenario("수락 대기 중 A가 잠시 앱을 떠남(그룹 형성을 백그라운드에서 놓침)", "복귀 후 링크 / 상태",
        { r -> r.a.app.discover(); r.run(2_000); r.a.app.connect(r.b.mac); r.run(1_000); r.a.pause(); r.run(5_000)
            r.a.resume(); r.run(1_000); "${r.a.engine.links.size} / ${r.a.p2pStatus}" }, { it == "1 / connected" }),
    Scenario("상대가 45초 넘어 늦게 수락", "상태 / 링크",
        { r -> r.b.acceptDelayMs = 60_000; r.a.app.discover(); r.run(2_000); r.a.app.connect(r.b.mac); r.run(65_000)
            "${r.a.p2pStatus} / ${r.a.engine.links.size}" }, { it == "connected / 1" }),
)

fun main() {
    println("AudioBridge Wi-Fi Direct 가상 시뮬레이션 — 가상 폰 2대, 가상 시계\n")
    val w = scenarios.maxOf { it.title.length }.coerceAtMost(46)
    println("%-${w}s  %-26s  %-16s  %-16s  %s".format("시나리오", "측정", "v2.8(수정 전)", "v2.8.1(현재)", "판정"))
    var failed = 0
    for (s in scenarios) {
        val old = runCatching { s.body(Rig(Version.V28)) }.getOrElse { "예외: ${it.message}" }
        val cur = runCatching { s.body(Rig(Version.CURRENT)) }.getOrElse { "예외: ${it.message}" }
        val ok = s.expect(cur)
        if (!ok) failed++
        val verdict = when {
            !ok -> "FAIL"
            !s.expect(old) -> "OK (수정 전 결함 재현)"
            else -> "OK"
        }
        println("%-${w}s  %-26s  %-16s  %-16s  %s".format(s.title, s.measure, old.toString(), cur.toString(), verdict))
    }
    println("\n${scenarios.size - failed}/${scenarios.size} 통과")
    if (failed > 0) exitProcess(1)
}
