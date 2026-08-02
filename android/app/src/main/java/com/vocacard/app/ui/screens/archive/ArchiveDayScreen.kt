package com.vocacard.app.ui.screens.archive

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vocacard.app.AppContainer
import com.vocacard.app.data.model.ArchiveDay
import com.vocacard.app.data.model.ArchiveWord
import com.vocacard.app.ui.StudyScope
import com.vocacard.app.ui.components.ProgressLine
import com.vocacard.app.ui.components.StaggerIn
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.voca
import kotlinx.coroutines.launch

/**
 * Day 상세 — 단어 목록과 학습 진입.
 *
 * "뜻 가리기" 토글 하나로 목록 자체가 셀프테스트가 된다(별도 화면을 만들지 않는다).
 * 개별 단어를 눌러 바로 암기 표시하거나, 내 단어장으로 보낼 수 있다.
 */
@Composable
fun ArchiveDayScreen(
    container: AppContainer,
    dayId: String,
    onBack: () -> Unit,
    onStudy: (StudyScope) -> Unit,
    onAddWord: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val day by produceState<ArchiveDay?>(initialValue = null, dayId) {
        value = container.archive.day(dayId)
    }
    val marks by container.archive.observeMarks(dayId).collectAsState(initial = emptyMap())
    var hideMeaning by remember { mutableStateOf(false) }

    LaunchedEffect(dayId) { container.settings.setLastDay(dayId) }

    val words = day?.words.orEmpty()
    val knownCount = words.count { marks[it.id] == true }

    Column(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
    ) {
        // ── 상단 바 ──
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButtonSoft(Icons.Outlined.ArrowBack, "뒤로", onBack)
            Spacer(Modifier.weight(1f))
            IconButtonSoft(
                if (hideMeaning) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                if (hideMeaning) "뜻 보이기" else "뜻 가리기",
            ) { hideMeaning = !hideMeaning }
        }

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Column(Modifier.padding(bottom = 8.dp)) {
                    Text(
                        day?.title ?: "…",
                        style = MaterialTheme.typography.headlineLarge,
                        color = voca.ink,
                    )
                    Text(
                        "${words.size}단어 · $knownCount 개 외움",
                        style = MaterialTheme.typography.bodyMedium,
                        color = voca.inkSoft,
                    )
                    Spacer(Modifier.height(10.dp))
                    ProgressLine(
                        if (words.isEmpty()) 0f else knownCount.toFloat() / words.size,
                        Modifier.fillMaxWidth(),
                    )
                }
            }

            itemsIndexed(words, key = { _, w -> w.id }) { index, word ->
                StaggerIn(index) {
                    WordRow(
                        word = word,
                        known = marks[word.id] == true,
                        hideMeaning = hideMeaning,
                        onToggleKnown = {
                            scope.launch {
                                container.archive.mark(word.id, dayId, marks[word.id] != true)
                            }
                        },
                        onAdd = { onAddWord(word.word) },
                    )
                }
            }
        }

        // ── 하단 고정 학습 버튼 ──
        Box(
            Modifier
                .fillMaxWidth()
                .padding(20.dp)
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(voca.ink)
                    .pressable { onStudy(StudyScope.Day(dayId)) }
                    .padding(vertical = 16.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.PlayArrow, null, tint = voca.bg, modifier = Modifier.size(20.dp))
                Spacer(Modifier.size(8.dp))
                Text(
                    "이 Day 학습하기",
                    style = MaterialTheme.typography.labelLarge,
                    color = voca.bg,
                )
            }
        }
    }
}

@Composable
private fun WordRow(
    word: ArchiveWord,
    known: Boolean,
    hideMeaning: Boolean,
    onToggleKnown: () -> Unit,
    onAdd: () -> Unit,
) {
    var revealed by remember(hideMeaning) { mutableStateOf(!hideMeaning) }

    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (known) voca.accent.copy(alpha = 0.09f) else voca.surface)
            .pressable { if (hideMeaning) revealed = !revealed else onAdd() }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(word.word, style = MaterialTheme.typography.titleLarge, color = voca.ink)
            AnimatedVisibility(
                visible = revealed,
                enter = fadeIn(tween(Motion.DurShort)) + expandVertically(Motion.resize()),
                exit = fadeOut(tween(Motion.DurQuick)) + shrinkVertically(Motion.resize()),
            ) {
                Text(
                    word.displayMeaning,
                    style = MaterialTheme.typography.bodyMedium,
                    color = voca.inkSoft,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (!revealed) {
                Text(
                    "탭해서 뜻 보기",
                    style = MaterialTheme.typography.bodySmall,
                    color = voca.line,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(if (known) voca.accent else voca.surfaceAlt)
                .pressable(onToggleKnown),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Check,
                contentDescription = if (known) "외움 해제" else "외움 표시",
                tint = if (known) Color(0xFFFFF8F2) else voca.inkSoft,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
internal fun IconButtonSoft(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .clip(RoundedCornerShape(13.dp))
            .background(voca.surface)
            .pressable(onClick)
            .padding(9.dp),
    ) {
        Icon(icon, description, tint = voca.ink, modifier = Modifier.size(21.dp))
    }
}
