package app.audiobridge

import app.audiobridge.audio.CaptureSource
import app.audiobridge.net.Peer
import app.audiobridge.net.Protocol
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

enum class ConnState { DISCONNECTED, CONNECTING, CONNECTED }

data class Stats(
    val lossPct: Double = 0.0,
    val levelA: Float = 0f,
    val levelB: Float = 0f,
    val bufferedMs: Int = 0,
)

/** UI와 엔진이 공유하는 관찰 가능 상태. */
object BridgeState {
    val conn = MutableStateFlow(ConnState.DISCONNECTED)
    val peerName = MutableStateFlow<String?>(null)
    val peerHost = MutableStateFlow<String?>(null)
    /** 연결된 상대 종류: "pc" 또는 "phone" (hello의 kind 필드) */
    val peerKind = MutableStateFlow("pc")

    // 스피커 모드 (이 폰이 다른 폰/PC의 스피커가 됨)
    val speakerOn = MutableStateFlow(false)
    val speakerPeer = MutableStateFlow<String?>(null)
    val speakerPlaying = MutableStateFlow(false)
    val speakerLevel = MutableStateFlow(0f)

    val modeA = MutableStateFlow(false)
    val modeB = MutableStateFlow(false)
    val modeBPending = MutableStateFlow(false)
    val bSource = MutableStateFlow(CaptureSource.MIC)

    val bufferMs = MutableStateFlow(60)
    val transportTcp = MutableStateFlow(false)
    val modeAPort = MutableStateFlow(Protocol.DEFAULT_MODE_A_PORT)

    val discovering = MutableStateFlow(false)
    val peers = MutableStateFlow<List<Peer>>(emptyList())

    val stats = MutableStateFlow(Stats())
    val toast = MutableSharedFlow<String>(extraBufferCapacity = 8)

    val update = MutableStateFlow<UpdateInfo?>(null)
    val updateProgress = MutableStateFlow<Float?>(null)

    fun notify(msg: String) {
        toast.tryEmit(msg)
    }
}
