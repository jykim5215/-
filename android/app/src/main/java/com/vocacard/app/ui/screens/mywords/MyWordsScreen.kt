package com.vocacard.app.ui.screens.mywords

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vocacard.app.AppContainer
import com.vocacard.app.data.db.WordWithState
import com.vocacard.app.data.study.Scheduler
import com.vocacard.app.ui.StudyScope
import com.vocacard.app.ui.components.EmptyState
import com.vocacard.app.ui.components.StaggerIn
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.voca
import kotlinx.coroutines.launch

private enum class WordFilter(val label: String) {
    DUE("복습 예정"), ALL("전체"), HARD("어려움"), MASTERED("마스터"),
}

/**
 * 내 단어장 — "몰랐던 단어"가 모이는 곳.
 *
 * 학습 중 몰랐던 단어가 자동으로 여기 쌓이고, 직접 추가한 단어도 같은 목록에 들어온다.
 * (수집 경로는 둘이지만 보관·복습 경로는 하나로 통합)
 */
@Composable
fun MyWordsScreen(
    container: AppContainer,
    onStudy: (StudyScope) -> Unit,
    onOpenWord: (Long) -> Unit,
    onAdd: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val all by container.words.observeAll().collectAsState(initial = emptyList())
    var filter by remember { mutableStateOf(WordFilter.DUE) }

    val dueCount = remember(all) { all.count { it.isDue } }
    val visible = remember(all, filter) {
        when (filter) {
            WordFilter.DUE -> all.filter { it.isDue }
            WordFilter.ALL -> all
            WordFilter.HARD -> all.filter { it.isHard }
            WordFilter.MASTERED -> all.filter { it.isMastered }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
    ) {
        Column(
            Modifier
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(start = 20.dp, end = 20.dp, top = 14.dp)
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("내 단어", style = MaterialTheme.typography.headlineLarge, color = voca.ink)
                    Text(
                        "${all.size}개 · 오늘 복습 ${dueCount}개",
                        style = MaterialTheme.typography.bodyMedium,
                        color = voca.inkSoft,
                    )
                }
                if (all.isNotEmpty()) {
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(15.dp))
                            .background(voca.ink)
                            .pressable {
                                onStudy(
                                    when (filter) {
                                        WordFilter.DUE -> StudyScope.Due
                                        WordFilter.HARD -> StudyScope.Hard
                                        else -> StudyScope.MyWords
                                    }
                                )
                            }
                            .padding(horizontal = 14.dp, vertical = 11.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.PlayArrow, null, tint = voca.bg, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("학습", style = MaterialTheme.typography.labelLarge, color = voca.bg)
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                itemsIndexed(WordFilter.entries.toList()) { _, f ->
                    val count = when (f) {
                        WordFilter.DUE -> all.count { it.isDue }
                        WordFilter.ALL -> all.size
                        WordFilter.HARD -> all.count { it.isHard }
                        WordFilter.MASTERED -> all.count { it.isMastered }
                    }
                    FilterChip(f.label, count, filter == f) { filter = f }
                }
            }
            Spacer(Modifier.height(10.dp))
        }

        if (visible.isEmpty()) {
            EmptyState(
                icon = Icons.Outlined.Bookmarks,
                title = if (all.isEmpty()) "아직 모은 단어가 없어요" else "이 조건에 맞는 단어가 없어요",
                description = if (all.isEmpty()) {
                    "학습 중 \"몰라요\"를 누른 단어가 자동으로 여기 쌓여요.\n직접 추가할 수도 있습니다."
                } else {
                    "다른 필터를 눌러 보세요."
                },
                modifier = Modifier.fillMaxWidth(),
                action = if (all.isEmpty()) {
                    {
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(16.dp))
                                .background(voca.ink)
                                .pressable(onAdd)
                                .padding(horizontal = 20.dp, vertical = 13.dp)
                        ) {
                            Text("단어 추가하기", style = MaterialTheme.typography.labelLarge, color = voca.bg)
                        }
                    }
                } else null,
            )
        } else {
            LazyColumn(
                Modifier.weight(1f),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 120.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                itemsIndexed(visible, key = { _, w -> w.id }) { index, word ->
                    StaggerIn(index) {
                        MyWordRow(
                            word = word,
                            onClick = { onOpenWord(word.id) },
                            onTogglePin = {
                                scope.launch { container.words.setPinned(word.id, !word.pinned) }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, count: Int, selected: Boolean, onClick: () -> Unit) {
    val bg by animateColorAsState(
        if (selected) voca.ink else voca.surface, tween(Motion.DurQuick), label = "filterBg",
    )
    val fg by animateColorAsState(
        if (selected) voca.bg else voca.inkSoft, tween(Motion.DurQuick), label = "filterFg",
    )
    Row(
        Modifier
            .clip(RoundedCornerShape(99.dp))
            .background(bg)
            .border(1.dp, if (selected) Color.Transparent else voca.line, RoundedCornerShape(99.dp))
            .pressable(onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = fg)
        Text("$count", style = MaterialTheme.typography.labelSmall, color = fg.copy(alpha = 0.65f))
    }
}

@Composable
private fun MyWordRow(word: WordWithState, onClick: () -> Unit, onTogglePin: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(voca.surface)
            .pressable(onClick)
            .padding(15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(word.word, style = MaterialTheme.typography.titleLarge, color = voca.ink)
                if (word.sourceDayId != null) {
                    Spacer(Modifier.width(7.dp))
                    Text(
                        word.sourceDayId.replace("day", "Day "),
                        style = MaterialTheme.typography.labelSmall,
                        color = voca.inkSoft.copy(alpha = 0.7f),
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(voca.surfaceAlt)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                }
            }
            Text(
                word.meanings.joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = voca.inkSoft,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(5.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    Scheduler.boxLabel(word.box ?: 0),
                    style = MaterialTheme.typography.labelSmall,
                    color = voca.accent,
                )
                Text(
                    Scheduler.describeDue(word.dueAt ?: 0L),
                    style = MaterialTheme.typography.labelSmall,
                    color = voca.inkSoft.copy(alpha = 0.8f),
                )
                if ((word.wrongCount ?: 0) > 0) {
                    Text(
                        "틀림 ${word.wrongCount}",
                        style = MaterialTheme.typography.labelSmall,
                        color = voca.dontKnow.copy(alpha = 0.8f),
                    )
                }
            }
        }
        Box(
            Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(11.dp))
                .background(if (word.pinned) voca.highlight.copy(alpha = 0.2f) else Color.Transparent)
                .pressable(onTogglePin),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.PushPin,
                contentDescription = if (word.pinned) "고정 해제" else "고정",
                tint = if (word.pinned) voca.highlight else voca.line,
                modifier = Modifier.size(17.dp),
            )
        }
    }
}
