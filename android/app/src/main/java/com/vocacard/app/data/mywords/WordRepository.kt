package com.vocacard.app.data.mywords

import com.vocacard.app.data.db.SessionDao
import com.vocacard.app.data.db.SessionEntity
import com.vocacard.app.data.db.StudyStateDao
import com.vocacard.app.data.db.StudyStateEntity
import com.vocacard.app.data.db.WordDao
import com.vocacard.app.data.db.WordEntity
import com.vocacard.app.data.db.WordWithState
import com.vocacard.app.data.model.ArchiveWord
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.study.Scheduler
import kotlinx.coroutines.flow.Flow

/**
 * "내 단어장" — 사용자가 몰랐던 단어와 직접 추가한 단어를 한 곳에서 관리한다.
 * 아카이브 학습 중 "몰라요"가 나오면 [promoteFromArchive] 로 자동 적재된다.
 */
class WordRepository(
    private val wordDao: WordDao,
    private val stateDao: StudyStateDao,
    private val sessionDao: SessionDao,
) {
    fun observeAll(): Flow<List<WordWithState>> = wordDao.observeAll()
    fun observeDue(limit: Int = 200): Flow<List<WordWithState>> =
        wordDao.observeDue(System.currentTimeMillis(), limit)

    fun observeDueCount(): Flow<Int> = wordDao.observeDueCount(System.currentTimeMillis())
    fun observeTotal(): Flow<Int> = wordDao.observeTotal()
    fun observeMastered(): Flow<Int> = wordDao.observeMastered()
    fun observeOne(id: Long): Flow<WordWithState?> = wordDao.observeOne(id)
    fun observeSessions(): Flow<List<SessionEntity>> = sessionDao.observeRecent(60)

    suspend fun findByWord(word: String): WordEntity? = wordDao.findByWord(word.trim().lowercase())

    /** 단어 추가 화면에서 저장. 이미 있으면 뜻/예문을 합친다. */
    suspend fun save(
        word: String,
        meanings: List<String>,
        examples: List<Example>,
        phonetic: String? = null,
        note: String = "",
        sourceDayId: String? = null,
        origin: String = WordEntity.ORIGIN_MANUAL,
    ): Long {
        val trimmed = word.trim()
        require(trimmed.isNotEmpty()) { "단어가 비어 있습니다" }
        val id = wordDao.insertOrMerge(
            WordEntity(
                word = trimmed,
                wordLower = trimmed.lowercase(),
                meanings = meanings.map { it.trim() }.filter { it.isNotEmpty() }.distinct(),
                examples = examples.filter { it.text.isNotBlank() }.distinctBy { it.text.trim().lowercase() },
                phonetic = phonetic,
                note = note,
                origin = origin,
                sourceDayId = sourceDayId,
            )
        )
        if (stateDao.find(id) == null) {
            // 새로 담긴 단어는 즉시 복습 대상.
            stateDao.upsert(StudyStateEntity(wordId = id, dueAt = System.currentTimeMillis()))
        }
        return id
    }

    /** 학습 중 "몰라요" 처리된 아카이브 단어를 내 단어장으로 승격. */
    suspend fun promoteFromArchive(archiveWord: ArchiveWord, dayId: String): Long = save(
        word = archiveWord.word,
        meanings = archiveWord.senses.ifEmpty { listOf(archiveWord.meaning) },
        examples = emptyList(),
        sourceDayId = dayId,
        origin = WordEntity.ORIGIN_ARCHIVE,
    )

    suspend fun update(
        id: Long,
        meanings: List<String>? = null,
        examples: List<Example>? = null,
        note: String? = null,
    ) {
        val existing = wordDao.findById(id) ?: return
        wordDao.update(
            existing.copy(
                meanings = meanings ?: existing.meanings,
                examples = examples ?: existing.examples,
                note = note ?: existing.note,
                updatedAt = System.currentTimeMillis(),
            )
        )
    }

    suspend fun setPinned(id: Long, pinned: Boolean) =
        wordDao.setPinned(id, pinned, System.currentTimeMillis())

    suspend fun delete(id: Long) {
        wordDao.delete(id)
        stateDao.delete(id)
    }

    /** 학습 결과 반영. */
    suspend fun grade(wordId: Long, grade: Scheduler.Grade) {
        val current = stateDao.find(wordId)
        stateDao.upsert(Scheduler.next(current, wordId, grade))
    }

    suspend fun recordSession(mode: String, scope: String, total: Int, correct: Int) {
        sessionDao.insert(
            SessionEntity(
                startedAt = System.currentTimeMillis(),
                mode = mode,
                scope = scope,
                total = total,
                correct = correct,
            )
        )
    }

    suspend fun resetAll() {
        wordDao.deleteAll()
        stateDao.deleteAll()
        sessionDao.deleteAll()
    }
}
