package app.audiobridge.net

/** PROTOCOL.md v1 — 오디오 패킷 헤더(24B, 빅엔디안)와 공용 상수. */
object Protocol {
    const val VERSION = 1
    const val HEADER_SIZE = 24
    const val CODEC_PCM16 = 0
    const val MAX_PAYLOAD = 1400
    const val FLAG_FIRST = 0x01

    const val DEFAULT_CTL_PORT = 48550
    const val DISCOVERY_PORT = 48551
    const val DEFAULT_MODE_A_PORT = 48552

    const val SAMPLE_RATE = 48000
    const val FRAME_MS = 5

    /** 모든 수신기가 공유하는 사용자 선택 재생 대기 시간. */
    const val MIN_PLAYOUT_DELAY_MS = 600
    const val MAX_PLAYOUT_DELAY_MS = 2000
    const val PLAYOUT_DELAY_STEP_MS = 200
    const val DEFAULT_PLAYOUT_DELAY_MS = MIN_PLAYOUT_DELAY_MS
    const val MAX_EXTRA_DELAY_MS = 300

    /** 범위 밖이거나 200ms 눈금 사이인 값을 가장 가까운 지원값으로 맞춘다. */
    fun normalizePlayoutDelayMs(value: Int): Int {
        val clamped = value.coerceIn(MIN_PLAYOUT_DELAY_MS, MAX_PLAYOUT_DELAY_MS)
        val stepIndex = (clamped - MIN_PLAYOUT_DELAY_MS + PLAYOUT_DELAY_STEP_MS / 2) /
            PLAYOUT_DELAY_STEP_MS
        return MIN_PLAYOUT_DELAY_MS + stepIndex * PLAYOUT_DELAY_STEP_MS
    }

    /** 음향 왕복 측정값에 출력/DSP 변동 여유 400ms를 더하고, 부족하지 않게 위 단계로 올린다. */
    fun recommendedPlayoutDelayMs(acousticOneWayMs: Int): Int {
        val desired = acousticOneWayMs.coerceAtLeast(0) + 400
        if (desired <= MIN_PLAYOUT_DELAY_MS) return MIN_PLAYOUT_DELAY_MS
        val stepIndex = (desired - MIN_PLAYOUT_DELAY_MS + PLAYOUT_DELAY_STEP_MS - 1) /
            PLAYOUT_DELAY_STEP_MS
        return (MIN_PLAYOUT_DELAY_MS + stepIndex * PLAYOUT_DELAY_STEP_MS)
            .coerceAtMost(MAX_PLAYOUT_DELAY_MS)
    }

    /** 5ms 프레임의 페이로드 바이트 수 (PCM16). */
    fun frameBytes(channels: Int): Int = SAMPLE_RATE / 1000 * FRAME_MS * 2 * channels

    fun bytesPerMs(sampleRate: Int, channels: Int): Int = sampleRate / 1000 * 2 * channels

    /**
     * [out]에 헤더+페이로드를 기록하고 전체 길이를 돌려준다.
     * out.size >= HEADER_SIZE + payloadLen 이어야 한다.
     */
    fun buildPacket(
        out: ByteArray, payload: ByteArray, payloadLen: Int, seq: Int,
        sampleRate: Int, channels: Int, flags: Int, timestampUs: Long,
    ): Int {
        out[0] = 0x41; out[1] = 0x42
        out[2] = VERSION.toByte()
        out[3] = CODEC_PCM16.toByte()
        out[4] = channels.toByte()
        out[5] = flags.toByte()
        out[6] = (payloadLen ushr 8).toByte(); out[7] = payloadLen.toByte()
        writeInt(out, 8, seq)
        writeInt(out, 12, sampleRate)
        writeLong(out, 16, timestampUs)
        System.arraycopy(payload, 0, out, HEADER_SIZE, payloadLen)
        return HEADER_SIZE + payloadLen
    }

    /** 헤더 필드 검증. 유효하지 않으면 null. 데이터그램 전체 길이 검증은 호출측에서. */
    fun parseHeader(data: ByteArray): PacketInfo? {
        if (data.size < HEADER_SIZE) return null
        if (data[0] != 0x41.toByte() || data[1] != 0x42.toByte()) return null
        if (data[2].toInt() != VERSION) return null
        if (data[3].toInt() != CODEC_PCM16) return null
        val channels = data[4].toInt()
        if (channels !in 1..2) return null
        val flags = data[5].toInt() and 0xFF
        val payloadLen = ((data[6].toInt() and 0xFF) shl 8) or (data[7].toInt() and 0xFF)
        if (payloadLen <= 0 || payloadLen > MAX_PAYLOAD) return null
        val seq = readInt(data, 8)
        val rate = readInt(data, 12)
        if (rate !in 8000..192000) return null
        val ts = readLong(data, 16)
        return PacketInfo(channels, flags, payloadLen, seq, rate, ts)
    }

    private fun writeInt(b: ByteArray, off: Int, v: Int) {
        b[off] = (v ushr 24).toByte(); b[off + 1] = (v ushr 16).toByte()
        b[off + 2] = (v ushr 8).toByte(); b[off + 3] = v.toByte()
    }

    private fun writeLong(b: ByteArray, off: Int, v: Long) {
        for (i in 0..7) b[off + i] = (v ushr (56 - 8 * i)).toByte()
    }

    private fun readInt(b: ByteArray, off: Int): Int =
        ((b[off].toInt() and 0xFF) shl 24) or ((b[off + 1].toInt() and 0xFF) shl 16) or
            ((b[off + 2].toInt() and 0xFF) shl 8) or (b[off + 3].toInt() and 0xFF)

    private fun readLong(b: ByteArray, off: Int): Long {
        var v = 0L
        for (i in 0..7) v = (v shl 8) or (b[off + i].toLong() and 0xFF)
        return v
    }
}

class PacketInfo(
    val channels: Int,
    val flags: Int,
    val payloadLen: Int,
    val seq: Int,
    val sampleRate: Int,
    val timestampUs: Long,
)
