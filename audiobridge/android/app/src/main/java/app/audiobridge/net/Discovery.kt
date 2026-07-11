package app.audiobridge.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

data class Peer(val name: String, val host: String, val ctlPort: Int)

/** UDP 브로드캐스트로 같은 LAN의 PC companion을 찾는다 (PROTOCOL.md §1). */
object Discovery {
    private const val QUERY = "ABDISC?"
    private const val PREFIX = "ABDISC!"

    suspend fun discover(timeoutMs: Long = 2200): List<Peer> = withContext(Dispatchers.IO) {
        val peers = LinkedHashMap<String, Peer>()
        runCatching {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 250
                val query = QUERY.toByteArray(Charsets.US_ASCII)
                val targets = broadcastAddresses()
                val deadline = System.currentTimeMillis() + timeoutMs
                var lastSend = 0L
                val buf = ByteArray(1024)
                while (System.currentTimeMillis() < deadline) {
                    val now = System.currentTimeMillis()
                    if (now - lastSend > 900) {
                        lastSend = now
                        for (t in targets) runCatching {
                            socket.send(DatagramPacket(query, query.size, t, Protocol.DISCOVERY_PORT))
                        }
                    }
                    val pkt = DatagramPacket(buf, buf.size)
                    try {
                        socket.receive(pkt)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    val text = String(pkt.data, 0, pkt.length, Charsets.UTF_8)
                    if (!text.startsWith(PREFIX)) continue
                    val obj = runCatching { JSONObject(text.substring(PREFIX.length)) }.getOrNull() ?: continue
                    val host = pkt.address.hostAddress ?: continue
                    val port = obj.optInt("ctlPort", Protocol.DEFAULT_CTL_PORT)
                    if (port !in 1..65535) continue
                    peers[host] = Peer(obj.optString("name", host).take(40), host, port)
                }
            }
        }
        peers.values.toList()
    }

    private fun broadcastAddresses(): List<InetAddress> {
        val result = mutableListOf<InetAddress>()
        runCatching { result.add(InetAddress.getByName("255.255.255.255")) }
        runCatching {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) ia.broadcast?.let { result.add(it) }
            }
        }
        return result.distinct()
    }
}
