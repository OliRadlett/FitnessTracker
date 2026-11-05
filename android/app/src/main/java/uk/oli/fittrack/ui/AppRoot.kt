package uk.oli.fittrack.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import uk.oli.fittrack.AppViewModel
import uk.oli.fittrack.ui.done.DoneScreen
import uk.oli.fittrack.ui.live.LiveScreen
import uk.oli.fittrack.ui.today.TodayScreen
import java.util.Locale

object Routes {
    const val TODAY = "today"
    const val LIVE = "live"
    const val DONE = "done"
    const val TAB = "tab/{name}"
    fun tab(kind: NavKind) = "tab/${kind.name.lowercase(Locale.UK)}"
}

@Composable
fun AppRoot(vm: AppViewModel = viewModel()) {
    val session by vm.session.collectAsStateWithLifecycle()
    val restUntil by vm.restUntil.collectAsStateWithLifecycle()
    val now by vm.now.collectAsStateWithLifecycle()

    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    NavHost(navController = nav, startDestination = Routes.TODAY) {
        composable(Routes.TODAY) {
            TodayScreen(
                session = session,
                onStart = {
                    vm.startSession()
                    nav.navigate(Routes.LIVE)
                },
                onResume = { nav.navigate(Routes.LIVE) },
                onTab = nav::switchTab
            )
        }

        composable(Routes.LIVE) {
            val current = session
            if (current == null) {
                LaunchedEffect(Unit) { nav.popBackStack(Routes.TODAY, false) }
            } else {
                LiveScreen(
                    session = current,
                    restUntil = restUntil,
                    now = now,
                    onLog = vm::logSet,
                    onBack = { nav.popBackStack() },
                    onFinish = { nav.navigate(Routes.DONE) }
                )
            }
        }

        composable(Routes.DONE) {
            val current = session
            if (current == null) {
                LaunchedEffect(Unit) { nav.popBackStack(Routes.TODAY, false) }
            } else {
                DoneScreen(
                    session = current,
                    onDone = {
                        vm.finishSession()
                        nav.popBackStack(Routes.TODAY, false)
                    }
                )
            }
        }

        composable(Routes.TAB) { entry ->
            PlaceholderScreen(
                tab = entry.arguments?.getString("name") ?: "train",
                onTab = nav::switchTab
            )
        }
    }
}

private fun NavHostController.switchTab(kind: NavKind) {
    navigate(Routes.tab(kind)) {
        popUpTo(Routes.TODAY) { inclusive = false }
        launchSingleTop = true
    }
}
