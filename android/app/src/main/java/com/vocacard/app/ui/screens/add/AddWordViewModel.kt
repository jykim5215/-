package com.vocacard.app.ui.screens.add

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vocacard.app.AppContainer
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.model.ExampleSource
import com.vocacard.app.data.model.MeaningCandidate
import com.vocacard.app.data.model.SuggestionResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AddUiState(
    val query: String = "",
    val autocomplete: List<String> = emptyList(),
    val loading: Boolean = false,
    val suggestion: SuggestionResult? = null,
    /** 사용자가 고른 뜻 (여러 개 선택 가능 — 다의어를 한 카드에 모아 저장) */
    val selectedMeanings: Set<String> = emptySet(),
    val selectedExamples: Set<String> = emptySet(),
    /** 직접 입력한 뜻/예문 */
    val customMeanings: List<String> = emptyList(),
    val customExamples: List<Example> = emptyList(),
    val note: String = "",
    val savedWordId: Long? = null,
    val alreadySaved: Boolean = false,
    val message: String? = null,
) {
    val canSave: Boolean
        get() = query.isNotBlank() && (selectedMeanings.isNotEmpty() || customMeanings.isNotEmpty())

    val allMeaningCandidates: List<MeaningCandidate>
        get() = (suggestion?.meanings.orEmpty()) + customMeanings.map {
            MeaningCandidate(it, origin = MeaningCandidate.Origin.USER, hint = "직접 입력")
        }

    val allExampleCandidates: List<Example>
        get() = (suggestion?.examples.orEmpty()) + customExamples
}

/**
 * 단어 추가 화면의 상태 기계.
 *
 * 흐름: 영어 입력 → (300ms 디바운스) 추천 뜻·예문 조회 → 사용자가 선택/편집 → 저장.
 * 추천은 오프라인(내장 아카이브)만으로도 동작하며, 온라인 사전은 있으면 더해진다.
 */
class AddWordViewModel(
    private val container: AppContainer,
) : ViewModel() {

    private val _state = MutableStateFlow(AddUiState())
    val state: StateFlow<AddUiState> = _state.asStateFlow()

    private var searchJob: Job? = null
    private var onlineEnabled = true

    fun setOnlineEnabled(enabled: Boolean) {
        onlineEnabled = enabled
    }

    fun onQueryChange(text: String) {
        _state.value = _state.value.copy(
            query = text,
            suggestion = null,
            selectedMeanings = emptySet(),
            selectedExamples = emptySet(),
            customMeanings = emptyList(),
            customExamples = emptyList(),
            savedWordId = null,
            alreadySaved = false,
            message = null,
        )
        searchJob?.cancel()
        if (text.isBlank()) {
            _state.value = _state.value.copy(autocomplete = emptyList(), loading = false)
            return
        }
        searchJob = viewModelScope.launch {
            _state.value = _state.value.copy(autocomplete = container.suggester.autocomplete(text))
            delay(DEBOUNCE_MS)
            search(text)
        }
    }

    fun pickAutocomplete(word: String) {
        searchJob?.cancel()
        _state.value = _state.value.copy(query = word, autocomplete = emptyList())
        searchJob = viewModelScope.launch { search(word) }
    }

    private suspend fun search(word: String) {
        _state.value = _state.value.copy(loading = true)
        val existing = container.words.findByWord(word)
        val result = container.suggester.suggest(word, includeOnline = onlineEnabled)
        // 아카이브에 있는 뜻은 기본 선택해 준다(대부분 그대로 저장하면 되도록).
        val preselect = result.meanings
            .filter { it.origin == MeaningCandidate.Origin.ARCHIVE }
            .map { it.text }
            .toSet()
        _state.value = _state.value.copy(
            loading = false,
            suggestion = result,
            autocomplete = emptyList(),
            selectedMeanings = preselect.ifEmpty { _state.value.selectedMeanings },
            alreadySaved = existing != null,
            savedWordId = existing?.id,
            message = result.error,
        )
    }

    fun toggleMeaning(text: String) {
        val s = _state.value
        _state.value = s.copy(
            selectedMeanings = if (text in s.selectedMeanings) s.selectedMeanings - text
            else s.selectedMeanings + text
        )
    }

    fun toggleExample(text: String) {
        val s = _state.value
        _state.value = s.copy(
            selectedExamples = if (text in s.selectedExamples) s.selectedExamples - text
            else s.selectedExamples + text
        )
    }

    fun addCustomMeaning(text: String) {
        val t = text.trim()
        if (t.isEmpty()) return
        val s = _state.value
        _state.value = s.copy(
            customMeanings = (s.customMeanings + t).distinct(),
            selectedMeanings = s.selectedMeanings + t,
        )
    }

    fun addCustomExample(text: String, translation: String = "") {
        val t = text.trim()
        if (t.isEmpty()) return
        val s = _state.value
        val ex = Example(text = t, translation = translation.trim(), source = ExampleSource.MANUAL)
        _state.value = s.copy(
            customExamples = (s.customExamples + ex).distinctBy { it.text.lowercase() },
            selectedExamples = s.selectedExamples + t,
        )
    }

    fun setNote(text: String) {
        _state.value = _state.value.copy(note = text)
    }

    fun save(onSaved: (Long) -> Unit) {
        val s = _state.value
        if (!s.canSave) return
        viewModelScope.launch {
            val meanings = s.allMeaningCandidates
                .map { it.text }
                .filter { it in s.selectedMeanings }
                .ifEmpty { s.customMeanings }
            val examples = s.allExampleCandidates.filter { it.text in s.selectedExamples }
            val id = container.words.save(
                word = s.query.trim(),
                meanings = meanings,
                examples = examples,
                phonetic = s.suggestion?.phonetic,
                note = s.note,
                sourceDayId = s.suggestion?.archiveDayId,
            )
            _state.value = _state.value.copy(savedWordId = id, message = "저장했어요")
            onSaved(id)
        }
    }

    fun reset() {
        searchJob?.cancel()
        _state.value = AddUiState()
    }

    private companion object {
        const val DEBOUNCE_MS = 300L
    }
}
