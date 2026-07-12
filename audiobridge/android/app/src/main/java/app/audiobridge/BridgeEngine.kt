package app.audiobridge

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.audiobridge.audio.CaptureSource
import app.audiobridge.audio.ModeAPlayer
import app.audiobridge.audio.ModeBSender
import app.audiobridge.net.ControlClient
import app.audiobridge.net.ControlServer
import app.audiobridge.net.Discovery
import app.audiobridge.net.DiscoveryResponder
import app.audiobridge.net.Protocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 앱 전체 오케스트레이터.
 *
 * 상호작용 모델(v2): 두 기기를 "연결"한 뒤, 양쪽이 각자 "소리가 나오는 곳"을 고른다.
 * 두 선택이 일치하면(한쪽 me, 다른쪽 peer) 소리가 흐른다 — 한쪽은 스피커(수동), 한쪽은 소스.
 * PC companion은 UI가 없으므로 항상 폰의 선택에 자동 동의한다.
 *
 * 공개 메서드는 메인 스레드에서 불려도 안전하다 — 소켓 작업은 IO 스코프/전용 스레드로 넘긴다.
 */
object BridgeEngine {
    private lateinit var app: Context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())

    // 세션 (동시에 하나: 내가 클라이언트이거나, 상대가 나에게 접속)
    private var control: ControlClient? = null
    private var server: ControlServer? = null
    private var discoveryResponder: DiscoveryResponder? = null

    // 스트림
    private var player: ModeAPlayer? = null       // 이 기기에서 재생 (클라이언트 역할일 때)
    private var sender: ModeBSender? = null       // 이 기기 소리 송신
    private var projection: MediaProjection? = null
    @Volatile private var awaitingTcpListen = false

    // 보내기 준비 사유
    private enum class SendReason { CLIENT, SERVER }
    private var pendingSend: SendReason? = null
    private var serverSendPort = 0

    // 자동 재연결 (클라이언트 세션)
    private var lastTarget: Pair<String, Int>? = null
    @Volatile private var userDisconnected = false
    private var reconnectAttempts = 0
    private var desiredOutput: String? = null // 재연결 후 복원할 선택

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        val prefs = prefs()
        BridgeState.bufferMs.value = prefs.getInt("bufferMs", 60)
        BridgeState.transportTcp.value = prefs.getBoolean("tcp", false)
        BridgeState.modeAPort.value = prefs.getInt("modeAPort", Protocol.DEFAULT_MODE_A_PORT)
        BridgeState.bSource.value =
            if (prefs.getString("bSource", "MIC") == "INTERNAL") CaptureSource.INTERNAL else CaptureSource.MIC
        BridgeState.myName.value =
            prefs.getString("deviceName", null)?.takeIf { it.isNotBlank() } ?: defaultName()
        startLocalServer()
    }

    private fun prefs() = app.getSharedPreferences("settings", Context.MODE_PRIVATE)

    private fun defaultName() = (Build.MODEL ?: "내 폰").take(20)

    // ---------- 설정 ----------

    fun setMyName(name: String) {
        val n = name.trim().take(20).ifBlank { defaultName() }
        BridgeState.myName.value = n
        prefs().edit().putString("deviceName", n).apply()
    }

    fun setBufferMs(ms: Int) {
        BridgeState.bufferMs.value = ms.coerceIn(20, 500)
        prefs().edit().putInt("bufferMs", BridgeState.bufferMs.value).apply()
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
        // 보내는 중이면 새 소스로 다시 시작
        if (BridgeState.sending.value || BridgeState.sendPending.value) {
            stopSending(tellPeer = true)
            main.post { evaluateRoles() }
        }
    }

    fun lastHost(): String = prefs().getString("lastHost", "") ?: ""

    // ---------- 상시 대기 서버 (이 폰을 찾고 연결할 수 있게) ----------

    private fun startLocalServer() {
        scope.launch {
            if (server == null) {
                val srv = ControlServer(
                    nameProvider = { BridgeState.myName.value },
                    port = Protocol.DEFAULT_CTL_PORT,
                    audioPort = 48553,
                    bufferMsProvider = { BridgeState.bufferMs.value },
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

    private val serverCallbacks = object : ControlServer.Callbacks {
        override fun isBusy() = BridgeState.conn.value != ConnState.DISCONNECTED

        override fun onPeerConnected(name: String, host: String) {
            main.post {
                BridgeState.conn.value = ConnState.CONNECTED
                BridgeState.isServerSession.value = true
                BridgeState.peerName.value = name
                BridgeState.peerHost.value = host
                BridgeState.peerKind.value = "phone" // 접속해 오는 쪽은 항상 폰 앱
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
            main.post { stopSending(tellPeer = false) }
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
    }

    // ---------- 검색/연결 ----------

    fun discover() {
        if (BridgeState.discovering.value) return
        scope.launch {
            BridgeState.discovering.value = true
            try {
                val found = Discovery.discover()
                    .filter { it.name != BridgeState.myName.value } // 나 자신 제외(같은 폰)
                BridgeState.peers.value = found
                if (found.isEmpty()) {
                    BridgeState.notify("기기를 찾지 못했어요 — 상대 폰은 앱을 열어 두고, PC는 프로그램을 실행해 주세요")
                }
            } finally {
                BridgeState.discovering.value = false
            }
        }
    }

    fun connect(host: String, port: Int) {
        userDisconnected = false
        reconnectAttempts = 0
        desiredOutput = null
        lastTarget = host to port
        prefs().edit().putString("lastHost", if (port == Protocol.DEFAULT_CTL_PORT) host else "$host:$port").apply()
        doConnect(host, port)
    }

    private fun doConnect(host: String, port: Int) {
        val old = control
        control = null
        scope.launch { old?.close() }
        stopStreamsQuiet()
        BridgeState.conn.value = ConnState.CONNECTING
        BridgeState.isServerSession.value = false
        val client = ControlClient(
            host = host, port = port, phoneName = BridgeState.myName.value,
            onMessage = ::onCtlMessage,
            onConnected = { peer, kind ->
                main.post {
                    reconnectAttempts = 0
                    BridgeState.conn.value = ConnState.CONNECTED
                    BridgeState.peerName.value = peer
                    BridgeState.peerHost.value = host
                    BridgeState.peerKind.value = kind
                    BridgeState.myOutput.value = null
                    BridgeState.peerOutput.value = null
                    startService(BridgeService.ACTION_FOREGROUND)
                    val restore = desiredOutput
                        ?: if (kind == "pc") (prefs().getString("outputChoice", "me")) else null
                    desiredOutput = null
                    if (restore != null) chooseOutput(restore)
                }
            },
            onDisconnected = { reason -> main.post { handleClientDisconnect(reason) } },
        )
        control = client
        client.start()
    }

    private fun handleClientDisconnect(reason: String?) {
        val target = lastTarget
        if (userDisconnected || target == null || reconnectAttempts >= 5) {
            resetSession(if (userDisconnected) null else (reason ?: "연결이 끊어졌어요"))
            return
        }
        desiredOutput = desiredOutput ?: BridgeState.myOutput.value
        stopStreamsQuiet()
        control = null
        BridgeState.myOutput.value = null
        BridgeState.peerOutput.value = null
        BridgeState.conn.value = ConnState.CONNECTING
        reconnectAttempts++
        BridgeState.notify("연결이 끊어져 다시 연결하고 있어요 ($reconnectAttempts/5)")
        main.postDelayed({
            if (!userDisconnected && BridgeState.conn.value == ConnState.CONNECTING) {
                doConnect(target.first, target.second)
            }
        }, 3000)
    }

    fun disconnect() {
        userDisconnected = true
        val c = control
        control = null
        scope.launch {
            c?.close()
            server?.closeSession()
        }
        resetSession(null)
    }

    private fun resetSession(message: String?) {
        stopStreamsQuiet()
        control = null
        awaitingTcpListen = false
        pendingSend = null
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
        scope.launch {
            server?.stopPlaying()
            p?.stop()
            s?.stop()
            runCatching { proj?.stop() }
        }
    }

    // ---------- 역할 선택 ----------

    /** where: "me"(이 기기에서 소리), "peer"(상대 기기에서 소리), null(정지) */
    fun chooseOutput(where: String?) {
        if (BridgeState.conn.value != ConnState.CONNECTED) return
        BridgeState.myOutput.value = where
        if (BridgeState.peerKind.value == "pc" && where != null) {
            prefs().edit().putString("outputChoice", where).apply()
        }
        sendRole()
        evaluateRoles()
    }

    private fun sendRole() {
        val raw = when (BridgeState.myOutput.value) {
            "me" -> "self"
            "peer" -> "other"
            else -> "none"
        }
        val msg = JSONObject().put("type", "role").put("output", raw)
        control?.send(msg) ?: server?.let { scope.launch { it.sendToPeer(msg) } }
    }

    /** 상대 프레임("self"=상대 기기에서 소리)을 내 프레임으로 변환 */
    private fun normalizePeerRole(raw: String): String? = when (raw) {
        "self" -> "peer"
        "other" -> "me"
        else -> null
    }

    private fun evaluateRoles() {
        if (BridgeState.conn.value != ConnState.CONNECTED) return
        val my = BridgeState.myOutput.value
        val peerWants = if (BridgeState.peerKind.value == "pc") my else BridgeState.peerOutput.value
        val listen = my == "me" && peerWants == "me"
        val send = my == "peer" && peerWants == "peer"

        if (!listen) stopListening()
        if (!send) stopSending(tellPeer = true)

        if (listen) startListening()
        if (send && !BridgeState.isServerSession.value) startClientSending()
        // 서버 세션의 송신은 상대(클라이언트)가 modeA start를 보내면 시작된다
    }

    // ---------- 이 기기에서 듣기 ----------

    private fun startListening() {
        if (BridgeState.isServerSession.value) return // 상대가 modeB로 보내오면 ControlServer가 재생
        if (player != null) return
        val c = control ?: return
        val tcp = BridgeState.transportTcp.value
        val p = newPlayer()
        player = p
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
        if (BridgeState.isServerSession.value) {
            scope.launch { server?.stopPlaying() }
            return
        }
        val p = player ?: return
        player = null
        awaitingTcpListen = false
        control?.send(JSONObject().put("type", "modeA").put("action", "stop"))
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
            sendRole()
        }
    }

    private fun newPlayer() = ModeAPlayer(
        bufferMsProvider = { BridgeState.bufferMs.value },
        onStats = { _, level, _ -> BridgeState.level.value = level },
        onError = { msg ->
            BridgeState.notify(msg)
            main.post { failListening() }
        },
    )

    // ---------- 이 기기 소리 보내기 ----------

    private fun startClientSending() {
        if (BridgeState.sending.value || BridgeState.sendPending.value) return
        pendingSend = SendReason.CLIENT
        BridgeState.sendPending.value = true
        BridgeState.sendSetup.tryEmit(Unit) // UI가 권한·동의 처리 후 requestSendMic/Projection 호출
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
                        .put("message", "이 방향에서는 '안정' 방식이 지원되지 않아요 — '빠름'으로 바꿔 주세요")
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
        if (BridgeState.myOutput.value == "peer") {
            BridgeState.myOutput.value = null
            sendRole()
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

    /** UI: 마이크 소스로 진행 (RECORD_AUDIO 허용됨) */
    fun requestSendMic() {
        startService(BridgeService.ACTION_MIC)
    }

    /** UI: 화면 녹화 동의 결과로 진행 */
    fun requestSendProjection(resultCode: Int, data: Intent) {
        val intent = serviceIntent(BridgeService.ACTION_PROJECTION)
            .putExtra(BridgeService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(BridgeService.EXTRA_RESULT_DATA, data)
        runCatching { app.startForegroundService(intent) }
    }

    /** BridgeService: 마이크 타입 포그라운드 승격 완료 */
    fun onServiceMicReady() {
        main.post { proceedSend() }
    }

    /** BridgeService: MediaProjection 생성 완료 */
    fun onProjectionReady(proj: MediaProjection?) {
        if (proj == null) {
            main.post { cancelSend("화면 녹화 권한이 거부되었어요 — 마이크로는 보낼 수 있어요") }
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
                val ch = if (BridgeState.bSource.value == CaptureSource.INTERNAL) 2 else 1
                val c = control ?: run { cancelSend(null); return }
                c.send(
                    JSONObject().put("type", "modeB").put("action", "start")
                        .put("sampleRate", Protocol.SAMPLE_RATE).put("channels", ch)
                        .put("codec", Protocol.CODEC_PCM16)
                        .put("transport", if (BridgeState.transportTcp.value) "tcp" else "udp")
                )
            }
            SendReason.SERVER -> {
                val host = BridgeState.peerHost.value ?: run { cancelSend(null); return }
                scope.launch { startSender(host, serverSendPort, tcp = false) }
            }
            null -> {}
        }
    }

    private fun startSender(host: String, port: Int, tcp: Boolean) {
        val s = ModeBSender(
            host = host, port = port, useTcp = tcp,
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
            }
        } else {
            main.post { cancelSend(null) }
        }
    }

    private fun stopSending(tellPeer: Boolean) {
        if (sender == null && !BridgeState.sendPending.value && pendingSend == null) return
        val s = sender; sender = null
        val proj = projection; projection = null
        val wasClient = !BridgeState.isServerSession.value
        pendingSend = null
        scope.launch {
            s?.stop()
            runCatching { proj?.stop() }
        }
        if (tellPeer && wasClient && s != null) {
            control?.send(JSONObject().put("type", "modeB").put("action", "stop"))
        }
        BridgeState.sending.value = false
        BridgeState.sendPending.value = false
        BridgeState.level.value = 0f
    }

    private fun stopSendingAndClear() {
        stopSending(tellPeer = true)
        if (BridgeState.myOutput.value == "peer") {
            BridgeState.myOutput.value = null
            sendRole()
        }
    }

    // ---------- 컨트롤 메시지 (클라이언트, 리더 스레드에서 호출) ----------

    private fun onCtlMessage(obj: JSONObject) {
        when (obj.optString("type")) {
            "role" -> main.post {
                BridgeState.peerOutput.value = normalizePeerRole(obj.optString("output", "none"))
                evaluateRoles()
            }
            "modeA" -> when (obj.optString("status")) {
                "ok" -> if (awaitingTcpListen) {
                    awaitingTcpListen = false
                    val host = control?.host ?: return
                    val port = obj.optInt("tcpPort", -1)
                    val p = player ?: return
                    scope.launch {
                        if (port !in 1..65535 || !p.startTcp(host, port)) {
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
                "ok" -> {
                    if (pendingSend != SendReason.CLIENT) return
                    val tcp = BridgeState.transportTcp.value
                    val port = obj.optInt(if (tcp) "tcpPort" else "udpPort", -1)
                    val host = control?.host
                    if (port !in 1..65535 || host == null) {
                        main.post { cancelSend("상대 응답이 올바르지 않아요") }
                        return
                    }
                    scope.launch { startSender(host, port, tcp) }
                }
                "error" -> main.post {
                    cancelSend(obj.optString("message", "보내기를 시작할 수 없어요"))
                }
            }
            "error" -> BridgeState.notify(obj.optString("message", "오류"))
        }
    }

    // ---------- 서비스 ----------

    private fun serviceIntent(action: String) =
        Intent(app, BridgeService::class.java).setAction(action)

    private fun startService(action: String) {
        runCatching { app.startForegroundService(serviceIntent(action)) }
    }
}
