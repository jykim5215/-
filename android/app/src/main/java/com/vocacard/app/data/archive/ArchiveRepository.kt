package com.vocacard.app.data.archive

import android.content.Context
import com.vocacard.app.data.db.ArchiveDao
import com.vocacard.app.data.db.ArchiveMarkEntity
import com.vocacard.app.data.db.DayProgressEntity
import com.vocacard.app.data.model.ArchiveDay
import com.vocacard.app.data.model.ArchiveWord
import com.vocacard.app.data.model.WordBank
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/**
 * `assets/wordbank.json` (엑셀에서 변환한 30일 아카이브)을 읽는다.
 * 아카이브는 **읽기 전용**이며, 사용자의 암기 표시만 DB(archive_marks)에 따로 저장한다.
 */
class ArchiveRepository(
    private val context: Context,
    private val archiveDao: ArchiveDao,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()

    @Volatile
    private var cache: WordBank? = null

    /** 소문자 단어 → 아카이브 단어(중복 시 가장 앞 Day) */
    @Volatile
    private var index: Map<String, Pair<ArchiveWord, String>> = emptyMap()

    suspend fun bank(): WordBank {
        cache?.let { return it }
        return mutex.withLock {
            cache ?: withContext(Dispatchers.IO) {
                val text = context.assets.open(ASSET).bufferedReader().use { it.readText() }
                val parsed = json.decodeFromString<WordBank>(text)
                val idx = HashMap<String, Pair<ArchiveWord, String>>(parsed.days.sumOf { it.words.size })
                parsed.days.forEach { day ->
                    day.words.forEach { w -> idx.putIfAbsent(w.word.lowercase(), w to day.id) }
                }
                index = idx
                cache = parsed
                parsed
            }
        }
    }

    suspend fun days(): List<ArchiveDay> = bank().days

    suspend fun day(dayId: String): ArchiveDay? = bank().days.firstOrNull { it.id == dayId }

    suspend fun lookup(word: String): Pair<ArchiveWord, String>? {
        bank()
        return index[word.trim().lowercase()]
    }

    /** 입력 접두사로 시작하는 아카이브 단어 자동완성 후보. */
    suspend fun prefixMatches(prefix: String, limit: Int = 8): List<Pair<ArchiveWord, String>> {
        bank()
        val p = prefix.trim().lowercase()
        if (p.isEmpty()) return emptyList()
        return index.asSequence()
            .filter { it.key.startsWith(p) }
            .sortedBy { it.key.length }
            .take(limit)
            .map { it.value }
            .toList()
    }

    /** 오답 보기(distractor) 생성을 위한 무작위 뜻 표본. */
    suspend fun randomMeanings(exclude: String, count: Int): List<String> {
        val all = bank().days.flatMap { it.words }
        if (all.isEmpty()) return emptyList()
        val excludeNorm = exclude.trim()
        return all.asSequence()
            .map { it.senses.firstOrNull() ?: it.meaning }
            .filter { it.isNotBlank() && it.trim() != excludeNorm }
            .distinct()
            .shuffled()
            .take(count)
            .toList()
    }

    /** Day 별 진행률. 아직 학습 이력이 없는 Day 도 0 으로 채워 내보낸다. */
    fun observeDayProgress(): Flow<Map<String, DayProgressEntity>> = flow {
        val totals = bank().days.associate { it.id to it.words.size }
        archiveDao.observeProgress().collect { list ->
            val stored = list.associateBy { it.dayId }
            emit(
                totals.keys.associateWith { id ->
                    stored[id] ?: DayProgressEntity(dayId = id, totalCount = totals[id] ?: 0)
                }
            )
        }
    }

    fun observeMarks(dayId: String): Flow<Map<String, Boolean>> =
        archiveDao.observeMarks(dayId).map { list -> list.associate { it.archiveWordId to it.known } }

    fun observeAllMarks(): Flow<Map<String, Boolean>> =
        archiveDao.observeAllMarks().map { list -> list.associate { it.archiveWordId to it.known } }

    fun observeLearnedTotal(): Flow<Int> =
        archiveDao.observeAllMarks().map { list -> list.count { it.known } }

    suspend fun mark(archiveWordId: String, dayId: String, known: Boolean) {
        archiveDao.upsertMark(ArchiveMarkEntity(archiveWordId, dayId, known))
        val total = day(dayId)?.words?.size ?: 0
        archiveDao.upsertProgress(
            DayProgressEntity(
                dayId = dayId,
                learnedCount = archiveDao.knownCount(dayId),
                totalCount = total,
                lastStudiedAt = System.currentTimeMillis(),
            )
        )
    }

    suspend fun resetMarks() {
        archiveDao.deleteAllMarks()
        archiveDao.deleteAllProgress()
    }

    /** 전체 단어 수 (홈 통계용) */
    suspend fun totalWordCount(): Int = bank().days.sumOf { it.words.size }

    companion object {
        private const val ASSET = "wordbank.json"
    }
}
