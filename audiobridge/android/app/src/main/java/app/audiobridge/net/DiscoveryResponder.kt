package app.audiobridge.net

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import kotlin.concurrent.thread

/**
 * 디스커버리 응답기 (PROTOCOL.md §1) — 앱이 켜져 있는 동안 이 폰을 찾을 수 있게 한다.
 * 정확한 "ABDISC?" 질의에만, 질의를 보낸 주소로만 응답한다.
 * 이름은 매 응답 시점에 [nameProvider]에서 읽으므로 이름 변경이 즉시 반영된다.
 */
class DiscoveryResponder(private val nameProvider: () -> String, private val ctlPort: Int) {
    private var socket: DatagramSocket? = null
    @Volatile private var running = false

    fun start(): Boolean {
        val s = try {
            DatagramSocket(Protocol.DISCOVERY_PORT)
        } catch (_: Exception) {
            return false
        }
        socket = s
        running = true
        thread(name = "ab-disc-resp") {
            val buf = ByteArray(64)
            while (running) {
                try {
                    val pkt = DatagramPacket(buf, buf.size)
                    s.receive(pkt)
                    if (pkt.length == 7 && String(pkt.data, 0, 7, Charsets.US_ASCII) == "ABDISC?") {
                        val reply = ("ABDISC!" + JSONObject()
                            .put("name", nameProvider())
                            .put("version", Protocol.VERSION)
                            .put("ctlPort", ctlPort)
                            .toString()).toByteArray(Charsets.UTF_8)
                        s.send(DatagramPacket(reply, reply.size, pkt.address, pkt.port))
                    }
                } catch (_: Exception) {
                    if (!running) return@thread
                }
            }
        }
        return true
    }

    fun stop() {
        running = false
        runCatching { socket?.close() }
        socket = null
    }
}
