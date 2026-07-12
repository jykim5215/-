package app.audiobridge.audio

import app.audiobridge.net.PacketInfo
import app.audiobridge.net.Protocol

class StreamFormat(val sampleRate: Int, val channels: Int) {
    val bytesPerMs: Int get() = Protocol.bytesPerMs(sampleRate, channels)
}

class TimedFrame(val tsUs: Long, val data: ByteArray)

/**
 * 타임스탬프 보존 수신 버퍼 (PROTOCOL.md §3~4).
 * 손실 패킷은 타임스탬프를 외삽한 무음으로 채우고, 과거 시퀀스는 버린다.
 */
class JitterBuffer {
    @Volatile var format: StreamFormat? = null
        private set

    private val lock = Any()
    private val queue = ArrayDeque<TimedFrame>()
    private var bytes = 0
    private var expectedSeq: Long = -1
    private var received = 0L
    private var lost = 0L

    fun push(info: PacketInfo, payload: ByteArray) {
        val fmt = format ?: StreamFormat(info.sampleRate, info.channels).also { format = it }
        val frameDurUs = payload.size * 1000L / fmt.bytesPerMs
        synchronized(lock) {
            if (info.flags and Protocol.FLAG_FIRST != 0) expectedSeq = -1
            if (expectedSeq >= 0) {
                val diff = info.seq - expectedSeq.toInt() // Int 뺄셈으로 랩어라운드 처리
                if (diff < 0) return // 과거/중복 패킷
                if (diff > 0) {
                    lost += diff
                    val fill = minOf(diff, 40)
                    for (i in fill downTo 1) {
                        queue.addLast(TimedFrame(info.timestampUs - frameDurUs * i, ByteArray(payload.size)))
                        bytes += payload.size
                    }
                }
            }
            expectedSeq = (info.seq + 1).toLong() and 0xFFFFFFFFL
            queue.addLast(TimedFrame(info.timestampUs, payload))
            bytes += payload.size
            received++
            // 오버런 가드: 2초치 초과 시 오래된 것부터 폐기
            val cap = fmt.bytesPerMs * 2000
            while (bytes > cap && queue.isNotEmpty()) {
                bytes -= queue.removeFirst().data.size
            }
        }
    }

    fun peek(): TimedFrame? = synchronized(lock) { queue.firstOrNull() }

    fun poll(): TimedFrame? = synchronized(lock) {
        val f = queue.removeFirstOrNull() ?: return null
        bytes -= f.data.size
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
