package com.vocacard.app.data.suggest

import com.vocacard.app.data.archive.ArchiveRepository
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.model.ExampleSource
import com.vocacard.app.data.model.MeaningCandidate
import com.vocacard.app.data.model.SuggestionResult
import com.vocacard.app.data.mywords.WordRepository

/**
 * 사용자가 영어 단어를 입력했을 때 **추천 뜻**과 **추천 예문**을 만들어 준다.
 *
 * 우선순위
 *  1. 내장 아카이브(1,222단어) — 한국어 뜻. 다의어는 sense 마다 별도 후보로 분리한다.
 *  2. 이미 내 단어장에 있는 같은 단어의 뜻(중복 저장 방지 + 기존 정리 재사용)
 *  3. 온라인 영영사전 — 품사별 정의와 원어민 예문 (없거나 오프라인이면 조용히 생략)
 *  4. 위 어느 것도 없으면 품사 추정 기반 예문 템플릿으로 최소 후보를 만들어 준다.
 *
 * 최종 선택과 저장은 항상 사용자가 한다. 이 클래스는 후보만 만든다.
 */
class Suggester(
    private val archive: ArchiveRepository,
    private val words: WordRepository,
    private val dictionary: DictionaryApi,
) {

    suspend fun suggest(rawQuery: String, includeOnline: Boolean = true): SuggestionResult {
        val query = rawQuery.trim()
        if (query.isEmpty()) return SuggestionResult(query = "")

        val meanings = LinkedHashMap<String, MeaningCandidate>()
        val examples = LinkedHashMap<String, Example>()

        // 1) 아카이브
        val hit = archive.lookup(query)
        hit?.let { (archiveWord, dayId) ->
            val senses = archiveWord.senses.ifEmpty { listOf(archiveWord.meaning) }
            senses.forEach { sense ->
                val c = MeaningCandidate(
                    text = sense,
                    origin = MeaningCandidate.Origin.ARCHIVE,
                    hint = "아카이브 ${dayId.replace("day", "Day ")}",
                )
                meanings[c.key] = c
            }
        }

        // 2) 내 단어장에 이미 있는 뜻
        words.findByWord(query)?.let { existing ->
            existing.meanings.forEach { m ->
                val c = MeaningCandidate(
                    text = m,
                    origin = MeaningCandidate.Origin.USER,
                    hint = "내 단어장에 저장됨",
                )
                meanings.putIfAbsent(c.key, c)
            }
            existing.examples.forEach { examples.putIfAbsent(it.text.normKey(), it) }
        }

        // 3) 온라인 사전
        var phonetic: String? = null
        var online = false
        var error: String? = null
        if (includeOnline) {
            val dict = dictionary.lookup(query)
            error = dict.error
            online = !dict.isEmpty
            phonetic = dict.phonetic
            dict.meanings.forEach { meanings.putIfAbsent(it.key, it) }
            dict.examples.forEach { examples.putIfAbsent(it.text.normKey(), it) }
        }

        // 4) 예문이 하나도 없으면 템플릿으로 만들어 준다(오프라인 폴백)
        if (examples.isEmpty()) {
            ExampleTemplates.generate(query, meanings.values.firstOrNull()?.partOfSpeech)
                .forEach { examples.putIfAbsent(it.text.normKey(), it) }
        }

        return SuggestionResult(
            query = query,
            meanings = meanings.values.toList(),
            examples = examples.values.toList(),
            phonetic = phonetic,
            archiveHit = hit?.first,
            archiveDayId = hit?.second,
            online = online,
            error = error,
        )
    }

    /** 입력 중 자동완성(아카이브 접두사 매칭). */
    suspend fun autocomplete(prefix: String): List<String> =
        archive.prefixMatches(prefix).map { it.first.word }

    private fun String.normKey() = trim().lowercase()
}

/**
 * 오프라인에서도 예문 후보가 최소 한 개는 나오도록 만드는 템플릿 생성기.
 * 완전한 문장이 아니라 "채워 쓰는 뼈대"임을 사용자가 알 수 있게 안내 문구를 붙인다.
 */
object ExampleTemplates {

    private val verbLike = listOf(
        "We need to %s the report before Friday.",
        "She will %s the new schedule tomorrow.",
        "They decided to %s the plan immediately.",
    )
    private val nounLike = listOf(
        "The %s was mentioned in the meeting.",
        "Please check the %s one more time.",
        "This %s is important for our team.",
    )
    private val adjLike = listOf(
        "The result was quite %s.",
        "He gave a %s answer to the question.",
        "This solution seems %s enough.",
    )

    fun generate(word: String, partOfSpeech: String?): List<Example> {
        val w = word.trim()
        if (w.isEmpty()) return emptyList()
        val pool = when {
            partOfSpeech == "동사" || w.endsWith("ate") || w.endsWith("ify") || w.endsWith("ize") -> verbLike
            partOfSpeech == "형용사" || w.endsWith("ous") || w.endsWith("ive") || w.endsWith("ful") ||
                w.endsWith("able") || w.endsWith("ible") -> adjLike
            partOfSpeech == "명사" || w.endsWith("tion") || w.endsWith("ment") || w.endsWith("ness") ||
                w.endsWith("ity") || w.endsWith("ance") -> nounLike
            else -> nounLike + verbLike
        }
        return pool.take(2).map {
            Example(
                text = it.format(w),
                translation = "",
                source = ExampleSource.GENERATED,
            )
        }
    }
}
