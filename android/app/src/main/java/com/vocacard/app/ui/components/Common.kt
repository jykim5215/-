package com.vocacard.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.VocaShape
import com.vocacard.app.ui.theme.voca

/** 리스트/그리드 아이템이 아래에서 살짝 떠오르며 등장. index 로 stagger. */
@Composable
fun StaggerIn(
    index: Int,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    val progress by animateFloatAsState(
        targetValue = if (appeared) 1f else 0f,
        animationSpec = tween(
            durationMillis = Motion.DurMedium,
            delayMillis = Motion.staggerDelay(index),
            easing = Motion.EmphasizedDecel,
        ),
        label = "staggerIn",
    )
    Box(
        modifier.graphicsLayer {
            alpha = progress
            translationY = (1f - progress) * 28f
            val s = 0.96f + 0.04f * progress
            scaleX = s
            scaleY = s
        }
    ) { content() }
}

/** 값이 바뀌면 스프링으로 채워지는 진행률 링. */
@Composable
fun ProgressRing(
    progress: Float,
    modifier: Modifier = Modifier,
    size: Dp = 64.dp,
    stroke: Dp = 7.dp,
    trackColor: Color? = null,
    color: Color? = null,
    content: @Composable (() -> Unit)? = null,
) {
    val target = progress.coerceIn(0f, 1f)
    val animated by animateFloatAsState(target, Motion.progress(), label = "ring")
    val c = color ?: voca.accent
    val track = trackColor ?: voca.line

    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.Canvas(Modifier.size(size)) {
            val w = stroke.toPx()
            val inset = w / 2
            val arcSize = Size(this.size.width - w, this.size.height - w)
            drawArc(
                color = track,
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
                size = arcSize,
                style = Stroke(width = w, cap = StrokeCap.Round),
            )
            if (animated > 0f) {
                drawArc(
                    color = c,
                    startAngle = -90f,
                    sweepAngle = 360f * animated,
                    useCenter = false,
                    topLeft = androidx.compose.ui.geometry.Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(width = w, cap = StrokeCap.Round),
                )
            }
        }
        content?.invoke()
    }
}

/** 얇은 선형 진행률. */
@Composable
fun ProgressLine(
    progress: Float,
    modifier: Modifier = Modifier,
    height: Dp = 5.dp,
    color: Color? = null,
) {
    val animated by animateFloatAsState(progress.coerceIn(0f, 1f), Motion.progress(), label = "line")
    Box(
        modifier
            .height(height)
            .clip(RoundedCornerShape(99.dp))
            .background(voca.line)
    ) {
        Box(
            Modifier
                .fillMaxWidth(animated)
                .height(height)
                .clip(RoundedCornerShape(99.dp))
                .background(color ?: voca.accent)
        )
    }
}

/** 선택 상태가 스프링으로 반응하는 칩. 추천 뜻/예문 선택에 쓰인다. */
@Composable
fun SelectChip(
    text: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    leading: String? = null,
    onClick: () -> Unit,
) {
    val bg by animateColorAsState(
        if (selected) voca.accent else voca.surface,
        tween(Motion.DurQuick), label = "chipBg",
    )
    val fg by animateColorAsState(
        if (selected) Color(0xFFFFF8F2) else voca.ink,
        tween(Motion.DurQuick), label = "chipFg",
    )
    val scale by animateFloatAsState(if (selected) 1.03f else 1f, Motion.press(), label = "chipScale")

    Row(
        modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(VocaShape.chip))
            .background(bg)
            .border(1.dp, if (selected) Color.Transparent else voca.line, RoundedCornerShape(VocaShape.chip))
            .pressable(onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (leading != null) {
            Text(
                leading,
                style = MaterialTheme.typography.labelSmall,
                color = fg.copy(alpha = 0.7f),
            )
        }
        Text(text, style = MaterialTheme.typography.labelLarge, color = fg)
    }
}

/** 섹션 제목 + 우측 액션. */
@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = voca.inkSoft,
            fontWeight = FontWeight.SemiBold,
        )
        action?.invoke()
    }
}

/** 종이 느낌의 카드 컨테이너. */
@Composable
fun PaperCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    padding: Dp = 16.dp,
    content: @Composable () -> Unit,
) {
    Box(
        modifier
            .clip(RoundedCornerShape(VocaShape.panel))
            .background(voca.surface)
            .border(1.dp, voca.line, RoundedCornerShape(VocaShape.panel))
            .let { if (onClick != null) it.pressable(onClick) else it }
            .padding(padding)
    ) { content() }
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, tint = voca.line, modifier = Modifier.size(52.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, color = voca.ink, textAlign = TextAlign.Center)
        Text(
            description,
            style = MaterialTheme.typography.bodyMedium,
            color = voca.inkSoft,
            textAlign = TextAlign.Center,
        )
        action?.invoke()
    }
}
