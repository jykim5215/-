package com.vocacard.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/* ───────────────  아카이브(에셋, 읽기 전용)  ─────────────── */

@Serializable
data class WordBank(
    val version: Int = 1,
    val source: String = "",
    val days: List<ArchiveDay> = emptyList(),
)

@Serializable
data class ArchiveDay(
    val id: String,
    val index: Int,
    val title: String,
    val words: List<ArchiveWord> = emptyList(),
)

@Serializable
data class ArchiveWord(
    val id: String,
    val word: String,
    /** 엑셀 원문 뜻(줄바꿈 포함 가능) */
    val meaning: String,
    /** 다의어 분리 결과 */
    val senses: List<String> = emptyList(),
) {
    val displayMeaning: String get() = meaning.replace("\n", " · ")
}

/* ───────────────  예문  ─────────────── */

@Serializable
data class Example(
    val text: String,
    val translation: String = "",
    @SerialName("src") val source: ExampleSource = ExampleSource.MANUAL,
)

@Serializable
enum class ExampleSource {
    /** 온라인 사전(dictionaryapi.dev) */
    DICTIONARY,

    /** 내장 패턴으로 생성 */
    GENERATED,

    /** 사용자가 직접 입력/수정 */
    MANUAL,
}

/* ───────────────  추천 결과  ─────────────── */

/** 단어를 입력했을 때 띄우는 "추천 뜻" 후보 하나. 다의어는 sense 마다 하나씩 생성된다. */
data class MeaningCandidate(
    val text: String,
    val partOfSpeech: String? = null,
    val origin: Origin,
    /** 영영 정의 등 부가 설명 */
    val hint: String? = null,
    /** 이 후보와 함께 딸려온 예문 */
    val examples: List<Example> = emptyList(),
) {
    enum class Origin { ARCHIVE, DICTIONARY, USER }

    val key: String get() = "${origin.name}:${partOfSpeech.orEmpty()}:$text"
}

/** 단어 하나에 대한 전체 추천 묶음. */
data class SuggestionResult(
    val query: String,
    val meanings: List<MeaningCandidate> = emptyList(),
    val examples: List<Example> = emptyList(),
    val phonetic: String? = null,
    val archiveHit: ArchiveWord? = null,
    val archiveDayId: String? = null,
    val online: Boolean = false,
    val error: String? = null,
)
