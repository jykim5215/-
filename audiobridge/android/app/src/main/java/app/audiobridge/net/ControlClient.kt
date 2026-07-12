package app.audiobridge.net

import android.os.SystemClock
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import kotlin.concurrent.thread

/**
 * 컨트롤 채널 (TCP, JSON Lines — PROTOCOL.md §2). 폰이 클라이언트.
 * send()는 큐에 넣기만 하므로 어느 스레드에서든 호출 가능(메인 스레드 포함).
 * 콜백은 내부 스레드에서 호출된다.
 */
class ControlClient(
    val host: String,
    val port: Int,
    private val phoneName: String,
    private val onMessage: (JSONObject) -> Unit,
    private val onConnected: (peerName: String, peerKind: String) -> Unit,
    private val onDisconnected: (reason: String?) -> Unit,
) {
    @Volatile private var socket: Socket? = null
    @Volatile private var closed = false
    @Volatile private var lastPong = 0L
    private val sendQueue = LinkedBlockingQueue<JSONObject>()

    fun start() {
        thread(name = "ab-ctl-read") {
            try {
                val s = Socket()
                s.tcpNoDelay = true
                s.connect(InetSocketAddress(host, port), 4000)
                s.soTimeout = 20000
                socket = s
                val writer = BufferedWriter(OutputStreamWriter(s.getOutputStream(), Charsets.UTF_8))
                val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
                startWriter(writer)
                startPing()
                send(JSONObject().put("type", "hello").put("name", phoneName).put("version", Protocol.VERSION))
                lastPong = SystemClock.elapsedRealtime()
                var gotHello = false
                while (!closed) {
                    val line = reader.readLine() ?: break
                    if (line.length > 4096) break
                    val obj = runCatching { JSONObject(line) }.getOrNull() ?: continue
                    when (obj.optString("type")) {
                        "hello" -> {
                            if (obj.optInt("version", -1) != Protocol.VERSION) {
                                fail("프로토콜 버전이 다릅니다 (PC 프로그램을 업데이트하세요)")
                                return@thread
                            }
                            if (!gotHello) {
                                gotHello = true
                                onConnected(
                                    obj.optString("name", "PC").take(40),
                                    obj.optString("kind", "pc"),
                                )
                            }
                        }
                        "ping" -> send(JSONObject().put("type", "pong"))
                        "pong" -> lastPong = SystemClock.elapsedRealtime()
                        "bye" -> break
                        else -> onMessage(obj)
                    }
                }
                fail(null)
            } catch (e: Exception) {
                fail(e.message ?: "연결 실패")
            }
        }
    }

    private fun startWriter(writer: BufferedWriter) {
        thread(name = "ab-ctl-write") {
            try {
                while (!closed) {
                    val obj = sendQueue.take()
                    writer.write(obj.toString())
                    writer.write("\n")
                    writer.flush()
                }
            } catch (_: Exception) {
                fail("전송 실패")
            }
        }
    }

    private fun startPing() {
        thread(name = "ab-ctl-ping") {
            while (!closed) {
                try {
                    Thread.sleep(5000)
                } catch (_: InterruptedException) {
                    return@thread
                }
                if (closed) return@thread
                send(JSONObject().put("type", "ping"))
                if (SystemClock.elapsedRealtime() - lastPong > 15000) {
                    fail("PC 응답 없음 (네트워크 확인)")
                    return@thread
                }
            }
        }
    }

    /** 비차단 송신 — 큐에 적재만 한다. 연결이 이미 닫혔으면 false. */
    fun send(obj: JSONObject): Boolean {
        if (closed) return false
        sendQueue.offer(obj)
        return true
    }

    private fun fail(reason: String?) {
        if (closed) return
        closed = true
        wakeWriter()
        runCatching { socket?.close() }
        onDisconnected(reason)
    }

    /** 사용자가 직접 끊을 때 — onDisconnected 콜백 없이 정리. 비차단. */
    fun close() {
        if (closed) return
        sendQueue.offer(JSONObject().put("type", "bye"))
        thread(name = "ab-ctl-close") {
            Thread.sleep(150) // bye 전송 여유
            closed = true
            wakeWriter()
            runCatching { socket?.close() }
        }
    }

    private fun wakeWriter() {
        sendQueue.offer(JSONObject().put("type", "pong")) // take() 블로킹 해제용
    }
}
