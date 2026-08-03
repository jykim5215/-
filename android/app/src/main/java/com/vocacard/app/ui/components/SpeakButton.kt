package com.vocacard.app.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vocacard.app.data.speech.Speaker
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.voca
import kotlinx.coroutines.delay

/** 화면 어디서든 발음을 재생할 수 있도록 루트에서 내려 주는 스피커. */
val LocalSpeaker = staticCompositionLocalOf<Speaker?> { null }

/**
 * 단어 발음 버튼.
 *
 * TTS 를 쓸 수 없는 기기에서는 **아예 그리지 않는다** — 눌러도 아무 일이 없는 버튼을
 * 남겨 두면 고장난 것처럼 보인다.
 */
@Composable
fun SpeakButton(
    text: String,
    modifier: Modifier = Modifier,
    tint: Color? = null,
    background: Color? = null,
    size: Dp = 34.dp,
) {
    val speaker = LocalSpeaker.current ?: return
    val available by speaker.available.collectAsState()
    if (!available) return

    var pulse by remember { mutableIntStateOf(0) }
    val scale by animateFloatAsState(
        targetValue = if (pulse % 2 == 1) 1.18f else 1f,
        animationSpec = Motion.press(),
        label = "speakPulse",
    )
    LaunchedEffect(pulse) {
        if (pulse % 2 == 1) {
            delay(160)
            pulse++
        }
    }

    Box(
        modifier
            .size(size)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(size / 2.6f))
            .background(background ?: voca.surfaceAlt)
            .pressable {
                speaker.speak(text)
                if (pulse % 2 == 0) pulse++
            }
            .padding(6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Outlined.VolumeUp,
            contentDescription = "발음 듣기",
            tint = tint ?: voca.accent,
            modifier = Modifier.size(size * 0.55f),
        )
    }
}
