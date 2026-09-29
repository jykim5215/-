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

    /**
     * 모든 수신기가 공유하는 공통 재생 대기 시간(소스 타임스탬프 → 소리).
     * 기본은 자동: 수신기들이 잰 필요 지연 중 최댓값(DelayAdvisor/DelayCoordinator). 수동이면 사용자 선택값.
     * 하한 40ms는 출력 버퍼·캡처 묶음을 고려한 물리적 바닥 근처다(LATENCY_POLICY.md).
     */
    const val MIN_PLAYOUT_DELAY_MS = 40
    const val MAX_PLAYOUT_DELAY_MS = 2000
    const val PLAYOUT_DELAY_STEP_MS = 10
    const val DEFAULT_PLAYOUT_DELAY_MS = 200
    /** 자동 모드가 측정 전 처음 쓰는 값 — 측정되면 필요한 만큼으로 내려간다 */
    const val AUTO_START_DELAY_MS = 250
    const val MAX_EXTRA_DELAY_MS = 300
    /** 음향 싱크 보정으로 정해지는 기기별 추가 지연 상한 (µs) */
    const val MAX_CALIBRATION_US = 300_000L

    /** 범위 밖이거나 눈금 사이인 값을 가장 가까운 지원값으로 맞춘다. */
    fun normalizePlayoutDelayMs(value: Int): Int {
        val clamped = value.coerceIn(MIN_PLAYOUT_DELAY_MS, MAX_PLAYOUT_DELAY_MS)
        val stepIndex = (clamped - MIN_PLAYOUT_DELAY_MS + PLAYOUT_DELAY_STEP_MS / 2) /
            PLAYOUT_DELAY_STEP_MS
        return MIN_PLAYOUT_DELAY_MS + stepIndex * PLAYOUT_DELAY_STEP_MS
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
