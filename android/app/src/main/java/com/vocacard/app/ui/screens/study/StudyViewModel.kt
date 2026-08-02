package com.vocacard.app.ui.screens.study

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vocacard.app.AppContainer
import com.vocacard.app.data.db.WordWithState
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.study.Scheduler
import com.vocacard.app.ui.StudyMode
import com.vocacard.app.ui.StudyScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * 학습 카드 한 장. 아카이브 단어와 내 단어장 단어를 하나의 타입으로 통일해
 * 학습 화면이 출처를 신경 쓰지 않게 만든다.
 */
data class StudyCard(
    val key: String,
    val word: String,
    val meanings: List<String>,
    val examples: List<Example> = emptyList(),
    val phonetic: String? = null,
    /** 아카이브 원본 id (있으면 암기 표시를 아카이브에도 반영) */
    val archiveWordId: String? = null,
    val dayId: String? = null,
    /** 내 단어장 id (있으면 간격 반복 상태를 갱신) */
    val myWordId: Long? = null,
) {
    val primaryMeaning: String get() = meanings.firstOrNull().orEmpty()
    val meaningText: String get() = meanings.joinToString(" · ")
}

data class QuizChoice(val text: String, val correct: Boolean)

data class StudyUiState(
    val loading: Boolean = true,
    val title: String = "",
    val mode: StudyMode? = null,
    val queue: List<StudyCard> = emptyList(),
    val total: Int = 0,
    val done: Int = 0,
    val correct: Int = 0,
    val wrongCards: List<StudyCard> = emptyList(),
    val choices: List<QuizChoice> = emptyList(),
    val finished: Boolean = false,
    val empty: Boolean = false,
) {
    val current: StudyCard? get() = queue.firstOrNull()
    val progress: Float get() = if (total == 0) 0f else done.toFloat() / total
}

class StudyViewModel(
    private val container: AppContainer,
    private val scope: StudyScope,
) : ViewModel() {

    private val _state = MutableStateFlow(StudyUiState(title = scope.title))
    val state: StateFlow<StudyUiState> = _state.asStateFlow()

    private var source: List<StudyCard> = emptyList()

    init {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        val cards = when (scope) {
            is StudyScope.Day -> loadDay(scope.dayId)
            StudyScope.Due -> loadMyWords(onlyDue = true, onlyHard = false)
            StudyScope.MyWords -> loadMyWords(onlyDue = false, onlyHard = false)
            StudyScope.Hard -> loadMyWords(onlyDue = false, onlyHard = true)
        }
        source = cards
        _state.value = _state.value.copy(
            loading = false,
            empty = cards.isEmpty(),
            total = cards.size,
        )
    }

    private suspend fun loadDay(dayId: String): List<StudyCard> {
        val day = container.archive.day(dayId) ?: return emptyList()
        return day.words.map { w ->
            StudyCard(
                key = w.id,
                word = w.word,
                meanings = w.senses.ifEmpty { listOf(w.meaning) },
                archiveWordId = w.id,
                dayId = dayId,
            )
        }
    }

    private suspend fun loadMyWords(onlyDue: Boolean, onlyHard: Boolean): List<StudyCard> {
        val all: List<WordWithState> = container.words.observeAll().first()
        val filtered = all.filter {
            when {
                onlyDue -> it.isDue
                onlyHard -> it.isHard
                else -> true
            }
        }
        return filtered.map { w ->
            StudyCard(
                key = "my-${w.id}",
                word = w.word,
                meanings = w.meanings.ifEmpty { listOf("뜻이 비어 있어요") },
                examples = w.examples,
                phonetic = w.phonetic,
                dayId = w.sourceDayId,
                myWordId = w.id,
            )
        }
    }

    /** 사용자가 모드를 고르면 큐를 구성한다. 매 세션 섞어서 순서 암기를 방지한다. */
    fun start(mode: StudyMode) {
        val queue = source.shuffled()
        _state.value = _state.value.copy(
            mode = mode,
            queue = queue,
            total = queue.size,
            done = 0,
            correct = 0,
            wrongCards = emptyList(),
            finished = queue.isEmpty(),
        )
        prepareChoices()
    }

    /** 4지선다 보기 구성 — 정답 1 + 아카이브에서 뽑은 오답 3. */
    private fun prepareChoices() {
        val card = _state.value.current ?: return
        if (_state.value.mode != StudyMode.QUIZ) return
        viewModelScope.launch {
            val distractors = container.archive.randomMeanings(card.primaryMeaning, 3)
            val choices = (listOf(QuizChoice(card.primaryMeaning, true)) +
                distractors.map { QuizChoice(it, false) }).shuffled()
            _state.value = _state.value.copy(choices = choices)
        }
    }

    /**
     * 한 장 처리.
     *
     * 이 앱의 핵심 규칙: **틀린 단어는 자동으로 내 단어장에 쌓인다.**
     * 사용자가 따로 정리하지 않아도 "몰랐던 단어"가 모이고, 스케줄러가 다시 꺼내 온다.
     */
    fun answer(known: Boolean) {
        val s = _state.value
        val card = s.current ?: return

        viewModelScope.launch {
            if (known) {
                card.archiveWordId?.let { container.archive.mark(it, card.dayId.orEmpty(), true) }
                card.myWordId?.let { container.words.grade(it, Scheduler.Grade.GOOD) }
            } else {
                // 아카이브 단어면 내 단어장으로 승격 후 곧바로 복습 대상으로 만든다.
                val id = card.myWordId ?: run {
                    val archiveWord = card.archiveWordId?.let { aid ->
                        container.archive.day(card.dayId.orEmpty())?.words?.firstOrNull { it.id == aid }
                    }
                    if (archiveWord != null && card.dayId != null) {
                        container.words.promoteFromArchive(archiveWord, card.dayId)
                    } else {
                        container.words.save(
                            word = card.word,
                            meanings = card.meanings,
                            examples = card.examples,
                            sourceDayId = card.dayId,
                        )
                    }
                }
                container.words.grade(id, Scheduler.Grade.AGAIN)
                card.archiveWordId?.let { container.archive.mark(it, card.dayId.orEmpty(), false) }
            }
        }

        val rest = s.queue.drop(1)
        val newState = s.copy(
            queue = rest,
            done = s.done + 1,
            correct = s.correct + if (known) 1 else 0,
            wrongCards = if (known) s.wrongCards else s.wrongCards + card,
            finished = rest.isEmpty(),
        )
        _state.value = newState
        if (rest.isEmpty()) {
            viewModelScope.launch {
                container.words.recordSession(
                    mode = s.mode?.name ?: "-",
                    scope = scope.encoded,
                    total = newState.total,
                    correct = newState.correct,
                )
            }
        } else {
            prepareChoices()
        }
    }

    /** 나중에 다시 — 큐 맨 뒤로 보낸다. 진행률에는 반영하지 않는다. */
    fun postpone() {
        val s = _state.value
        val card = s.current ?: return
        _state.value = s.copy(queue = s.queue.drop(1) + card)
        prepareChoices()
    }

    fun restart(onlyWrong: Boolean) {
        val next = if (onlyWrong) _state.value.wrongCards else source
        val mode = _state.value.mode ?: StudyMode.FLASHCARD
        source = if (onlyWrong) next else source
        _state.value = _state.value.copy(
            queue = next.shuffled(),
            total = next.size,
            done = 0,
            correct = 0,
            wrongCards = emptyList(),
            finished = next.isEmpty(),
            mode = mode,
        )
        prepareChoices()
    }

    /** 모드 선택 화면으로 되돌아간다. */
    fun backToModePicker() {
        _state.value = _state.value.copy(
            mode = null,
            finished = false,
            queue = emptyList(),
            done = 0,
            correct = 0,
            wrongCards = emptyList(),
        )
    }
}
