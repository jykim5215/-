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
 * 스피커 모드용 컨트롤 서버 (PROTOCOL.md §2) — 폰이 PC companion처럼 동작한다.
 * 상대(폰/PC 클라이언트)가 보내는 오디오(modeB)를 받아 이 폰에서 재생한다.
 * modeA(이 폰의 내부 소리 송신)는 v1에서 미지원 — 명확한 오류로 응답.
 * 동시에 한 세션만 유지한다.
 */
class ControlServer(
    private val name: String,
    private val port: Int,
    private val audioPort: Int,
    private val bufferMsProvider: () -> Int,
    private val onStatus: (peer: String?, playing: Boolean) -> Unit,
    private val onLevel: (Float) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var server: ServerSocket? = null
    @Volatile private var running = false
    @Volatile private var session: Session? = null

    fun start(): Boolean {
        val s = try {
            ServerSocket(port)
        } catch (e: Exception) {
            onError("포트 $port 을(를) 사용할 수 없어 스피커 모드를 켤 수 없습니다")
            return false
        }
        server = s
        running = true
        thread(name = "ab-srv-accept") {
            while (running) {
                val client = try {
                    s.accept()
                } catch (_: Exception) {
                    return@thread
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
        runCatching { server?.close() }
        server = null
        onStatus(null, false)
    }

    private inner class Session(private val socket: Socket) {
        @Volatile private var closed = false
        @Volatile private var lastPong = SystemClock.elapsedRealtime()
        private var writer: BufferedWriter? = null
        private var player: ModeAPlayer? = null
        private var peerName = "기기"

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
                        send(JSONObject().put("type", "error").put("message", "프로토콜 버전이 다릅니다"))
                        close()
                        return
                    }
                    peerName = m.optString("name", "기기").take(40)
                    send(
                        JSONObject().put("type", "hello").put("name", name)
                            .put("version", Protocol.VERSION).put("kind", "phone")
                    )
                    onStatus(peerName, false)
                }
                "ping" -> send(JSONObject().put("type", "pong"))
                "pong" -> lastPong = SystemClock.elapsedRealtime()
                "bye" -> close()
                "modeA" -> if (m.optString("action") == "start") {
                    send(
                        JSONObject().put("type", "modeA").put("status", "error")
                            .put("message", "폰 스피커는 소리 받기 전용입니다 (이 방향은 PC 연결에서 사용)")
                    )
                } else {
                    send(JSONObject().put("type", "modeA").put("status", "ok"))
                }
                "modeB" -> handleModeB(m)
            }
        }

        private fun handleModeB(m: JSONObject) {
            if (m.optString("action") == "stop") {
                player?.stop(); player = null
                send(JSONObject().put("type", "modeB").put("status", "ok"))
                onStatus(peerName, false)
                return
            }
            if (m.optString("action") != "start") return
            if (m.optInt("codec", 0) != Protocol.CODEC_PCM16) {
                send(
                    JSONObject().put("type", "modeB").put("status", "error")
                        .put("message", "지원하지 않는 코덱입니다 (PCM16만 지원)")
                )
                return
            }
            val tcp = m.optString("transport", "udp") == "tcp"
            val peerHost = socket.inetAddress.hostAddress ?: return
            player?.stop()
            val p = ModeAPlayer(
                bufferMsProvider = bufferMsProvider,
                onStats = { _, level, _ -> onLevel(level) },
                onError = { msg -> onError(msg) },
            )
            val ok = if (tcp) p.startTcpServer(audioPort, peerHost) else p.startUdp(audioPort, peerHost)
            if (!ok) {
                send(
                    JSONObject().put("type", "modeB").put("status", "error")
                        .put("message", "오디오 수신 포트를 열 수 없습니다")
                )
                return
            }
            player = p
            send(
                JSONObject().put("type", "modeB").put("status", "ok")
                    .put(if (tcp) "tcpPort" else "udpPort", audioPort)
            )
            onStatus(peerName, true)
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
        private fun send(obj: JSONObject) {
            if (closed) return
            try {
                writer?.let {
                    it.write(obj.toString())
                    it.write("\n")
                    it.flush()
                }
            } catch (_: Exception) {
                close()
            }
        }

        fun close() {
            if (closed) return
            closed = true
            player?.stop(); player = null
            runCatching { socket.close() }
            if (session === this) onStatus(null, false)
        }
    }
}
