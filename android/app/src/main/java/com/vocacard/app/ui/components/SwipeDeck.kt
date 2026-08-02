package com.vocacard.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.VocaShape
import com.vocacard.app.ui.theme.voca
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.sign

enum class SwipeDirection { LEFT, RIGHT, UP }

/**
 * Class Card 식 카드 스택.
 *
 * 모션 설계
 *  - 맨 앞 카드만 손가락을 그대로 따라간다. `Animatable` 을 직접 굴려 프레임 지연이 없다.
 *  - 가로 이동량에 비례해 회전(최대 ±12°)한다. 손목으로 카드를 던지는 물리 감각.
 *  - 뒤 카드 2장은 앞 카드가 밀린 만큼 **미리** 올라온다(scale/offset 보간). 스택이 살아 있는 느낌.
 *  - 임계값(96dp)을 넘겨 놓으면 화면 밖으로 날아가고, 못 넘기면 스프링으로 제자리 복귀.
 *  - 좌/우 방향에 따라 카드 위에 색 오버레이가 서서히 짙어져 판정을 미리 보여준다.
 *
 * @param items 남아 있는 카드들. 맨 앞이 index 0.
 * @param onSwiped 카드가 완전히 날아간 뒤 호출. 호출 측에서 items 를 줄여 주면 된다.
 */
@Composable
fun <T> SwipeDeck(
    items: List<T>,
    key: (T) -> Any,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    allowUp: Boolean = false,
    /** false 면 맨 앞 카드의 배경을 그리지 않는다(FlipCard 처럼 스스로 면을 그리는 콘텐츠용). */
    drawTopSurface: Boolean = true,
    onSwiped: (item: T, direction: SwipeDirection) -> Unit,
    overlayLabel: @Composable (SwipeDirection, Float) -> Unit = { _, _ -> },
    content: @Composable BoxScope.(item: T, isTop: Boolean) -> Unit,
) {
    if (items.isEmpty()) return

    val density = LocalDensity.current
    val screenWidthPx = with(density) { LocalConfiguration.current.screenWidthDp.dp.toPx() }
    val thresholdPx = with(density) { Motion.SwipeThreshold.toPx() }
    val colors = voca
    val scope = rememberCoroutineScope()

    val topKey = key(items.first())
    val offsetX = remember(topKey) { Animatable(0f) }
    val offsetY = remember(topKey) { Animatable(0f) }

    // 뒤 카드는 최대 3장까지만 그린다.
    val visible = items.take(3)

    Box(modifier, contentAlignment = Alignment.Center) {

        // ── 뒤 카드들 (뒤에서 앞으로 그린다) ──
        visible.drop(1).asReversed().forEachIndexed { revIndex, item ->
            val depth = visible.size - 1 - revIndex // 2 또는 1
            // 앞 카드가 밀린 정도(0~1)만큼 한 칸씩 앞으로 당겨진다.
            val progress = (abs(offsetX.value) / thresholdPx).coerceIn(0f, 1f)
            val effectiveDepth = depth - progress
            val scale = 1f - 0.055f * effectiveDepth
            val yOff = with(density) { (14.dp.toPx()) * effectiveDepth }
            Box(
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = 4.dp)
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationY = yOff
                        alpha = 1f - 0.18f * effectiveDepth
                    }
                    .clip(RoundedCornerShape(VocaShape.card))
                    .background(colors.surface)
                    .border(1.dp, colors.line, RoundedCornerShape(VocaShape.card)),
            ) { content(item, false) }
        }

        // ── 맨 앞 카드 ──
        val top = items.first()
        val dragProgress = (abs(offsetX.value) / thresholdPx).coerceIn(0f, 1f)
        val upProgress = if (allowUp) (-offsetY.value / thresholdPx).coerceIn(0f, 1f) else 0f
        val direction = when {
            upProgress > dragProgress && upProgress > 0f -> SwipeDirection.UP
            offsetX.value >= 0f -> SwipeDirection.RIGHT
            else -> SwipeDirection.LEFT
        }
        val overlayAlpha = maxOf(dragProgress, upProgress)

        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    translationX = offsetX.value
                    translationY = offsetY.value
                    rotationZ = (offsetX.value / screenWidthPx) * 26f
                    val s = 1f - 0.02f * dragProgress
                    scaleX = s
                    scaleY = s
                }
                .pointerInput(topKey, enabled) {
                    if (!enabled) return@pointerInput
                    detectDragGestures(
                        onDragEnd = {
                            val dx = offsetX.value
                            val dy = offsetY.value
                            val goneUp = allowUp && -dy > thresholdPx && abs(dy) > abs(dx)
                            val goneSide = abs(dx) > thresholdPx
                            when {
                                goneUp -> scope.launch {
                                    offsetY.animateTo(-screenWidthPx * 1.6f, Motion.fling())
                                    onSwiped(top, SwipeDirection.UP)
                                }
                                goneSide -> scope.launch {
                                    val target = sign(dx) * screenWidthPx * 1.6f
                                    launch { offsetY.animateTo(dy * 1.4f, Motion.fling()) }
                                    offsetX.animateTo(target, Motion.fling())
                                    onSwiped(top, if (dx > 0) SwipeDirection.RIGHT else SwipeDirection.LEFT)
                                }
                                else -> scope.launch {
                                    launch { offsetX.animateTo(0f, Motion.settle()) }
                                    offsetY.animateTo(0f, Motion.settle())
                                }
                            }
                        },
                        onDragCancel = {
                            scope.launch {
                                launch { offsetX.animateTo(0f, Motion.settle()) }
                                offsetY.animateTo(0f, Motion.settle())
                            }
                        },
                    ) { change, drag: Offset ->
                        change.consume()
                        scope.launch {
                            offsetX.snapTo(offsetX.value + drag.x)
                            // 세로는 저항을 줘서 카드가 위아래로 헐겁게 흔들리지 않게 한다.
                            offsetY.snapTo(offsetY.value + drag.y * if (allowUp) 1f else 0.35f)
                        }
                    }
                }
                .let {
                    if (drawTopSurface) {
                        it.clip(RoundedCornerShape(VocaShape.card))
                            .background(colors.surface)
                            .border(1.dp, colors.line, RoundedCornerShape(VocaShape.card))
                    } else it
                },
        ) {
            content(top, true)

            if (overlayAlpha > 0.02f) {
                val tint = when (direction) {
                    SwipeDirection.RIGHT -> colors.know
                    SwipeDirection.LEFT -> colors.dontKnow
                    SwipeDirection.UP -> colors.highlight
                }
                Box(
                    Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(VocaShape.card))
                        .background(tint.copy(alpha = 0.16f * overlayAlpha)),
                    contentAlignment = Alignment.Center,
                ) { overlayLabel(direction, overlayAlpha) }
            }
        }
    }

    // 카드가 바뀌면 위치를 리셋한다.
    LaunchedEffect(topKey) {
        offsetX.snapTo(0f)
        offsetY.snapTo(0f)
    }
}

/** 버튼으로도 같은 판정을 낼 수 있게 하는 보조 상태(외부 트리거 애니메이션). */
@Composable
fun rememberDeckNudge(trigger: Int, toRight: Boolean): Float {
    val value by animateFloatAsState(
        targetValue = if (trigger % 2 == 0) 0f else if (toRight) 1f else -1f,
        animationSpec = Motion.fling(),
        label = "deckNudge",
    )
    return value
}

internal fun blend(a: Color, b: Color, t: Float): Color = Color(
    red = a.red + (b.red - a.red) * t,
    green = a.green + (b.green - a.green) * t,
    blue = a.blue + (b.blue - a.blue) * t,
    alpha = a.alpha + (b.alpha - a.alpha) * t,
)
