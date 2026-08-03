package com.vocacard.app.ui.screens.study

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Done
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.SentimentDissatisfied
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vocacard.app.AppContainer
import com.vocacard.app.data.settings.Settings
import com.vocacard.app.ui.StudyMode
import com.vocacard.app.ui.StudyScope
import com.vocacard.app.ui.components.EmptyState
import com.vocacard.app.ui.components.FlipCard
import com.vocacard.app.ui.components.PaperCard
import com.vocacard.app.ui.components.ProgressLine
import com.vocacard.app.ui.components.StaggerIn
import com.vocacard.app.ui.components.LocalSpeaker
import com.vocacard.app.ui.components.SpeakButton
import com.vocacard.app.ui.components.SwipeDeck
import com.vocacard.app.ui.components.SwipeDirection
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.components.rememberHaptics
import com.vocacard.app.ui.factoryOf
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.VocaShape
import com.vocacard.app.ui.theme.WordDisplay
import com.vocacard.app.ui.theme.voca
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

/**
 * 학습 화면 — 앱의 **유일한** 학습 진입점.
 * 아카이브 Day, 오늘 복습, 내 단어장 전체, 어려운 단어가 모두 이 화면으로 들어온다.
 */
@Composable
fun StudyScreen(
    container: AppContainer,
    settings: Settings,
    scope: StudyScope,
    onClose: () -> Unit,
    onOpenWord: (Long) -> Unit,
) {
    val vm: StudyViewModel = viewModel(
        key = "study-${scope.encoded}",
        factory = factoryOf(container, StudyViewModel::class.java to { c -> StudyViewModel(c, scope) }),
    )
    val state by vm.state.collectAsState()
    val haptic = rememberHaptics(settings.hapticFeedback)

    Column(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
    ) {
        // ── 헤더: 닫기 + 진행률 ──
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(voca.surface)
                    .pressable(onClose)
                    .padding(8.dp)
            ) { Icon(Icons.Outlined.Close, "닫기", tint = voca.ink, modifier = Modifier.size(20.dp)) }

            Column(Modifier.weight(1f)) {
                Text(
                    state.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = voca.ink,
                )
                if (state.mode != null && !state.finished) {
                    Spacer(Modifier.height(5.dp))
                    ProgressLine(state.progress, Modifier.fillMaxWidth(), height = 4.dp)
                }
            }

            if (state.mode != null && !state.finished) {
                Text(
                    "${state.done}/${state.total}",
                    style = MaterialTheme.typography.labelMedium,
                    color = voca.inkSoft,
                )
            }
        }

        Box(Modifier.weight(1f)) {
            when {
                state.loading -> Unit

                state.empty -> EmptyState(
                    icon = Icons.Outlined.Style,
                    title = "학습할 단어가 없어요",
                    description = "오늘 복습할 단어가 없거나, 아직 모은 단어가 없습니다.",
                    modifier = Modifier.align(Alignment.Center),
                )

                state.mode == null -> ModePicker(
                    count = state.total,
                    onPick = { haptic(); vm.start(it) },
                )

                state.finished -> ResultView(
                    total = state.total,
                    correct = state.correct,
                    wrong = state.wrongCards.size,
                    onRetryWrong = { vm.restart(onlyWrong = true) },
                    onRetryAll = { vm.restart(onlyWrong = false) },
                    onChangeMode = { vm.backToModePicker() },
                    onClose = onClose,
                )

                else -> when (state.mode) {
                    StudyMode.FLASHCARD -> CardMode(
                        state = state,
                        reverse = false,
                        autoSpeak = settings.autoSpeak,
                        onAnswer = { haptic(); vm.answer(it) },
                        onPostpone = vm::postpone,
                    )
                    StudyMode.RECALL -> CardMode(
                        state = state,
                        reverse = true,
                        autoSpeak = false,
                        onAnswer = { haptic(); vm.answer(it) },
                        onPostpone = vm::postpone,
                    )
                    StudyMode.QUIZ -> QuizMode(
                        state = state,
                        onAnswer = { haptic(); vm.answer(it) },
                    )
                    StudyMode.SPELLING -> SpellingMode(
                        state = state,
                        onAnswer = { haptic(); vm.answer(it) },
                    )
                    null -> Unit
                }
            }
        }
    }
}

/* ─────────────────────────  모드 선택  ───────────────────────── */

@Composable
private fun ModePicker(count: Int, onPick: (StudyMode) -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Spacer(Modifier.height(8.dp))
        Text("$count 단어", style = WordDisplay, color = voca.ink)
        Text(
            "어떻게 학습할까요?",
            style = MaterialTheme.typography.bodyMedium,
            color = voca.inkSoft,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        StudyMode.entries.forEachIndexed { index, mode ->
            StaggerIn(index) {
                PaperCard(Modifier.fillMaxWidth(), onClick = { onPick(mode) }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(42.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(voca.accent.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                "${index + 1}",
                                style = MaterialTheme.typography.titleLarge,
                                color = voca.accent,
                            )
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(mode.label, style = MaterialTheme.typography.titleLarge, color = voca.ink)
                            Text(
                                mode.description,
                                style = MaterialTheme.typography.bodySmall,
                                color = voca.inkSoft,
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(30.dp))
    }
}

/* ─────────────────────────  카드 모드  ───────────────────────── */

@Composable
private fun CardMode(
    state: StudyUiState,
    reverse: Boolean,
    autoSpeak: Boolean,
    onAnswer: (Boolean) -> Unit,
    onPostpone: () -> Unit,
) {
    val cards = state.queue
    val topKey = cards.firstOrNull()?.key
    var flipped by remember(topKey) { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(vertical = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            SwipeDeck(
                items = cards,
                key = { it.key },
                modifier = Modifier.fillMaxSize(),
                allowUp = true,
                drawTopSurface = false,
                onSwiped = { _, dir ->
                    when (dir) {
                        SwipeDirection.RIGHT -> onAnswer(true)
                        SwipeDirection.LEFT -> onAnswer(false)
                        SwipeDirection.UP -> onPostpone()
                    }
                },
                overlayLabel = { dir, alpha ->
                    val label = when (dir) {
                        SwipeDirection.RIGHT -> "알아요"
                        SwipeDirection.LEFT -> "몰라요"
                        SwipeDirection.UP -> "나중에"
                    }
                    val tint = when (dir) {
                        SwipeDirection.RIGHT -> voca.know
                        SwipeDirection.LEFT -> voca.dontKnow
                        SwipeDirection.UP -> voca.highlight
                    }
                    Text(
                        label,
                        style = MaterialTheme.typography.headlineLarge,
                        color = tint.copy(alpha = alpha),
                        modifier = Modifier.graphicsLayer {
                            val s = 0.8f + 0.2f * alpha
                            scaleX = s; scaleY = s
                            rotationZ = -8f
                        },
                    )
                },
            ) { card, isTop ->
                if (isTop) {
                    FlipCard(
                        flipped = flipped,
                        modifier = Modifier.fillMaxSize(),
                        onClick = { flipped = !flipped },
                        front = { CardFace(card, showMeaning = reverse, autoSpeak = autoSpeak) },
                        back = { CardFace(card, showMeaning = !reverse, autoSpeak = autoSpeak) },
                    )
                } else {
                    Box(Modifier.fillMaxSize()) { CardFace(card, showMeaning = reverse) }
                }
            }
        }

        // ── 버튼(스와이프가 익숙하지 않은 사용자를 위한 동등한 경로) ──
        Row(
            Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .padding(bottom = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            AnswerButton("몰라요", voca.dontKnow, Modifier.weight(1f)) { onAnswer(false) }
            Box(
                Modifier
                    .size(52.dp)
                    .clip(RoundedCornerShape(17.dp))
                    .background(voca.surface)
                    .pressable(onPostpone),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Refresh, "나중에", tint = voca.inkSoft, modifier = Modifier.size(20.dp))
            }
            AnswerButton("알아요", voca.know, Modifier.weight(1f)) { onAnswer(true) }
        }
    }
}

@Composable
private fun CardFace(card: StudyCard, showMeaning: Boolean, autoSpeak: Boolean = false) {
    val speaker = LocalSpeaker.current
    // 단어 면이 나오면 자동으로 한 번 읽어 준다(설정에서 끌 수 있다).
    LaunchedEffect(card.key, showMeaning, autoSpeak) {
        if (autoSpeak && !showMeaning) {
            delay(180)
            speaker?.speak(card.word)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(26.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (card.dayId != null) {
            Text(
                card.dayId.replace("day", "DAY "),
                style = MaterialTheme.typography.labelSmall,
                color = voca.inkSoft.copy(alpha = 0.7f),
            )
            Spacer(Modifier.height(10.dp))
        }

        if (showMeaning) {
            card.meanings.forEach { m ->
                Text(
                    m,
                    style = MaterialTheme.typography.headlineMedium,
                    color = voca.ink,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(vertical = 2.dp),
                )
            }
        } else {
            Text(
                card.word,
                style = WordDisplay,
                color = voca.ink,
                textAlign = TextAlign.Center,
            )
            if (!card.phonetic.isNullOrBlank()) {
                Text(
                    card.phonetic,
                    style = MaterialTheme.typography.bodyMedium,
                    color = voca.inkSoft,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Spacer(Modifier.height(10.dp))
            SpeakButton(card.word, size = 40.dp)
        }

        if (showMeaning) {
            Spacer(Modifier.height(12.dp))
            SpeakButton(card.word, size = 34.dp)
        }

        val example = card.examples.firstOrNull()
        if (showMeaning && example != null) {
            Spacer(Modifier.height(18.dp))
            Text(
                "“${example.text}”",
                style = MaterialTheme.typography.bodyMedium,
                color = voca.inkSoft,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(20.dp))
        Text(
            if (showMeaning) "← 몰라요 · 알아요 →" else "카드를 탭하면 뒤집혀요",
            style = MaterialTheme.typography.labelSmall,
            color = voca.line,
        )
    }
}

@Composable
private fun AnswerButton(text: String, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(17.dp))
            .background(color.copy(alpha = 0.14f))
            .border(1.dp, color.copy(alpha = 0.35f), RoundedCornerShape(17.dp))
            .pressable(onClick)
            .padding(vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = color)
    }
}

/* ─────────────────────────  4지선다  ───────────────────────── */

@Composable
private fun QuizMode(state: StudyUiState, onAnswer: (Boolean) -> Unit) {
    val card = state.current ?: return
    var picked by remember(card.key) { mutableStateOf<Int?>(null) }
    var shakeTrigger by remember(card.key) { mutableIntStateOf(0) }

    LaunchedEffect(picked) {
        val p = picked ?: return@LaunchedEffect
        val correct = state.choices.getOrNull(p)?.correct == true
        if (!correct) shakeTrigger++
        delay(if (correct) 420 else 900)
        onAnswer(correct)
    }

    Column(
        Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(vertical = 12.dp)
                .clip(RoundedCornerShape(VocaShape.card))
                .background(voca.surface)
                .border(1.dp, voca.line, RoundedCornerShape(VocaShape.card)),
            contentAlignment = Alignment.Center,
        ) {
            AnimatedContent(
                targetState = card.key,
                transitionSpec = {
                    (fadeIn(tween(Motion.DurShort)) togetherWith fadeOut(tween(Motion.DurQuick)))
                },
                label = "quizWord",
            ) { _ ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(card.word, style = WordDisplay, color = voca.ink, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(10.dp))
                    SpeakButton(card.word, size = 38.dp)
                }
            }
        }

        state.choices.forEachIndexed { index, choice ->
            val revealed = picked != null
            val isPicked = picked == index
            val bg = when {
                !revealed -> voca.surface
                choice.correct -> voca.know.copy(alpha = 0.18f)
                isPicked -> voca.dontKnow.copy(alpha = 0.18f)
                else -> voca.surface
            }
            val fg = when {
                !revealed -> voca.ink
                choice.correct -> voca.know
                isPicked -> voca.dontKnow
                else -> voca.inkSoft.copy(alpha = 0.6f)
            }
            val shake by animateFloatAsState(
                targetValue = if (isPicked && !choice.correct) shakeTrigger.toFloat() else 0f,
                animationSpec = tween(Motion.DurQuick),
                label = "shake",
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .graphicsLayer {
                        translationX = if (isPicked && !choice.correct) {
                            (kotlin.math.sin(shake * 18f) * 12f)
                        } else 0f
                    }
                    .clip(RoundedCornerShape(16.dp))
                    .background(bg)
                    .border(1.dp, voca.line, RoundedCornerShape(16.dp))
                    .pressable { if (picked == null) picked = index }
                    .padding(horizontal = 16.dp, vertical = 15.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    choice.text,
                    style = MaterialTheme.typography.bodyLarge,
                    color = fg,
                    modifier = Modifier.weight(1f),
                )
                if (revealed && choice.correct) {
                    Icon(Icons.Outlined.Done, null, tint = voca.know, modifier = Modifier.size(18.dp))
                }
            }
        }
        Spacer(Modifier.windowInsetsPadding(WindowInsets.navigationBars).height(12.dp))
    }
}

/* ─────────────────────────  스펠링  ───────────────────────── */

@Composable
private fun SpellingMode(state: StudyUiState, onAnswer: (Boolean) -> Unit) {
    val card = state.current ?: return
    var input by remember(card.key) { mutableStateOf("") }
    var result by remember(card.key) { mutableStateOf<Boolean?>(null) }
    val keyboard = LocalSoftwareKeyboardController.current

    LaunchedEffect(result) {
        val r = result ?: return@LaunchedEffect
        delay(if (r) 450 else 1100)
        onAnswer(r)
    }

    Column(
        Modifier
            .fillMaxSize()
            .imePadding()
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(vertical = 12.dp)
                .clip(RoundedCornerShape(VocaShape.card))
                .background(voca.surface)
                .border(1.dp, voca.line, RoundedCornerShape(VocaShape.card)),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(24.dp),
            ) {
                Text(
                    card.meaningText,
                    style = MaterialTheme.typography.headlineMedium,
                    color = voca.ink,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    hint(card.word, input),
                    style = MaterialTheme.typography.titleLarge,
                    color = voca.line,
                )
                if (result == false) {
                    Spacer(Modifier.height(14.dp))
                    Text(
                        card.word,
                        style = MaterialTheme.typography.headlineMedium,
                        color = voca.dontKnow,
                    )
                }
            }
        }

        OutlinedTextField(
            value = input,
            onValueChange = { if (result == null) input = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text("영어 철자를 입력하세요") },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = {
                keyboard?.hide()
                result = input.trim().equals(card.word.trim(), ignoreCase = true)
            }),
            shape = RoundedCornerShape(16.dp),
        )

        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(17.dp))
                .background(voca.ink)
                .pressable {
                    keyboard?.hide()
                    if (result == null) {
                        result = input.trim().equals(card.word.trim(), ignoreCase = true)
                    }
                }
                .padding(vertical = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text("확인", style = MaterialTheme.typography.labelLarge, color = voca.bg)
        }
        Spacer(Modifier.windowInsetsPadding(WindowInsets.navigationBars).height(8.dp))
    }
}

/** 입력한 만큼만 알려 주는 힌트: 첫 글자 + 나머지 밑줄. */
private fun hint(word: String, input: String): String {
    val revealCount = (input.length).coerceAtMost(word.length).coerceAtLeast(1)
    return word.mapIndexed { i, c -> if (i < revealCount) c else '_' }.joinToString(" ")
}

/* ─────────────────────────  결과  ───────────────────────── */

@Composable
private fun ResultView(
    total: Int,
    correct: Int,
    wrong: Int,
    onRetryWrong: () -> Unit,
    onRetryAll: () -> Unit,
    onChangeMode: () -> Unit,
    onClose: () -> Unit,
) {
    val rate = if (total == 0) 0 else (correct * 100f / total).roundToInt()
    val animatedRate by animateFloatAsState(rate.toFloat(), Motion.progress(), label = "rate")

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Spacer(Modifier.height(20.dp))
        Text("${animatedRate.roundToInt()}%", style = WordDisplay, color = voca.accent)
        Text(
            "$total 단어 중 $correct 개 정답",
            style = MaterialTheme.typography.bodyLarge,
            color = voca.inkSoft,
        )
        Spacer(Modifier.height(6.dp))

        if (wrong > 0) {
            PaperCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Outlined.SentimentDissatisfied,
                        null,
                        tint = voca.dontKnow,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            "몰랐던 $wrong 개를 내 단어장에 담았어요",
                            style = MaterialTheme.typography.titleMedium,
                            color = voca.ink,
                        )
                        Text(
                            "복습 일정에 맞춰 다시 보여 드릴게요",
                            style = MaterialTheme.typography.bodySmall,
                            color = voca.inkSoft,
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(4.dp))
        if (wrong > 0) {
            WideButton("틀린 $wrong 개만 다시", primary = true, onClick = onRetryWrong)
        }
        WideButton("처음부터 다시", primary = wrong == 0, onClick = onRetryAll)
        WideButton("다른 모드로 학습", primary = false, onClick = onChangeMode)
        WideButton("끝내기", primary = false, onClick = onClose)
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun WideButton(text: String, primary: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(17.dp))
            .background(if (primary) voca.ink else voca.surface)
            .border(1.dp, if (primary) Color.Transparent else voca.line, RoundedCornerShape(17.dp))
            .pressable(onClick)
            .padding(vertical = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.labelLarge,
            color = if (primary) voca.bg else voca.ink,
        )
    }
}
