package com.vocacard.app.ui.theme

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp

/**
 * 앱 전체 모션의 단일 출처.
 *
 * 원칙
 *  1. 사용자가 직접 조작하는 것(카드 드래그·플립·선택)은 **스프링**. 손가락을 따라오는 느낌이 나야 한다.
 *  2. 사용자가 조작하지 않는 상태 변화(화면 전환·페이드·진행률)는 **easing tween**. 예측 가능해야 한다.
 *  3. 지속시간은 이동 거리에 비례한다. 작은 것은 빠르게(150ms), 화면 전체는 느리게(340ms).
 */
object Motion {

    // Material 3 "emphasized" 계열 이징
    val Emphasized: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val EmphasizedDecel: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
    val EmphasizedAccel: Easing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)
    val Standard: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)

    const val DurQuick = 150
    const val DurShort = 220
    const val DurMedium = 300
    const val DurLong = 420

    /** 카드 플립 — 살짝 튕기지만 흔들리지 않는 감쇠비. */
    fun <T> flip(): AnimationSpec<T> = spring(dampingRatio = 0.75f, stiffness = 380f)

    /** 드래그 놓았을 때 제자리 복귀. */
    fun <T> settle(): AnimationSpec<T> = spring(dampingRatio = 0.72f, stiffness = 620f)

    /** 카드가 화면 밖으로 날아갈 때. */
    fun <T> fling(): AnimationSpec<T> = spring(dampingRatio = 1f, stiffness = 260f)

    /** 스택에서 카드가 한 칸 앞으로 올라올 때. */
    fun <T> promote(): AnimationSpec<T> = spring(dampingRatio = 0.8f, stiffness = 300f)

    /** 칩 선택·버튼 눌림 등 작은 요소. */
    fun <T> press(): AnimationSpec<T> = spring(dampingRatio = 0.55f, stiffness = 900f)

    /** 진행률 바/링. */
    fun <T> progress(): AnimationSpec<T> = spring(dampingRatio = 0.9f, stiffness = 180f)

    /** 크기가 변하는 컨테이너(펼침/접힘). */
    fun <T> resize(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.85f, stiffness = 400f)

    fun offsetSpring(): FiniteAnimationSpec<IntOffset> =
        spring(dampingRatio = 0.8f, stiffness = 380f, visibilityThreshold = IntOffset.VisibilityThreshold)

    fun dpSpring(): FiniteAnimationSpec<Dp> =
        spring(dampingRatio = 0.8f, stiffness = 500f, visibilityThreshold = Dp.VisibilityThreshold)

    fun fadeIn(delayMillis: Int = 0): FiniteAnimationSpec<Float> =
        tween(DurMedium, delayMillis = delayMillis, easing = EmphasizedDecel)

    fun fadeOut(): FiniteAnimationSpec<Float> = tween(DurQuick, easing = EmphasizedAccel)

    /** 리스트 진입 stagger 지연. 너무 길어지지 않도록 상한을 둔다. */
    fun staggerDelay(index: Int, step: Int = 26, max: Int = 300): Int =
        (index * step).coerceAtMost(max)

    /** 스와이프 판정 임계값(가로 이동 dp). */
    val SwipeThreshold: Dp = 96.dp

    /** 3D 플립 원근감. graphicsLayer.cameraDistance = density * this */
    const val CameraDistance = 14f

    /** 흔들림(오답) 진폭 */
    val ShakeAmplitude: Dp = 10.dp

    const val SpringDefault = Spring.StiffnessMedium
}
