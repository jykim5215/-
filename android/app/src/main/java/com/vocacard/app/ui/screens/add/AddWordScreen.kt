package com.vocacard.app.ui.screens.add

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vocacard.app.AppContainer
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.model.ExampleSource
import com.vocacard.app.data.model.MeaningCandidate
import com.vocacard.app.data.settings.Settings
import com.vocacard.app.ui.components.PaperCard
import com.vocacard.app.ui.components.SectionHeader
import com.vocacard.app.ui.components.SpeakButton
import com.vocacard.app.ui.components.StaggerIn
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.factoryOf
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.WordDisplay
import com.vocacard.app.ui.theme.voca

/**
 * 단어 추가 — 사용자 요구사항의 핵심 화면.
 *
 * 영어를 적으면 **추천 뜻**(다의어는 뜻마다 하나씩)을 띄우고, 사용자가 골라 저장한다.
 * **예문도 함께 추천**하며 선택·편집해서 같이 저장할 수 있다.
 *
 * 검색과 추가를 한 화면에 통합했다(같은 기능을 두 곳에 두지 않는다는 원칙).
 * 이미 저장된 단어를 입력하면 "이미 있음" 배지와 함께 기존 뜻이 후보로 함께 나온다.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddWordScreen(
    container: AppContainer,
    settings: Settings,
    initialWord: String,
    onSaved: () -> Unit,
    onOpenWord: (Long) -> Unit,
) {
    val vm: AddWordViewModel = viewModel(
        factory = factoryOf(container, AddWordViewModel::class.java to { c -> AddWordViewModel(c) }),
    )
    val state by vm.state.collectAsState()

    LaunchedEffect(settings.onlineSuggest) { vm.setOnlineEnabled(settings.onlineSuggest) }
    LaunchedEffect(initialWord) {
        if (initialWord.isNotBlank() && state.query.isBlank()) vm.pickAutocomplete(initialWord)
    }

    var customMeaning by remember { mutableStateOf("") }
    var customExample by remember { mutableStateOf("") }

    Box(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
    ) {
        LazyColumn(
            Modifier
                .fillMaxSize()
                .imePadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 160.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {

            item {
                Column(
                    Modifier
                        .windowInsetsPadding(WindowInsets.statusBars)
                        .padding(top = 14.dp)
                ) {
                    Text("단어 추가", style = MaterialTheme.typography.headlineLarge, color = voca.ink)
                    Text(
                        "영어를 적으면 뜻과 예문을 추천해 드려요",
                        style = MaterialTheme.typography.bodyMedium,
                        color = voca.inkSoft,
                    )
                }
            }

            // ── 입력창 ──
            item {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = vm::onQueryChange,
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    textStyle = MaterialTheme.typography.titleLarge,
                    placeholder = { Text("예: cover", style = MaterialTheme.typography.titleLarge) },
                    leadingIcon = { Icon(Icons.Outlined.Search, null, tint = voca.inkSoft) },
                    trailingIcon = {
                        if (state.loading) {
                            CircularProgressIndicator(
                                Modifier.size(19.dp),
                                strokeWidth = 2.dp,
                                color = voca.accent,
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
                    shape = RoundedCornerShape(18.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = voca.surface,
                        unfocusedContainerColor = voca.surface,
                        focusedIndicatorColor = voca.accent,
                        unfocusedIndicatorColor = voca.line,
                    ),
                )
            }

            // ── 아카이브 자동완성 ──
            if (state.autocomplete.isNotEmpty() && state.suggestion == null) {
                item {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        state.autocomplete.forEach { w ->
                            Box(
                                Modifier
                                    .clip(RoundedCornerShape(99.dp))
                                    .background(voca.surface)
                                    .border(1.dp, voca.line, RoundedCornerShape(99.dp))
                                    .pressable { vm.pickAutocomplete(w) }
                                    .padding(horizontal = 13.dp, vertical = 8.dp)
                            ) {
                                Text(w, style = MaterialTheme.typography.labelMedium, color = voca.ink)
                            }
                        }
                    }
                }
            }

            val suggestion = state.suggestion
            if (suggestion != null) {

                // ── 헤드워드 ──
                item {
                    StaggerIn(0) {
                        PaperCard(Modifier.fillMaxWidth()) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(suggestion.query, style = WordDisplay, color = voca.ink)
                                    Spacer(Modifier.width(10.dp))
                                    SpeakButton(suggestion.query, size = 36.dp)
                                    Spacer(Modifier.width(8.dp))
                                    if (state.alreadySaved) {
                                        Badge("이미 저장됨", voca.highlight)
                                    }
                                }
                                if (!suggestion.phonetic.isNullOrBlank()) {
                                    Text(
                                        suggestion.phonetic,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = voca.inkSoft,
                                    )
                                }
                                if (suggestion.archiveDayId != null) {
                                    Spacer(Modifier.height(6.dp))
                                    Badge(
                                        "아카이브 ${suggestion.archiveDayId.replace("day", "Day ")}",
                                        voca.accent,
                                    )
                                }
                            }
                        }
                    }
                }

                // ── 오프라인 안내 ──
                if (state.message != null) {
                    item {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(voca.surfaceAlt)
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Outlined.CloudOff,
                                null,
                                tint = voca.inkSoft,
                                modifier = Modifier.size(17.dp),
                            )
                            Spacer(Modifier.width(9.dp))
                            Text(
                                state.message.orEmpty(),
                                style = MaterialTheme.typography.bodySmall,
                                color = voca.inkSoft,
                            )
                        }
                    }
                }

                // ── 추천 뜻 ──
                item {
                    SectionHeader("추천 뜻") {
                        Text(
                            "${state.selectedMeanings.size}개 선택",
                            style = MaterialTheme.typography.labelMedium,
                            color = voca.accent,
                        )
                    }
                }

                if (state.allMeaningCandidates.isEmpty()) {
                    item {
                        Text(
                            "추천할 뜻을 찾지 못했어요. 아래에서 직접 입력해 주세요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = voca.inkSoft,
                        )
                    }
                } else {
                    itemsIndexed(state.allMeaningCandidates) { index, candidate ->
                        StaggerIn(index) {
                            MeaningRow(
                                candidate = candidate,
                                selected = candidate.text in state.selectedMeanings,
                                onToggle = { vm.toggleMeaning(candidate.text) },
                            )
                        }
                    }
                }

                item {
                    InlineAdd(
                        value = customMeaning,
                        onValueChange = { customMeaning = it },
                        placeholder = "뜻 직접 입력",
                        onAdd = {
                            vm.addCustomMeaning(customMeaning)
                            customMeaning = ""
                        },
                    )
                }

                // ── 추천 예문 ──
                item { SectionHeader("추천 예문") }

                if (state.allExampleCandidates.isEmpty()) {
                    item {
                        Text(
                            "예문을 찾지 못했어요. 직접 적어 두면 나중에 카드 뒷면에 함께 보여 드려요.",
                            style = MaterialTheme.typography.bodySmall,
                            color = voca.inkSoft,
                        )
                    }
                } else {
                    itemsIndexed(state.allExampleCandidates) { index, example ->
                        StaggerIn(index) {
                            ExampleRow(
                                example = example,
                                selected = example.text in state.selectedExamples,
                                onToggle = { vm.toggleExample(example.text) },
                            )
                        }
                    }
                }

                item {
                    InlineAdd(
                        value = customExample,
                        onValueChange = { customExample = it },
                        placeholder = "예문 직접 입력",
                        onAdd = {
                            vm.addCustomExample(customExample)
                            customExample = ""
                        },
                    )
                }

                item {
                    OutlinedTextField(
                        value = state.note,
                        onValueChange = vm::setNote,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("메모 (선택)") },
                        shape = RoundedCornerShape(16.dp),
                        minLines = 2,
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

        // ── 저장 버튼 (항상 손 닿는 곳에) ──
        AnimatedVisibility(
            visible = state.suggestion != null,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = fadeIn(tween(Motion.DurShort)) + expandVertically(Motion.resize()),
            exit = fadeOut(tween(Motion.DurQuick)) + shrinkVertically(Motion.resize()),
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .padding(20.dp)
                    .padding(bottom = 76.dp)
            ) {
                val enabled = state.canSave
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(18.dp))
                        .background(if (enabled) voca.ink else voca.line)
                        .pressable { if (enabled) vm.save { onSaved() } }
                        .padding(vertical = 17.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        when {
                            !enabled -> "뜻을 하나 이상 선택하세요"
                            state.alreadySaved -> "기존 단어에 합쳐 저장"
                            else -> "내 단어장에 저장"
                        },
                        style = MaterialTheme.typography.labelLarge,
                        color = if (enabled) voca.bg else voca.inkSoft,
                    )
                }
            }
        }
    }
}

@Composable
private fun MeaningRow(
    candidate: MeaningCandidate,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) voca.accent.copy(alpha = 0.12f) else voca.surface)
            .border(
                1.dp,
                if (selected) voca.accent.copy(alpha = 0.5f) else voca.line,
                RoundedCornerShape(16.dp),
            )
            .pressable(onToggle)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (candidate.partOfSpeech != null) {
                    Text(
                        candidate.partOfSpeech,
                        style = MaterialTheme.typography.labelSmall,
                        color = voca.accentSoft,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(voca.surfaceAlt)
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                    Spacer(Modifier.width(7.dp))
                }
                Text(
                    originLabel(candidate.origin),
                    style = MaterialTheme.typography.labelSmall,
                    color = voca.inkSoft.copy(alpha = 0.7f),
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(candidate.text, style = MaterialTheme.typography.bodyLarge, color = voca.ink)
            if (candidate.hint != null) {
                Text(
                    candidate.hint,
                    style = MaterialTheme.typography.bodySmall,
                    color = voca.inkSoft.copy(alpha = 0.75f),
                )
            }
        }
        CheckDot(selected)
    }
}

@Composable
private fun ExampleRow(example: Example, selected: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(if (selected) voca.accent.copy(alpha = 0.12f) else voca.surface)
            .border(
                1.dp,
                if (selected) voca.accent.copy(alpha = 0.5f) else voca.line,
                RoundedCornerShape(16.dp),
            )
            .pressable(onToggle)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                "“${example.text}”",
                style = MaterialTheme.typography.bodyLarge,
                color = voca.ink,
                fontStyle = FontStyle.Italic,
            )
            if (example.translation.isNotBlank()) {
                Text(
                    example.translation,
                    style = MaterialTheme.typography.bodySmall,
                    color = voca.inkSoft,
                )
            }
            Text(
                when (example.source) {
                    ExampleSource.DICTIONARY -> "사전 예문"
                    ExampleSource.GENERATED -> "예시 문장 (필요하면 고쳐 쓰세요)"
                    ExampleSource.MANUAL -> "직접 입력"
                },
                style = MaterialTheme.typography.labelSmall,
                color = voca.inkSoft.copy(alpha = 0.65f),
                modifier = Modifier.padding(top = 3.dp),
            )
        }
        CheckDot(selected)
    }
}

@Composable
private fun CheckDot(selected: Boolean) {
    Box(
        Modifier
            .size(26.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(if (selected) voca.accent else Color.Transparent)
            .border(
                1.dp,
                if (selected) Color.Transparent else voca.line,
                RoundedCornerShape(9.dp),
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Icon(
                Icons.Outlined.Check,
                null,
                tint = Color(0xFFFFF8F2),
                modifier = Modifier.size(15.dp),
            )
        }
    }
}

@Composable
private fun InlineAdd(
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
                .pressable { if (value.isNotBlank()) onAdd() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.Outlined.Add,
                "추가",
                tint = if (value.isBlank()) voca.inkSoft else voca.bg,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

private fun originLabel(origin: MeaningCandidate.Origin): String = when (origin) {
    MeaningCandidate.Origin.ARCHIVE -> "아카이브"
    MeaningCandidate.Origin.DICTIONARY -> "영영사전"
    MeaningCandidate.Origin.USER -> "내 단어장"
}
