package com.vocacard.app.data.study

import com.vocacard.app.data.db.StudyStateEntity
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * SM-2 를 단순화한 간격 반복 스케줄러.
 *
 * "몰랐던 단어를 계속 보게 한다"는 것이 이 앱의 핵심 요구사항이므로,
 * 틀린 단어는 **당일 안에 다시** 돌아오게(10분 뒤) 만들고, 맞을수록 간격을 벌린다.
 *
 * box: 0(신규) → 1 → 2 → 3 → 4 → 5(마스터)
 * 기본 간격: 10분 → 1일 → 3일 → 7일 → 16일 → 35일 (ease 로 가감)
 */
object Scheduler {

    private const val MINUTE = 60_000L
    private const val DAY = 24 * 60 * MINUTE

    private val baseIntervalDays = floatArrayOf(0f, 1f, 3f, 7f, 16f, 35f)

    enum class Grade {
        /** 몰라요 — 처음부터 다시 */
        AGAIN,

        /** 애매해요 — 같은 단계 유지, 조금만 미룸 */
        HARD,

        /** 알아요 — 다음 단계 */
        GOOD,

        /** 쉬워요 — 두 단계 점프 */
        EASY,
    }

    fun next(
        current: StudyStateEntity?,
        wordId: Long,
        grade: Grade,
        now: Long = System.currentTimeMillis(),
    ): StudyStateEntity {
        val state = current ?: StudyStateEntity(wordId = wordId)

        var box = state.box
        var ease = state.ease

        when (grade) {
            Grade.AGAIN -> {
                box = 0
                ease = max(1.3f, ease - 0.22f)
            }
            Grade.HARD -> {
                box = max(1, box)
                ease = max(1.3f, ease - 0.08f)
            }
            Grade.GOOD -> {
                box = (box + 1).coerceAtMost(5)
                ease += 0.02f
            }
            Grade.EASY -> {
                box = (box + 2).coerceAtMost(5)
                ease += 0.12f
            }
        }
        ease = ease.coerceIn(1.3f, 3.0f)

        val intervalDays: Float
        val dueAt: Long
        if (box == 0) {
            // 오늘 안에 다시 만난다.
            intervalDays = 0f
            dueAt = now + 10 * MINUTE
        } else {
            val base = baseIntervalDays[box]
            val factor = when (grade) {
                Grade.HARD -> 0.6f
                Grade.EASY -> 1.3f
                else -> 1f
            }
            intervalDays = base * (ease / 2.5f) * factor
            dueAt = now + (intervalDays * DAY).roundToLong()
        }

        return state.copy(
            wordId = wordId,
            box = box,
            ease = ease,
            intervalDays = intervalDays,
            dueAt = dueAt,
            correctCount = state.correctCount + if (grade == Grade.AGAIN) 0 else 1,
            wrongCount = state.wrongCount + if (grade == Grade.AGAIN) 1 else 0,
            lastResult = grade.ordinal,
            updatedAt = now,
        )
    }

    /** 사람이 읽을 수 있는 다음 복습 시점. */
    fun describeDue(dueAt: Long, now: Long = System.currentTimeMillis()): String {
        val diff = dueAt - now
        return when {
            diff <= 0 -> "지금 복습"
            diff < 60 * MINUTE -> "${(diff / MINUTE).coerceAtLeast(1)}분 뒤"
            diff < DAY -> "${diff / (60 * MINUTE)}시간 뒤"
            diff < 30 * DAY -> "${diff / DAY}일 뒤"
            else -> "${diff / (30 * DAY)}개월 뒤"
        }
    }

    fun boxLabel(box: Int): String = when (box) {
        0 -> "새 단어"
        1 -> "익히는 중"
        2 -> "1단계"
        3 -> "2단계"
        4 -> "3단계"
        else -> "마스터"
    }
}
