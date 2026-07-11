package app.audiobridge.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// 레트로 하이파이 팔레트 (design/ui-styles.html C안)
val Cream = Color(0xFFEFE6D4)
val Panel = Color(0xFFF7F1E3)
val Ink = Color(0xFF3A2F22)
val Accent = Color(0xFFC2571F)
val Amber = Color(0xFFF4C95D)
val Sub = Color(0xFF8A7A60)
val Beige = Color(0xFFD9CCB2)

@Composable
fun RetroTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Accent,
            onPrimary = Panel,
            background = Cream,
            onBackground = Ink,
            surface = Panel,
            onSurface = Ink,
            secondary = Amber,
            outline = Ink,
        ),
        content = content,
    )
}

/** 굵은 윤곽선 + 오프셋 그림자 카드. */
@Composable
fun RetroCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Box(modifier.padding(end = 4.dp, bottom = 4.dp)) {
        Box(
            Modifier
                .matchParentSize()
                .offset(4.dp, 4.dp)
                .background(Ink.copy(alpha = 0.25f), RoundedCornerShape(10.dp))
        )
        Column(
            Modifier
                .fillMaxWidth()
                .background(Panel, RoundedCornerShape(10.dp))
                .border(2.dp, Ink, RoundedCornerShape(10.dp))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

/** MODE A ▸ PC → PHONE 스타일의 작은 라벨. */
@Composable
fun RetroLabel(text: String) {
    Text(
        text,
        fontFamily = FontFamily.Monospace,
        fontSize = 11.sp,
        letterSpacing = 2.sp,
        fontWeight = FontWeight.Bold,
        color = Sub,
    )
}

@Composable
fun RetroSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    val knobX by animateDpAsState(if (checked) 28.dp else 2.dp, label = "knob")
    Box(
        Modifier
            .size(58.dp, 32.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (checked) Accent else Beige)
            .border(2.dp, Ink, RoundedCornerShape(6.dp))
            .clickable { onCheckedChange(!checked) },
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(
            Modifier
                .offset(x = knobX)
                .size(24.dp)
                .background(if (checked) Panel else Ink, RoundedCornerShape(4.dp))
        )
    }
}

@Composable
fun RetroSegmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .border(2.dp, Ink, RoundedCornerShape(6.dp))
    ) {
        options.forEachIndexed { i, label ->
            Box(
                Modifier
                    .weight(1f)
                    .background(if (i == selected) Accent else Panel)
                    .clickable { onSelect(i) }
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (i == selected) Panel else Sub,
                )
            }
        }
    }
}

@Composable
fun RetroButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(modifier.padding(end = 3.dp, bottom = 3.dp)) {
        Box(
            Modifier
                .matchParentSize()
                .offset(3.dp, 3.dp)
                .background(Ink.copy(alpha = 0.25f), RoundedCornerShape(6.dp))
        )
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .background(if (enabled) Amber else Beige)
                .border(2.dp, Ink, RoundedCornerShape(6.dp))
                .clickable(enabled = enabled) { onClick() }
                .padding(vertical = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 14.sp,
                color = Ink,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** 도트 VU 미터. */
@Composable
fun LevelMeter(level: Float, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(16.dp)
            .border(2.dp, Ink, RoundedCornerShape(3.dp))
            .padding(3.dp)
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val w = size.width * level.coerceIn(0f, 1f)
            val seg = 6.dp.toPx()
            val gap = 2.dp.toPx()
            var x = 0f
            while (x < w) {
                drawRect(
                    color = Accent,
                    topLeft = Offset(x, 0f),
                    size = Size(minOf(seg, w - x), size.height),
                )
                x += seg + gap
            }
        }
    }
}
