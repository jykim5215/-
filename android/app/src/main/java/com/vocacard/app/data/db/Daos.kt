package com.vocacard.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** 내 단어장 단어 + 학습 상태를 함께 읽기 위한 조인 결과. */
data class WordWithState(
    val id: Long,
    val word: String,
    val meanings: List<String>,
    val examples: List<com.vocacard.app.data.model.Example>,
    val phonetic: String?,
    val note: String,
    val origin: String,
    val sourceDayId: String?,
    val pinned: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    val box: Int?,
    val dueAt: Long?,
    val correctCount: Int?,
    val wrongCount: Int?,
) {
    val isDue: Boolean get() = (dueAt ?: 0L) <= System.currentTimeMillis()
    val isHard: Boolean get() = (wrongCount ?: 0) >= 2 && (wrongCount ?: 0) > (correctCount ?: 0)
    val isMastered: Boolean get() = (box ?: 0) >= 5
}

@Dao
abstract class WordDao {

    @Query(
        """
        SELECT w.id AS id, w.word AS word, w.meanings AS meanings, w.examples AS examples,
               w.phonetic AS phonetic, w.note AS note, w.origin AS origin,
               w.sourceDayId AS sourceDayId, w.pinned AS pinned,
               w.createdAt AS createdAt, w.updatedAt AS updatedAt,
               s.box AS box, s.dueAt AS dueAt, s.correctCount AS correctCount, s.wrongCount AS wrongCount
        FROM words w LEFT JOIN study_state s ON s.wordId = w.id
        ORDER BY w.pinned DESC, w.updatedAt DESC
        """
    )
    abstract fun observeAll(): Flow<List<WordWithState>>

    @Query(
        """
        SELECT w.id AS id, w.word AS word, w.meanings AS meanings, w.examples AS examples,
               w.phonetic AS phonetic, w.note AS note, w.origin AS origin,
               w.sourceDayId AS sourceDayId, w.pinned AS pinned,
               w.createdAt AS createdAt, w.updatedAt AS updatedAt,
               s.box AS box, s.dueAt AS dueAt, s.correctCount AS correctCount, s.wrongCount AS wrongCount
        FROM words w LEFT JOIN study_state s ON s.wordId = w.id
        WHERE COALESCE(s.dueAt, 0) <= :now
        ORDER BY COALESCE(s.dueAt, 0) ASC, w.createdAt ASC
        LIMIT :limit
        """
    )
    abstract fun observeDue(now: Long, limit: Int): Flow<List<WordWithState>>

    @Query("SELECT COUNT(*) FROM words w LEFT JOIN study_state s ON s.wordId = w.id WHERE COALESCE(s.dueAt, 0) <= :now")
    abstract fun observeDueCount(now: Long): Flow<Int>

    @Query("SELECT COUNT(*) FROM words")
    abstract fun observeTotal(): Flow<Int>

    @Query("SELECT COUNT(*) FROM study_state WHERE box >= 5")
    abstract fun observeMastered(): Flow<Int>

    /** 완전히 외운(마스터) 단어를 최근 순으로. 홈의 "쌓인 단어" 시각화에 쓴다. */
    @Query(
        """
        SELECT w.word FROM words w JOIN study_state s ON s.wordId = w.id
        WHERE s.box >= 5 ORDER BY s.updatedAt DESC LIMIT :limit
        """
    )
    abstract fun observeMasteredWords(limit: Int): Flow<List<String>>

    @Query(
        """
        SELECT w.id AS id, w.word AS word, w.meanings AS meanings, w.examples AS examples,
               w.phonetic AS phonetic, w.note AS note, w.origin AS origin,
               w.sourceDayId AS sourceDayId, w.pinned AS pinned,
               w.createdAt AS createdAt, w.updatedAt AS updatedAt,
               s.box AS box, s.dueAt AS dueAt, s.correctCount AS correctCount, s.wrongCount AS wrongCount
        FROM words w LEFT JOIN study_state s ON s.wordId = w.id WHERE w.id = :id
        """
    )
    abstract fun observeOne(id: Long): Flow<WordWithState?>

    @Query("SELECT * FROM words WHERE wordLower = :lower LIMIT 1")
    abstract suspend fun findByWord(lower: String): WordEntity?

    @Query("SELECT * FROM words WHERE id = :id")
    abstract suspend fun findById(id: Long): WordEntity?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    abstract suspend fun insert(word: WordEntity): Long

    @Update
    abstract suspend fun update(word: WordEntity)

    @Query("DELETE FROM words WHERE id = :id")
    abstract suspend fun delete(id: Long)

    @Query("DELETE FROM words")
    abstract suspend fun deleteAll()

    @Query("UPDATE words SET pinned = :pinned, updatedAt = :now WHERE id = :id")
    abstract suspend fun setPinned(id: Long, pinned: Boolean, now: Long)

    @Transaction
    open suspend fun insertOrMerge(entity: WordEntity): Long {
        val existing = findByWord(entity.wordLower)
        return if (existing == null) {
            insert(entity)
        } else {
            val merged = existing.copy(
                meanings = (existing.meanings + entity.meanings).distinct(),
                examples = (existing.examples + entity.examples).distinctBy { it.text.trim().lowercase() },
                phonetic = existing.phonetic ?: entity.phonetic,
                note = if (entity.note.isBlank()) existing.note else entity.note,
                sourceDayId = existing.sourceDayId ?: entity.sourceDayId,
                updatedAt = System.currentTimeMillis(),
            )
            update(merged)
            existing.id
        }
    }
}

@Dao
interface StudyStateDao {
    @Query("SELECT * FROM study_state WHERE wordId = :wordId")
    suspend fun find(wordId: Long): StudyStateEntity?

    @Upsert
    suspend fun upsert(state: StudyStateEntity)

    @Query("DELETE FROM study_state WHERE wordId = :wordId")
    suspend fun delete(wordId: Long)

    @Query("DELETE FROM study_state")
    suspend fun deleteAll()
}

@Dao
interface ArchiveDao {
    @Query("SELECT * FROM day_progress")
    fun observeProgress(): Flow<List<DayProgressEntity>>

    @Query("SELECT * FROM day_progress WHERE dayId = :dayId")
    fun observeDay(dayId: String): Flow<DayProgressEntity?>

    @Upsert
    suspend fun upsertProgress(progress: DayProgressEntity)

    @Query("SELECT * FROM archive_marks WHERE dayId = :dayId")
    fun observeMarks(dayId: String): Flow<List<ArchiveMarkEntity>>

    @Query("SELECT * FROM archive_marks")
    fun observeAllMarks(): Flow<List<ArchiveMarkEntity>>

    @Query("SELECT * FROM archive_marks WHERE known = 1 ORDER BY updatedAt DESC LIMIT :limit")
    fun observeRecentKnown(limit: Int): Flow<List<ArchiveMarkEntity>>

    @Upsert
    suspend fun upsertMark(mark: ArchiveMarkEntity)

    @Query("SELECT COUNT(*) FROM archive_marks WHERE dayId = :dayId AND known = 1")
    suspend fun knownCount(dayId: String): Int

    @Query("DELETE FROM archive_marks")
    suspend fun deleteAllMarks()

    @Query("DELETE FROM day_progress")
    suspend fun deleteAllProgress()
}

@Dao
interface SessionDao {
    @Insert
    suspend fun insert(session: SessionEntity): Long

    @Query("SELECT * FROM sessions ORDER BY startedAt DESC LIMIT :limit")
    fun observeRecent(limit: Int): Flow<List<SessionEntity>>

    @Query("DELETE FROM sessions")
    suspend fun deleteAll()
}
