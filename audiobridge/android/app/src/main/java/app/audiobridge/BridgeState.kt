package app.audiobridge

import app.audiobridge.audio.CaptureSource
import app.audiobridge.net.Peer
import app.audiobridge.net.Protocol
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow

enum class ConnState { DISCONNECTED, CONNECTING, CONNECTED }

/** [channel] 0=양쪽, 1=왼쪽, 2=오른쪽 · [gain] 0~100 */
data class SpeakerInfo(
    val id: Int,
    val name: String,
    val kind: String,
    val active: Boolean,
    val channel: Int = 0,
    val gain: Int = 100,
)

/** UI와 엔진이 공유하는 관찰 가능 상태. */
object BridgeState {
    // 연결
    val conn = MutableStateFlow(ConnState.DISCONNECTED)
    val peerName = MutableStateFlow<String?>(null)
    val peerHost = MutableStateFlow<String?>(null)
    /** 연결된 상대 종류: "pc" 또는 "phone" */
    val peerKind = MutableStateFlow("pc")
    /** true면 상대가 나에게 접속해 온 세션(내가 서버) */
    val isServerSession = MutableStateFlow(false)

    // 내 기기
    val myName = MutableStateFlow("")

    // 역할: 소리가 나오는 곳. "me"=이 기기, "peer"=상대 기기, null=미선택
    val myOutput = MutableStateFlow<String?>(null)
    val peerOutput = MutableStateFlow<String?>(null)

    // 스트림 상태
    val listening = MutableStateFlow(false)   // 이 기기에서 재생 중
    val sending = MutableStateFlow(false)     // 이 기기 소리를 보내는 중
    val sendPending = MutableStateFlow(false) // 보내기 준비(권한 등) 중
    val level = MutableStateFlow(0f)

    // 설정
    val bSource = MutableStateFlow(CaptureSource.MIC)
    val bufferMs = MutableStateFlow(Protocol.DEFAULT_PLAYOUT_DELAY_MS)
    val transportTcp = MutableStateFlow(false)
    val modeAPort = MutableStateFlow(Protocol.DEFAULT_MODE_A_PORT)

    // 다대일 스피커 (내가 소스일 때 연결된 스피커들)
    val speakers = MutableStateFlow<List<SpeakerInfo>>(emptyList())
    // 공통 재생 시각보다 이 기기만 더 늦추는 보정 (ms, 0..300)
    val extraDelayMs = MutableStateFlow(0)
    val calibrationRunning = MutableStateFlow(false)

    // 검색
    val discovering = MutableStateFlow(false)
    val peers = MutableStateFlow<List<Peer>>(emptyList())

    // 알림·업데이트
    val toast = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val update = MutableStateFlow<UpdateInfo?>(null)
    val updateProgress = MutableStateFlow<Float?>(null)

    /** 엔진이 "보내기 준비(권한·화면녹화 동의)"를 UI에 요청할 때 발행 */
    val sendSetup = MutableSharedFlow<Unit>(extraBufferCapacity = 2)
    /** 상대 기기의 물리 보정 요청을 받았으나 마이크 권한이 없을 때 UI가 권한 창을 연다. */
    val calibrationPermissionRequest = MutableSharedFlow<Unit>(extraBufferCapacity = 2)

    fun notify(msg: String) {
        toast.tryEmit(msg)
    }
}
