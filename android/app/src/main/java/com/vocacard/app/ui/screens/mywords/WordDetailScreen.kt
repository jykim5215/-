package com.vocacard.app.ui.screens.mywords

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import com.vocacard.app.AppContainer
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.model.ExampleSource
import com.vocacard.app.data.settings.Settings
import com.vocacard.app.data.study.Scheduler
import com.vocacard.app.ui.components.PaperCard
import com.vocacard.app.ui.components.SectionHeader
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.screens.archive.IconButtonSoft
import com.vocacard.app.ui.theme.WordDisplay
import com.vocacard.app.ui.theme.voca
import kotlinx.coroutines.launch

/**
 * 내 단어 상세 — 뜻/예문/메모를 정리하고 편집한다.
 * 추천을 더 받고 싶으면 "단어 추가" 화면에서 같은 단어를 다시 검색하면 되므로,
 * 여기서는 추천 기능을 중복해서 제공하지 않는다(선택은 한 곳에서만).
 */
@Composable
fun WordDetailScreen(
    container: AppContainer,
    settings: Settings,
    wordId: Long,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val word by container.words.observeOne(wordId).collectAsState(initial = null)

    var newMeaning by remember { mutableStateOf("") }
    var newExample by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var noteLoaded by remember { mutableStateOf(false) }

    LaunchedEffect(word?.id) {
        val w = word
        if (w != null && !noteLoaded) {
            note = w.note
            noteLoaded = true
        }
    }

    val w = word

    Column(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
            .imePadding()
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButtonSoft(Icons.Outlined.ArrowBack, "뒤로", onBack)
            Spacer(Modifier.weight(1f))
            IconButtonSoft(Icons.Outlined.DeleteOutline, "삭제") {
                scope.launch {
                    container.words.delete(wordId)
                    onBack()
                }
            }
        }

        if (w == null) return@Column

        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 60.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column {
                    Text(w.word, style = WordDisplay, color = voca.ink)
                    if (!w.phonetic.isNullOrBlank()) {
                        Text(
                            w.phonetic.orEmpty(),
                            style = MaterialTheme.typography.bodyMedium,
                            color = voca.inkSoft,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        Pill(Scheduler.boxLabel(w.box ?: 0), voca.accent)
                        Pill(Scheduler.describeDue(w.dueAt ?: 0L), voca.inkSoft)
                        if ((w.wrongCount ?: 0) > 0) {
                            Pill("틀림 ${w.wrongCount}회", voca.dontKnow)
                        }
                        if (w.sourceDayId != null) {
                            Pill(w.sourceDayId.replace("day", "Day "), voca.accentSoft)
                        }
                    }
                }
            }

            item { SectionHeader("뜻") }

            items(w.meanings) { meaning ->
                PaperCard(Modifier.fillMaxWidth(), padding = 13.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            meaning,
                            style = MaterialTheme.typography.bodyLarge,
                            color = voca.ink,
                            modifier = Modifier.weight(1f),
                        )
                        RemoveButton {
                            scope.launch {
                                container.words.update(wordId, meanings = w.meanings - meaning)
                            }
                        }
                    }
                }
            }

            item {
                AddRow(
                    value = newMeaning,
                    onValueChange = { newMeaning = it },
                    placeholder = "뜻 추가",
                ) {
                    val t = newMeaning.trim()
                    if (t.isNotEmpty()) {
                        scope.launch {
                            container.words.update(wordId, meanings = (w.meanings + t).distinct())
                        }
                        newMeaning = ""
                    }
                }
            }

            item { SectionHeader("예문") }

            if (w.examples.isEmpty()) {
                item {
                    Text(
                        "저장된 예문이 없어요. 아래에 적어 두면 카드 뒷면에 함께 보여 드려요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = voca.inkSoft,
                    )
                }
            }

            items(w.examples) { ex ->
                PaperCard(Modifier.fillMaxWidth(), padding = 13.dp) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(
                                "“${ex.text}”",
                                style = MaterialTheme.typography.bodyLarge,
                                color = voca.ink,
                                fontStyle = FontStyle.Italic,
                            )
                            if (ex.translation.isNotBlank()) {
                                Text(
                                    ex.translation,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = voca.inkSoft,
                                )
                            }
                        }
                        RemoveButton {
                            scope.launch {
                                container.words.update(wordId, examples = w.examples - ex)
                            }
                        }
                    }
                }
            }

            item {
                AddRow(
                    value = newExample,
                    onValueChange = { newExample = it },
                    placeholder = "예문 추가",
                ) {
                    val t = newExample.trim()
                    if (t.isNotEmpty()) {
                        scope.launch {
                            container.words.update(
                                wordId,
                                examples = w.examples + Example(t, source = ExampleSource.MANUAL),
                            )
                        }
                        newExample = ""
                    }
                }
            }

            item { SectionHeader("메모") }
            item {
                OutlinedTextField(
                    value = note,
                    onValueChange = {
                        note = it
                        scope.launch { container.words.update(wordId, note = it) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("헷갈리는 포인트를 적어 두세요") },
                    minLines = 3,
                    shape = RoundedCornerShape(16.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = voca.surface,
                        unfocusedContainerColor = voca.surface,
                        focusedIndicatorColor = voca.accent,
                        unfocusedIndicatorColor = voca.line,
                    ),
                )
            }
        }
    }
}

@Composable
private fun Pill(text: String, color: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 9.dp, vertical = 4.dp)
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

@Composable
private fun RemoveButton(onClick: () -> Unit) {
    Box(
        Modifier
            .size(28.dp)
            .clip(RoundedCornerShape(9.dp))
            .pressable(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Outlined.Close, "삭제", tint = voca.line, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun AddRow(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onAdd: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.weight(1f),
            singleLine = true,
            placeholder = { Text(placeholder, style = MaterialTheme.typography.bodyMedium) },
            shape = RoundedCornerShape(16.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = voca.surface,
                unfocusedContainerColor = voca.surface,
                focusedIndicatorColor = voca.accent,
                unfocusedIndicatorColor = voca.line,
            ),
        )
        Box(
            Modifier
                .size(52.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(if (value.isBlank()) voca.surfaceAlt else voca.ink)
                .pressable(onAdd)
                .border(1.dp, Color.Transparent, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "+",
                style = MaterialTheme.typography.titleLarge,
                color = if (value.isBlank()) voca.inkSoft else voca.bg,
            )
        }
    }
}
