package uk.oli.fittrack.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.HistoryEngine
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.Plan
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.domain.SessionState
import uk.oli.fittrack.ui.BottomAction
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.log.LogScreen
import uk.oli.fittrack.ui.progress.ProgressScreen
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * The whole home screen: today's session, one action, and what you did last time.
 *
 * The card is the session itself — six exercises with their schemes — because
 * that is what "what am I doing today" means.
 */
@Composable
fun TodayScreen(
    session: SessionState?,
    plan: Plan,
    signedIn: Boolean,
    history: List<FinishedSession>,
    onEditPlan: () -> Unit,
    onOpenSession: (String) -> Unit,
    onSignIn: () -> Unit,
    onStart: () -> Unit,
    onResume: () -> Unit,
    onTab: (NavKind) -> Unit
) {
    val active = session?.plan ?: plan
    val now = remember { System.currentTimeMillis() }
    // 0 = the session in front of you, 1 = the log. Log nests under Today
    // because "what did I do" is a view of time, and Today owns time.
    var mode by rememberSaveable { mutableIntStateOf(0) }
    val dateLabel = remember {
        LocalDate.now().format(DateTimeFormatter.ofPattern("EEE d MMMM", Locale.UK))
            .uppercase(Locale.UK)
    }

    val firstExercise = active.exercises.first()
    val lastSet = remember(history, firstExercise.name) {
        HistoryEngine.lastSetFor(history, firstExercise.name)
    }
    val strip = remember(history, now) { HistoryEngine.dailyVolume(history, now, days = 7) }
    val weekVolume = strip.sumOf { it.second }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .statusBarsPadding()
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
        ) {
            Spacer(Modifier.height(18.dp))
            Text(
                dateLabel,
                fontSize = 12.sp,
                letterSpacing = 0.7.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(10.dp))
            Text(
                when {
                    mode == 1 -> "Your log."
                    mode == 2 -> "Your progress."
                    session != null -> "In progress."
                    else -> "${active.title}."
                },
                fontSize = 30.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(16.dp))
            ModePills(mode) { mode = it }
            Spacer(Modifier.height(20.dp))
            if (mode == 0) {
                PlanCard(active, session, lastSet, now, onEditPlan)

                if (history.isEmpty() && session == null) {
                    Text("Nothing logged yet today.", fontSize = 13.sp, color = Tokens.Muted)
                } else if (history.isNotEmpty()) {
                    Spacer(Modifier.height(18.dp))
                    WeekStrip(strip, weekVolume)
                }
            } else if (mode == 1) {
                LogScreen(history, onOpenSession)
            } else {
                ProgressScreen(history)
            }
            Spacer(Modifier.height(20.dp))
        }
        if (mode == 0) {
            BottomAction {
                // The prompt lives on the deck, not in the scroll area: at 360dp
                // the card plus a "last time" footer leaves no room for it, so
                // scrolled placement put it off screen. The deck never scrolls.
                if (!signedIn) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onSignIn() }
                            .padding(bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Not signed in", fontSize = 12.sp, color = Tokens.Muted)
                        Spacer(Modifier.weight(1f))
                        Text("Sign in →", fontSize = 12.sp, color = Tokens.Accent)
                    }
                }
                if (session != null) {
                    PrimaryButton("Resume session", onResume)
                } else {
                    PrimaryButton("Start session", onStart)
                }
            }
        }
        BottomNav(NavKind.Today, onTab)
    }
}

@Composable
private fun ModePills(mode: Int, onSelect: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Today", "Log", "Progress").forEachIndexed { index, label ->
            val selected = index == mode
            Box(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (selected) Tokens.Accent.copy(alpha = 0.14f) else Tokens.Surface)
                    .clickable { onSelect(index) }
                    .padding(horizontal = 14.dp, vertical = 8.dp)
            ) {
                Text(
                    label,
                    fontSize = 13.sp,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (selected) Tokens.Accent else Tokens.Muted
                )
            }
        }
    }
}

@Composable
private fun PlanCard(
    plan: uk.oli.fittrack.domain.Plan,
    session: SessionState?,
    lastSet: LoggedSet?,
    now: Long,
    onEditPlan: () -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 18.dp, vertical = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Align the header with the exercise names, which sit past the accent bar.
            Spacer(Modifier.width(14.dp))
            if (session != null) {
                Text("●", fontSize = 11.sp, color = Tokens.Accent)
                Spacer(Modifier.width(7.dp))
            }
            Label(
                if (session == null) {
                    "${plan.exercises.size} EXERCISES · ${plan.totalSets} SETS"
                } else {
                    "${session.doneSets} OF ${plan.totalSets} SETS LOGGED"
                }
            )
            Spacer(Modifier.weight(1f))
            if (session == null) {
                Text(
                    "Edit",
                    fontSize = 13.sp,
                    color = Tokens.Accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onEditPlan() }
                        .padding(horizontal = 10.dp, vertical = 6.dp)
                )
            }
        }
        Spacer(Modifier.height(10.dp))

        val current = session?.let { SessionEngine.currentExercise(it) }
        plan.exercises.forEachIndexed { index, exercise ->
            val done = session?.let { SessionEngine.doneFor(it, exercise.name) } ?: 0
            val isNext = exercise.name == current?.name || (session == null && index == 0)
            Row(
                Modifier.fillMaxWidth().height(42.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(3.dp)
                        .height(18.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(
                            when {
                                isNext -> Tokens.Accent
                                done >= exercise.sets -> Tokens.Accent.copy(alpha = 0.35f)
                                else -> Tokens.Surface
                            }
                        )
                )
                Spacer(Modifier.width(11.dp))
                Text(
                    exercise.name,
                    fontSize = 14.sp,
                    fontWeight = if (isNext) FontWeight.Medium else FontWeight.Normal,
                    color = if (done >= exercise.sets) Tokens.Muted else Tokens.Fg,
                    modifier = Modifier.weight(1f)
                )
                if (done > 0) {
                    Text(
                        "$done/${exercise.sets}",
                        fontSize = 12.sp,
                        color = if (done >= exercise.sets) Tokens.Accent else Tokens.Muted,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                    Spacer(Modifier.width(10.dp))
                }
                Text(
                    "${exercise.sets} × ${exercise.reps}",
                    fontSize = 13.sp,
                    color = if (isNext) Tokens.Fg else Tokens.Muted,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }

        if (lastSet != null && session == null) {
            Spacer(Modifier.height(6.dp))
            Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.SurfaceLight))
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Last time", fontSize = 13.sp, color = Tokens.Muted)
                Spacer(Modifier.width(8.dp))
                Text(
                    "${formatWeight(lastSet.weightKg)} × ${lastSet.reps}",
                    fontSize = 13.sp,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
                Spacer(Modifier.width(6.dp))
                Text("@${lastSet.rpe}", fontSize = 13.sp, color = Tokens.Muted)
                Spacer(Modifier.weight(1f))
                Text(relativeDay(lastSet.at, now), fontSize = 13.sp, color = Tokens.Muted)
            }
        }
    }
}

@Composable
private fun WeekStrip(days: List<Pair<LocalDate, Double>>, total: Double) {
    val max = days.maxOfOrNull { it.second } ?: 0.0
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("LAST 7 DAYS")
            Spacer(Modifier.weight(1f))
            if (total > 0) {
                Text(
                    "${formatWeight(total.toFloat())} kg",
                    fontSize = 12.sp,
                    color = Tokens.Muted,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            days.forEach { (day, volume) ->
                val fraction = if (max <= 0.0) 0f else (volume / max).toFloat()
                Column(Modifier.weight(1f)) {
                    Box(
                        Modifier.fillMaxWidth().height(52.dp),
                        contentAlignment = Alignment.BottomCenter
                    ) {
                        Box(
                            Modifier
                                .width(30.dp)
                                .height(if (volume <= 0.0) 3.dp else (52f * fraction).dp)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (volume <= 0.0) Tokens.SurfaceLight else Tokens.Accent)
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        day.dayOfWeek.name.take(3).lowercase(Locale.UK),
                        fontSize = 12.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.align(Alignment.CenterHorizontally)
                    )
                }
            }
        }
    }
}

private fun relativeDay(at: Long, now: Long): String {
    val zone = ZoneId.systemDefault()
    val then = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val days = ChronoUnit.DAYS.between(then, today)
    return when (days) {
        0L -> "today"
        1L -> "yesterday"
        else -> "$days days ago"
    }
}
