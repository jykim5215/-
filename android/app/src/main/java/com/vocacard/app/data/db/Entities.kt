package com.vocacard.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import com.vocacard.app.data.model.Example
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * 내 단어장에 담기는 단어.
 * 아카이브 단어는 여기에 복제하지 않는다 — "몰라요"가 뜬 순간에만 승격된다.
 */
@Entity(
    tableName = "words",
    indices = [Index(value = ["wordLower"], unique = true), Index(value = ["sourceDayId"])],
)
data class WordEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val word: String,
    /** 중복 방지를 위한 소문자 정규화 키 */
    val wordLower: String,
    /** 사용자가 선택/입력한 뜻들 */
    val meanings: List<String>,
    val examples: List<Example> = emptyList(),
    val phonetic: String? = null,
    val note: String = "",
    /** ARCHIVE = 아카이브에서 승격, MANUAL = 직접 추가 */
    val origin: String = ORIGIN_MANUAL,
    val sourceDayId: String? = null,
    val pinned: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
) {
    companion object {
        const val ORIGIN_ARCHIVE = "ARCHIVE"
        const val ORIGIN_MANUAL = "MANUAL"
    }
}

/** 간격 반복 상태. wordId 는 내 단어장 단어의 id. */
@Entity(tableName = "study_state")
data class StudyStateEntity(
    @PrimaryKey val wordId: Long,
    /** 0=신규, 1..5 = 학습 단계 */
    val box: Int = 0,
    val ease: Float = 2.5f,
    val intervalDays: Float = 0f,
    val dueAt: Long = 0L,
    val correctCount: Int = 0,
    val wrongCount: Int = 0,
    val lastResult: Int = 0,
    val updatedAt: Long = System.currentTimeMillis(),
) {
    val isDue: Boolean get() = dueAt <= System.currentTimeMillis()
}

/** Day 단위 진도. 아카이브 학습 결과를 저장한다. */
@Entity(tableName = "day_progress")
data class DayProgressEntity(
    @PrimaryKey val dayId: String,
    @ColumnInfo(defaultValue = "0") val learnedCount: Int = 0,
    @ColumnInfo(defaultValue = "0") val totalCount: Int = 0,
    val lastStudiedAt: Long = 0L,
)

/** 개별 아카이브 단어의 암기 여부(엑셀의 "외움" 열에 대응). */
@Entity(tableName = "archive_marks")
data class ArchiveMarkEntity(
    @PrimaryKey val archiveWordId: String,
    val dayId: String,
    val known: Boolean,
    val updatedAt: Long = System.currentTimeMillis(),
)

/** 학습 세션 기록 — 연속 학습일(streak) 계산용. */
@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val startedAt: Long,
    val mode: String,
    val scope: String,
    val total: Int,
    val correct: Int,
)

class Converters {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    // 직렬화기를 명시한다. reified 확장(encodeToString(value))은 Room 이 생성하는
    // 자바 호출부에서 타입 추론이 되지 않아 컴파일에 실패한다.
    private val stringList = ListSerializer(String.serializer())
    private val exampleList = ListSerializer(Example.serializer())

    @TypeConverter
    fun stringListToJson(value: List<String>): String = json.encodeToString(stringList, value)

    @TypeConverter
    fun jsonToStringList(value: String): List<String> =
        runCatching { json.decodeFromString(stringList, value) }.getOrDefault(emptyList())

    @TypeConverter
    fun exampleListToJson(value: List<Example>): String = json.encodeToString(exampleList, value)

    @TypeConverter
    fun jsonToExampleList(value: String): List<Example> =
        runCatching { json.decodeFromString(exampleList, value) }.getOrDefault(emptyList())
}
