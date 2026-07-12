package app.audiobridge.net

import android.os.SystemClock
import app.audiobridge.audio.ModeAPlayer
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

/**
 * 수신(서버) 측 컨트롤 채널 (PROTOCOL.md §2) — 폰이 PC companion처럼 연결을 받는다.
 * 앱이 켜져 있는 동안 상시 대기하며, 프로토콜 처리만 담당하고 정책은 [Callbacks]로 위임한다.
 * 동시에 한 세션만 허용, 사용 중이면 새 접속을 정중히 거절한다.
 */
class ControlServer(
    private val nameProvider: () -> String,
    private val port: Int,
    private val audioPort: Int,
    private val bufferMsProvider: () -> Int,
    private val callbacks: Callbacks,
) {
    interface Callbacks {
        /** 이미 다른 연결을 사용 중인가 (신규 접속 거절 기준) */
        fun isBusy(): Boolean
        fun onPeerConnected(name: String, host: String)
        fun onPeerClosed()
        /** 상대의 역할 선택 원문("self"/"other"/"none") */
        fun onPeerRole(rawOutput: String)
        /** 상대가 "내(서버) 소리를 보내 달라"고 요청 — 응답은 엔진이 sendToPeer로 */
        fun onModeAStart(udpPort: Int, tcp: Boolean)
        fun onModeAStop()
        /** 상대가 보내는 소리를 이 기기에서 재생해도 되는가 (사용자 동의 일치 여부) */
        fun canPlay(): Boolean
        fun onPlaying(playing: Boolean)
        fun onLevel(level: Float)
        fun onError(msg: String)
    }

    private var serverSocket: ServerSocket? = null
    @Volatile private var running = false
    @Volatile private var session: Session? = null

    fun start(): Boolean {
        val s = try {
            ServerSocket(port)
        } catch (_: Exception) {
            return false
        }
        serverSocket = s
        running = true
        thread(name = "ab-srv-accept") {
            while (running) {
                val client = try {
                    s.accept()
                } catch (_: Exception) {
                    return@thread
                }
                if (callbacks.isBusy()) {
                    runCatching {
                        val w = BufferedWriter(OutputStreamWriter(client.getOutputStream(), Charsets.UTF_8))
                        w.write(
                            JSONObject().put("type", "error")
                                .put("message", "상대 기기가 이미 다른 연결을 사용 중이에요").toString()
                        )
                        w.write("\n")
                        w.flush()
                        client.close()
                    }
                    continue
                }
                session?.close()
                session = Session(client).also { it.start() }
            }
        }
        return true
    }

    fun stop() {
        running = false
        session?.close()
        session = null
        runCatching { serverSocket?.close() }
        serverSocket = null
    }

    fun sendToPeer(obj: JSONObject): Boolean = session?.send(obj) ?: false

    fun stopPlaying() {
        session?.stopPlayer()
    }

    fun closeSession() {
        session?.close()
    }

    private inner class Session(private val socket: Socket) {
        @Volatile private var closed = false
        @Volatile private var lastPong = SystemClock.elapsedRealtime()
        @Volatile private var helloDone = false
        private var writer: BufferedWriter? = null
        private var player: ModeAPlayer? = null

        fun start() {
            thread(name = "ab-srv-read") { readLoop() }
        }

        private fun readLoop() {
            try {
                socket.tcpNoDelay = true
                socket.soTimeout = 20000
                writer = BufferedWriter(OutputStreamWriter(socket.getOutputStream(), Charsets.UTF_8))
                val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
                startPing()
                while (!closed) {
                    val line = reader.readLine() ?: break
                    if (line.length > 4096) break
                    val obj = runCatching { JSONObject(line) }.getOrNull() ?: continue
                    handle(obj)
                }
            } catch (_: Exception) {
                // 연결 끊김
            }
            close()
        }

        private fun handle(m: JSONObject) {
            when (m.optString("type")) {
                "hello" -> {
                    if (m.optInt("version", -1) != Protocol.VERSION) {
                        send(JSONObject().put("type", "error").put("message", "앱 버전이 서로 달라요 — 업데이트해 주세요"))
                        close()
                        return
                    }
                    send(
                        JSONObject().put("type", "hello").put("name", nameProvider())
                            .put("version", Protocol.VERSION).put("kind", "phone")
                    )
                    helloDone = true
                    callbacks.onPeerConnected(
                        m.optString("name", "기기").take(40),
                        socket.inetAddress.hostAddress ?: "",
                    )
                }
                "ping" -> send(JSONObject().put("type", "pong"))
                "pong" -> lastPong = SystemClock.elapsedRealtime()
                "bye" -> close()
                "role" -> callbacks.onPeerRole(m.optString("output", "none"))
                "modeA" -> when (m.optString("action")) {
                    "start" -> callbacks.onModeAStart(
                        m.optInt("udpPort", Protocol.DEFAULT_MODE_A_PORT),
                        m.optString("transport", "udp") == "tcp",
                    )
                    "stop" -> {
                        send(JSONObject().put("type", "modeA").put("status", "ok"))
                        callbacks.onModeAStop()
                    }
                }
                "modeB" -> handleModeB(m)
            }
        }

        private fun handleModeB(m: JSONObject) {
            if (m.optString("action") == "stop") {
                stopPlayer()
                send(JSONObject().put("type", "modeB").put("status", "ok"))
                return
            }
            if (m.optString("action") != "start") return
            if (m.optInt("codec", 0) != Protocol.CODEC_PCM16) {
                send(
                    JSONObject().put("type", "modeB").put("status", "error")
                        .put("message", "지원하지 않는 오디오 형식이에요")
                )
                return
            }
            if (!callbacks.canPlay()) {
                send(
                    JSONObject().put("type", "modeB").put("status", "error")
                        .put("message", "상대 기기에서 아직 '상대 기기'를 선택하지 않았어요")
                )
                return
            }
            val tcp = m.optString("transport", "udp") == "tcp"
            val peerHost = socket.inetAddress.hostAddress ?: return
            player?.stop()
            val p = ModeAPlayer(
                bufferMsProvider = bufferMsProvider,
                onStats = { _, level, _ -> callbacks.onLevel(level) },
                onError = { msg -> callbacks.onError(msg) },
            )
            val ok = if (tcp) p.startTcpServer(audioPort, peerHost) else p.startUdp(audioPort, peerHost)
            if (!ok) {
                send(
                    JSONObject().put("type", "modeB").put("status", "error")
                        .put("message", "소리 받을 통로를 열 수 없어요")
                )
                return
            }
            player = p
            send(
                JSONObject().put("type", "modeB").put("status", "ok")
                    .put(if (tcp) "tcpPort" else "udpPort", audioPort)
            )
            callbacks.onPlaying(true)
        }

        fun stopPlayer() {
            val p = player
            player = null
            p?.stop()
            if (p != null) callbacks.onPlaying(false)
        }

        private fun startPing() {
            thread(name = "ab-srv-ping") {
                while (!closed) {
                    try {
                        Thread.sleep(5000)
                    } catch (_: InterruptedException) {
                        return@thread
                    }
                    if (closed) return@thread
                    send(JSONObject().put("type", "ping"))
                    if (SystemClock.elapsedRealtime() - lastPong > 15000) {
                        close()
                        return@thread
                    }
                }
            }
        }

        @Synchronized
        fun send(obj: JSONObject): Boolean {
            if (closed) return false
            return try {
                writer?.let {
                    it.write(obj.toString())
                    it.write("\n")
                    it.flush()
                    true
                } ?: false
            } catch (_: Exception) {
                close()
                false
            }
        }

        fun close() {
            if (closed) return
            closed = true
            stopPlayer()
            runCatching { socket.close() }
            if (session === this) {
                session = null
                if (helloDone) callbacks.onPeerClosed()
            }
        }
    }
}
