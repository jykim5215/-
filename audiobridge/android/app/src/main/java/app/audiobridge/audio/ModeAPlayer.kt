package app.audiobridge.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.AudioTimestamp
import android.os.Process
import android.os.SystemClock
import app.audiobridge.net.Protocol
import java.io.DataInputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max

/**
 * 수신 재생기 — 상대가 보내는 오디오를 이 기기에서 재생한다.
 *
 * 시간 동기 재생: 각 패킷의 소스 타임스탬프를 시계 오프셋([offsetUsProvider],
 * PROTOCOL.md §7)으로 로컬 시각으로 바꾸고, "소스 시각 + 공통 지연 + 추가 지연"
 * 시점에 맞춰 재생한다. 여러 스피커가 같은 소스에 물리면 같은 시점에 소리가 난다.
 * 오프셋이 없으면(구버전 PC 등) 첫 패킷 도착 기준으로 잠정 오프셋을 잡는다.
 */
class ModeAPlayer(
    private val delayMsProvider: () -> Int,
    private val extraDelayMsProvider: () -> Int,
    private val offsetUsProvider: () -> Long?,
    private val onStats: (lossPct: Double, level: Float, bufferedMs: Int) -> Unit,
    private val onError: (String) -> Unit,
    private val gainProvider: () -> Float = { 1f },
    /** 음향 싱크 보정으로 정해진 이 기기의 추가 지연 (µs) */
    private val calibrationUsProvider: () -> Long = { 0L },
) {
    private val jitter = JitterBuffer()
    private val advisor = DelayAdvisor()
    /** 음향 싱크 보정 시험음을 낼 소스 시각들 (µs, 소스 시계) */
    private val syncTones = java.util.concurrent.ConcurrentLinkedQueue<Long>()

    /** 끊김 없이 쓸 수 있는 최소 공통 지연(ms) — 송신기에 보고한다. 자료가 모자라면 null. */
    fun needMs(): Int? = advisor.needMs(nowUs())

    /** 소스 시각 [atSourceUs]부터 50ms를 음악 대신 시험음으로 낸다 (실제 재생 경로 그대로 — 음향 보정용). */
    fun scheduleSyncTone(atSourceUs: Long) {
        syncTones.add(atSourceUs)
    }

    private fun onPacket(timestampUs: Long) {
        val offset = offsetUsProvider() ?: return
        val now = nowUs()
        advisor.onArrival(now, now - (timestampUs + offset))
    }
    @Volatile private var running = false
    private var udpSocket: DatagramSocket? = null
    private var tcpSocket: Socket? = null
    private var serverSocket: ServerSocket? = null

    private fun nowUs() = SystemClock.elapsedRealtimeNanos() / 1000

    /** UDP 수신 시작. 포트 바인드 실패 시 false. */
    fun startUdp(listenPort: Int, allowedHost: String): Boolean {
        val allowed = runCatching { InetAddress.getByName(allowedHost) }.getOrNull()
            ?: run { onError("상대 주소를 확인할 수 없어요"); return false }
        val socket = try {
            DatagramSocket(null).apply {
                reuseAddress = true
                bind(InetSocketAddress(listenPort))
            }
        } catch (e: Exception) {
            onError("소리 받을 통로(${listenPort})를 열 수 없어요")
            return false
        }
        udpSocket = socket
        running = true
        thread(name = "ab-a-rx") { udpLoop(socket, allowed) }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    /** TCP(안정) 모드: 상대에게 접속해 스트림을 읽는다. */
    fun startTcp(host: String, port: Int): Boolean {
        val socket = try {
            Socket().apply {
                tcpNoDelay = true
                connect(InetSocketAddress(host, port), 4000)
            }
        } catch (e: Exception) {
            onError("소리 통로 접속 실패: ${e.message}")
            return false
        }
        tcpSocket = socket
        running = true
        thread(name = "ab-a-rx") { tcpLoop(socket) }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    /** TCP 서버 모드: 이 기기가 리스너가 되어 상대의 접속을 받는다. */
    fun startTcpServer(listenPort: Int, allowedHost: String): Boolean {
        val allowed = runCatching { InetAddress.getByName(allowedHost) }.getOrNull()
            ?: run { onError("상대 주소를 확인할 수 없어요"); return false }
        val server = try {
            ServerSocket(listenPort)
        } catch (e: Exception) {
            onError("소리 받을 통로(${listenPort})를 열 수 없어요")
            return false
        }
        serverSocket = server
        running = true
        thread(name = "ab-a-rx") {
            try {
                while (running) {
                    val s = server.accept()
                    if (s.inetAddress != allowed) {
                        runCatching { s.close() } // 페어링된 상대 외 접속 거부
                        continue
                    }
                    s.tcpNoDelay = true
                    tcpSocket = s
                    tcpLoop(s)
                    break
                }
            } catch (_: Exception) {
                // 리스너 닫힘
            }
        }
        thread(name = "ab-a-play") { playLoop() }
        return true
    }

    fun stop() {
        running = false
        runCatching { udpSocket?.close() }
        runCatching { tcpSocket?.close() }
        runCatching { serverSocket?.close() }
        jitter.clear()
    }

    private fun udpLoop(socket: DatagramSocket, allowed: InetAddress) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val buf = ByteArray(2048)
        while (running) {
            val pkt = DatagramPacket(buf, buf.size)
            try {
                socket.receive(pkt)
            } catch (_: Exception) {
                if (running) continue else break
            }
            if (pkt.address != allowed) continue // 페어링된 상대 외 무시
            val info = Protocol.parseHeader(buf) ?: continue
            if (Protocol.HEADER_SIZE + info.payloadLen != pkt.length) continue
            onPacket(info.timestampUs)
            jitter.push(info, buf.copyOfRange(Protocol.HEADER_SIZE, Protocol.HEADER_SIZE + info.payloadLen))
        }
    }

    private fun tcpLoop(socket: Socket) {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        try {
            val input = DataInputStream(socket.getInputStream().buffered())
            val header = ByteArray(Protocol.HEADER_SIZE)
            while (running) {
                input.readFully(header)
                val info = Protocol.parseHeader(header) ?: break
                val payload = ByteArray(info.payloadLen)
                input.readFully(payload)
                onPacket(info.timestampUs)
                jitter.push(info, payload)
            }
        } catch (e: Exception) {
            if (running) onError("소리 스트림이 끊어졌어요")
        }
    }

    /** 원격 볼륨: 16bit LE 샘플 앞 [length]바이트에 소프트웨어 게인 적용 (1.0이면 무변경). */
    private fun applyGain(data: ByteArray, length: Int, gain: Float) {
        if (gain > 0.99f && gain < 1.01f) return
        val g = gain.coerceIn(0f, 1f)
        var i = 0
        while (i + 1 < length) {
            val s = ((data[i].toInt() and 0xFF) or (data[i + 1].toInt() shl 8))
            val v = (s * g).toInt().coerceIn(-32768, 32767)
            data[i] = v.toByte()
            data[i + 1] = (v shr 8).toByte()
            i += 2
        }
    }

    /** [chunk]의 첫 샘플이 소스 시각 [chunkSrcUs]일 때, 예약된 시험음 구간의 샘플을 시험음으로 바꾼다 (볼륨과 무관한 고정 크기). */
    private fun injectSyncTones(chunk: ByteArray, length: Int, chunkSrcUs: Long, fmt: StreamFormat) {
        while (true) {
            val at = syncTones.peek() ?: return
            if (at + SyncChirp.DURATION_US < chunkSrcUs) syncTones.poll() else break
        }
        val bytesPerFrameUnit = 2 * fmt.channels
        val samples = length / bytesPerFrameUnit
        val usPerSample = 1_000_000.0 / fmt.sampleRate
        for (at in syncTones) {
            if (at > chunkSrcUs + samples * usPerSample) continue
            for (j in 0 until samples) {
                val t = chunkSrcUs + j * usPerSample - at
                if (t < 0 || t >= SyncChirp.DURATION_US) continue
                val v = (SyncChirp.value(t) * 32767).toInt()
                for (c in 0 until fmt.channels) {
                    val i = j * bytesPerFrameUnit + c * 2
                    chunk[i] = v.toByte()
                    chunk[i + 1] = (v shr 8).toByte()
                }
            }
        }
    }

    private fun writeFully(track: AudioTrack, data: ByteArray, length: Int = data.size): Int {
        var offset = 0
        while (running && offset < length) {
            val written = track.write(
                data,
                offset,
                length - offset,
                AudioTrack.WRITE_BLOCKING,
            )
            if (written <= 0) break
            offset += written
        }
        return offset
    }

    /** Presentation time of the next frame written to the hardware output path. */
    private fun nextWritePresentationUs(
        track: AudioTrack,
        timestamp: AudioTimestamp,
        writtenFrames: Long,
        sampleRate: Int,
    ): Long {
        if (track.getTimestamp(timestamp)) {
            val pending = (writtenFrames - timestamp.framePosition).coerceAtLeast(0)
            return timestamp.nanoTime / 1000 + pending * 1_000_000L / sampleRate
        }
        val played = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
        val pending = (writtenFrames - played).coerceAtLeast(0)
        return nowUs() + pending * 1_000_000L / sampleRate
    }

    private fun playLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        // 첫 패킷으로 포맷 파악 (상대 준비·동의 시간을 고려해 30초 대기)
        var waited = 0
        while (running && jitter.format == null) {
            Thread.sleep(20)
            waited += 20
            if (waited > 30000) {
                if (running) onError("상대 기기에서 소리가 오지 않아요 (같은 Wi-Fi·방화벽 확인)")
                return
            }
        }
        val fmt = jitter.format ?: return
        val channelMask = if (fmt.channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
        val minBuf = AudioTrack.getMinBufferSize(fmt.sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        val frameBytes = fmt.sampleRate / 1000 * Protocol.FRAME_MS * 2 * fmt.channels
        val track = try {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(fmt.sampleRate)
                        .setChannelMask(channelMask)
                        .build()
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(max(minBuf, frameBytes * 4))
                .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
                .build()
        } catch (e: Exception) {
            onError("소리 재생을 시작할 수 없어요: ${e.message}")
            return
        }
        track.play()
        val silence = ByteArray(frameBytes)
        val bytesPerFrameUnit = 2 * fmt.channels // 샘플 프레임(모든 채널) 1개의 바이트
        val frameSamples = frameBytes / bytesPerFrameUnit
        // 한 프레임 + 반복 샘플(최대 2개)을 담을 작업 버퍼
        val chunk = ByteArray(frameBytes + 2 * bytesPerFrameUnit)
        val scheduler = PlayoutScheduler(fmt.sampleRate, frameSamples)
        var cursor = 0 // 머리 프레임에서 이미 쓰거나 건너뛴 샘플 수
        var writtenFrames = 0L // 트랙에 쓴 샘플 프레임 수
        val audioTimestamp = AudioTimestamp()
        var fallbackOffset: Long? = null
        var level = 0f
        var lastStats = 0L
        try {
            while (running) {
                // 핵심: "지금 쓰는 데이터가 실제 스피커에서 나오는 시각"으로 비교한다.
                // 기기마다 오디오 출력 버퍼 크기가 크게 달라서, 트랙에 쌓여 있는
                // 미재생분만큼 미래에 소리가 나온다 — 이걸 반영해야 기기 간이 맞는다.
                val playAtUs = nextWritePresentationUs(
                    track,
                    audioTimestamp,
                    writtenFrames,
                    fmt.sampleRate,
                )
                val nowForDepth = nowUs()
                advisor.onOutputDepth(nowForDepth, playAtUs - nowForDepth)
                val head = jitter.peek()
                if (head == null) {
                    // 데이터 없음 — 무음으로 트랙을 채우며 대기 (write가 실시간 페이스 유지)
                    val d = scheduler.decide(null, 0)
                    writtenFrames += writeFully(track, silence, d.samples * bytesPerFrameUnit) / bytesPerFrameUnit
                    level = 0f
                    continue
                }
                val offset = offsetUsProvider() ?: run {
                    if (fallbackOffset == null) fallbackOffset = nowUs() - head.tsUs
                    fallbackOffset!!
                }
                // 머리 프레임에서 다음에 쓸 샘플의 목표 재생 시각
                val targetUs = head.tsUs + offset +
                    Protocol.normalizePlayoutDelayMs(delayMsProvider()) * 1000L +
                    extraDelayMsProvider().coerceIn(0, Protocol.MAX_EXTRA_DELAY_MS) * 1000L +
                    calibrationUsProvider().coerceIn(0L, Protocol.MAX_CALIBRATION_US) +
                    cursor * 1_000_000L / fmt.sampleRate
                val headSamples = head.data.size / bytesPerFrameUnit
                val d = scheduler.decide(playAtUs - targetUs, headSamples - cursor)
                when (d.kind) {
                    PlayoutScheduler.Kind.SILENCE -> {
                        // 아직 이르다 — 정확히 모자란 만큼만 무음으로 기다린다
                        val written = writeFully(track, silence, d.samples * bytesPerFrameUnit)
                        writtenFrames += written / bytesPerFrameUnit
                    }
                    PlayoutScheduler.Kind.SKIP -> {
                        // 늦었다 — 정확히 늦은 만큼만 건너뛴다
                        cursor += d.samples
                        if (cursor >= headSamples) {
                            jitter.poll()
                            cursor = 0
                        }
                    }
                    PlayoutScheduler.Kind.PLAY -> {
                        val frame = jitter.poll() ?: continue
                        val from = cursor * bytesPerFrameUnit
                        cursor = 0
                        // adjust<0: 끝 샘플을 빼서 따라잡기, >0: 마지막 샘플을 반복해 기다리기 (클럭 속도 차 보정)
                        val body = (frame.data.size - from + minOf(0, d.adjust) * bytesPerFrameUnit).coerceAtLeast(0)
                        System.arraycopy(frame.data, from, chunk, 0, body)
                        var length = body
                        repeat(maxOf(0, d.adjust)) {
                            if (length >= bytesPerFrameUnit) {
                                System.arraycopy(chunk, length - bytesPerFrameUnit, chunk, length, bytesPerFrameUnit)
                                length += bytesPerFrameUnit
                            }
                        }
                        applyGain(chunk, length, gainProvider())
                        if (syncTones.isNotEmpty()) {
                            injectSyncTones(chunk, length, frame.tsUs + from / bytesPerFrameUnit * 1_000_000L / fmt.sampleRate, fmt)
                        }
                        val written = writeFully(track, chunk, length)
                        writtenFrames += written / bytesPerFrameUnit
                        var peak = 0
                        var i = 0
                        while (i + 1 < length) {
                            val s = (chunk[i].toInt() and 0xFF) or (chunk[i + 1].toInt() shl 8)
                            peak = max(peak, abs(s))
                            i += 8
                        }
                        level = level * 0.7f + (peak / 32768f) * 0.3f
                    }
                }
                val now = System.currentTimeMillis()
                if (now - lastStats > 400) {
                    lastStats = now
                    onStats(jitter.lossPercent(), level, jitter.bufferedBytes() / fmt.bytesPerMs)
                }
            }
        } finally {
            runCatching { track.stop() }
            track.release()
        }
    }
}
