package com.vocacard.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.VocaShape
import com.vocacard.app.ui.theme.voca
import kotlin.math.abs

/**
 * 3D 로 뒤집히는 단어 카드.
 *
 * - `rotationY` 를 스프링으로 몰아 살짝 오버슈트시킨다(감쇠비 0.75). 딱 떨어지지 않고 "종이"처럼 흔들린다.
 * - 90도를 지나는 순간 앞/뒷면 가시성을 교체하고, 그 근처에서 alpha 를 낮춰 뒤집히는 찰나의 왜곡을 감춘다.
 * - 뒤집히는 동안 아주 살짝(최대 4%) 커졌다 돌아오게 해서 손끝으로 들어올린 느낌을 준다.
 */
@Composable
fun FlipCard(
    flipped: Boolean,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    front: @Composable BoxScope.() -> Unit,
    back: @Composable BoxScope.() -> Unit,
) {
    val rotation by animateFloatAsState(
        targetValue = if (flipped) 180f else 0f,
        animationSpec = Motion.flip(),
        label = "flipRotation",
    )
    val density = LocalDensity.current.density
    val colors = voca

    // 90도 부근에서 살짝 부풀렸다가 돌아온다.
    val lift = 1f + 0.04f * (1f - abs(90f - (rotation % 360f)) / 90f).coerceIn(0f, 1f)
    val showBack = rotation % 360f > 90f && rotation % 360f < 270f
    // 뒤집히는 찰나 카드가 종이처럼 얇아 보이도록 투명도를 살짝 떨어뜨린다.
    val edgeFade = (abs(abs(rotation % 180f) - 90f) / 90f).coerceIn(0f, 1f)

    val interaction = remember { MutableInteractionSource() }

    Box(
        modifier = modifier
            .graphicsLayer {
                rotationY = rotation
                cameraDistance = Motion.CameraDistance * density
                scaleX = lift
                scaleY = lift
            }
            .let { if (onClick != null) it.pressable(interaction, onClick) else it }
    ) {
        // 앞면
        Box(
            Modifier
                .fillMaxSize()
                .alpha(if (showBack) 0f else 0.35f + 0.65f * edgeFade)
                .shadow(if (showBack) 0.dp else 16.dp, RoundedCornerShape(VocaShape.card), clip = false)
                .clip(RoundedCornerShape(VocaShape.card))
                .background(colors.surface)
                .border(1.dp, colors.line, RoundedCornerShape(VocaShape.card)),
            contentAlignment = Alignment.Center,
            content = front,
        )
        // 뒷면 — 뒤집힌 상태에서 정상으로 보이도록 다시 180도 돌려 둔다.
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { rotationY = 180f }
                .alpha(if (showBack) 0.35f + 0.65f * edgeFade else 0f)
                .shadow(if (showBack) 16.dp else 0.dp, RoundedCornerShape(VocaShape.card), clip = false)
                .clip(RoundedCornerShape(VocaShape.card))
                .background(MaterialTheme.colorScheme.primaryContainer)
                .border(1.dp, colors.line, RoundedCornerShape(VocaShape.card)),
            contentAlignment = Alignment.Center,
            content = back,
        )
    }
}
