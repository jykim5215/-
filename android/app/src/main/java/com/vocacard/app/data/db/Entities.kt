package com.vocacard.app.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverter
import com.vocacard.app.data.model.Example
import com.vocacard.app.data.model.ExampleSource
import org.json.JSONArray
import org.json.JSONObject

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

/**
 * Room TypeConverter.
 *
 * **kotlinx.serialization 을 쓰지 않는다.** `Example.serializer()` 같은 함수는
 * 직렬화 컴파일러 플러그인이 만들어 주는데, Room 의 KSP 프로세서는 그보다 먼저 도는
 * 단계에서 이 클래스를 훑기 때문에 타입을 해석하지 못하고
 * `[MissingType]: Element 'Converters' references a type that is not present` 로 실패한다.
 * 안드로이드에 기본 내장된 org.json 만 써서 그 의존을 끊는다.
 */
class Converters {

    @TypeConverter
    fun stringListToJson(value: List<String>): String {
        val array = JSONArray()
        value.forEach { array.put(it) }
        return array.toString()
    }

    @TypeConverter
    fun jsonToStringList(value: String): List<String> = runCatching {
        val array = JSONArray(value)
        (0 until array.length()).map { array.getString(it) }
    }.getOrDefault(emptyList())

    @TypeConverter
    fun exampleListToJson(value: List<Example>): String {
        val array = JSONArray()
        value.forEach { example ->
            array.put(
                JSONObject()
                    .put(KEY_TEXT, example.text)
                    .put(KEY_TRANSLATION, example.translation)
                    .put(KEY_SOURCE, example.source.name)
            )
        }
        return array.toString()
    }

    @TypeConverter
    fun jsonToExampleList(value: String): List<Example> = runCatching {
        val array = JSONArray(value)
        (0 until array.length()).map { i ->
            val obj = array.getJSONObject(i)
            Example(
                text = obj.optString(KEY_TEXT),
                translation = obj.optString(KEY_TRANSLATION),
                source = runCatching {
                    ExampleSource.valueOf(obj.optString(KEY_SOURCE, ExampleSource.MANUAL.name))
                }.getOrDefault(ExampleSource.MANUAL),
            )
        }
    }.getOrDefault(emptyList())

    private companion object {
        const val KEY_TEXT = "text"
        const val KEY_TRANSLATION = "translation"
        const val KEY_SOURCE = "src"
    }
}
