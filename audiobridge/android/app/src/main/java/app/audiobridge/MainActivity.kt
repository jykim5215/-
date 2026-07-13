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
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.audiobridge.audio.CaptureSource
import app.audiobridge.net.Protocol
import app.audiobridge.ui.AppTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BridgeEngine.init(applicationContext)
        setContent {
            AppTheme { MainScreen() }
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
    val cs = MaterialTheme.colorScheme

    val conn by BridgeState.conn.collectAsState()
    val peerName by BridgeState.peerName.collectAsState()
    val peerKind by BridgeState.peerKind.collectAsState()
    val myName by BridgeState.myName.collectAsState()
    val myOutput by BridgeState.myOutput.collectAsState()
    val peerOutput by BridgeState.peerOutput.collectAsState()
    val listening by BridgeState.listening.collectAsState()
    val sending by BridgeState.sending.collectAsState()
    val sendPending by BridgeState.sendPending.collectAsState()
    val level by BridgeState.level.collectAsState()
    val bSource by BridgeState.bSource.collectAsState()
    val bufferMs by BridgeState.bufferMs.collectAsState()
    val transportTcp by BridgeState.transportTcp.collectAsState()
    val discovering by BridgeState.discovering.collectAsState()
    val peers by BridgeState.peers.collectAsState()
    val update by BridgeState.update.collectAsState()
    val updateProgress by BridgeState.updateProgress.collectAsState()
    val speakers by BridgeState.speakers.collectAsState()
    val isServerSession by BridgeState.isServerSession.collectAsState()
    val extraDelayMs by BridgeState.extraDelayMs.collectAsState()
    val calibrationRunning by BridgeState.calibrationRunning.collectAsState()

    val uiScope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var showSettings by remember { mutableStateOf(false) }
    var showManual by remember { mutableStateOf(false) }
    var showAddSpeaker by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { BridgeState.toast.collect { snackbar.showSnackbar(it) } }
    LaunchedEffect(Unit) {
        if (BridgeState.update.value == null) {
            BridgeState.update.value = Updater.check(context.applicationContext)
        }
    }

    // ---- 보내기 준비(권한·화면녹화 동의) 흐름 ----
    val projectionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == android.app.Activity.RESULT_OK && data != null) {
            BridgeEngine.requestSendProjection(result.resultCode, data)
        } else {
            BridgeEngine.cancelSend("화면 소리 공유가 거부되었어요 — 마이크로는 보낼 수 있어요")
        }
    }
    val continueSetup: () -> Unit = {
        if (BridgeState.bSource.value == CaptureSource.INTERNAL) {
            if (Build.VERSION.SDK_INT < 29) {
                BridgeEngine.cancelSend("이 폰에서는 미디어 소리 보내기가 지원되지 않아요 — 마이크를 사용해 주세요")
            } else {
                val mpm = context.getSystemService(MediaProjectionManager::class.java)
                projectionLauncher.launch(mpm.createScreenCaptureIntent())
            }
        } else {
            BridgeEngine.requestSendMic()
        }
    }
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) continueSetup()
        else BridgeEngine.cancelSend("마이크 권한이 없어 소리를 보낼 수 없어요")
    }

    var startCalibrationAfterPermission by remember { mutableStateOf(false) }
    val calibrationMicLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        BridgeEngine.onCalibrationPermission(granted)
        if (granted && startCalibrationAfterPermission) BridgeEngine.requestAcousticCalibration()
        if (!granted && startCalibrationAfterPermission) BridgeState.notify("마이크 권한이 없어 자동 보정을 시작할 수 없어요")
        startCalibrationAfterPermission = false
    }
    LaunchedEffect(Unit) {
        BridgeState.calibrationPermissionRequest.collect {
            startCalibrationAfterPermission = false
            calibrationMicLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    val requestCalibration: () -> Unit = {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            BridgeEngine.requestAcousticCalibration()
        } else {
            startCalibrationAfterPermission = true
            calibrationMicLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }
    LaunchedEffect(Unit) {
        BridgeState.sendSetup.collect {
            val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            if (granted) continueSetup() else micLauncher.launch(Manifest.permission.RECORD_AUDIO)
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

    val versionName = remember {
        runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: ""
    }

    Scaffold(
        containerColor = cs.background,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // 상단 바
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("AudioBridge", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { showSettings = true }
                            .padding(vertical = 2.dp),
                    ) {
                        Text(myName, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Filled.Edit, contentDescription = "이름 바꾸기", tint = cs.onSurfaceVariant, modifier = Modifier.size(13.dp))
                    }
                }
                IconButton(onClick = { showSettings = true }) {
                    Icon(Icons.Filled.Settings, contentDescription = "설정", tint = cs.onSurfaceVariant)
                }
            }

            // 업데이트 배너
            update?.let { info ->
                Surface(shape = RoundedCornerShape(20.dp), color = cs.secondaryContainer) {
                    Row(
                        Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("새 버전 ${info.versionName}", style = MaterialTheme.typography.titleSmall, color = cs.onSecondaryContainer)
                            updateProgress?.let {
                                Text("받는 중 ${(it * 100).toInt()}%", style = MaterialTheme.typography.bodySmall, color = cs.onSecondaryContainer)
                            }
                        }
                        TextButton(
                            enabled = updateProgress == null,
                            onClick = {
                                uiScope.launch {
                                    BridgeState.updateProgress.value = 0f
                                    val err = Updater.downloadAndInstall(context.applicationContext, info) { p ->
                                        BridgeState.updateProgress.value = p
                                    }
                                    BridgeState.updateProgress.value = null
                                    err?.let { BridgeState.notify(it) }
                                }
                            },
                        ) { Text("설치") }
                    }
                }
            }

            when (conn) {
                ConnState.CONNECTED -> ConnectedCard(
                    peerName = peerName ?: "상대 기기",
                    peerKind = peerKind,
                    myOutput = myOutput,
                    peerOutput = peerOutput,
                    listening = listening,
                    sending = sending,
                    sendPending = sendPending,
                    level = level,
                    source = bSource,
                    speakers = speakers,
                    isServer = isServerSession,
                    onAddSpeaker = { showAddSpeaker = true },
                )
                ConnState.CONNECTING -> Surface(shape = RoundedCornerShape(28.dp), color = cs.surface, border = BorderStroke(1.dp, cs.outline)) {
                    Row(Modifier.padding(24.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
                        Spacer(Modifier.width(14.dp))
                        Text("연결하고 있어요…", style = MaterialTheme.typography.bodyLarge)
                        Spacer(Modifier.weight(1f))
                        TextButton(onClick = { BridgeEngine.disconnect() }) { Text("취소") }
                    }
                }
                ConnState.DISCONNECTED -> DiscoveryCard(
                    discovering = discovering,
                    peers = peers,
                    onFind = { BridgeEngine.discover() },
                    onConnect = { host, port -> BridgeEngine.connect(host, port) },
                    onManual = { showManual = true },
                )
            }

            Text(
                "v$versionName",
                style = MaterialTheme.typography.labelSmall,
                color = cs.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (showAddSpeaker) {
        AlertDialog(
            onDismissRequest = { showAddSpeaker = false },
            title = { Text("스피커 추가") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "추가할 폰은 앱을 열어 두세요. 소리는 모든 스피커에서 동시에 나와요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                    Button(onClick = { BridgeEngine.discover() }, enabled = !discovering, modifier = Modifier.fillMaxWidth()) {
                        if (discovering) {
                            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = cs.onPrimary)
                            Spacer(Modifier.width(8.dp))
                            Text("찾는 중…")
                        } else {
                            Text("기기 찾기")
                        }
                    }
                    peers.forEach { peer ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .background(cs.surfaceVariant)
                                .clickable {
                                    showAddSpeaker = false
                                    BridgeEngine.addSpeaker(peer.host, peer.ctlPort)
                                }
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(peer.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                            Text("추가", style = MaterialTheme.typography.labelLarge, color = cs.primary)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAddSpeaker = false }) { Text("닫기") }
            },
        )
    }

    if (showManual) {
        var manual by remember { mutableStateOf(BridgeEngine.lastHost()) }
        AlertDialog(
            onDismissRequest = { showManual = false },
            title = { Text("IP 주소로 연결") },
            text = {
                OutlinedTextField(
                    value = manual,
                    onValueChange = { manual = it },
                    singleLine = true,
                    placeholder = { Text("예: 192.168.0.10") },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val parsed = parseHostPort(manual)
                    if (parsed == null) {
                        BridgeState.notify("주소를 다시 확인해 주세요 (예: 192.168.0.10)")
                    } else {
                        showManual = false
                        BridgeEngine.connect(parsed.first, parsed.second)
                    }
                }) { Text("연결") }
            },
            dismissButton = { TextButton(onClick = { showManual = false }) { Text("취소") } },
        )
    }

    if (showSettings) {
        var nameField by remember { mutableStateOf(myName) }
        AlertDialog(
            onDismissRequest = { showSettings = false },
            title = { Text("설정") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text("기기 이름", style = MaterialTheme.typography.labelLarge)
                    OutlinedTextField(
                        value = nameField,
                        onValueChange = { nameField = it.take(20) },
                        singleLine = true,
                        supportingText = { Text("상대 기기 목록에 이 이름으로 보여요") },
                    )
                    val canChangeDelay = !listening && !sending && !sendPending
                    Text("기본 재생 대기 (${bufferMs}ms)", style = MaterialTheme.typography.labelLarge)
                    Slider(
                        value = bufferMs.toFloat(),
                        onValueChange = { BridgeEngine.setPlayoutDelayMs(it.toInt()) },
                        valueRange = Protocol.MIN_PLAYOUT_DELAY_MS.toFloat()..
                            Protocol.MAX_PLAYOUT_DELAY_MS.toFloat(),
                        steps = (Protocol.MAX_PLAYOUT_DELAY_MS - Protocol.MIN_PLAYOUT_DELAY_MS) /
                            Protocol.PLAYOUT_DELAY_STEP_MS - 1,
                        enabled = canChangeDelay,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("600ms", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                        Text("2000ms", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                    }
                    Text(
                        if (canChangeDelay) "200ms 단위로 선택하며 다음 연결에도 유지돼요"
                        else "소리가 흐르는 중에는 끈 뒤 변경할 수 있어요",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                    Button(
                        onClick = requestCalibration,
                        enabled = canChangeDelay && conn == ConnState.CONNECTED && !calibrationRunning,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (calibrationRunning) {
                            CircularProgressIndicator(
                                Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = cs.onPrimary,
                            )
                            Spacer(Modifier.width(10.dp))
                            Text("시험음 측정 중")
                        } else {
                            Text("두 기기의 마이크·스피커로 자동 맞춤")
                        }
                    }
                    Text(
                        "기기 한 대와 연결한 뒤, 조용한 곳에서 두 기기를 0.5–1.5m 떨어뜨리고 볼륨을 60% 이상으로 올려 주세요. 실패하면 현재 값이 유지돼요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                    Text("연결 방식", style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SelectChip(label = "빠름 (권장)", selected = !transportTcp) { BridgeEngine.setTransportTcp(false) }
                        SelectChip(label = "안정", selected = transportTcp) { BridgeEngine.setTransportTcp(true) }
                    }
                    Text("이 기기 추가 지연 (+${extraDelayMs}ms)", style = MaterialTheme.typography.labelLarge)
                    Slider(
                        value = extraDelayMs.toFloat(),
                        onValueChange = { BridgeEngine.setExtraDelayMs(it.toInt()) },
                        valueRange = 0f..Protocol.MAX_EXTRA_DELAY_MS.toFloat(),
                    )
                    Text(
                        "공통 시각보다 이 기기를 더 늦추는 방향으로만 조절해요",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                    Text(
                        "소스 기기의 원음은 앱이 늦출 수 없어요. 함께 들을 때는 소스 기기를 음소거하고 연결된 스피커만 사용하세요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onSurfaceVariant,
                    )
                    TextButton(onClick = {
                        uiScope.launch {
                            val found = Updater.check(context.applicationContext)
                            BridgeState.update.value = found
                            BridgeState.notify(if (found != null) "새 버전이 있어요 — 위 배너에서 설치하세요" else "최신 버전을 쓰고 있어요")
                        }
                    }) { Text("업데이트 확인") }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    BridgeEngine.setMyName(nameField)
                    showSettings = false
                }) { Text("완료") }
            },
        )
    }
}

// ---------- 화면 조각 ----------

@Composable
private fun DiscoveryCard(
    discovering: Boolean,
    peers: List<app.audiobridge.net.Peer>,
    onFind: () -> Unit,
    onConnect: (String, Int) -> Unit,
    onManual: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Surface(shape = RoundedCornerShape(28.dp), color = cs.surface, border = BorderStroke(1.dp, cs.outline)) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .background(cs.secondaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(R.drawable.ic_speaker), contentDescription = null, tint = cs.onSecondaryContainer, modifier = Modifier.size(30.dp))
            }
            Text("주변 기기와 연결", style = MaterialTheme.typography.titleMedium)
            Text(
                "상대 폰은 앱을 열어 두면 자동으로 보여요.\nPC는 AudioBridgeWin을 실행해 주세요.",
                style = MaterialTheme.typography.bodySmall,
                color = cs.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Button(onClick = onFind, enabled = !discovering, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                if (discovering) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = cs.onPrimary)
                    Spacer(Modifier.width(10.dp))
                    Text("찾는 중…")
                } else {
                    Icon(Icons.Filled.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("기기 찾기")
                }
            }
            peers.forEach { peer ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = cs.surfaceVariant,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { onConnect(peer.host, peer.ctlPort) },
                ) {
                    Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(painterResource(R.drawable.ic_device_phone), contentDescription = null, tint = cs.onSurfaceVariant, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(peer.name, style = MaterialTheme.typography.bodyLarge)
                            Text(peer.host, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                        }
                        Text("연결", style = MaterialTheme.typography.labelLarge, color = cs.primary)
                    }
                }
            }
            TextButton(onClick = onManual) { Text("IP 주소로 직접 연결") }
        }
    }
}

@Composable
private fun ConnectedCard(
    peerName: String,
    peerKind: String,
    myOutput: String?,
    peerOutput: String?,
    listening: Boolean,
    sending: Boolean,
    sendPending: Boolean,
    level: Float,
    source: CaptureSource,
    speakers: List<SpeakerInfo>,
    isServer: Boolean,
    onAddSpeaker: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    val multi = speakers.size > 1
    val peerIcon = painterResource(if (peerKind == "pc") R.drawable.ic_device_pc else R.drawable.ic_device_phone)
    Surface(shape = RoundedCornerShape(28.dp), color = cs.primaryContainer) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            // 연결 상대
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                DeviceAvatar(painterResource(R.drawable.ic_device_phone))
                Row(Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    repeat(3) {
                        Box(
                            Modifier
                                .size(4.dp)
                                .clip(CircleShape)
                                .background(cs.onPrimaryContainer.copy(alpha = 0.4f))
                        )
                    }
                }
                DeviceAvatar(peerIcon)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        if (multi) "스피커 ${speakers.size}대" else peerName,
                        style = MaterialTheme.typography.titleMedium,
                        color = cs.onPrimaryContainer,
                    )
                    Text(
                        if (multi) "동시에 연결됨" else if (peerKind == "pc") "PC · 연결됨" else "폰 · 연결됨",
                        style = MaterialTheme.typography.bodySmall,
                        color = cs.onPrimaryContainer.copy(alpha = 0.7f),
                    )
                }
                IconButton(onClick = { BridgeEngine.disconnect() }) {
                    Icon(Icons.Filled.Close, contentDescription = "연결 끊기", tint = cs.onPrimaryContainer)
                }
            }

            // 소리 위치 선택
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("소리가 나오는 곳", style = MaterialTheme.typography.labelLarge, color = cs.onPrimaryContainer)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutputOption(
                        icon = painterResource(R.drawable.ic_device_phone),
                        label = "이 기기",
                        selected = myOutput == "me",
                        modifier = Modifier.weight(1f),
                    ) { BridgeEngine.chooseOutput(if (myOutput == "me") null else "me") }
                    OutputOption(
                        icon = peerIcon,
                        label = peerName.take(8),
                        selected = myOutput == "peer",
                        modifier = Modifier.weight(1f),
                    ) { BridgeEngine.chooseOutput(if (myOutput == "peer") null else "peer") }
                }
            }

            // 보낼 소리 선택 (내 소리를 상대로 보낼 때)
            if (myOutput == "peer") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SelectChip(
                        label = "미디어 소리",
                        icon = painterResource(R.drawable.ic_music),
                        selected = source == CaptureSource.INTERNAL,
                    ) {
                        if (Build.VERSION.SDK_INT < 29) BridgeState.notify("이 폰에서는 마이크만 보낼 수 있어요")
                        else BridgeEngine.setBSource(CaptureSource.INTERNAL)
                    }
                    SelectChip(
                        label = "마이크",
                        icon = painterResource(R.drawable.ic_mic),
                        selected = source == CaptureSource.MIC,
                    ) { BridgeEngine.setBSource(CaptureSource.MIC) }
                }
            }

            // 스피커 목록 + 추가 (내가 소스일 때)
            if (myOutput == "peer" && !isServer) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    speakers.forEach { sp ->
                        Column(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(cs.surface.copy(alpha = 0.6f))
                                .padding(start = 12.dp, top = 4.dp, bottom = 6.dp, end = 4.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    painterResource(if (sp.kind == "pc") R.drawable.ic_device_pc else R.drawable.ic_device_phone),
                                    contentDescription = null,
                                    tint = cs.onSurfaceVariant,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(Modifier.width(10.dp))
                                Text(sp.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                // 스테레오 페어: 탭할 때마다 양쪽 → 왼쪽 → 오른쪽 순환
                                SelectChip(
                                    label = when (sp.channel) { 1 -> "왼쪽"; 2 -> "오른쪽"; else -> "양쪽" },
                                    selected = sp.channel != 0,
                                ) { BridgeEngine.setSpeakerChannel(sp.id, (sp.channel + 1) % 3) }
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    if (sp.active && sending) "재생 중" else "대기 중",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (sp.active && sending) cs.primary else cs.onSurfaceVariant,
                                )
                                IconButton(onClick = { BridgeEngine.removeSpeaker(sp.id) }, modifier = Modifier.size(32.dp)) {
                                    Icon(Icons.Filled.Close, contentDescription = "제거", tint = cs.onSurfaceVariant, modifier = Modifier.size(16.dp))
                                }
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    painterResource(R.drawable.ic_speaker),
                                    contentDescription = "볼륨",
                                    tint = cs.onSurfaceVariant,
                                    modifier = Modifier.size(14.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Slider(
                                    value = sp.gain.toFloat(),
                                    onValueChange = { BridgeEngine.setSpeakerGain(sp.id, it.toInt()) },
                                    valueRange = 0f..100f,
                                    modifier = Modifier.weight(1f).height(24.dp),
                                )
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    "${sp.gain}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = cs.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    if (speakers.size < 4) {
                        TextButton(onClick = onAddSpeaker) { Text("+ 스피커 추가") }
                    }
                }
            }

            // 상태
            val active = listening || sending
            val status = when {
                listening -> "이 기기에서 재생 중"
                sending -> "상대 기기로 보내는 중"
                sendPending -> "준비하고 있어요…"
                myOutput == null -> "소리가 나올 곳을 골라 주세요"
                peerKind != "pc" && peerOutput == null -> "상대가 고르기를 기다리고 있어요"
                peerKind != "pc" && peerOutput != myOutput -> "상대와 선택이 달라요 — 둘 중 하나만 바꾸면 돼요"
                else -> "시작하고 있어요…"
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(status, style = MaterialTheme.typography.bodyMedium, color = cs.onPrimaryContainer)
                if (active) {
                    val animated by animateFloatAsState(level.coerceIn(0f, 1f), label = "level")
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(cs.onPrimaryContainer.copy(alpha = 0.15f))
                    ) {
                        Box(
                            Modifier
                                .fillMaxWidth(animated)
                                .height(6.dp)
                                .clip(RoundedCornerShape(3.dp))
                                .background(cs.primary)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DeviceAvatar(icon: Painter) {
    val cs = MaterialTheme.colorScheme
    Box(
        Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(cs.surface),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = cs.primary, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun OutputOption(
    icon: Painter,
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = if (selected) cs.primary else cs.surface,
        modifier = modifier
            .height(84.dp)
            .clip(RoundedCornerShape(20.dp))
            .clickable { onClick() },
    ) {
        Column(
            Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (selected) cs.onPrimary else cs.onSurfaceVariant,
                modifier = Modifier.size(24.dp),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) cs.onPrimary else cs.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SelectChip(
    label: String,
    selected: Boolean,
    icon: Painter? = null,
    onClick: () -> Unit,
) {
    val cs = MaterialTheme.colorScheme
    Surface(
        shape = RoundedCornerShape(50),
        color = if (selected) cs.secondaryContainer else cs.surface,
        border = if (selected) null else BorderStroke(1.dp, cs.outline),
        modifier = Modifier
            .clip(RoundedCornerShape(50))
            .clickable { onClick() },
    ) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon?.let {
                Icon(it, contentDescription = null, tint = if (selected) cs.onSecondaryContainer else cs.onSurfaceVariant, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = if (selected) cs.onSecondaryContainer else cs.onSurfaceVariant,
            )
        }
    }
}
