package com.vocacard.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/* ─────────────────────────────────────────────────────────────
 *  "Paper" 팔레트 — 따뜻한 종이 위 잉크. 사용자가 선택한 스타일 B.
 * ───────────────────────────────────────────────────────────── */

object Paper {
    val Bg = Color(0xFFF6F1E8)
    val Surface = Color(0xFFFFFDF8)
    val SurfaceAlt = Color(0xFFF1E9DA)
    val Ink = Color(0xFF241F1A)
    val InkSoft = Color(0xFF6B6157)
    val Line = Color(0xFFE3D9C8)
    val Terracotta = Color(0xFFC2603C)
    val Umber = Color(0xFF8A5A34)
    val Moss = Color(0xFF4F7A4A)
    val Rust = Color(0xFFB4482F)
    val Gold = Color(0xFFCC9A3E)

    val DarkBg = Color(0xFF17140F)
    val DarkSurface = Color(0xFF211D17)
    val DarkSurfaceAlt = Color(0xFF2A251E)
    val DarkInk = Color(0xFFF0E9DD)
    val DarkInkSoft = Color(0xFFA79C8C)
    val DarkLine = Color(0xFF39332A)
    val DarkTerracotta = Color(0xFFE08A62)
}

/** Material 색으로는 표현이 부족한 앱 고유 색을 담는 확장 팔레트. */
data class VocaColors(
    val bg: Color,
    val surface: Color,
    val surfaceAlt: Color,
    val ink: Color,
    val inkSoft: Color,
    val line: Color,
    val accent: Color,
    val accentSoft: Color,
    val know: Color,
    val dontKnow: Color,
    val highlight: Color,
    val isDark: Boolean,
)

val LocalVocaColors = staticCompositionLocalOf {
    VocaColors(
        bg = Paper.Bg, surface = Paper.Surface, surfaceAlt = Paper.SurfaceAlt,
        ink = Paper.Ink, inkSoft = Paper.InkSoft, line = Paper.Line,
        accent = Paper.Terracotta, accentSoft = Paper.Umber,
        know = Paper.Moss, dontKnow = Paper.Rust, highlight = Paper.Gold, isDark = false,
    )
}

private val LightScheme = lightColorScheme(
    primary = Paper.Terracotta,
    onPrimary = Color(0xFFFFF8F2),
    primaryContainer = Color(0xFFF6DFD1),
    onPrimaryContainer = Color(0xFF4A1D0C),
    secondary = Paper.Umber,
    onSecondary = Color(0xFFFFF8F2),
    background = Paper.Bg,
    onBackground = Paper.Ink,
    surface = Paper.Surface,
    onSurface = Paper.Ink,
    surfaceVariant = Paper.SurfaceAlt,
    onSurfaceVariant = Paper.InkSoft,
    outline = Paper.Line,
    outlineVariant = Paper.Line,
    error = Paper.Rust,
)

private val DarkScheme = darkColorScheme(
    primary = Paper.DarkTerracotta,
    onPrimary = Color(0xFF3A1608),
    primaryContainer = Color(0xFF562714),
    onPrimaryContainer = Color(0xFFFFDBCA),
    secondary = Color(0xFFD3B08D),
    onSecondary = Color(0xFF3A2A16),
    background = Paper.DarkBg,
    onBackground = Paper.DarkInk,
    surface = Paper.DarkSurface,
    onSurface = Paper.DarkInk,
    surfaceVariant = Paper.DarkSurfaceAlt,
    onSurfaceVariant = Paper.DarkInkSoft,
    outline = Paper.DarkLine,
    outlineVariant = Paper.DarkLine,
    error = Color(0xFFE0806A),
)

/* ─────────────────────────────  타이포  ───────────────────────────── */

private val Serif = FontFamily.Serif
private val Sans = FontFamily.SansSerif

val VocaTypography = Typography(
    displayLarge = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 44.sp, lineHeight = 50.sp, letterSpacing = (-1).sp),
    displayMedium = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 40.sp, letterSpacing = (-0.8).sp),
    headlineLarge = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 27.sp, lineHeight = 34.sp, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 29.sp, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 18.sp, lineHeight = 24.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 21.sp),
    bodyLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 13.5.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, letterSpacing = 0.2.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 11.5.sp, letterSpacing = 0.4.sp),
    labelSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 10.5.sp, letterSpacing = 0.6.sp),
)

/** 카드 앞면의 영단어 전용 스타일(세리프, 큼직하게). */
val WordDisplay = TextStyle(
    fontFamily = Serif, fontWeight = FontWeight.Bold, fontSize = 40.sp,
    lineHeight = 46.sp, letterSpacing = (-1.2).sp,
)

object VocaShape {
    val card = 24.dp
    val panel = 20.dp
    val chip = 999.dp
    val small = 14.dp
}

@Composable
fun VocaCardTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val scheme = if (darkTheme) DarkScheme else LightScheme
    val voca = if (darkTheme) {
        VocaColors(
            bg = Paper.DarkBg, surface = Paper.DarkSurface, surfaceAlt = Paper.DarkSurfaceAlt,
            ink = Paper.DarkInk, inkSoft = Paper.DarkInkSoft, line = Paper.DarkLine,
            accent = Paper.DarkTerracotta, accentSoft = Color(0xFFD3B08D),
            know = Color(0xFF87B77F), dontKnow = Color(0xFFE0806A), highlight = Paper.Gold,
            isDark = true,
        )
    } else {
        VocaColors(
            bg = Paper.Bg, surface = Paper.Surface, surfaceAlt = Paper.SurfaceAlt,
            ink = Paper.Ink, inkSoft = Paper.InkSoft, line = Paper.Line,
            accent = Paper.Terracotta, accentSoft = Paper.Umber,
            know = Paper.Moss, dontKnow = Paper.Rust, highlight = Paper.Gold,
            isDark = false,
        )
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        val context = LocalContext.current
        SideEffect {
            (context as? Activity)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !darkTheme
                    isAppearanceLightNavigationBars = !darkTheme
                }
            }
        }
    }

    CompositionLocalProvider(LocalVocaColors provides voca) {
        MaterialTheme(colorScheme = scheme, typography = VocaTypography, content = content)
    }
}

/** 어디서든 `voca.accent` 처럼 짧게 쓰기 위한 접근자. */
val voca: VocaColors
    @Composable get() = LocalVocaColors.current
