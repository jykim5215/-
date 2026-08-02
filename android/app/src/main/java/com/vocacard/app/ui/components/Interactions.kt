package com.vocacard.app.ui.components

import android.view.HapticFeedbackConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalView
import com.vocacard.app.ui.theme.Motion

/**
 * 누르면 살짝 눌리는(scale 0.97) 클릭 처리.
 * ripple 대신 물리적인 눌림으로 반응해야 "종이 카드" 느낌이 유지된다.
 */
fun Modifier.pressable(
    interactionSource: MutableInteractionSource,
    onClick: () -> Unit,
): Modifier = composed {
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = Motion.press(),
        label = "pressScale",
    )
    this
        .graphicsLayer { scaleX = scale; scaleY = scale }
        .clickable(interactionSource = interactionSource, indication = null, onClick = onClick)
}

/** interactionSource 를 알아서 만들어 주는 축약형. */
fun Modifier.pressable(onClick: () -> Unit): Modifier = composed {
    val source = remember { MutableInteractionSource() }
    pressable(source, onClick)
}

/** 가벼운 촉각 피드백. 설정에서 끌 수 있다. */
@Composable
fun rememberHaptics(enabled: Boolean): () -> Unit {
    val view = LocalView.current
    return remember(enabled, view) {
        {
            if (enabled) {
                view.performHapticFeedback(HapticFeedbackConstants.CONTEXT_CLICK)
            }
        }
    }
}
