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
import app.audiobridge.net.Discovery
import app.audiobridge.net.Protocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * 앱 전체 오케스트레이터. UI(MainActivity)와 BridgeService가 함께 사용한다.
 * 공개 메서드는 메인 스레드에서 불려도 안전하다 — 소켓 작업은 IO 스코프/전용 스레드로 넘긴다.
 */
object BridgeEngine {
    private lateinit var app: Context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())

    private var control: ControlClient? = null
    private var playerA: ModeAPlayer? = null
    private var senderB: ModeBSender? = null
    private var projection: MediaProjection? = null
    @Volatile private var awaitingTcpA = false

    fun init(context: Context) {
        if (::app.isInitialized) return
        app = context.applicationContext
        val prefs = app.getSharedPreferences("settings", Context.MODE_PRIVATE)
        BridgeState.bufferMs.value = prefs.getInt("bufferMs", 60)
        BridgeState.transportTcp.value = prefs.getBoolean("tcp", false)
        BridgeState.modeAPort.value = prefs.getInt("modeAPort", Protocol.DEFAULT_MODE_A_PORT)
        BridgeState.bSource.value =
            if (prefs.getString("bSource", "MIC") == "INTERNAL") CaptureSource.INTERNAL else CaptureSource.MIC
    }

    private fun prefs() = app.getSharedPreferences("settings", Context.MODE_PRIVATE)

    fun setBufferMs(ms: Int) {
        BridgeState.bufferMs.value = ms.coerceIn(20, 500)
        prefs().edit().putInt("bufferMs", BridgeState.bufferMs.value).apply()
    }

    fun setTransportTcp(tcp: Boolean) {
        if (BridgeState.modeA.value || BridgeState.modeB.value || BridgeState.modeBPending.value) {
            BridgeState.notify("전송 방식은 모드 A/B를 끈 상태에서 바꿀 수 있습니다")
            return
        }
        BridgeState.transportTcp.value = tcp
        prefs().edit().putBoolean("tcp", tcp).apply()
    }

    fun setModeAPort(port: Int) {
        if (port !in 1024..65535) {
            BridgeState.notify("포트는 1024~65535 사이여야 합니다")
            return
        }
        BridgeState.modeAPort.value = port
        prefs().edit().putInt("modeAPort", port).apply()
    }

    fun setBSource(source: CaptureSource) {
        BridgeState.bSource.value = source
        prefs().edit().putString("bSource", source.name).apply()
    }

    fun lastHost(): String = prefs().getString("lastHost", "") ?: ""

    // ---------- 검색/연결 ----------

    fun discover() {
        if (BridgeState.discovering.value) return
        scope.launch {
            BridgeState.discovering.value = true
            try {
                val found = Discovery.discover()
                BridgeState.peers.value = found
                if (found.isEmpty()) {
                    BridgeState.notify("PC를 찾지 못했습니다 — PC에서 AudioBridgeWin이 실행 중인지, 같은 Wi-Fi인지 확인하세요")
                }
            } finally {
                BridgeState.discovering.value = false
            }
        }
    }

    fun connect(host: String, port: Int) {
        val old = control
        control = null
        scope.launch { old?.close() }
        stopStreamsAsync()
        BridgeState.conn.value = ConnState.CONNECTING
        prefs().edit().putString("lastHost", if (port == Protocol.DEFAULT_CTL_PORT) host else "$host:$port").apply()
        val name = (Build.MODEL ?: "Android").take(30)
        val client = ControlClient(
            host = host, port = port, phoneName = name,
            onMessage = ::onCtlMessage,
            onConnected = { peer ->
                BridgeState.conn.value = ConnState.CONNECTED
                BridgeState.peerName.value = peer
                BridgeState.peerHost.value = host
                startService(BridgeService.ACTION_FOREGROUND)
            },
            onDisconnected = { reason ->
                main.post { teardown(reason ?: "연결이 끊어졌습니다") }
            },
        )
        control = client
        client.start()
    }

    fun disconnect() {
        val c = control
        control = null
        scope.launch { c?.close() }
        teardown(null)
    }

    private fun stopStreamsAsync() {
        val pa = playerA; playerA = null
        val sb = senderB; senderB = null
        val proj = projection; projection = null
        awaitingTcpA = false
        scope.launch {
            pa?.stop()
            sb?.stop()
            runCatching { proj?.stop() }
        }
    }

    private fun teardown(message: String?) {
        stopStreamsAsync()
        control = null
        BridgeState.modeA.value = false
        BridgeState.modeB.value = false
        BridgeState.modeBPending.value = false
        BridgeState.conn.value = ConnState.DISCONNECTED
        BridgeState.peerName.value = null
        BridgeState.peerHost.value = null
        BridgeState.stats.value = Stats()
        if (::app.isInitialized) {
            runCatching { app.startService(serviceIntent(BridgeService.ACTION_STOP)) }
        }
        message?.let { BridgeState.notify(it) }
    }

    // ---------- 모드 A ----------

    fun toggleModeA(on: Boolean) {
        if (on) {
            val c = control
            if (c == null || BridgeState.conn.value != ConnState.CONNECTED) {
                BridgeState.notify("먼저 PC와 연결하세요")
                return
            }
            if (playerA != null) return
            BridgeState.modeA.value = true
            val tcp = BridgeState.transportTcp.value
            val player = newPlayerA()
            playerA = player
            scope.launch {
                if (!tcp) {
                    if (!player.startUdp(BridgeState.modeAPort.value, c.host)) {
                        main.post { if (BridgeState.modeA.value) toggleModeA(false) }
                        return@launch
                    }
                } else {
                    awaitingTcpA = true
                }
                c.send(
                    JSONObject().put("type", "modeA").put("action", "start")
                        .put("udpPort", BridgeState.modeAPort.value)
                        .put("sampleRate", Protocol.SAMPLE_RATE).put("channels", 2)
                        .put("codec", Protocol.CODEC_PCM16)
                        .put("transport", if (tcp) "tcp" else "udp")
                )
            }
        } else {
            control?.send(JSONObject().put("type", "modeA").put("action", "stop"))
            val pa = playerA; playerA = null
            awaitingTcpA = false
            scope.launch { pa?.stop() }
            BridgeState.modeA.value = false
            BridgeState.stats.value = BridgeState.stats.value.copy(levelA = 0f, bufferedMs = 0)
        }
    }

    private fun newPlayerA() = ModeAPlayer(
        bufferMsProvider = { BridgeState.bufferMs.value },
        onStats = { loss, level, buffered ->
            BridgeState.stats.value =
                BridgeState.stats.value.copy(lossPct = loss, levelA = level, bufferedMs = buffered)
        },
        onError = { msg ->
            BridgeState.notify(msg)
            main.post { if (BridgeState.modeA.value) toggleModeA(false) }
        },
    )

    // ---------- 모드 B ----------

    /** UI에서 RECORD_AUDIO 권한 확인 후 호출 (마이크 소스). */
    fun requestModeBMic() {
        if (!ensureConnected()) return
        BridgeState.modeBPending.value = true
        startService(BridgeService.ACTION_MIC)
    }

    /** UI에서 MediaProjection 동의 후 호출 (내부 소리 소스). */
    fun requestModeBProjection(resultCode: Int, data: Intent) {
        if (!ensureConnected()) return
        BridgeState.modeBPending.value = true
        val intent = serviceIntent(BridgeService.ACTION_PROJECTION)
            .putExtra(BridgeService.EXTRA_RESULT_CODE, resultCode)
            .putExtra(BridgeService.EXTRA_RESULT_DATA, data)
        runCatching { app.startForegroundService(intent) }
    }

    /** BridgeService가 마이크 타입 포그라운드 승격 후 호출. */
    fun onServiceMicReady() {
        sendModeBStart(1)
    }

    /** BridgeService가 MediaProjection 생성 후 호출. */
    fun onProjectionReady(proj: MediaProjection?) {
        if (proj == null) {
            BridgeState.modeBPending.value = false
            BridgeState.notify("내부 소리 캡처 권한이 거부되었습니다 — 마이크 소스를 사용해 보세요")
            return
        }
        projection = proj
        proj.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                main.post { if (BridgeState.modeB.value || BridgeState.modeBPending.value) toggleModeBOff() }
            }
        }, main)
        sendModeBStart(2)
    }

    private fun sendModeBStart(channels: Int) {
        val c = control ?: run { BridgeState.modeBPending.value = false; return }
        val ok = c.send(
            JSONObject().put("type", "modeB").put("action", "start")
                .put("sampleRate", Protocol.SAMPLE_RATE).put("channels", channels)
                .put("codec", Protocol.CODEC_PCM16)
                .put("transport", if (BridgeState.transportTcp.value) "tcp" else "udp")
        )
        if (!ok) {
            BridgeState.modeBPending.value = false
            BridgeState.notify("PC에 요청을 보내지 못했습니다")
        }
    }

    fun toggleModeBOff() {
        control?.send(JSONObject().put("type", "modeB").put("action", "stop"))
        val sb = senderB; senderB = null
        val proj = projection; projection = null
        scope.launch {
            sb?.stop()
            runCatching { proj?.stop() }
        }
        BridgeState.modeB.value = false
        BridgeState.modeBPending.value = false
        BridgeState.stats.value = BridgeState.stats.value.copy(levelB = 0f)
    }

    private fun ensureConnected(): Boolean {
        if (control == null || BridgeState.conn.value != ConnState.CONNECTED) {
            BridgeState.notify("먼저 PC와 연결하세요")
            return false
        }
        return true
    }

    // ---------- 컨트롤 메시지 처리 (ControlClient 리더 스레드에서 호출) ----------

    private fun onCtlMessage(obj: JSONObject) {
        when (obj.optString("type")) {
            "modeA" -> when (obj.optString("status")) {
                "ok" -> if (awaitingTcpA) {
                    awaitingTcpA = false
                    val host = control?.host ?: return
                    val port = obj.optInt("tcpPort", -1)
                    val player = playerA ?: return
                    scope.launch {
                        if (port !in 1..65535 || !player.startTcp(host, port)) {
                            BridgeState.notify("TCP 오디오 스트림을 열 수 없습니다")
                            main.post { if (BridgeState.modeA.value) toggleModeA(false) }
                        }
                    }
                }
                "error" -> {
                    BridgeState.notify("PC: " + obj.optString("message", "모드 A 시작 실패"))
                    main.post { if (BridgeState.modeA.value) toggleModeA(false) }
                }
            }
            "modeB" -> when (obj.optString("status")) {
                "ok" -> {
                    if (BridgeState.modeB.value || !BridgeState.modeBPending.value) return
                    val tcp = BridgeState.transportTcp.value
                    val port = obj.optInt(if (tcp) "tcpPort" else "udpPort", -1)
                    val host = control?.host
                    if (port !in 1..65535 || host == null) {
                        BridgeState.modeBPending.value = false
                        BridgeState.notify("PC 응답이 올바르지 않습니다")
                        return
                    }
                    scope.launch { startSenderB(host, port, tcp) }
                }
                "error" -> {
                    BridgeState.modeBPending.value = false
                    BridgeState.notify("PC: " + obj.optString("message", "모드 B 시작 실패"))
                }
            }
            "error" -> BridgeState.notify("PC: " + obj.optString("message", "오류"))
        }
    }

    private fun startSenderB(host: String, port: Int, tcp: Boolean) {
        val sender = ModeBSender(
            host = host, port = port, useTcp = tcp,
            source = BridgeState.bSource.value,
            projection = projection,
            onLevel = { level ->
                BridgeState.stats.value = BridgeState.stats.value.copy(levelB = level)
            },
            onError = { msg ->
                BridgeState.notify(msg)
                main.post { if (BridgeState.modeB.value || BridgeState.modeBPending.value) toggleModeBOff() }
            },
        )
        if (sender.start()) {
            senderB = sender
            BridgeState.modeB.value = true
            BridgeState.modeBPending.value = false
        } else {
            BridgeState.modeBPending.value = false
            control?.send(JSONObject().put("type", "modeB").put("action", "stop"))
        }
    }

    // ---------- 서비스 ----------

    private fun serviceIntent(action: String) =
        Intent(app, BridgeService::class.java).setAction(action)

    private fun startService(action: String) {
        runCatching { app.startForegroundService(serviceIntent(action)) }
    }
}
