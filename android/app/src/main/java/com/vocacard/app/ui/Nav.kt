package com.vocacard.app.ui

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import com.vocacard.app.ui.theme.Motion

/**
 * 화면 전환 모션 규칙.
 *
 *  - 탭 사이 이동 : fade + 아주 작은 scale (수평 이동 없음 → 방향감 혼란 방지)
 *  - 계층 진입    : shared axis X (밀려 들어오고 뒤 화면은 30% 만 밀린다 → 깊이감)
 *  - 학습/모달    : 아래에서 위로 (전체 화면 몰입)
 */
object NavAnim {
    private const val D = Motion.DurMedium
    private const val DOut = Motion.DurShort

    val tabEnter: EnterTransition =
        fadeIn(tween(D, easing = Motion.EmphasizedDecel)) +
            scaleIn(initialScale = 0.98f, animationSpec = tween(D, easing = Motion.EmphasizedDecel))

    val tabExit: ExitTransition =
        fadeOut(tween(DOut, easing = Motion.EmphasizedAccel)) +
            scaleOut(targetScale = 1.01f, animationSpec = tween(DOut, easing = Motion.EmphasizedAccel))

    val modalEnter: EnterTransition =
        slideInVertically(tween(Motion.DurLong, easing = Motion.Emphasized)) { it / 3 } +
            fadeIn(tween(Motion.DurShort))

    val modalExit: ExitTransition =
        slideOutVertically(tween(Motion.DurMedium, easing = Motion.EmphasizedAccel)) { it / 3 } +
            fadeOut(tween(Motion.DurShort))
}

/* 계층 진입/복귀 전환 — NavHost 의 composable() 안에서 쓰기 위해 최상위 확장으로 둔다. */

fun AnimatedContentTransitionScope<*>.pushEnter(): EnterTransition =
    slideInHorizontally(tween(Motion.DurMedium, easing = Motion.Emphasized)) { it } +
        fadeIn(tween(Motion.DurShort, easing = Motion.EmphasizedDecel))

fun AnimatedContentTransitionScope<*>.pushExit(): ExitTransition =
    slideOutHorizontally(tween(Motion.DurMedium, easing = Motion.Emphasized)) { -it / 3 } +
        fadeOut(tween(Motion.DurMedium, easing = Motion.EmphasizedAccel))

fun AnimatedContentTransitionScope<*>.popEnter(): EnterTransition =
    slideInHorizontally(tween(Motion.DurMedium, easing = Motion.Emphasized)) { -it / 3 } +
        fadeIn(tween(Motion.DurMedium, easing = Motion.EmphasizedDecel))

fun AnimatedContentTransitionScope<*>.popExit(): ExitTransition =
    slideOutHorizontally(tween(Motion.DurMedium, easing = Motion.Emphasized)) { it } +
        fadeOut(tween(Motion.DurShort, easing = Motion.EmphasizedAccel))

/** 라우트 정의. 학습 진입점은 하나뿐이며 scope 문자열로 대상을 지정한다. */
object Route {
    const val HOME = "home"
    const val ARCHIVE = "archive"
    const val ARCHIVE_DAY = "archive/{dayId}"
    const val ADD = "add?word={word}"
    const val MY_WORDS = "mywords?filter={filter}&pile={pile}"
    const val WORD_DETAIL = "word/{wordId}"
    const val STUDY = "study/{scope}"
    const val SETTINGS = "settings"

    fun archiveDay(dayId: String) = "archive/$dayId"
    fun add(word: String = "") = "add?word=$word"
    /** [filter] 는 WordFilter 이름(DUE/ALL/HARD/MASTERED), [pile] 이면 쌓기 보기로 연다. */
    fun myWords(filter: String = "DUE", pile: Boolean = false) = "mywords?filter=$filter&pile=$pile"

    fun wordDetail(id: Long) = "word/$id"
    fun study(scope: StudyScope) = "study/${scope.encoded}"

    val tabs = listOf(HOME, ARCHIVE, ADD, MY_WORDS)
}

/** 학습 대상 범위. 화면은 하나지만 어디서 왔는지에 따라 카드 묶음이 달라진다. */
sealed class StudyScope(val encoded: String, val title: String) {
    data class Day(val dayId: String) : StudyScope("day-$dayId", dayId.replace("day", "Day "))
    data object Due : StudyScope("due", "오늘 복습")
    data object MyWords : StudyScope("mine", "내 단어장 전체")
    data object Hard : StudyScope("hard", "어려운 단어")

    companion object {
        fun decode(raw: String?): StudyScope = when {
            raw == null -> Due
            raw.startsWith("day-") -> Day(raw.removePrefix("day-"))
            raw == "mine" -> MyWords
            raw == "hard" -> Hard
            else -> Due
        }
    }
}

/** 학습 모드. 사용자가 학습을 시작할 때마다 직접 고른다. */
enum class StudyMode(val label: String, val description: String) {
    FLASHCARD("암기 카드", "카드를 넘기며 뜻을 확인해요"),
    RECALL("뜻 → 단어", "뜻을 보고 영단어를 떠올려요"),
    QUIZ("4지선다", "보기 중에서 맞는 뜻을 골라요"),
    SPELLING("스펠링", "직접 철자를 입력해요"),
}
