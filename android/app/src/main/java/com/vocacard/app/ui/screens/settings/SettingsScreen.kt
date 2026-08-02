package com.vocacard.app.ui.screens.settings

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.vocacard.app.AppContainer
import com.vocacard.app.BuildConfig
import com.vocacard.app.data.settings.Settings
import com.vocacard.app.data.settings.ThemeMode
import com.vocacard.app.ui.components.PaperCard
import com.vocacard.app.ui.components.ProgressLine
import com.vocacard.app.ui.components.SectionHeader
import com.vocacard.app.ui.components.SelectChip
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.screens.archive.IconButtonSoft
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.voca
import com.vocacard.app.update.UpdateChecker
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    container: AppContainer,
    settings: Settings,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var updateState by remember { mutableStateOf<UpdateChecker.Result?>(null) }
    var checking by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf(false) }
    var downloadProgress by remember { mutableFloatStateOf(0f) }
    var showResetDialog by remember { mutableStateOf(false) }

    fun check(silent: Boolean) {
        if (checking) return
        checking = true
        scope.launch {
            val result = container.updateChecker.check()
            checking = false
            container.settings.setLastUpdateCheck(System.currentTimeMillis())
            if (silent && result !is UpdateChecker.Result.Available) return@launch
            updateState = result
            if (!silent && result is UpdateChecker.Result.UpToDate) {
                Toast.makeText(context, "최신 버전이에요 (${result.current})", Toast.LENGTH_SHORT).show()
            }
            if (!silent && result is UpdateChecker.Result.Failed) {
                Toast.makeText(context, result.message, Toast.LENGTH_SHORT).show()
            }
        }
    }

    // 앱 실행 후 설정에 들어왔을 때 자동 확인(하루 1회). 실패해도 조용히 넘어간다.
    LaunchedEffect(settings.autoCheckUpdate) {
        val aDay = 24 * 60 * 60 * 1000L
        if (settings.autoCheckUpdate &&
            System.currentTimeMillis() - settings.lastUpdateCheck > aDay
        ) check(silent = true)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButtonSoft(Icons.Outlined.ArrowBack, "뒤로", onBack)
            Spacer(Modifier.width(8.dp))
            Text("설정", style = MaterialTheme.typography.titleLarge, color = voca.ink)
        }

        LazyColumn(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 60.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { SectionHeader("화면") }
            item {
                PaperCard(Modifier.fillMaxWidth()) {
                    Column {
                        Text("테마", style = MaterialTheme.typography.titleMedium, color = voca.ink)
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            listOf(
                                ThemeMode.SYSTEM to "시스템",
                                ThemeMode.LIGHT to "종이",
                                ThemeMode.DARK to "밤",
                            ).forEach { (mode, label) ->
                                SelectChip(
                                    text = label,
                                    selected = settings.themeMode == mode,
                                ) { scope.launch { container.settings.setTheme(mode) } }
                            }
                        }
                    }
                }
            }

            item { SectionHeader("학습") }
            item {
                PaperCard(Modifier.fillMaxWidth(), padding = 4.dp) {
                    Column {
                        ToggleRow(
                            title = "온라인 사전 추천",
                            description = "영영 정의와 원어민 예문을 함께 추천해요. 꺼도 내장 아카이브 추천은 그대로 동작합니다.",
                            checked = settings.onlineSuggest,
                        ) { scope.launch { container.settings.setOnlineSuggest(it) } }
                        ToggleRow(
                            title = "촉각 피드백",
                            description = "카드를 넘길 때 가볍게 진동해요.",
                            checked = settings.hapticFeedback,
                        ) { scope.launch { container.settings.setHaptic(it) } }
                    }
                }
            }

            item { SectionHeader("업데이트") }
            item {
                PaperCard(Modifier.fillMaxWidth()) {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "현재 버전 ${BuildConfig.VERSION_NAME}",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = voca.ink,
                                )
                                Text(
                                    "GitHub 릴리즈에서 새 버전을 확인해요",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = voca.inkSoft,
                                )
                            }
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(voca.ink)
                                    .pressable { check(silent = false) }
                                    .padding(horizontal = 15.dp, vertical = 11.dp)
                            ) {
                                Text(
                                    if (checking) "확인 중…" else "업데이트 확인",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = voca.bg,
                                )
                            }
                        }

                        val available = updateState as? UpdateChecker.Result.Available
                        AnimatedVisibility(
                            visible = available != null,
                            enter = fadeIn(tween(Motion.DurShort)) + expandVertically(Motion.resize()),
                            exit = fadeOut(tween(Motion.DurQuick)) + shrinkVertically(Motion.resize()),
                        ) {
                            if (available != null) {
                                Column(Modifier.padding(top = 14.dp)) {
                                    Text(
                                        "새 버전 ${available.version}",
                                        style = MaterialTheme.typography.titleMedium,
                                        color = voca.accent,
                                    )
                                    Spacer(Modifier.height(4.dp))
                                    Text(
                                        available.changelog,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = voca.inkSoft,
                                    )
                                    Spacer(Modifier.height(12.dp))
                                    if (downloading) {
                                        val p by animateFloatAsState(
                                            downloadProgress, Motion.progress(), label = "dl",
                                        )
                                        ProgressLine(p, Modifier.fillMaxWidth())
                                        Spacer(Modifier.height(6.dp))
                                        Text(
                                            "내려받는 중 ${(p * 100).toInt()}%",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = voca.inkSoft,
                                        )
                                    } else {
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            Box(
                                                Modifier
                                                    .weight(1f)
                                                    .clip(RoundedCornerShape(14.dp))
                                                    .background(voca.accent)
                                                    .pressable {
                                                        val url = available.apkUrl
                                                        if (url == null) {
                                                            context.startActivity(
                                                                container.updateChecker
                                                                    .releasePageIntent(available.pageUrl)
                                                            )
                                                        } else {
                                                            downloading = true
                                                            scope.launch {
                                                                val file = container.updateChecker.download(
                                                                    url, available.version,
                                                                ) { downloadProgress = it }
                                                                downloading = false
                                                                if (file != null) {
                                                                    context.startActivity(
                                                                        container.updateChecker
                                                                            .installIntent(file)
                                                                    )
                                                                } else {
                                                                    Toast.makeText(
                                                                        context,
                                                                        "내려받지 못했어요. 잠시 후 다시 시도해 주세요.",
                                                                        Toast.LENGTH_SHORT,
                                                                    ).show()
                                                                }
                                                            }
                                                        }
                                                    }
                                                    .padding(vertical = 13.dp),
                                                contentAlignment = Alignment.Center,
                                            ) {
                                                Text(
                                                    if (available.apkUrl == null) "릴리즈 페이지 열기" else "업데이트 설치",
                                                    style = MaterialTheme.typography.labelMedium,
                                                    color = androidx.compose.ui.graphics.Color(0xFFFFF8F2),
                                                )
                                            }
                                            Box(
                                                Modifier
                                                    .clip(RoundedCornerShape(14.dp))
                                                    .background(voca.surfaceAlt)
                                                    .pressable {
                                                        scope.launch {
                                                            container.settings
                                                                .setSkippedVersion(available.version)
                                                        }
                                                        updateState = null
                                                    }
                                                    .padding(horizontal = 15.dp, vertical = 13.dp),
                                            ) {
                                                Text(
                                                    "나중에",
                                                    style = MaterialTheme.typography.labelMedium,
                                                    color = voca.inkSoft,
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            item {
                PaperCard(Modifier.fillMaxWidth(), padding = 4.dp) {
                    ToggleRow(
                        title = "자동으로 업데이트 확인",
                        description = "하루에 한 번만 확인하며, 실패해도 앱 사용에는 영향이 없어요.",
                        checked = settings.autoCheckUpdate,
                    ) { scope.launch { container.settings.setAutoCheckUpdate(it) } }
                }
            }

            item { SectionHeader("데이터") }
            item {
                PaperCard(
                    Modifier.fillMaxWidth(),
                    onClick = { showResetDialog = true },
                ) {
                    Column {
                        Text(
                            "학습 기록 초기화",
                            style = MaterialTheme.typography.titleMedium,
                            color = voca.dontKnow,
                        )
                        Text(
                            "내 단어장과 아카이브 진행률을 모두 지웁니다. 되돌릴 수 없어요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = voca.inkSoft,
                        )
                    }
                }
            }

            item {
                Text(
                    "아카이브 데이터는 사용자가 제공한 30일 단어 목록을 기기 안에 그대로 담은 것입니다.\n" +
                        "이 앱은 서버를 두지 않으며, 학습 기록은 기기 밖으로 나가지 않습니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = voca.inkSoft.copy(alpha = 0.75f),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }

    if (showResetDialog) {
        AlertDialog(
            onDismissRequest = { showResetDialog = false },
            title = { Text("학습 기록을 모두 지울까요?") },
            text = { Text("내 단어장의 단어와 아카이브 진행률이 사라집니다. 되돌릴 수 없습니다.") },
            confirmButton = {
                TextButton(onClick = {
                    showResetDialog = false
                    scope.launch {
                        container.words.resetAll()
                        container.archive.resetMarks()
                        Toast.makeText(context, "초기화했어요", Toast.LENGTH_SHORT).show()
                    }
                }) { Text("지우기", color = voca.dontKnow) }
            },
            dismissButton = {
                TextButton(onClick = { showResetDialog = false }) { Text("취소") }
            },
            containerColor = voca.surface,
        )
    }
}

@Composable
private fun ToggleRow(
    title: String,
    description: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .pressable { onChange(!checked) }
            .padding(horizontal = 13.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = voca.ink)
            Text(description, style = MaterialTheme.typography.bodySmall, color = voca.inkSoft)
        }
        Spacer(Modifier.width(10.dp))
        Switch(
            checked = checked,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = voca.surface,
                checkedTrackColor = voca.accent,
                uncheckedThumbColor = voca.surface,
                uncheckedTrackColor = voca.line,
            ),
        )
    }
}
