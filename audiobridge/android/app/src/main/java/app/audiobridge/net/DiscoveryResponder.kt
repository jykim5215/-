package app.audiobridge.net

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import kotlin.concurrent.thread

/**
 * 스피커 모드용 디스커버리 응답기 (PROTOCOL.md §1) — 폰이 PC처럼 검색에 응답한다.
 * 정확한 "ABDISC?" 질의에만, 질의를 보낸 주소로만 응답한다.
 */
class DiscoveryResponder(private val name: String, private val ctlPort: Int) {
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
            val reply = ("ABDISC!" + JSONObject()
                .put("name", name)
                .put("version", Protocol.VERSION)
                .put("ctlPort", ctlPort)
                .toString()).toByteArray(Charsets.UTF_8)
            val buf = ByteArray(64)
            while (running) {
                try {
                    val pkt = DatagramPacket(buf, buf.size)
                    s.receive(pkt)
                    if (pkt.length == 7 && String(pkt.data, 0, 7, Charsets.US_ASCII) == "ABDISC?") {
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
