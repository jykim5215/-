package app.audiobridge

import android.Manifest
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.audiobridge.audio.CaptureSource
import app.audiobridge.net.Protocol
import app.audiobridge.ui.Accent
import app.audiobridge.ui.Amber
import app.audiobridge.ui.Beige
import app.audiobridge.ui.Cream
import app.audiobridge.ui.Ink
import app.audiobridge.ui.LevelMeter
import app.audiobridge.ui.Panel
import app.audiobridge.ui.RetroButton
import app.audiobridge.ui.RetroCard
import app.audiobridge.ui.RetroLabel
import app.audiobridge.ui.RetroSegmented
import app.audiobridge.ui.RetroSwitch
import app.audiobridge.ui.RetroTheme
import app.audiobridge.ui.Sub
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BridgeEngine.init(applicationContext)
        setContent {
            RetroTheme { MainScreen() }
        }
    }
}

private fun parseHostPort(input: String): Pair<String, Int>? {
    val t = input.trim()
    if (t.isEmpty()) return null
    val host: String
    var port = Protocol.DEFAULT_CTL_PORT
    if (t.contains(":")) {
        val parts = t.split(":")
        if (parts.size != 2) return null
        host = parts[0].trim()
        port = parts[1].trim().toIntOrNull() ?: return null
    } else {
        host = t
    }
    if (host.isEmpty() || port !in 1..65535) return null
    return host to port
}

@Composable
fun MainScreen() {
    val context = LocalContext.current
    val conn by BridgeState.conn.collectAsState()
    val peerName by BridgeState.peerName.collectAsState()
    val peerHost by BridgeState.peerHost.collectAsState()
    val modeA by BridgeState.modeA.collectAsState()
    val modeB by BridgeState.modeB.collectAsState()
    val modeBPending by BridgeState.modeBPending.collectAsState()
    val bSource by BridgeState.bSource.collectAsState()
    val bufferMs by BridgeState.bufferMs.collectAsState()
    val transportTcp by BridgeState.transportTcp.collectAsState()
    val modeAPort by BridgeState.modeAPort.collectAsState()
    val discovering by BridgeState.discovering.collectAsState()
    val peers by BridgeState.peers.collectAsState()
    val stats by BridgeState.stats.collectAsState()
    val peerKind by BridgeState.peerKind.collectAsState()
    val speakerOn by BridgeState.speakerOn.collectAsState()
    val speakerPeer by BridgeState.speakerPeer.collectAsState()
    val speakerPlaying by BridgeState.speakerPlaying.collectAsState()
    val speakerLevel by BridgeState.speakerLevel.collectAsState()

    val update by BridgeState.update.collectAsState()
    val updateProgress by BridgeState.updateProgress.collectAsState()
    val uiScope = rememberCoroutineScope()

    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) {
        BridgeState.toast.collect { snackbar.showSnackbar(it) }
    }
    LaunchedEffect(Unit) {
        // 앱 시작 시 조용히 업데이트 확인
        if (BridgeState.update.value == null) {
            BridgeState.update.value = Updater.check(context.applicationContext)
        }
    }

    var pendingBAfterMic by remember { mutableStateOf(false) }
    var showAdvanced by remember { mutableStateOf(false) }

    val projectionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == android.app.Activity.RESULT_OK && data != null) {
            BridgeEngine.requestModeBProjection(result.resultCode, data)
        } else {
            BridgeState.notify("내부 소리 캡처 권한이 거부되었습니다")
        }
    }

    fun startModeB() {
        if (BridgeState.bSource.value == CaptureSource.INTERNAL) {
            if (Build.VERSION.SDK_INT < 29) {
                BridgeState.notify("내부 소리 캡처는 Android 10 이상에서만 가능합니다 — 마이크를 사용하세요")
                return
            }
            val mpm = context.getSystemService(MediaProjectionManager::class.java)
            projectionLauncher.launch(mpm.createScreenCaptureIntent())
        } else {
            BridgeEngine.requestModeBMic()
        }
    }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingBAfterMic) {
            pendingBAfterMic = false
            startModeB()
        } else if (!granted) {
            pendingBAfterMic = false
            BridgeState.notify("녹음 권한이 없으면 모드 B를 사용할 수 없습니다")
        }
    }

    val notifLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun onModeBToggle(on: Boolean) {
        if (!on) {
            BridgeEngine.toggleModeBOff()
            return
        }
        if (conn != ConnState.CONNECTED) {
            BridgeState.notify("먼저 상대 기기와 연결하세요")
            return
        }
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) {
            pendingBAfterMic = true
            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
        } else {
            startModeB()
        }
    }

    Scaffold(
        containerColor = Cream,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .background(Cream)
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 헤더
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row {
                    Text("AUDIO", fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = Ink, letterSpacing = 1.sp)
                    Text("BRIDGE", fontWeight = FontWeight.ExtraBold, fontSize = 20.sp, color = Accent, letterSpacing = 1.sp)
                }
                val badgeText = when (conn) {
                    ConnState.CONNECTED -> (peerName ?: "PC") + " ●"
                    ConnState.CONNECTING -> "연결 중…"
                    ConnState.DISCONNECTED -> "연결 안 됨"
                }
                Box(
                    Modifier
                        .background(Ink, RoundedCornerShape(4.dp))
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                ) {
                    Text(
                        badgeText,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = if (conn == ConnState.CONNECTED) Amber else Beige,
                    )
                }
            }

            // 업데이트 카드 (새 버전 있을 때만)
            update?.let { info ->
                RetroCard {
                    RetroLabel("UPDATE")
                    Text(
                        "새 버전 ${info.versionName}이 나왔습니다",
                        fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, color = Ink,
                    )
                    updateProgress?.let { LevelMeter(it) }
                    RetroButton(
                        text = updateProgress?.let { "받는 중… ${(it * 100).toInt()}%" } ?: "업데이트 설치",
                        enabled = updateProgress == null,
                    ) {
                        uiScope.launch {
                            BridgeState.updateProgress.value = 0f
                            val err = Updater.downloadAndInstall(context.applicationContext, info) { p ->
                                BridgeState.updateProgress.value = p
                            }
                            BridgeState.updateProgress.value = null
                            err?.let { BridgeState.notify(it) }
                        }
                    }
                }
            }

            // 스피커 모드 카드 (이 폰이 다른 폰의 스피커가 됨)
            RetroCard {
                RetroLabel("SPEAKER · 폰 ↔ 폰")
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("이 폰을 스피커로 쓰기", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Ink)
                        Text(
                            when {
                                !speakerOn -> "다른 폰의 소리를 이 폰에서 재생"
                                speakerPlaying -> "재생 중 — ${speakerPeer ?: "상대 기기"}"
                                speakerPeer != null -> "연결됨: $speakerPeer"
                                else -> "대기 중 — 상대 폰에서 '${(Build.MODEL ?: "이 폰").take(20)}' 선택"
                            },
                            fontSize = 12.sp, color = Sub,
                        )
                    }
                    RetroSwitch(speakerOn) { BridgeEngine.setSpeakerMode(it) }
                }
                if (speakerPlaying) LevelMeter(speakerLevel)
            }

            // 연결 카드
            RetroCard {
                RetroLabel("CONNECT")
                if (conn == ConnState.CONNECTED) {
                    Text(peerName ?: "PC", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Ink)
                    Text(peerHost ?: "", fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Sub)
                    RetroButton("연결 해제") { BridgeEngine.disconnect() }
                } else {
                    RetroButton(if (discovering) "찾는 중…" else "같은 Wi-Fi에서 기기 찾기 (폰·PC)", enabled = !discovering) {
                        BridgeEngine.discover()
                    }
                    peers.forEach { peer ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .background(Cream, RoundedCornerShape(6.dp))
                                .clickable(enabled = conn != ConnState.CONNECTING) {
                                    BridgeEngine.connect(peer.host, peer.ctlPort)
                                }
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(peer.name, fontWeight = FontWeight.Bold, color = Ink, fontSize = 14.sp)
                            Text(peer.host, fontFamily = FontFamily.Monospace, color = Sub, fontSize = 12.sp)
                        }
                    }
                    var manual by remember { mutableStateOf(BridgeEngine.lastHost()) }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = manual,
                            onValueChange = { manual = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("IP 주소 (예: 192.168.0.10)", fontSize = 13.sp, color = Sub) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Ink,
                                unfocusedBorderColor = Sub,
                                cursorColor = Accent,
                                focusedTextColor = Ink,
                                unfocusedTextColor = Ink,
                            ),
                        )
                        Spacer(Modifier.width(8.dp))
                        RetroButton("연결", modifier = Modifier.width(76.dp), enabled = conn != ConnState.CONNECTING) {
                            val parsed = parseHostPort(manual)
                            if (parsed == null) {
                                BridgeState.notify("주소 형식이 올바르지 않습니다 (예: 192.168.0.10 또는 192.168.0.10:48550)")
                            } else {
                                BridgeEngine.connect(parsed.first, parsed.second)
                            }
                        }
                    }
                }
            }

            // PC → 폰 카드 (연결 시 자동 시작)
            RetroCard {
                RetroLabel("PC ▶ 폰")
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("PC 소리를 폰에서 듣기", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Ink)
                        Text(
                            when {
                                conn == ConnState.CONNECTED && peerKind == "phone" ->
                                    "상대가 폰이라 이 방향은 사용하지 않아요"
                                modeA -> "재생 중"
                                else -> "PC와 연결하면 자동으로 켜져요"
                            },
                            fontSize = 12.sp, color = Sub,
                        )
                    }
                    RetroSwitch(modeA) { BridgeEngine.toggleModeA(it) }
                }
                if (modeA) {
                    LevelMeter(stats.levelA)
                    Text(
                        "버퍼 ${stats.bufferedMs}ms · 손실 ${"%.1f".format(stats.lossPct)}% · 48kHz",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = Sub,
                    )
                }
            }

            // 폰 → PC 카드
            RetroCard {
                RetroLabel("폰 ▶ PC")
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("이 폰 소리를 상대에서 듣기", fontWeight = FontWeight.ExtraBold, fontSize = 16.sp, color = Ink)
                        Text(
                            when {
                                modeBPending -> "시작하는 중…"
                                conn == ConnState.CONNECTED && peerKind == "phone" ->
                                    "이 폰의 소리를 상대 폰 스피커로"
                                else -> "이 폰의 음악·게임·마이크를 PC 스피커로"
                            },
                            fontSize = 12.sp, color = Sub,
                        )
                    }
                    RetroSwitch(modeB || modeBPending) { onModeBToggle(it) }
                }
                RetroSegmented(
                    options = listOf("내부 소리", "마이크"),
                    selected = if (bSource == CaptureSource.INTERNAL) 0 else 1,
                ) { idx ->
                    if (modeB || modeBPending) {
                        BridgeState.notify("소스는 모드 B를 끈 상태에서 바꿀 수 있습니다")
                    } else {
                        BridgeEngine.setBSource(if (idx == 0) CaptureSource.INTERNAL else CaptureSource.MIC)
                    }
                }
                Text(
                    if (bSource == CaptureSource.INTERNAL)
                        "내부 소리: Android 10+ 필요, 일부 앱은 캡처를 차단합니다 (그 경우 마이크 사용)"
                    else
                        "마이크: 주변 소리를 그대로 상대 기기로 보냅니다 (마이크→스피커처럼 사용)",
                    fontSize = 11.sp, color = Sub,
                )
                if (modeB) LevelMeter(stats.levelB)
            }

            // 버퍼 카드
            RetroCard {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    RetroLabel("BUFFER")
                    Text(
                        "${bufferMs}ms",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Accent,
                    )
                }
                Slider(
                    value = bufferMs.toFloat(),
                    onValueChange = { BridgeEngine.setBufferMs(it.toInt()) },
                    valueRange = 20f..300f,
                    colors = SliderDefaults.colors(
                        thumbColor = Ink,
                        activeTrackColor = Accent,
                        inactiveTrackColor = Beige,
                    ),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("FAST", fontFamily = FontFamily.Monospace, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Sub)
                    Text("STABLE", fontFamily = FontFamily.Monospace, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Sub)
                }
            }

            // 푸터
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    (if (transportTcp) "TCP" else "UDP") + " · PCM16 · 48kHz",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = Sub,
                )
                Text(
                    "고급 설정",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Accent,
                    modifier = Modifier
                        .clickable { showAdvanced = true }
                        .padding(6.dp),
                )
            }
        }
    }

    if (showAdvanced) {
        var portText by remember { mutableStateOf(modeAPort.toString()) }
        AlertDialog(
            onDismissRequest = { showAdvanced = false },
            containerColor = Panel,
            title = { Text("고급 설정", fontWeight = FontWeight.ExtraBold, color = Ink) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    RetroLabel("TRANSPORT")
                    RetroSegmented(
                        options = listOf("UDP (저지연)", "TCP (안정)"),
                        selected = if (transportTcp) 1 else 0,
                    ) { idx -> BridgeEngine.setTransportTcp(idx == 1) }
                    RetroLabel("폰 오디오 수신 포트 (모드 A)")
                    OutlinedTextField(
                        value = portText,
                        onValueChange = { portText = it },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Ink,
                            unfocusedBorderColor = Sub,
                            cursorColor = Accent,
                            focusedTextColor = Ink,
                            unfocusedTextColor = Ink,
                        ),
                    )
                    Text(
                        "컨트롤 포트는 연결 주소에 함께 입력합니다 (예: 192.168.0.10:48550)",
                        fontSize = 11.sp, color = Sub,
                    )
                    RetroButton("업데이트 확인") {
                        uiScope.launch {
                            val found = Updater.check(context.applicationContext)
                            BridgeState.update.value = found
                            BridgeState.notify(
                                if (found != null) "새 버전 ${found.versionName} 발견 — 화면 위 카드에서 설치하세요"
                                else "이미 최신 버전입니다"
                            )
                        }
                        showAdvanced = false
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    portText.toIntOrNull()?.let { BridgeEngine.setModeAPort(it) }
                    showAdvanced = false
                }) { Text("확인", color = Accent, fontWeight = FontWeight.Bold) }
            },
        )
    }
}
