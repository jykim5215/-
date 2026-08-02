package com.vocacard.app.data.suggest

import com.vocacard.app.data.model.Example
import com.vocacard.app.data.model.ExampleSource
import com.vocacard.app.data.model.MeaningCandidate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 무료·무인증 영영사전(dictionaryapi.dev)에서 품사별 정의와 예문을 가져온다.
 *
 * - **인증 토큰을 사용하지 않는다.** 공개 엔드포인트만 호출한다.
 * - 네트워크가 없거나 404 여도 예외를 던지지 않고 빈 결과를 돌려준다.
 *   추천은 어디까지나 보강이며, 앱은 오프라인에서도 완전히 동작해야 한다.
 */
class DictionaryApi(
    private val client: OkHttpClient = defaultClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun lookup(word: String): DictionaryResult = withContext(Dispatchers.IO) {
        val q = word.trim()
        if (q.isEmpty() || !q.matches(WORD_RE)) return@withContext DictionaryResult.empty
        val url = "$BASE${java.net.URLEncoder.encode(q, "UTF-8")}"
        try {
            client.newCall(Request.Builder().url(url).header("Accept", "application/json").build())
                .execute().use { res ->
                    if (!res.isSuccessful) {
                        return@withContext DictionaryResult.empty.copy(
                            error = if (res.code == 404) null else "사전 응답 오류 (${res.code})"
                        )
                    }
                    val body = res.body?.string().orEmpty()
                    if (body.isBlank()) return@withContext DictionaryResult.empty
                    parse(json.decodeFromString<List<DictEntry>>(body))
                }
        } catch (e: IOException) {
            DictionaryResult.empty.copy(error = "오프라인 상태예요. 내장 사전으로만 추천합니다.")
        } catch (e: Exception) {
            DictionaryResult.empty.copy(error = null)
        }
    }

    private fun parse(entries: List<DictEntry>): DictionaryResult {
        val meanings = mutableListOf<MeaningCandidate>()
        val examples = mutableListOf<Example>()
        var phonetic: String? = null

        entries.forEach { entry ->
            if (phonetic.isNullOrBlank()) {
                phonetic = entry.phonetic
                    ?: entry.phonetics?.firstOrNull { !it.text.isNullOrBlank() }?.text
            }
            entry.meanings?.forEach { m ->
                val pos = m.partOfSpeech?.let(::posKo)
                m.definitions?.take(3)?.forEach { d ->
                    val def = d.definition?.trim().orEmpty()
                    if (def.isNotEmpty()) {
                        val ex = d.example?.trim().orEmpty()
                        val exs = if (ex.isNotEmpty()) {
                            listOf(Example(text = ex.sentenceCase(), source = ExampleSource.DICTIONARY))
                        } else emptyList()
                        meanings += MeaningCandidate(
                            text = def,
                            partOfSpeech = pos,
                            origin = MeaningCandidate.Origin.DICTIONARY,
                            hint = null,
                            examples = exs,
                        )
                        examples += exs
                    }
                }
            }
        }
        return DictionaryResult(
            meanings = meanings.distinctBy { it.text.lowercase() }.take(8),
            examples = examples.distinctBy { it.text.lowercase() }.take(6),
            phonetic = phonetic,
        )
    }

    companion object {
        private const val BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/"
        private val WORD_RE = Regex("^[A-Za-z][A-Za-z'\\- ]{0,40}$")

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(6, TimeUnit.SECONDS)
            .readTimeout(6, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        fun posKo(pos: String): String = when (pos.lowercase()) {
            "noun" -> "명사"
            "verb" -> "동사"
            "adjective" -> "형용사"
            "adverb" -> "부사"
            "preposition" -> "전치사"
            "conjunction" -> "접속사"
            "pronoun" -> "대명사"
            "interjection" -> "감탄사"
            else -> pos
        }
    }
}

private fun String.sentenceCase(): String =
    if (isEmpty()) this else this[0].uppercaseChar() + substring(1)

data class DictionaryResult(
    val meanings: List<MeaningCandidate> = emptyList(),
    val examples: List<Example> = emptyList(),
    val phonetic: String? = null,
    val error: String? = null,
) {
    val isEmpty: Boolean get() = meanings.isEmpty() && examples.isEmpty()

    companion object {
        val empty = DictionaryResult()
    }
}

/* ────────── dictionaryapi.dev 응답 스키마(필요한 필드만) ────────── */

@Serializable
private data class DictEntry(
    val word: String? = null,
    val phonetic: String? = null,
    val phonetics: List<DictPhonetic>? = null,
    val meanings: List<DictMeaning>? = null,
)

@Serializable
private data class DictPhonetic(val text: String? = null)

@Serializable
private data class DictMeaning(
    @SerialName("partOfSpeech") val partOfSpeech: String? = null,
    val definitions: List<DictDefinition>? = null,
)

@Serializable
private data class DictDefinition(
    val definition: String? = null,
    val example: String? = null,
)
