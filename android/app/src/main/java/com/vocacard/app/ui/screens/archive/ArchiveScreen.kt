package com.vocacard.app.ui.screens.archive

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vocacard.app.AppContainer
import com.vocacard.app.data.model.ArchiveDay
import com.vocacard.app.ui.components.ProgressLine
import com.vocacard.app.ui.components.StaggerIn
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.theme.voca

/**
 * 아카이브 — 엑셀에서 옮겨 온 30일 커리큘럼을 Day 단위로 보여 준다.
 * 여기서는 **탐색만** 한다. 학습은 Day 상세에서 시작한다(진입점 단일화).
 */
@Composable
fun ArchiveScreen(
    container: AppContainer,
    onOpenDay: (String) -> Unit,
) {
    val days by produceState(initialValue = emptyList<ArchiveDay>()) {
        value = container.archive.days()
    }
    val progress by container.archive.observeDayProgress().collectAsState(initial = emptyMap())

    val totalWords = remember(days) { days.sumOf { it.words.size } }
    val learned = remember(progress) { progress.values.sumOf { it.learnedCount } }

    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        modifier = Modifier
            .fillMaxSize()
            .background(voca.bg),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 120.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(3) }) {
            Column(
                Modifier
                    .windowInsetsPadding(WindowInsets.statusBars)
                    .padding(top = 14.dp, bottom = 12.dp)
            ) {
                Text("아카이브", style = MaterialTheme.typography.headlineLarge, color = voca.ink)
                Text(
                    "30일 · ${totalWords}단어",
                    style = MaterialTheme.typography.bodyMedium,
                    color = voca.inkSoft,
                )
                Spacer(Modifier.height(12.dp))
                ProgressLine(
                    if (totalWords == 0) 0f else learned.toFloat() / totalWords,
                    Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    "$learned / $totalWords 외움",
                    style = MaterialTheme.typography.labelMedium,
                    color = voca.inkSoft,
                )
            }
        }

        itemsIndexed(days, key = { _, d -> d.id }) { index, day ->
            val p = progress[day.id]
            val ratio = if (day.words.isEmpty()) 0f else (p?.learnedCount ?: 0).toFloat() / day.words.size
            StaggerIn(index) {
                DayTile(day = day, ratio = ratio, onClick = { onOpenDay(day.id) })
            }
        }
    }
}

@Composable
private fun DayTile(day: ArchiveDay, ratio: Float, onClick: () -> Unit) {
    val done = ratio >= 1f
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(0.92f)
            .clip(RoundedCornerShape(20.dp))
            .background(if (done) voca.accent.copy(alpha = 0.12f) else voca.surface)
            .pressable(onClick)
            .padding(13.dp)
    ) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text(
                    "DAY",
                    style = MaterialTheme.typography.labelSmall,
                    color = voca.inkSoft.copy(alpha = 0.8f),
                )
                Text(
                    "${day.index}",
                    style = MaterialTheme.typography.headlineMedium,
                    color = if (done) voca.accent else voca.ink,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    day.words.firstOrNull()?.word.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = voca.inkSoft,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                ProgressLine(ratio, Modifier.fillMaxWidth(), height = 4.dp)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${day.words.size}단어",
                        style = MaterialTheme.typography.labelSmall,
                        color = voca.inkSoft,
                    )
                    Text(
                        "${(ratio * 100).toInt()}%",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (done) voca.accent else voca.inkSoft,
                    )
                }
            }
        }
    }
}
