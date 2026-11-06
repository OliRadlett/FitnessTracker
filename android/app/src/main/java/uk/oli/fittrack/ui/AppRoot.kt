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
import uk.oli.fittrack.BuildConfig
import uk.oli.fittrack.ui.done.DoneScreen
import uk.oli.fittrack.ui.live.LiveScreen
import uk.oli.fittrack.ui.log.SessionDetailScreen
import uk.oli.fittrack.ui.plan.PlanEditorScreen
import uk.oli.fittrack.ui.signin.SignInScreen
import uk.oli.fittrack.ui.today.TodayScreen
import uk.oli.fittrack.ui.train.TrainScreen
import uk.oli.fittrack.ui.you.YouScreen
import java.util.Locale

object Routes {
    const val TODAY = "today"
    const val LIVE = "live"
    const val DONE = "done"
    const val SIGNIN = "signin"
    const val TAB = "tab/{name}"
    const val SESSION = "session/{id}"
    const val PLAN_EDIT = "plan-edit"
    fun tab(kind: NavKind) = "tab/${kind.name.lowercase(Locale.UK)}"
    fun session(id: String) = "session/$id"
}

/**
 * Sign-in is a destination, not a gate. The gym flow works before you have ever
 * authenticated, because logging a set must never wait on a network round trip.
 */
@Composable
fun AppRoot(vm: AppViewModel = viewModel()) {
    val session by vm.session.collectAsStateWithLifecycle()
    val restUntil by vm.restUntil.collectAsStateWithLifecycle()
    val now by vm.now.collectAsStateWithLifecycle()
    val auth by vm.auth.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    val plan by vm.plan.collectAsStateWithLifecycle()
    val planFromServer by vm.planFromServer.collectAsStateWithLifecycle()
    val plannedPlanName by vm.plannedPlanName.collectAsStateWithLifecycle()
    val restDay by vm.restDay.collectAsStateWithLifecycle()
    val warmupTemplates by vm.warmupTemplates.collectAsStateWithLifecycle()
    val linkCandidates by vm.linkCandidates.collectAsStateWithLifecycle()
    val planWeek by vm.planWeek.collectAsStateWithLifecycle()
    val records by vm.records.collectAsStateWithLifecycle()
    val analyses by vm.analyses.collectAsStateWithLifecycle()
    val analysisBusy by vm.analysisBusy.collectAsStateWithLifecycle()
    val syncedAt by vm.syncedAt.collectAsStateWithLifecycle()
    val syncError by vm.syncError.collectAsStateWithLifecycle()

    // History is pulled once a token exists, and again whenever it changes.
    LaunchedEffect(auth.token) {
        if (auth.token != null) vm.syncHistory()
    }

    val nav = rememberNavController()
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route

    NavHost(navController = nav, startDestination = Routes.TODAY) {
        composable(Routes.TODAY) {
            TodayScreen(
                session = session,
                plan = plan,
                signedIn = auth.signedIn,
                history = history,
                planFromServer = planFromServer,
                plannedPlanName = plannedPlanName,
                restDay = restDay,
                onEditPlan = { nav.navigate(Routes.PLAN_EDIT) },
                onOpenSession = { id -> nav.navigate(Routes.session(id)) },
                onSignIn = { nav.navigate(Routes.SIGNIN) },
                onStart = {
                    vm.startSession()
                    nav.navigate(Routes.LIVE)
                },
                onResume = { nav.navigate(Routes.LIVE) },
                onTab = nav::switchTab
            )
        }

        composable(Routes.SIGNIN) {
            LaunchedEffect(auth.signedIn) {
                if (auth.signedIn) nav.popBackStack()
            }
            SignInScreen(
                state = auth,
                configured = BuildConfig.GOOGLE_WEB_CLIENT_ID.isNotBlank(),
                onSignIn = vm::signIn
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
                    history = history,
                    warmupTemplates = warmupTemplates,
                    onApplyWarmup = vm::applyWarmupTemplate,
                    onDeleteWarmup = { vm.deleteWarmupTemplate(it.id) },
                    onSaveWarmups = vm::saveWarmupsAsTemplate,
                    onLog = vm::logSet,
                    onUndo = vm::undoLastSet,
                    onAdjustRest = vm::adjustRest,
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
                    previous = history.firstOrNull { it.planTitle == current.plan.title },
                    onDone = { note, rpe ->
                        vm.finishSession(note, rpe)
                        nav.popBackStack(Routes.TODAY, false)
                    }
                )
            }
        }

        composable(Routes.PLAN_EDIT) {
            PlanEditorScreen(
                plan = plan,
                onSave = {
                    vm.updatePlan(it)
                    nav.popBackStack()
                },
                onCancel = { nav.popBackStack() }
            )
        }

        composable(Routes.SESSION) { entry ->
            val id = entry.arguments?.getString("id")
            val finished = history.firstOrNull { it.id == id }
            if (finished == null) {
                LaunchedEffect(Unit) { nav.popBackStack() }
            } else {
                SessionDetailScreen(
                    session = finished,
                    onBack = { nav.popBackStack() },
                    onEditSet = { index, edit -> vm.editSet(finished.id, index, edit) },
                    onDeleteSet = { index -> vm.deleteSet(finished.id, index) },
                    onDeleteSession = {
                        vm.deleteSession(finished.id)
                        nav.popBackStack()
                    },
                    onEditSession = { days, focus, note -> vm.editSession(finished.id, days, focus, note) },
                    onAddSets = { exercise, specs -> vm.addSets(finished.id, exercise, specs) },
                    linkCandidates = linkCandidates,
                    onLoadLinkable = { vm.loadLinkableActivities(finished.id) },
                    onLinkActivity = { activity -> vm.linkActivity(finished.id, activity) },
                    onCancelLink = vm::clearLinkCandidates,
                    analysis = analyses[finished.id],
                    analysisBusy = analysisBusy == finished.id,
                    onLoadAnalysis = { vm.loadAnalysis(finished.id) },
                    onAnalyse = { vm.requestAnalysis(finished.id) },
                    canRepeat = session == null,
                    onRepeat = {
                        if (vm.repeatSession(finished.id)) nav.navigate(Routes.LIVE)
                    }
                )
            }
        }

        composable(Routes.TAB) { entry ->
            val name = entry.arguments?.getString("name") ?: "train"
            when (name) {
                "you" -> YouScreen(
                    auth = auth,
                    syncedAt = syncedAt,
                    syncError = syncError,
                    onSignIn = { nav.navigate(Routes.SIGNIN) },
                    onSignOut = vm::signOut,
                    onTab = nav::switchTab
                )
                "train" -> TrainScreen(
                    history = history,
                    planWeek = planWeek,
                    records = records,
                    onAddRecord = vm::addRecord,
                    onOpenSession = { id -> nav.navigate(Routes.session(id)) },
                    onRefreshWeek = vm::refreshPlanWeek,
                    onTab = nav::switchTab
                )
                else -> PlaceholderScreen(tab = name, onTab = nav::switchTab)
            }
        }
    }
}

private fun NavHostController.switchTab(kind: NavKind) {
    navigate(Routes.tab(kind)) {
        popUpTo(Routes.TODAY) { inclusive = false }
        launchSingleTop = true
    }
}
