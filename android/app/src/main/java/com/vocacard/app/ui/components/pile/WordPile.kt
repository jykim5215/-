package com.vocacard.app.ui.components.pile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/** 물리 공간에 넣을 단어 하나. */
data class PileWord(val id: Long, val text: String)

/**
 * 쌓인 단어를 손으로 만질 수 있는 물리 공간.
 *
 *  - 기기를 기울이면 단어가 그쪽으로 굴러간다(가속도 센서).
 *  - 흔들면 전부 튀어 오른다.
 *  - 손가락으로 하나를 집어 끌고 다니다 놓으면 던져진다.
 *  - 톡 누르면 [onWordTap] — 그 단어의 상세로 보낸다.
 *
 * 텍스트는 목록이 바뀔 때만 측정한다. 매 프레임 측정하면 수십 개만으로도 프레임을 잡아먹는다.
 */
@Composable
fun WordPile(
    words: List<PileWord>,
    modifier: Modifier = Modifier,
    chipColor: Color,
    chipHighlight: Color,
    textColor: Color,
    textStyle: TextStyle,
    tiltEnabled: Boolean = true,
    cornerRadius: Dp = 10.dp,
    onWordTap: (Long) -> Unit = {},
) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val padH = with(density) { 11.dp.toPx() }
    val padV = with(density) { 7.dp.toPx() }
    val radiusPx = with(density) { cornerRadius.toPx() }

    val layouts: List<TextLayoutResult> = remember(words, textStyle) {
        words.map { measurer.measure(AnnotatedString(it.text), textStyle) }
    }

    val world = remember { PileWorld() }
    var canvasSize by remember { mutableStateOf(IntSize.Zero) }
    var frame by remember { mutableIntStateOf(0) }

    val tilt = rememberTilt(enabled = tiltEnabled) { strength ->
        world.shake(1500f * strength) { i -> pseudoRandom(i * 31 + 7) }
    }

    // 화면 크기가 정해지거나 단어가 바뀌면 바디를 다시 만든다.
    // (그리기 도중에 상태를 만들면 무한 무효화가 나므로 반드시 여기서 한다.)
    LaunchedEffect(words, canvasSize, layouts) {
        val w = canvasSize.width.toFloat()
        val h = canvasSize.height.toFloat()
        if (w <= 0f || h <= 0f) return@LaunchedEffect
        world.width = w
        world.height = h
        world.clear()
        words.forEachIndexed { i, word ->
            val layout = layouts[i]
            val halfW = (layout.size.width + padH * 2f) / 2f
            val halfH = (layout.size.height + padV * 2f) / 2f
            val span = (w - halfW * 2f).coerceAtLeast(1f)
            world.add(
                PileBody(
                    wordId = word.id,
                    text = word.text,
                    halfW = halfW,
                    halfH = halfH,
                    x = halfW + pseudoRandom(i) * span,
                    // 화면 위쪽 밖에서 시작 → 차례차례 떨어져 쌓인다.
                    y = -halfH - i * halfH * 1.7f,
                )
            )
        }
    }

    // 물리 루프.
    LaunchedEffect(world) {
        var last = 0L
        while (true) {
            withFrameNanos { now ->
                val dt = if (last == 0L) 0f else (now - last) / 1_000_000_000f
                last = now
                val g = tilt.value.normalized()
                world.gravityX = g.x * PileWorld.GRAVITY
                world.gravityY = g.y * PileWorld.GRAVITY
                if (dt > 0f) world.step(dt)
                frame++
            }
        }
    }

    Box(
        modifier
            .onSizeChanged { canvasSize = it }
            .pointerInput(words) {
                var held: PileBody? = null
                detectDragGestures(
                    onDragStart = { pos ->
                        held = world.bodies.lastOrNull { it.contains(pos.x, pos.y) }
                        held?.held = true
                    },
                    onDragEnd = { held?.held = false; held = null },
                    onDragCancel = { held?.held = false; held = null },
                ) { change, drag ->
                    change.consume()
                    val body = held ?: return@detectDragGestures
                    body.x += drag.x
                    body.y += drag.y
                    // 놓는 순간 던져지도록 손가락 이동량을 속도로 남겨 둔다.
                    body.vx = drag.x * 40f
                    body.vy = drag.y * 40f
                }
            }
            .pointerInput(words) {
                detectTapGestures { pos ->
                    world.bodies.lastOrNull { it.contains(pos.x, pos.y) }
                        ?.let { onWordTap(it.wordId) }
                }
            }
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val tick = frame // 매 프레임 다시 그리기 위한 상태 구독
            if (tick < 0) return@Canvas

            world.bodies.forEachIndexed { i, body ->
                val layout = layouts.getOrNull(i) ?: return@forEachIndexed
                drawChip(body, layout, chipColor, chipHighlight, textColor, radiusPx)
            }
        }
    }
}

private fun DrawScope.drawChip(
    body: PileBody,
    layout: TextLayoutResult,
    chipColor: Color,
    chipHighlight: Color,
    textColor: Color,
    radiusPx: Float,
) {
    val w = body.halfW * 2f
    val h = body.halfH * 2f
    val left = body.x - body.halfW
    val top = body.y - body.halfH

    rotate(degrees = body.lean, pivot = Offset(body.x, body.y)) {
        drawRoundRect(
            color = lerpColor(chipColor, chipHighlight, body.flash * 0.5f),
            topLeft = Offset(left, top),
            size = Size(w, h),
            cornerRadius = CornerRadius(radiusPx, radiusPx),
        )
        drawText(
            textLayoutResult = layout,
            color = textColor,
            topLeft = Offset(
                left + (w - layout.size.width) / 2f,
                top + (h - layout.size.height) / 2f,
            ),
        )
    }
}

private fun lerpColor(a: Color, b: Color, t: Float): Color {
    val f = t.coerceIn(0f, 1f)
    return Color(
        red = a.red + (b.red - a.red) * f,
        green = a.green + (b.green - a.green) * f,
        blue = a.blue + (b.blue - a.blue) * f,
        alpha = a.alpha + (b.alpha - a.alpha) * f,
    )
}

/**
 * 씨앗 고정 의사난수(0~1).
 * `Math.random()` 을 쓰면 화면을 다시 만들 때마다 배치가 달라져 화면이 튄다.
 */
private fun pseudoRandom(seed: Int): Float {
    var x = seed * 1103515245 + 12345
    x = x xor (x shr 13)
    x *= 1274126177
    return ((x shr 8) and 0xFFFF) / 65535f
}
