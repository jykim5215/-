package com.vocacard.app.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vocacard.app.ui.theme.Motion
import kotlinx.coroutines.delay
import kotlin.math.abs

/**
 * 완전히 외운 단어가 **하나씩 떨어져 쌓이는** 시각화.
 *
 * 왜 이렇게 만들었나
 *  - "몇 개를 확실히 아는가"는 이 앱에서 가장 중요한 숫자다. 목록이 아니라 **부피**로 보여야
 *    쌓인 실감이 난다. 그래서 단어를 아래에서부터 층층이 채운다.
 *  - 각 단어는 위에서 떨어져 바닥/아랫줄에 부딪히고 살짝 튕긴다(감쇠비 0.5).
 *    스프링의 오버슈트가 그대로 착지 반동이 되므로 별도 물리 엔진이 필요 없다.
 *  - 떨어지는 순서는 index 마다 55ms 씩 어긋나게 해서, 우르르 쏟아지지 않고
 *    또박또박 쌓이는 리듬을 만든다.
 *  - 착지 순간 세로로 살짝 눌렸다(squash) 돌아오고, 미세하게 기운 각도로 멈춘다.
 *    각도는 단어 문자열 해시에서 뽑아 **매번 같은 자리에 같은 모양**으로 재현된다.
 *
 * [words] 는 **오래된 것이 앞**이어야 한다. 앞의 것이 아래층에 깔리고 최근 것이 위에 얹힌다.
 */
@Composable
fun WordDropStack(
    words: List<String>,
    modifier: Modifier = Modifier,
    chipColor: Color,
    textColor: Color,
    maxRows: Int = 4,
    horizontalGap: Dp = 6.dp,
    verticalGap: Dp = 6.dp,
    animate: Boolean = true,
) {
    if (words.isEmpty()) return

    Layout(
        modifier = modifier,
        content = {
            words.forEachIndexed { index, word ->
                DropChip(
                    word = word,
                    index = index,
                    chipColor = chipColor,
                    textColor = textColor,
                    animate = animate,
                )
            }
        },
    ) { measurables, constraints ->
        val maxWidth = constraints.maxWidth
        val hGap = horizontalGap.roundToPx()
        val vGap = verticalGap.roundToPx()

        val placeables = measurables.map { it.measure(Constraints(maxWidth = maxWidth)) }

        // 왼쪽에서 오른쪽으로 채우다가 넘치면 다음 층으로.
        val rows = mutableListOf<MutableList<Int>>()
        var current = mutableListOf<Int>()
        var currentWidth = 0
        placeables.forEachIndexed { i, p ->
            val needed = if (current.isEmpty()) p.width else currentWidth + hGap + p.width
            if (current.isNotEmpty() && needed > maxWidth) {
                rows += current
                current = mutableListOf()
                currentWidth = 0
            }
            current += i
            currentWidth = if (currentWidth == 0) p.width else currentWidth + hGap + p.width
        }
        if (current.isNotEmpty()) rows += current

        // 층이 넘치면 최근 것(뒤쪽)만 남긴다.
        val visible = if (rows.size > maxRows) rows.takeLast(maxRows) else rows
        val rowHeight = placeables.maxOfOrNull { it.height } ?: 0
        val height = (visible.size * rowHeight + (visible.size - 1).coerceAtLeast(0) * vGap)
            .coerceAtLeast(rowHeight)

        layout(maxWidth, height) {
            visible.forEachIndexed { rowIndex, row ->
                // rowIndex 0 = 가장 오래된 층 → 맨 아래
                val fromBottom = visible.size - 1 - rowIndex
                val y = fromBottom * (rowHeight + vGap)
                val rowWidth = row.sumOf { placeables[it].width } + (row.size - 1).coerceAtLeast(0) * hGap
                var x = ((maxWidth - rowWidth) / 2).coerceAtLeast(0)
                row.forEach { i ->
                    placeables[i].place(x, y)
                    x += placeables[i].width + hGap
                }
            }
        }
    }
}

@Composable
private fun DropChip(
    word: String,
    index: Int,
    chipColor: Color,
    textColor: Color,
    animate: Boolean,
) {
    // 1 = 아직 공중, 0 = 착지. 스프링 오버슈트가 착지 반동이 된다.
    val fall = remember(word) { Animatable(if (animate) 1f else 0f) }

    // 단어마다 고정된 기울기 — 다시 그려도 같은 자리에 같은 모양으로 멈춘다.
    val tilt = remember(word) { ((word.hashCode() % 7) - 3).toFloat() * 1.1f }

    LaunchedEffect(word, animate) {
        if (!animate) return@LaunchedEffect
        delay(index * 55L)
        fall.animateTo(0f, spring(dampingRatio = 0.5f, stiffness = 360f))
    }

    val f = fall.value
    // 착지 후 스프링이 음수로 넘어가는 구간 = 부딪혀 눌리는 순간
    val impact = (-f).coerceAtLeast(0f)

    Box(
        Modifier
            .graphicsLayer {
                translationY = -f * 340f
                rotationZ = tilt * (1f - abs(f).coerceAtMost(1f) * 0.35f) + f * 9f
                scaleY = 1f - impact * 1.4f
                scaleX = 1f + impact * 1.1f
                alpha = (1f - (f - 0.55f).coerceAtLeast(0f) * 2.2f).coerceIn(0f, 1f)
            }
            .clip(RoundedCornerShape(9.dp))
            .background(chipColor)
            .padding(horizontal = 9.dp, vertical = 6.dp)
    ) {
        Text(
            word,
            style = MaterialTheme.typography.labelMedium,
            color = textColor,
            maxLines = 1,
        )
    }
}

/**
 * 숫자가 자릿수별로 굴러 올라가며 바뀌는 카운터.
 * 큰 숫자 하나가 화면을 지배해야 "내가 이만큼 알고 있다"가 한눈에 들어온다.
 */
@Composable
fun OdometerCount(
    value: Int,
    modifier: Modifier = Modifier,
    color: Color,
    fontSize: androidx.compose.ui.unit.TextUnit = 64.sp,
) {
    val animated by animateIntAsState(
        targetValue = value,
        animationSpec = tween(1100, easing = Motion.EmphasizedDecel),
        label = "odometer",
    )
    val digits = animated.coerceAtLeast(0).toString()
    val style = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Bold,
        fontSize = fontSize,
        letterSpacing = (-2).sp,
    )

    Row(modifier, horizontalArrangement = Arrangement.Start) {
        digits.forEachIndexed { position, digit ->
            AnimatedContent(
                targetState = digit,
                transitionSpec = {
                    (slideInVertically { it } + fadeIn(tween(160))) togetherWith
                        (slideOutVertically { -it } + fadeOut(tween(160)))
                },
                label = "digit$position",
            ) { d ->
                Text(d.toString(), style = style, color = color, textAlign = TextAlign.Center)
            }
        }
    }
}

/** 히어로 카드 안에서 쓰는 얇은 구분선. */
@Composable
fun HairLine(color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(RoundedCornerShape(99.dp))
            .border(0.5.dp, color, RoundedCornerShape(99.dp))
    )
}
