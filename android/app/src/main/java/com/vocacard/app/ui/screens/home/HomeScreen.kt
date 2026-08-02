package com.vocacard.app.ui.screens.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vocacard.app.AppContainer
import com.vocacard.app.data.settings.Settings
import com.vocacard.app.ui.StudyScope
import com.vocacard.app.ui.components.PaperCard
import com.vocacard.app.ui.components.ProgressLine
import com.vocacard.app.ui.components.ProgressRing
import com.vocacard.app.ui.components.SectionHeader
import com.vocacard.app.ui.components.StaggerIn
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.theme.VocaShape
import com.vocacard.app.ui.theme.WordDisplay
import com.vocacard.app.ui.theme.voca
import java.util.Calendar

/**
 * 홈 — "지금 뭘 해야 하는가"에만 답하는 화면.
 *
 * 기능 중복을 피하기 위해 홈에는 **학습 진입점과 요약만** 둔다.
 * 단어 목록·검색·편집은 각각 아카이브/추가/내 단어 탭에만 존재한다.
 */
@Composable
fun HomeScreen(
    container: AppContainer,
    settings: Settings,
    onOpenDay: (String) -> Unit,
    onStudy: (StudyScope) -> Unit,
    onOpenArchive: () -> Unit,
    onOpenAdd: () -> Unit,
    onOpenMyWords: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val dueCount by container.words.observeDueCount().collectAsState(initial = 0)
    val myTotal by container.words.observeTotal().collectAsState(initial = 0)
    val mastered by container.words.observeMastered().collectAsState(initial = 0)
    val archiveLearned by container.archive.observeLearnedTotal().collectAsState(initial = 0)
    val dayProgress by container.archive.observeDayProgress().collectAsState(initial = emptyMap())
    val sessions by container.words.observeSessions().collectAsState(initial = emptyList())

    val days by produceState(initialValue = emptyList<com.vocacard.app.data.model.ArchiveDay>()) {
        value = container.archive.days()
    }
    val archiveTotal = remember(days) { days.sumOf { it.words.size } }

    val streak = remember(sessions) { computeStreak(sessions.map { it.startedAt }) }
    val continueDay: com.vocacard.app.data.model.ArchiveDay? =
        remember(days, dayProgress, settings.lastDayId) {
            settings.lastDayId?.let { id -> days.firstOrNull { it.id == id } }
                ?: days.firstOrNull { (dayProgress[it.id]?.learnedCount ?: 0) < it.words.size }
                ?: days.firstOrNull()
        }

    LazyColumn(
        Modifier
            .fillMaxSize()
            .background(voca.bg),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 20.dp, end = 20.dp, bottom = 120.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {

        item {
            Row(
                Modifier
                    .fillMaxWidth()
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(top = 14.dp, bottom = 2.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(greeting(), style = MaterialTheme.typography.bodyMedium, color = voca.inkSoft)
                    Text(
                        "단어장",
                        style = MaterialTheme.typography.headlineLarge,
                        color = voca.ink,
                    )
                }
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(voca.surface)
                        .pressable(onOpenSettings)
                        .padding(10.dp)
                ) {
                    Icon(Icons.Outlined.Settings, "설정", tint = voca.inkSoft, modifier = Modifier.size(21.dp))
                }
            }
        }

        // ── 오늘 복습 (가장 중요한 액션) ──
        item {
            StaggerIn(0) {
                TodayCard(
                    dueCount = dueCount,
                    myTotal = myTotal,
                    onStart = { onStudy(StudyScope.Due) },
                    onOpenMyWords = onOpenMyWords,
                    onAdd = onOpenAdd,
                )
            }
        }

        // ── 통계 3종 ──
        item {
            StaggerIn(1) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile("$archiveLearned", "외운 아카이브 단어", Modifier.weight(1f))
                    StatTile("$mastered", "마스터한 내 단어", Modifier.weight(1f))
                    StatTile("${streak}일", "연속 학습", Modifier.weight(1f))
                }
            }
        }

        // ── 이어서 학습 ──
        if (continueDay != null) {
            item {
                StaggerIn(2) {
                    SectionHeader("이어서 학습") {
                        Row(
                            Modifier.pressable(onOpenArchive),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("전체 보기", style = MaterialTheme.typography.labelMedium, color = voca.accent)
                            Icon(Icons.Outlined.ChevronRight, null, tint = voca.accent, modifier = Modifier.size(16.dp))
                        }
                    }
                }
            }
            item {
                val day = continueDay
                val progress = dayProgress[day.id]
                val learned = progress?.learnedCount ?: 0
                StaggerIn(3) {
                    PaperCard(Modifier.fillMaxWidth(), onClick = { onOpenDay(day.id) }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ProgressRing(
                                progress = if (day.words.isEmpty()) 0f else learned.toFloat() / day.words.size,
                                size = 56.dp,
                                stroke = 6.dp,
                            ) {
                                Text(
                                    "${day.index}",
                                    style = MaterialTheme.typography.titleLarge,
                                    color = voca.ink,
                                )
                            }
                            Spacer(Modifier.size(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(day.title, style = MaterialTheme.typography.titleLarge, color = voca.ink)
                                Text(
                                    "${day.words.size}단어 · $learned 개 외움",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = voca.inkSoft,
                                )
                                Spacer(Modifier.height(8.dp))
                                Text(
                                    day.words.take(4).joinToString(" · ") { it.word },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = voca.inkSoft.copy(alpha = 0.75f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            Icon(Icons.Outlined.ChevronRight, null, tint = voca.line)
                        }
                    }
                }
            }
        }

        // ── 아카이브 미리보기 가로 스크롤 ──
        item {
            StaggerIn(4) { SectionHeader("30일 아카이브") }
        }
        item {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 2.dp),
            ) {
                items(days, key = { it.id }) { day ->
                    val p = dayProgress[day.id]
                    val ratio = if (day.words.isEmpty()) 0f else (p?.learnedCount ?: 0).toFloat() / day.words.size
                    DayChip(index = day.index, ratio = ratio) { onOpenDay(day.id) }
                }
            }
        }

        item {
            StaggerIn(5) {
                PaperCard(Modifier.fillMaxWidth(), onClick = onOpenAdd) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(13.dp))
                                .background(voca.accent.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Outlined.Add, null, tint = voca.accent) }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text("몰랐던 단어 추가", style = MaterialTheme.typography.titleMedium, color = voca.ink)
                            Text(
                                "영어를 적으면 뜻과 예문을 추천해 드려요",
                                style = MaterialTheme.typography.bodySmall,
                                color = voca.inkSoft,
                            )
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = voca.line)
                    }
                }
            }
        }

        if (archiveTotal > 0) {
            item {
                Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "아카이브 진행률 ${(archiveLearned * 100 / archiveTotal.coerceAtLeast(1))}%",
                        style = MaterialTheme.typography.labelMedium,
                        color = voca.inkSoft,
                    )
                    ProgressLine(archiveLearned.toFloat() / archiveTotal, Modifier.fillMaxWidth())
                }
            }
        }
    }
}

@Composable
private fun TodayCard(
    dueCount: Int,
    myTotal: Int,
    onStart: () -> Unit,
    onOpenMyWords: () -> Unit,
    onAdd: () -> Unit,
) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(VocaShape.card))
            .background(voca.ink)
            .padding(20.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                if (dueCount > 0) "오늘 복습할 단어" else "복습 완료",
                style = MaterialTheme.typography.labelMedium,
                color = voca.bg.copy(alpha = 0.6f),
            )
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    if (dueCount > 0) "$dueCount" else "0",
                    style = WordDisplay,
                    color = voca.bg,
                )
                Text(
                    "  개",
                    style = MaterialTheme.typography.titleLarge,
                    color = voca.bg.copy(alpha = 0.6f),
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            Text(
                when {
                    myTotal == 0 -> "아직 모은 단어가 없어요. 학습 중 모르는 단어는 자동으로 여기 쌓입니다."
                    dueCount > 0 -> "잊어버릴 때가 됐어요. 지금 한 번 더 보면 오래 남아요."
                    else -> "오늘 몫은 끝났어요. 내일 다시 만나요."
                },
                style = MaterialTheme.typography.bodySmall,
                color = voca.bg.copy(alpha = 0.72f),
            )
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (dueCount > 0) {
                    DarkButton("복습 시작", primary = true, modifier = Modifier.weight(1f), onClick = onStart)
                    DarkButton("내 단어 보기", primary = false, onClick = onOpenMyWords)
                } else {
                    DarkButton("단어 추가", primary = true, modifier = Modifier.weight(1f), onClick = onAdd)
                    DarkButton("내 단어 보기", primary = false, onClick = onOpenMyWords)
                }
            }
        }
    }
}

@Composable
private fun DarkButton(
    text: String,
    primary: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .background(if (primary) voca.accent else Color.Transparent)
            .let {
                if (primary) it else it.background(voca.bg.copy(alpha = 0.10f))
            }
            .pressable(onClick)
            .padding(horizontal = 18.dp, vertical = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelLarge,
            color = if (primary) Color(0xFFFFF8F2) else voca.bg.copy(alpha = 0.9f),
        )
    }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    PaperCard(modifier, padding = 13.dp) {
        Column {
            Text(value, style = MaterialTheme.typography.headlineMedium, color = voca.ink)
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = voca.inkSoft,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun DayChip(index: Int, ratio: Float, onClick: () -> Unit) {
    Column(
        Modifier
            .size(width = 68.dp, height = 78.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(voca.surface)
            .pressable(onClick)
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text("DAY", style = MaterialTheme.typography.labelSmall, color = voca.inkSoft)
        Text("$index", style = MaterialTheme.typography.titleLarge, color = voca.ink)
        ProgressLine(ratio, Modifier.fillMaxWidth(), height = 4.dp)
    }
}

private fun greeting(): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when (hour) {
        in 5..11 -> "좋은 아침이에요"
        in 12..17 -> "오후에도 한 장"
        in 18..22 -> "하루를 정리하며"
        else -> "늦은 밤에도"
    }
}

/** 최근 학습 기록으로 연속 학습일 계산. */
private fun computeStreak(timestamps: List<Long>): Int {
    if (timestamps.isEmpty()) return 0
    val dayMs = 24 * 60 * 60 * 1000L
    fun dayIndex(t: Long): Long {
        val cal = Calendar.getInstance().apply { timeInMillis = t }
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis / dayMs
    }
    val today = dayIndex(System.currentTimeMillis())
    val days = timestamps.map(::dayIndex).toSortedSet().reversed()
    if (days.isEmpty()) return 0
    if (days.first() < today - 1) return 0
    var streak = 0
    var expect = days.first()
    for (d in days) {
        if (d == expect) {
            streak++
            expect -= 1
        } else if (d < expect) break
    }
    return streak
}
