package com.vocacard.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Bookmarks
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.vocacard.app.AppContainer
import com.vocacard.app.data.settings.Settings
import com.vocacard.app.ui.components.pressable
import com.vocacard.app.ui.screens.add.AddWordScreen
import com.vocacard.app.ui.screens.archive.ArchiveDayScreen
import com.vocacard.app.ui.screens.archive.ArchiveScreen
import com.vocacard.app.ui.screens.home.HomeScreen
import com.vocacard.app.ui.screens.mywords.MyWordsScreen
import com.vocacard.app.ui.screens.mywords.WordDetailScreen
import com.vocacard.app.ui.screens.settings.SettingsScreen
import com.vocacard.app.ui.screens.study.StudyScreen
import com.vocacard.app.ui.theme.Motion
import com.vocacard.app.ui.theme.voca

@Composable
fun VocaAppRoot(
    container: AppContainer,
    settings: Settings,
    deepLink: String?,
    onDeepLinkHandled: () -> Unit,
) {
    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    // 런처 바로가기(vocacard://review 등) 처리
    LaunchedEffect(deepLink) {
        when (deepLink) {
            "review" -> nav.navigate(Route.study(StudyScope.Due))
            "add" -> nav.navigate(Route.add())
            "archive" -> nav.navigate(Route.ARCHIVE)
        }
        if (deepLink != null) onDeepLinkHandled()
    }

    val showBar = route in Route.tabs

    Box(
        Modifier
            .fillMaxSize()
            .background(voca.bg)
    ) {
        NavHost(
            navController = nav,
            startDestination = Route.HOME,
            modifier = Modifier.fillMaxSize(),
            enterTransition = { NavAnim.tabEnter },
            exitTransition = { NavAnim.tabExit },
            popEnterTransition = { NavAnim.tabEnter },
            popExitTransition = { NavAnim.tabExit },
        ) {
            composable(Route.HOME) {
                HomeScreen(
                    container = container,
                    settings = settings,
                    onOpenDay = { nav.navigate(Route.archiveDay(it)) },
                    onStudy = { nav.navigate(Route.study(it)) },
                    onOpenArchive = { nav.navigateTab(Route.ARCHIVE) },
                    onOpenAdd = { nav.navigateTab(Route.add()) },
                    onOpenMyWords = { nav.navigateTab(Route.MY_WORDS) },
                    onOpenSettings = { nav.navigate(Route.SETTINGS) },
                )
            }

            composable(Route.ARCHIVE) {
                ArchiveScreen(
                    container = container,
                    onOpenDay = { nav.navigate(Route.archiveDay(it)) },
                )
            }

            composable(
                Route.ARCHIVE_DAY,
                arguments = listOf(navArgument("dayId") { type = NavType.StringType }),
                enterTransition = { pushEnter() },
                exitTransition = { pushExit() },
                popEnterTransition = { popEnter() },
                popExitTransition = { popExit() },
            ) { entry ->
                ArchiveDayScreen(
                    container = container,
                    dayId = entry.arguments?.getString("dayId").orEmpty(),
                    onBack = { nav.popBackStack() },
                    onStudy = { nav.navigate(Route.study(it)) },
                    onAddWord = { nav.navigate(Route.add(it)) },
                )
            }

            composable(
                Route.ADD,
                arguments = listOf(navArgument("word") { type = NavType.StringType; defaultValue = "" }),
            ) { entry ->
                AddWordScreen(
                    container = container,
                    settings = settings,
                    initialWord = entry.arguments?.getString("word").orEmpty(),
                    onSaved = { nav.navigateTab(Route.MY_WORDS) },
                    onOpenWord = { nav.navigate(Route.wordDetail(it)) },
                )
            }

            composable(Route.MY_WORDS) {
                MyWordsScreen(
                    container = container,
                    onStudy = { nav.navigate(Route.study(it)) },
                    onOpenWord = { nav.navigate(Route.wordDetail(it)) },
                    onAdd = { nav.navigateTab(Route.add()) },
                )
            }

            composable(
                Route.WORD_DETAIL,
                arguments = listOf(navArgument("wordId") { type = NavType.LongType }),
                enterTransition = { pushEnter() },
                exitTransition = { pushExit() },
                popEnterTransition = { popEnter() },
                popExitTransition = { popExit() },
            ) { entry ->
                WordDetailScreen(
                    container = container,
                    settings = settings,
                    wordId = entry.arguments?.getLong("wordId") ?: 0L,
                    onBack = { nav.popBackStack() },
                )
            }

            composable(
                Route.STUDY,
                arguments = listOf(navArgument("scope") { type = NavType.StringType }),
                enterTransition = { NavAnim.modalEnter },
                exitTransition = { NavAnim.modalExit },
                popEnterTransition = { NavAnim.tabEnter },
                popExitTransition = { NavAnim.modalExit },
            ) { entry ->
                StudyScreen(
                    container = container,
                    settings = settings,
                    scope = StudyScope.decode(entry.arguments?.getString("scope")),
                    onClose = { nav.popBackStack() },
                    onOpenWord = { nav.navigate(Route.wordDetail(it)) },
                )
            }

            composable(
                Route.SETTINGS,
                enterTransition = { pushEnter() },
                exitTransition = { pushExit() },
                popEnterTransition = { popEnter() },
                popExitTransition = { popExit() },
            ) {
                SettingsScreen(container = container, settings = settings, onBack = { nav.popBackStack() })
            }
        }

        AnimatedVisibility(
            visible = showBar,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically(tween(Motion.DurMedium, easing = Motion.EmphasizedDecel)) { it } +
                fadeIn(tween(Motion.DurShort)),
            exit = slideOutVertically(tween(Motion.DurShort, easing = Motion.EmphasizedAccel)) { it } +
                fadeOut(tween(Motion.DurQuick)),
        ) {
            VocaBottomBar(
                current = route,
                onSelect = { nav.navigateTab(it) },
            )
        }
    }
}

private fun NavHostController.navigateTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

/** [pattern] 은 현재 위치 비교용, [target] 은 실제 이동용(인자 있는 라우트 대응). */
private data class TabItem(
    val pattern: String,
    val target: String,
    val label: String,
    val icon: ImageVector,
)

@Composable
private fun VocaBottomBar(current: String?, onSelect: (String) -> Unit) {
    val tabs = listOf(
        TabItem(Route.HOME, Route.HOME, "홈", Icons.Outlined.Home),
        TabItem(Route.ARCHIVE, Route.ARCHIVE, "아카이브", Icons.Outlined.AutoStories),
        TabItem(Route.ADD, Route.add(), "단어 추가", Icons.Outlined.Add),
        TabItem(Route.MY_WORDS, Route.MY_WORDS, "내 단어", Icons.Outlined.Bookmarks),
    )

    Box(
        Modifier
            .fillMaxWidth()
            .background(voca.bg.copy(alpha = 0.0f))
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(26.dp))
                .background(voca.surface)
                .padding(horizontal = 6.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            tabs.forEach { tab ->
                TabButton(tab = tab, selected = current == tab.pattern) { onSelect(tab.target) }
            }
        }
    }
}

@Composable
private fun TabButton(tab: TabItem, selected: Boolean, onClick: () -> Unit) {
    val tint by animateColorAsState(
        if (selected) voca.accent else voca.inkSoft.copy(alpha = 0.65f),
        tween(Motion.DurShort), label = "tabTint",
    )
    val indicator by animateDpAsState(
        if (selected) 18.dp else 0.dp,
        Motion.dpSpring(), label = "tabIndicator",
    )
    val lift by animateFloatAsState(
        if (selected) -2f else 0f, Motion.press(), label = "tabLift",
    )

    Column(
        Modifier
            .pressable(onClick)
            .padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Icon(
            tab.icon,
            contentDescription = tab.label,
            tint = tint,
            modifier = Modifier
                .size(23.dp)
                .graphicsLayer { translationY = lift }
        )
        Text(tab.label, style = MaterialTheme.typography.labelSmall, color = tint)
        Box(
            Modifier
                .height(3.dp)
                .width(indicator)
                .clip(RoundedCornerShape(99.dp))
                .background(if (selected) voca.accent else Color.Transparent)
        )
    }
}
