package app.audiobridge.audio

import app.audiobridge.net.PacketInfo
import app.audiobridge.net.Protocol

class StreamFormat(val sampleRate: Int, val channels: Int) {
    val bytesPerMs: Int get() = Protocol.bytesPerMs(sampleRate, channels)
}

/**
 * 수신 지터 버퍼 (PROTOCOL.md §3~4).
 * 손실 패킷은 무음으로 채우고, 과거 시퀀스는 버린다. 손실률 통계 제공.
 */
class JitterBuffer {
    @Volatile var format: StreamFormat? = null
        private set

    private val lock = Any()
    private val queue = ArrayDeque<ByteArray>()
    private var bytes = 0
    private var expectedSeq: Long = -1
    private var received = 0L
    private var lost = 0L

    fun push(info: PacketInfo, payload: ByteArray) {
        if (format == null) format = StreamFormat(info.sampleRate, info.channels)
        synchronized(lock) {
            if (info.flags and Protocol.FLAG_FIRST != 0) expectedSeq = -1
            if (expectedSeq >= 0) {
                val diff = info.seq - expectedSeq.toInt() // Int 뺄셈으로 랩어라운드 처리
                if (diff < 0) return // 과거/중복 패킷
                if (diff > 0) {
                    lost += diff
                    val fill = minOf(diff, 40)
                    repeat(fill) {
                        queue.addLast(ByteArray(payload.size))
                        bytes += payload.size
                    }
                }
            }
            expectedSeq = (info.seq + 1).toLong() and 0xFFFFFFFFL
            queue.addLast(payload)
            bytes += payload.size
            received++
            // 오버런 가드: 2초치 초과 시 오래된 것부터 폐기
            val cap = (format?.bytesPerMs ?: 192) * 2000
            while (bytes > cap && queue.isNotEmpty()) {
                bytes -= queue.removeFirst().size
            }
        }
    }

    fun poll(): ByteArray? = synchronized(lock) {
        val f = queue.removeFirstOrNull() ?: return null
        bytes -= f.size
        f
    }

    fun bufferedBytes(): Int = synchronized(lock) { bytes }

    fun lossPercent(): Double = synchronized(lock) {
        val total = received + lost
        if (total == 0L) 0.0 else lost * 100.0 / total
    }

    fun clear() = synchronized(lock) {
        queue.clear()
        bytes = 0
        expectedSeq = -1
    }
}
