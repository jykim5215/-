package app.audiobridge

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.Manifest
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import app.audiobridge.audio.CaptureSource
import app.audiobridge.audio.DelayCoordinator
import app.audiobridge.audio.ModeAPlayer
import app.audiobridge.audio.ModeBSender
import app.audiobridge.audio.SendTarget
import app.audiobridge.audio.SyncCalibration
import app.audiobridge.audio.SyncChirp
import app.audiobridge.audio.SyncMicRecorder
import app.audiobridge.audio.SyncRecording
import app.audiobridge.net.ClockSync
import app.audiobridge.net.ControlClient
import app.audiobridge.net.ControlServer
import app.audiobridge.net.Discovery
import app.audiobridge.net.DiscoveryResponder
import app.audiobridge.net.Protocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.util.UUID

/**
 * 앱 전체 오케스트레이터.
 *
 * v2.1 모델: 소스 기기는 여러 스피커(폰·PC)에 동시에 연결할 수 있다(다대일).
 * 모든 수신기는 패킷 타임스탬프 + 시계 동기(clk)로 "소스 시각 + 지연" 시점에
 * 맞춰 재생하므로 여러 스피커의 소리가 시간적으로 정렬된다.
 *
 * 공개 메서드는 메인 스레드에서 호출된다고 가정한다. 소켓 작업은 IO로 넘긴다.
 */
object BridgeEngine {
    private lateinit var app: Context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())

    // 내가 만든 연결들 (소스 → 스피커). 조작은 메인 스레드에서만.
    private class Link(val id: Int, val host: String, val port: Int) {
        @Volatile var client: ControlClient? = null
        @Volatile var name: String = ""
        @Volatile var kind: String = "pc"
        @Volatile var peerOutput: String? = null
        @Volatile var sendPort: Int = -1
        @Volatile var requested = false
        @Volatile var channelMode = 0 // 0=양쪽 1=왼쪽 2=오른쪽
        @Volatile var gain = 100
        val clock = ClockSync({ obj -> client?.send(obj) })
    }

    private val links = mutableListOf<Link>()
    private var nextLinkId = 1
    @Volatile private var sendTargets: List<SendTarget> = emptyList()

    // 상시 대기 서버 (상대가 나에게 연결)
    private var server: ControlServer? = null
    private var discoveryResponder: DiscoveryResponder? = null
    private val serverClock = ClockSync({ obj -> server?.sendToPeer(obj) })
    @Volatile private var serverPlayDelayMs = -1

    // 스트림
    private var player: ModeAPlayer? = null       // 이 기기에서 재생 (클라이언트 링크)
    private var sender: ModeBSender? = null       // 이 기기 소리 송신
    private var projection: MediaProjection? = null
    @Volatile private var awaitingTcpListen = false
    @Volatile private var awaitingTcpSend = false

    // 공통 지연: 내가 소스일 때 스피커들의 필요 지연을 모아 정한다 / 내가 혼자 들을 때는 내 필요 지연
    private var delayCoordinator = DelayCoordinator()
    private val localDelay = DelayCoordinator()

    // 스피커 소리 맞추기(음향 보정) 한 번의 진행 상태
    private class SyncRun(
        val id: String,
        val links: List<Link>,
        val tones: Map<Int, List<Long>>,
        val recording: SyncRecording,
        val recorder: SyncMicRecorder?,
        val delayMs: Int,
    ) {
        /** 링크 id → (그 스피커의 현재 음향 보정 µs, 공통 지연 외 추가 지연 합 µs) */
        val acks = java.util.concurrent.ConcurrentHashMap<Int, Pair<Long, Long>>()
        var extended = false
    }
    @Volatile private var syncRun: SyncRun? = null
    private val syncTimeout = Runnable { syncRun?.let { abortSpeakerSync(it, "스피커 소리 맞추기 시간이 초과됐어요") } }

    private enum class SendReason { CLIENT, SERVER }
    private var pendingSend: SendReason? = null
    private var serverSendPort = 0

    // 단일 링크 자동 재연결
    private var lastTarget: Pair<String, Int>? = null
    @Volatile private var userDisconnected = false
    private var reconnectAttempts = 0
    private var desiredOutput: String? = null

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        val prefs = prefs()
        val storedPlayoutDelay = Protocol.normalizePlayoutDelayMs(
            prefs.getInt("playoutDelayMs", Protocol.DEFAULT_PLAYOUT_DELAY_MS)
        )
        BridgeState.bufferMs.value = storedPlayoutDelay
        BridgeState.autoDelay.value = prefs.getBoolean("autoDelay", true)
        BridgeState.activeDelayMs.value =
            if (BridgeState.autoDelay.value) Protocol.AUTO_START_DELAY_MS else storedPlayoutDelay
        BridgeState.calibrationUs.value =
            prefs.getLong("calibrationUs", 0L).coerceIn(0L, Protocol.MAX_CALIBRATION_US)
        BridgeState.transportTcp.value = prefs.getBoolean("tcp", false)
        BridgeState.modeAPort.value = prefs.getInt("modeAPort", Protocol.DEFAULT_MODE_A_PORT)
        val savedOrLegacyExtraDelay = if (prefs.contains("extraDelayMs")) {
            prefs.getInt("extraDelayMs", 0)
        } else {
            // v2.5까지의 양방향 nudge는 양수만 보존한다. 음수(앞당김)는 새 정책에서 0이다.
            prefs.getInt("nudgeMs", 0).coerceAtLeast(0)
        }
        val storedExtraDelay = savedOrLegacyExtraDelay.coerceIn(0, Protocol.MAX_EXTRA_DELAY_MS)
        BridgeState.extraDelayMs.value = storedExtraDelay
        prefs.edit()
            .putInt("playoutDelayMs", storedPlayoutDelay)
            .putInt("extraDelayMs", storedExtraDelay)
            .remove("nudgeMs")
            .remove("bufferMs")
            .apply()
        BridgeState.bSource.value =
            if (prefs.getString("bSource", "MIC") == "INTERNAL") CaptureSource.INTERNAL else CaptureSource.MIC
        BridgeState.myName.value =
            prefs.getString("deviceName", null)?.takeIf { it.isNotBlank() } ?: defaultName()
        startLocalServer()
        startClockTicker()
        startDelayTicker()
    }

    private fun prefs() = app.getSharedPreferences("settings", Context.MODE_PRIVATE)

    private fun defaultName() = (Build.MODEL ?: "내 폰").take(20)

    // ---------- 설정 ----------

    fun setMyName(name: String) {
        val n = name.trim().take(20).ifBlank { defaultName() }
        BridgeState.myName.value = n
        prefs().edit().putString("deviceName", n).apply()
    }

    fun setExtraDelayMs(ms: Int) {
        BridgeState.extraDelayMs.value = ms.coerceIn(0, Protocol.MAX_EXTRA_DELAY_MS)
        prefs().edit().putInt("extraDelayMs", BridgeState.extraDelayMs.value).apply()
    }

    /** 수동 공통 지연 (자동을 끈 경우). 보내는 중이면 스피커들에 바로 알린다. */
    fun setPlayoutDelayMs(ms: Int) {
        val normalized = Protocol.normalizePlayoutDelayMs(ms)
        BridgeState.bufferMs.value = normalized
        prefs().edit().putInt("playoutDelayMs", normalized).apply()
        if (!BridgeState.autoDelay.value) applyCommonDelay(normalized)
    }

    fun setAutoDelay(on: Boolean) {
        BridgeState.autoDelay.value = on
        prefs().edit().putBoolean("autoDelay", on).apply()
        applyCommonDelay(if (on) delayCoordinator.currentMs else BridgeState.bufferMs.value)
    }

    /** 스피커 소리 맞추기로 정해진 이 기기의 추가 지연 (µs) */
    fun setCalibrationUs(us: Long) {
        val v = us.coerceIn(0L, Protocol.MAX_CALIBRATION_US)
        BridgeState.calibrationUs.value = v
        prefs().edit().putLong("calibrationUs", v).apply()
    }

    /** 내가 소스일 때 스피커들이 쓸 공통 지연 */
    private fun commonDelayMs(): Int =
        if (BridgeState.autoDelay.value) delayCoordinator.currentMs else BridgeState.bufferMs.value

    /** 내가 혼자 들을 때(상대가 소스) 쓸 공통 지연 */
    private fun listenDelayMs(): Int =
        if (BridgeState.autoDelay.value) localDelay.currentMs else BridgeState.bufferMs.value

    /** 공통 지연이 바뀌면 표시를 갱신하고, 내가 소스면 소리를 받는 스피커들에 알린다. */
    private fun applyCommonDelay(ms: Int) {
        BridgeState.activeDelayMs.value = if (player != null) listenDelayMs() else ms
        val msg = JSONObject().put("type", "delay").put("ms", ms)
        mainLinks().filter { it.requested }.forEach { it.client?.send(msg) }
    }

    /** 스피커가 보고한 필요 지연 (리더 스레드) */
    private fun onNeed(link: Link, needMs: Int) {
        if (!BridgeState.autoDelay.value || syncRun != null) return
        val now = SystemClock.elapsedRealtime()
        delayCoordinator.report(link.id, needMs, now)?.let { d -> main.post { applyCommonDelay(d) } }
    }

    /** 혼자 들을 때: 2초마다 내 필요 지연으로 공통 지연을 정한다 */
    private fun startDelayTicker() {
        scope.launch {
            while (true) {
                delay(DelayCoordinator.REPORT_INTERVAL_MS)
                val p = player
                if (p != null && BridgeState.autoDelay.value) {
                    p.needMs()?.let { need ->
                        localDelay.report(0, need, SystemClock.elapsedRealtime())?.let { d ->
                            BridgeState.activeDelayMs.value = d
                        }
                    }
                }
            }
        }
    }

    fun setTransportTcp(tcp: Boolean) {
        if (BridgeState.listening.value || BridgeState.sending.value || BridgeState.sendPending.value) {
            BridgeState.notify("소리가 흐르는 중에는 바꿀 수 없어요")
            return
        }
        BridgeState.transportTcp.value = tcp
        prefs().edit().putBoolean("tcp", tcp).apply()
    }

    fun setBSource(source: CaptureSource) {
        if (BridgeState.bSource.value == source) return
        if (BridgeState.isServerSession.value && (BridgeState.sending.value || BridgeState.sendPending.value)) {
            BridgeState.notify("보내는 중에는 바꿀 수 없어요 — 잠시 끄고 바꿔 주세요")
            return
        }
        BridgeState.bSource.value = source
        prefs().edit().putString("bSource", source.name).apply()
        if (BridgeState.sending.value || BridgeState.sendPending.value) {
            stopSendingAll()
            main.post { evaluateRoles() }
        }
    }

    fun lastHost(): String = prefs().getString("lastHost", "") ?: ""

    // ---------- 상시 대기 서버 ----------

    private fun startLocalServer() {
        scope.launch {
            if (server == null) {
                val srv = ControlServer(
                    nameProvider = { BridgeState.myName.value },
                    port = Protocol.DEFAULT_CTL_PORT,
                    audioPort = 48553,
                    callbacks = serverCallbacks,
                )
                if (srv.start()) server = srv
            }
            if (discoveryResponder == null) {
                val disc = DiscoveryResponder({ BridgeState.myName.value }, Protocol.DEFAULT_CTL_PORT)
                if (disc.start()) discoveryResponder = disc
            }
        }
    }

    /** 재생 중인 쪽이 주기적으로 시계 동기 질의를 보낸다. 간격은 ClockSync가 정한다(맞추는 동안 빠르게). */
    private fun startClockTicker() {
        scope.launch {
            while (true) {
                var interval = 3000L
                if (BridgeState.listening.value) {
                    val clock = if (BridgeState.isServerSession.value) serverClock
                    else mainLinks().firstOrNull()?.clock
                    clock?.tick()
                    if (clock != null) interval = clock.nextTickDelayMs()
                }
                delay(interval)
            }
        }
    }

    private fun mainLinks(): List<Link> = synchronized(links) { links.toList() }

    private val serverCallbacks = object : ControlServer.Callbacks {
        override fun isBusy() = BridgeState.conn.value != ConnState.DISCONNECTED

        override fun onPeerConnected(name: String, host: String) {
            main.post {
                serverClock.reset()
                serverPlayDelayMs = -1
                BridgeState.conn.value = ConnState.CONNECTED
                BridgeState.isServerSession.value = true
                BridgeState.peerName.value = name
                BridgeState.peerHost.value = host
                BridgeState.peerKind.value = "phone"
                BridgeState.myOutput.value = null
                BridgeState.peerOutput.value = null
                startService(BridgeService.ACTION_FOREGROUND)
            }
        }

        override fun onPeerClosed() {
            main.post {
                if (BridgeState.isServerSession.value) resetSession("연결이 끊어졌어요")
            }
        }

        override fun onPeerRole(rawOutput: String) {
            main.post {
                BridgeState.peerOutput.value = normalizePeerRole(rawOutput)
                evaluateRoles()
            }
        }

        override fun onModeAStart(udpPort: Int, tcp: Boolean) {
            main.post { handleServerModeAStart(udpPort, tcp) }
        }

        override fun onModeAStop() {
            main.post { stopSendingAll() }
        }

        override fun canPlay() = BridgeState.myOutput.value == "me"

        override fun onPlaying(playing: Boolean) {
            main.post {
                BridgeState.listening.value = playing
                if (!playing) BridgeState.level.value = 0f
            }
        }

        override fun onLevel(level: Float) {
            BridgeState.level.value = level
        }

        override fun onError(msg: String) {
            BridgeState.notify(msg)
        }

        override fun onClkReply(t0: Long, t1: Long) {
            serverClock.onReply(t0, t1)
        }

        override fun onPlayDelay(delayMs: Int) {
            if (delayMs <= 0) return
            serverPlayDelayMs = delayMs
            BridgeState.activeDelayMs.value = Protocol.normalizePlayoutDelayMs(delayMs)
        }

        override fun onSyncCalibration(us: Long) {
            main.post {
                setCalibrationUs(us)
                BridgeState.notify("스피커 소리 맞추기: 이 기기를 ${"%.1f".format(us / 1000.0)}ms 늦춰요")
            }
        }

        override fun playbackDelayMs(): Int =
            if (serverPlayDelayMs > 0) serverPlayDelayMs else BridgeState.bufferMs.value

        override fun playbackExtraDelayMs(): Int = BridgeState.extraDelayMs.value

        override fun playbackCalibrationUs(): Long = BridgeState.calibrationUs.value

        override fun playbackOffsetUs(): Long? = serverClock.offsetUs
    }

    // ---------- 검색/연결 ----------

    fun discover() {
        if (BridgeState.discovering.value) return
        scope.launch {
            BridgeState.discovering.value = true
            try {
                val linked = mainLinks().map { it.host }.toSet()
                val found = Discovery.discover()
                    .filter { it.name != BridgeState.myName.value && it.host !in linked }
                BridgeState.peers.value = found
                if (found.isEmpty()) {
                    BridgeState.notify("기기를 찾지 못했어요 — 상대 폰은 앱을 열어 두고, PC는 프로그램을 실행해 주세요")
                }
            } finally {
                BridgeState.discovering.value = false
            }
        }
    }

    // ---------- Wi-Fi Direct (공유기 없이 직접 연결) ----------
    // 컨트롤러(WifiP2pManager 래퍼)는 MainActivity가 생성해 주입한다. UI는 이 훅으로만 접근.

    interface WifiDirectController {
        fun discover()
        fun connect(deviceAddress: String)
        fun disconnect()
    }

    @Volatile var wifiDirect: WifiDirectController? = null

    /**
     * Wi-Fi Direct 그룹이 형성되면 호출된다. 그룹장(GO)은 서버(192.168.49.1)로 대기하고,
     * 상대는 그 IP의 기존 컨트롤 채널에 붙는다 — 이후 흐름은 일반 연결과 동일.
     */
    fun onWifiDirectConnected(isGroupOwner: Boolean, groupOwnerHost: String?) {
        main.post {
            if (isGroupOwner) {
                // 내가 그룹장 = 서버. 상대가 붙어오면 상시 서버가 받는다.
                BridgeState.notify("Wi-Fi Direct 준비됨 — 상대 기기가 연결하면 시작돼요")
            } else {
                val host = groupOwnerHost ?: run {
                    BridgeState.notify("상대 주소를 확인할 수 없어요")
                    return@post
                }
                // 이미 그 그룹장에 붙어 있으면 다시 연결하지 않는다(중복 링크 방지)
                if (mainLinks().any { it.host == host }) return@post
                connect(host, Protocol.DEFAULT_CTL_PORT)
            }
        }
    }

    fun connect(host: String, port: Int) {
        if (BridgeState.isServerSession.value) {
            scope.launch { server?.closeSession() }
            resetSession(null)
        }
        userDisconnected = false
        reconnectAttempts = 0
        desiredOutput = null
        lastTarget = host to port
        prefs().edit().putString("lastHost", if (port == Protocol.DEFAULT_CTL_PORT) host else "$host:$port").apply()
        if (mainLinks().isEmpty()) BridgeState.conn.value = ConnState.CONNECTING
        addLink(host, port)
    }

    /** 이미 연결된 상태에서 스피커를 추가 (다대일). */
    fun addSpeaker(host: String, port: Int) {
        if (BridgeState.isServerSession.value) {
            BridgeState.notify("상대가 나에게 연결한 상태에서는 추가할 수 없어요")
            return
        }
        if (mainLinks().any { it.host == host }) {
            BridgeState.notify("이미 연결된 기기예요")
            return
        }
        if (mainLinks().size >= 4) {
            BridgeState.notify("스피커는 최대 4대까지 연결할 수 있어요")
            return
        }
        if (BridgeState.myOutput.value != "peer") chooseOutput("peer")
        addLink(host, port)
    }

    private fun addLink(host: String, port: Int) {
        val link = Link(nextLinkId++, host, port)
        synchronized(links) { links.add(link) }
        val client = ControlClient(
            host = host, port = port, phoneName = BridgeState.myName.value,
            onMessage = { obj -> onCtlMessage(link, obj) },
            onConnected = { peer, kind -> main.post { onLinkConnected(link, peer, kind) } },
            onDisconnected = { reason -> main.post { onLinkDropped(link, reason) } },
        )
        link.client = client
        client.start()
        refreshSpeakers()
    }

    fun removeSpeaker(id: Int) {
        val link = mainLinks().firstOrNull { it.id == id } ?: return
        synchronized(links) { links.remove(link) }
        val c = link.client
        scope.launch { c?.close() }
        refreshTargets()
        refreshSpeakers()
        if (mainLinks().isEmpty()) {
            userDisconnected = true
            resetSession(null)
        } else {
            refreshPrimary()
        }
    }

    private fun onLinkConnected(link: Link, peer: String, kind: String) {
        if (link !in mainLinks()) return
        reconnectAttempts = 0
        link.name = peer
        link.kind = kind
        BridgeState.conn.value = ConnState.CONNECTED
        refreshPrimary()
        refreshSpeakers()
        startService(BridgeService.ACTION_FOREGROUND)
        if (mainLinks().size == 1) {
            val restore = desiredOutput
                ?: if (kind == "pc") prefs().getString("outputChoice", "me") else null
            desiredOutput = null
            if (restore != null) {
                chooseOutput(restore)
                return
            }
        }
        sendRoleTo(link)
        evaluateRoles()
    }

    private fun onLinkDropped(link: Link, reason: String?) {
        val present = synchronized(links) { links.remove(link) }
        if (!present) return
        delayCoordinator.remove(link.id)
        refreshTargets()
        refreshSpeakers()
        val remaining = mainLinks()
        if (remaining.isEmpty()) {
            val target = lastTarget
            if (!userDisconnected && target != null && reconnectAttempts < 5 && !BridgeState.isServerSession.value) {
                desiredOutput = desiredOutput ?: BridgeState.myOutput.value
                stopStreamsQuiet()
                BridgeState.myOutput.value = null
                BridgeState.peerOutput.value = null
                BridgeState.conn.value = ConnState.CONNECTING
                reconnectAttempts++
                BridgeState.notify("연결이 끊어져 다시 연결하고 있어요 ($reconnectAttempts/5)")
                main.postDelayed({
                    if (!userDisconnected && BridgeState.conn.value == ConnState.CONNECTING && mainLinks().isEmpty()) {
                        addLink(target.first, target.second)
                    }
                }, 3000)
            } else {
                resetSession(if (userDisconnected) null else (reason ?: "연결이 끊어졌어요"))
            }
        } else {
            BridgeState.notify("${link.name.ifEmpty { link.host }}와의 연결이 끊어졌어요")
            refreshPrimary()
        }
    }

    fun disconnect() {
        userDisconnected = true
        val all = mainLinks()
        synchronized(links) { links.clear() }
        scope.launch {
            all.forEach { it.client?.close() }
            server?.closeSession()
        }
        resetSession(null)
    }

    private fun resetSession(message: String?) {
        syncRun?.let { abortSpeakerSync(it, null) }
        stopStreamsQuiet()
        synchronized(links) { links.clear() }
        sendTargets = emptyList()
        awaitingTcpListen = false
        awaitingTcpSend = false
        pendingSend = null
        serverClock.reset()
        BridgeState.conn.value = ConnState.DISCONNECTED
        BridgeState.isServerSession.value = false
        BridgeState.peerName.value = null
        BridgeState.peerHost.value = null
        BridgeState.peerKind.value = "pc"
        BridgeState.myOutput.value = null
        BridgeState.peerOutput.value = null
        BridgeState.listening.value = false
        BridgeState.sending.value = false
        BridgeState.sendPending.value = false
        BridgeState.level.value = 0f
        BridgeState.speakers.value = emptyList()
        if (::app.isInitialized) {
            runCatching { app.startService(serviceIntent(BridgeService.ACTION_STOP)) }
        }
        message?.let { BridgeState.notify(it) }
    }

    private fun stopStreamsQuiet() {
        val p = player; player = null
        val s = sender; sender = null
        val proj = projection; projection = null
        awaitingTcpListen = false
        awaitingTcpSend = false
        scope.launch {
            server?.stopPlaying()
            p?.stop()
            s?.stop()
            runCatching { proj?.stop() }
        }
    }

    private fun refreshPrimary() {
        val first = mainLinks().firstOrNull() ?: return
        BridgeState.peerName.value = first.name.ifEmpty { first.host }
        BridgeState.peerHost.value = first.host
        BridgeState.peerKind.value = first.kind
        BridgeState.peerOutput.value = first.peerOutput
    }

    private fun refreshSpeakers() {
        BridgeState.speakers.value = mainLinks().map {
            SpeakerInfo(it.id, it.name.ifEmpty { it.host }, it.kind, it.sendPort > 0, it.channelMode, it.gain)
        }
    }

    private fun refreshTargets() {
        sendTargets = mainLinks().filter { it.sendPort > 0 }
            .map { SendTarget(InetSocketAddress(it.host, it.sendPort), it.channelMode) }
    }

    /** 스테레오 페어: 스피커별 채널 지정 (0=양쪽 1=왼쪽 2=오른쪽) */
    fun setSpeakerChannel(id: Int, mode: Int) {
        val link = mainLinks().firstOrNull { it.id == id } ?: return
        link.channelMode = mode.coerceIn(0, 2)
        refreshTargets()
        refreshSpeakers()
    }

    /** 원격 볼륨 (0~100) — 해당 스피커에 vol 메시지 전송 */
    fun setSpeakerGain(id: Int, gain: Int) {
        val link = mainLinks().firstOrNull { it.id == id } ?: return
        link.gain = gain.coerceIn(0, 100)
        link.client?.send(JSONObject().put("type", "vol").put("gain", link.gain))
        refreshSpeakers()
    }

    // ---------- 역할 ----------

    /** where: "me"(이 기기에서 소리), "peer"(상대 기기에서 소리), null(정지) */
    fun chooseOutput(where: String?) {
        if (BridgeState.conn.value != ConnState.CONNECTED) return
        if (where == "me" && mainLinks().size > 1) {
            BridgeState.notify("여러 대에 보내는 중에는 이 기기 재생을 쓸 수 없어요")
            return
        }
        BridgeState.myOutput.value = where
        if (BridgeState.peerKind.value == "pc" && where != null && mainLinks().size <= 1) {
            prefs().edit().putString("outputChoice", where).apply()
        }
        sendRoleAll()
        evaluateRoles()
    }

    private fun roleMessage(): JSONObject {
        val raw = when (BridgeState.myOutput.value) {
            "me" -> "self"
            "peer" -> "other"
            else -> "none"
        }
        return JSONObject().put("type", "role").put("output", raw)
    }

    private fun sendRoleAll() {
        val msg = roleMessage()
        val all = mainLinks()
        if (all.isEmpty()) {
            server?.let { scope.launch { it.sendToPeer(msg) } }
        } else {
            all.forEach { it.client?.send(msg) }
        }
    }

    private fun sendRoleTo(link: Link) {
        link.client?.send(roleMessage())
    }

    private fun normalizePeerRole(raw: String): String? = when (raw) {
        "self" -> "peer"
        "other" -> "me"
        else -> null
    }

    private fun evaluateRoles() {
        if (BridgeState.conn.value != ConnState.CONNECTED) return
        val my = BridgeState.myOutput.value

        if (BridgeState.isServerSession.value) {
            val peerW = BridgeState.peerOutput.value
            if (my != "me") scope.launch { server?.stopPlaying() }
            if (my != "peer") stopSendingAll()
            // 서버 세션 재생·송신 시작은 상대의 modeB/modeA 요청이 트리거
            return
        }

        val all = mainLinks()
        when (my) {
            "me" -> {
                stopSendingAll()
                val link = all.firstOrNull() ?: return
                val peerW = if (link.kind == "pc") "me" else link.peerOutput
                if (all.size == 1 && peerW == "me") startListening(link) else stopListening()
            }
            "peer" -> {
                stopListening()
                var anyAgreed = false
                for (l in all) {
                    val agreed = l.kind == "pc" || l.peerOutput == "peer"
                    if (agreed) {
                        anyAgreed = true
                        if (!l.requested) {
                            l.requested = true
                            sendModeBStart(l)
                        }
                    }
                }
                if (anyAgreed) ensureCapture()
            }
            else -> {
                stopListening()
                stopSendingAll()
            }
        }
    }

    // ---------- 이 기기에서 듣기 (단일 링크) ----------

    private fun startListening(link: Link) {
        if (player != null) return
        val c = link.client ?: return
        val tcp = BridgeState.transportTcp.value
        link.clock.reset()
        link.clock.tick()
        localDelay.remove(0)
        val p = ModeAPlayer(
            delayMsProvider = { listenDelayMs() },
            extraDelayMsProvider = { BridgeState.extraDelayMs.value },
            offsetUsProvider = { link.clock.offsetUs },
            onStats = { _, level, _ -> BridgeState.level.value = level },
            onError = { msg ->
                BridgeState.notify(msg)
                main.post { failListening() }
            },
            calibrationUsProvider = { BridgeState.calibrationUs.value },
        )
        player = p
        BridgeState.activeDelayMs.value = listenDelayMs()
        BridgeState.listening.value = true
        scope.launch {
            if (!tcp) {
                if (!p.startUdp(BridgeState.modeAPort.value, c.host)) {
                    main.post { failListening() }
                    return@launch
                }
            } else {
                awaitingTcpListen = true
            }
            c.send(
                JSONObject().put("type", "modeA").put("action", "start")
                    .put("udpPort", BridgeState.modeAPort.value)
                    .put("sampleRate", Protocol.SAMPLE_RATE).put("channels", 2)
                    .put("codec", Protocol.CODEC_PCM16)
                    .put("transport", if (tcp) "tcp" else "udp")
            )
        }
    }

    private fun stopListening() {
        val p = player ?: return
        player = null
        awaitingTcpListen = false
        mainLinks().firstOrNull()?.client?.send(JSONObject().put("type", "modeA").put("action", "stop"))
        scope.launch { p.stop() }
        BridgeState.listening.value = false
        BridgeState.level.value = 0f
    }

    private fun failListening() {
        val p = player
        player = null
        scope.launch { p?.stop() }
        BridgeState.listening.value = false
        if (BridgeState.myOutput.value == "me") {
            BridgeState.myOutput.value = null
            sendRoleAll()
        }
    }

    // ---------- 이 기기 소리 보내기 ----------

    private fun sendModeBStart(link: Link) {
        val ch = if (BridgeState.bSource.value == CaptureSource.INTERNAL) 2 else 1
        val single = mainLinks().size == 1
        val tcp = BridgeState.transportTcp.value && single
        link.client?.send(
            JSONObject().put("type", "modeB").put("action", "start")
                .put("sampleRate", Protocol.SAMPLE_RATE).put("channels", ch)
                .put("codec", Protocol.CODEC_PCM16)
                .put("transport", if (tcp) "tcp" else "udp")
                .put("delayMs", commonDelayMs())
        )
    }

    private fun ensureCapture() {
        if (sender != null || pendingSend != null) return
        delayCoordinator = DelayCoordinator()
        BridgeState.activeDelayMs.value = commonDelayMs()
        pendingSend = SendReason.CLIENT
        BridgeState.sendPending.value = true
        BridgeState.sendSetup.tryEmit(Unit)
    }

    private fun handleServerModeAStart(udpPort: Int, tcp: Boolean) {
        val srv = server ?: return
        if (BridgeState.myOutput.value != "peer") {
            scope.launch {
                srv.sendToPeer(
                    JSONObject().put("type", "modeA").put("status", "error")
                        .put("message", "상대 기기에서 아직 '상대 기기'를 선택하지 않았어요")
                )
            }
            return
        }
        if (tcp) {
            scope.launch {
                srv.sendToPeer(
                    JSONObject().put("type", "modeA").put("status", "error")
                        .put("message", "이 방향은 '빠름' 방식만 지원해요")
                )
            }
            return
        }
        if (udpPort !in 1..65535) return
        if (BridgeState.sending.value || BridgeState.sendPending.value) return
        serverSendPort = udpPort
        pendingSend = SendReason.SERVER
        BridgeState.sendPending.value = true
        scope.launch { srv.sendToPeer(JSONObject().put("type", "modeA").put("status", "ok")) }
        BridgeState.sendSetup.tryEmit(Unit)
    }

    /** UI: 권한/동의가 불가능하거나 거부됨 */
    fun cancelSend(message: String?) {
        val wasServer = pendingSend == SendReason.SERVER
        pendingSend = null
        BridgeState.sendPending.value = false
        mainLinks().forEach { it.requested = false }
        if (BridgeState.myOutput.value == "peer") {
            BridgeState.myOutput.value = null
            sendRoleAll()
        }
        if (wasServer) {
            server?.let {
                scope.launch {
                    it.sendToPeer(
                        JSONObject().put("type", "modeA").put("status", "error")
                            .put("message", message ?: "상대 기기에서 준비가 취소되었어요")
                    )
                }
            }
        }
        message?.let { BridgeState.notify(it) }
    }

    fun requestSendMic() {
        startService(BridgeService.ACTION_MIC)
    }

    fun requestSendProjection(resultCode: Int, data: Intent) {
        val intent = serviceIntent(BridgeService.ACTION_PROJECTION)
            .putExtra(BridgeService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(BridgeService.EXTRA_RESULT_DATA, data)
        runCatching { app.startForegroundService(intent) }
    }

    fun onServiceMicReady() {
        main.post { proceedSend() }
    }

    fun onProjectionReady(proj: MediaProjection?) {
        if (proj == null) {
            main.post { cancelSend("화면 소리 공유가 거부되었어요 — 마이크로는 보낼 수 있어요") }
            return
        }
        projection = proj
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                main.post { if (BridgeState.sending.value || BridgeState.sendPending.value) stopSendingAndClear() }
            }
        }, main)
        main.post { proceedSend() }
    }

    private fun proceedSend() {
        when (pendingSend) {
            SendReason.CLIENT -> {
                val single = mainLinks().size == 1
                val tcp = BridgeState.transportTcp.value && single
                if (tcp) {
                    val t = sendTargets.firstOrNull()
                    if (t == null) {
                        awaitingTcpSend = true // modeB ok 대기
                    } else {
                        scope.launch { startSender(tcpTarget = t.addr) }
                    }
                } else {
                    scope.launch { startSender(tcpTarget = null) }
                }
            }
            SendReason.SERVER -> {
                val host = BridgeState.peerHost.value ?: run { cancelSend(null); return }
                val target = SendTarget(InetSocketAddress(host, serverSendPort))
                scope.launch { startSender(tcpTarget = null, fixedTargets = listOf(target)) }
            }
            null -> {}
        }
    }

    private fun startSender(tcpTarget: InetSocketAddress?, fixedTargets: List<SendTarget>? = null) {
        val s = ModeBSender(
            targetsProvider = { fixedTargets ?: sendTargets },
            tcpTarget = tcpTarget,
            source = BridgeState.bSource.value,
            projection = projection,
            onLevel = { BridgeState.level.value = it },
            onError = { msg ->
                BridgeState.notify(msg)
                main.post { stopSendingAndClear() }
            },
        )
        if (s.start()) {
            sender = s
            main.post {
                pendingSend = null
                BridgeState.sending.value = true
                BridgeState.sendPending.value = false
                refreshSpeakers()
            }
        } else {
            main.post { cancelSend(null) }
        }
    }

    private fun stopSendingAll() {
        if (sender == null && !BridgeState.sendPending.value && pendingSend == null) return
        syncRun?.let { abortSpeakerSync(it, null) }
        val s = sender; sender = null
        val proj = projection; projection = null
        pendingSend = null
        awaitingTcpSend = false
        val stops = mainLinks().filter { it.requested }
        stops.forEach {
            it.requested = false
            it.sendPort = -1
            it.client?.send(JSONObject().put("type", "modeB").put("action", "stop"))
        }
        refreshTargets()
        scope.launch {
            s?.stop()
            runCatching { proj?.stop() }
        }
        BridgeState.sending.value = false
        BridgeState.sendPending.value = false
        BridgeState.level.value = 0f
        refreshSpeakers()
    }

    private fun stopSendingAndClear() {
        stopSendingAll()
        if (BridgeState.myOutput.value == "peer") {
            BridgeState.myOutput.value = null
            sendRoleAll()
        }
    }

    // ---------- 링크별 컨트롤 메시지 (리더 스레드에서 호출) ----------

    private fun onCtlMessage(link: Link, obj: JSONObject) {
        when (obj.optString("type")) {
            "role" -> main.post {
                link.peerOutput = normalizePeerRole(obj.optString("output", "none"))
                refreshPrimary()
                evaluateRoles()
            }
            "clk" -> link.clock.onReply(obj.optLong("t0", 0), obj.optLong("t1", 0))
            "modeA" -> when (obj.optString("status")) {
                "ok" -> if (awaitingTcpListen) {
                    awaitingTcpListen = false
                    val port = obj.optInt("tcpPort", -1)
                    val p = player ?: return
                    scope.launch {
                        if (port !in 1..65535 || !p.startTcp(link.host, port)) {
                            BridgeState.notify("소리 통로를 열 수 없어요")
                            main.post { failListening() }
                        }
                    }
                }
                "error" -> main.post {
                    BridgeState.notify(obj.optString("message", "재생을 시작할 수 없어요"))
                    failListening()
                }
            }
            "modeB" -> when (obj.optString("status")) {
                "ok" -> main.post {
                    val tcp = BridgeState.transportTcp.value && mainLinks().size == 1
                    val port = obj.optInt(if (tcp) "tcpPort" else "udpPort", -1)
                    if (port !in 1..65535) return@post
                    link.sendPort = port
                    refreshTargets()
                    refreshSpeakers()
                    if (link.gain != 100) {
                        link.client?.send(JSONObject().put("type", "vol").put("gain", link.gain))
                    }
                    if (awaitingTcpSend && tcp) {
                        awaitingTcpSend = false
                        val t = InetSocketAddress(link.host, port)
                        scope.launch { startSender(tcpTarget = t) }
                    }
                }
                "error" -> main.post {
                    link.requested = false
                    link.sendPort = -1
                    refreshTargets()
                    refreshSpeakers()
                    BridgeState.notify("${link.name.ifEmpty { link.host }}: " + obj.optString("message", "보내기 실패"))
                    if (mainLinks().none { it.sendPort > 0 } && pendingSend == null && sender != null) {
                        stopSendingAll()
                    }
                }
            }
            "need" -> onNeed(link, obj.optInt("ms", -1).takeIf { it > 0 } ?: return)
            "sync" -> onSyncReply(link, obj)
            "error" -> BridgeState.notify(obj.optString("message", "오류"))
        }
    }

    // ---------- 스피커 소리 맞추기 (음향 보정) ----------
    // 스피커들을 이 폰 옆에 모아 두면, 스피커마다 다른 소스 시각에 시험음을 실제 재생 경로로 내게 하고
    // 이 폰 마이크로 녹음해 도착 시각의 차이(스피커 내부 처리 지연 포함)를 잰 뒤, 빠른 스피커를 늦춘다.

    fun requestSpeakerSync() {
        if (syncRun != null) return
        val s = sender
        val targets = mainLinks().filter { it.sendPort > 0 }
        if (BridgeState.isServerSession.value || s == null || !BridgeState.sending.value) {
            BridgeState.notify("이 폰에서 스피커로 소리를 보내는 중에 쓸 수 있어요")
            return
        }
        if (targets.size < 2) {
            BridgeState.notify("스피커가 두 대 이상일 때 서로 맞출 수 있어요")
            return
        }
        if (!s.capturesMic &&
            app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
        ) {
            BridgeState.calibrationPermissionRequest.tryEmit(Unit)
            return
        }
        startSpeakerSync(s, targets)
    }

    /** MainActivity의 마이크 권한 결과 */
    fun onCalibrationPermission(granted: Boolean) {
        if (granted) requestSpeakerSync()
        else BridgeState.notify("마이크 권한이 있어야 스피커 소리를 맞출 수 있어요")
    }

    private fun startSpeakerSync(s: ModeBSender, targets: List<Link>) {
        val recording = SyncRecording(Protocol.SAMPLE_RATE)
        var recorder: SyncMicRecorder? = null
        if (s.capturesMic) {
            s.micTap = { f, ts -> recording.add(f, ts) }
        } else {
            recorder = SyncMicRecorder { f, ts -> recording.add(f, ts) }
            if (!recorder.start()) {
                BridgeState.notify("마이크를 열 수 없어요")
                return
            }
        }
        val nowUs = SystemClock.elapsedRealtimeNanos() / 1000
        val base = nowUs + SyncCalibration.LEAD_US
        val tones = targets.withIndex().associate { (i, l) ->
            l.id to (0 until SyncCalibration.ROUNDS).map { r -> SyncCalibration.toneAtUs(base, targets.size, i, r) }
        }
        val run = SyncRun(UUID.randomUUID().toString(), targets, tones, recording, recorder, commonDelayMs())
        syncRun = run
        BridgeState.calibrationRunning.value = true
        s.muted = true
        for (l in targets) {
            l.client?.send(
                JSONObject().put("type", "sync").put("action", "tones").put("id", run.id)
                    .put("at", JSONArray(tones.getValue(l.id)))
            )
        }
        val lastTone = tones.values.flatten().max()
        val waitMs = (lastTone - nowUs) / 1000 + run.delayMs + LISTEN_TAIL_MS
        main.postDelayed({ finishSpeakerSync(run) }, waitMs)
        main.removeCallbacks(syncTimeout)
        main.postDelayed(syncTimeout, waitMs + 2 * Protocol.MAX_EXTRA_DELAY_MS + 15_000)
        BridgeState.notify("스피커들을 이 폰 옆에 같은 거리로 모아 두고 조용히 해 주세요 — 시험음이 차례로 나요")
    }

    /** 스피커의 응답: {"type":"sync","action":"ack","id":..,"calUs":..,"extraUs":..} (리더 스레드) */
    private fun onSyncReply(link: Link, obj: JSONObject) {
        val run = syncRun ?: return
        if (obj.optString("action") != "ack" || obj.optString("id") != run.id) return
        run.acks[link.id] = obj.optLong("calUs", 0L) to obj.optLong("extraUs", 0L)
    }

    private fun stopSyncRecording(run: SyncRun) {
        sender?.let {
            it.micTap = null
            it.muted = false
        }
        run.recorder?.stop()
    }

    private fun finishSpeakerSync(run: SyncRun) {
        if (syncRun !== run) return
        // 추가 지연이 큰 스피커는 그만큼 늦게 울린다 — 한 번은 더 기다린다
        val maxExtraMs = (run.acks.values.maxOfOrNull { it.second } ?: 0L) / 1000
        if (!run.extended && maxExtraMs > 0) {
            run.extended = true
            main.postDelayed({ finishSpeakerSync(run) }, maxExtraMs)
            return
        }
        stopSyncRecording(run)
        scope.launch {
            val result = runCatching { computeSpeakerSync(run) }
            main.post {
                if (syncRun !== run) return@post
                result.onSuccess { cal ->
                    for (l in run.links) {
                        l.client?.send(JSONObject().put("type", "sync").put("action", "set").put("calUs", cal.getValue(l.id)))
                    }
                    val summary = run.links.joinToString(", ") {
                        "${it.name.ifEmpty { it.host }} +${"%.1f".format(cal.getValue(it.id) / 1000.0)}ms"
                    }
                    endSpeakerSync("스피커 소리를 맞췄어요: $summary")
                }.onFailure { endSpeakerSync(it.message ?: "스피커 소리를 맞추지 못했어요") }
            }
        }
    }

    private fun computeSpeakerSync(run: SyncRun): Map<Int, Long> {
        val (recStartUs, samples) = run.recording.build() ?: error("녹음이 비어 있어요")
        val template = SyncChirp.template(Protocol.SAMPLE_RATE)
        val late = HashMap<Int, Double>()
        for (l in run.links) {
            val ack = run.acks[l.id] ?: error("${l.name.ifEmpty { l.host }}가 응답하지 않았어요 (앱을 최신으로 업데이트해 주세요)")
            late[l.id] = SyncCalibration.measureLateUs(
                samples, recStartUs.toDouble(), Protocol.SAMPLE_RATE,
                run.tones.getValue(l.id), run.delayMs * 1000.0 + ack.second, template,
            ) ?: error("${l.name.ifEmpty { l.host }} 시험음을 못 들었어요 — 볼륨을 올리고 폰 가까이 두세요")
        }
        return SyncCalibration.compute(late, run.acks.mapValues { it.value.first })
    }

    private fun abortSpeakerSync(run: SyncRun, message: String?) {
        if (syncRun !== run) return
        stopSyncRecording(run)
        endSpeakerSync(message)
    }

    private fun endSpeakerSync(message: String?) {
        main.removeCallbacks(syncTimeout)
        syncRun = null
        BridgeState.calibrationRunning.value = false
        message?.let { BridgeState.notify(it) }
    }

    private const val LISTEN_TAIL_MS = 700L

    // ---------- 서비스 ----------

    private fun serviceIntent(action: String) =
        Intent(app, BridgeService::class.java).setAction(action)

    private fun startService(action: String) {
        runCatching { app.startForegroundService(serviceIntent(action)) }
    }
}
