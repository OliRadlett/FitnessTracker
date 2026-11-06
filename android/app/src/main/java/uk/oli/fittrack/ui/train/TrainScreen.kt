package uk.oli.fittrack.ui.train

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.humaniseLabel
import uk.oli.fittrack.net.PlanDaySummary
import uk.oli.fittrack.net.PlanWeek
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.log.LogScreen
import uk.oli.fittrack.ui.progress.ProgressScreen
import uk.oli.fittrack.ui.theme.Tokens
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The training surface: what you have done, how it is going, and what the plan
 * says this week. Three views of one system, which is why they share a tab.
 */
@Composable
fun TrainScreen(
    history: List<FinishedSession>,
    planWeek: PlanWeek?,
    onOpenSession: (String) -> Unit,
    onRefreshWeek: () -> Unit,
    onTab: (NavKind) -> Unit
) {
    // 0 = sessions, 1 = progress, 2 = the week.
    var mode by rememberSaveable { mutableIntStateOf(0) }

    LaunchedEffect(mode) {
        if (mode == 2) onRefreshWeek()
    }

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
            Label("TRAIN")
            Spacer(Modifier.height(10.dp))
            Text(
                when (mode) {
                    0 -> "Sessions."
                    1 -> "Progress."
                    else -> "This week."
                },
                fontSize = 30.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(16.dp))
            ModePills(mode) { mode = it }
            Spacer(Modifier.height(20.dp))

            when (mode) {
                0 -> LogScreen(history, onOpenSession)
                1 -> ProgressScreen(history)
                else -> WeekPlan(planWeek, onRefreshWeek)
            }
            Spacer(Modifier.height(20.dp))
        }
        BottomNav(NavKind.Train, onTab)
    }
}

@Composable
private fun ModePills(mode: Int, onSelect: (Int) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("Sessions", "Progress", "Week").forEachIndexed { index, label ->
            val selected = index == mode
            Box(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (selected) Tokens.Accent.copy(alpha = 0.14f) else Tokens.Surface)
                    .clickable { onSelect(index) }
                    .padding(horizontal = 12.dp, vertical = 8.dp)
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

/**
 * The plan's week. Read-only on purpose: the editor lives on the website, and
 * the phone's job here is to tell you what is coming, not to rewrite it.
 */
@Composable
private fun WeekPlan(week: PlanWeek?, onRefresh: () -> Unit) {
    if (week == null) {
        Text("No plan loaded.", fontSize = 15.sp, color = Tokens.Fg)
        Spacer(Modifier.height(6.dp))
        Text(
            "Sign in, or tap refresh if you are already signed in.",
            fontSize = 13.sp,
            color = Tokens.Muted
        )
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.Surface)
                .clickable { onRefresh() }
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text("Refresh", fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
        }
        return
    }

    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label(week.planName.uppercase(Locale.UK))
            Spacer(Modifier.weight(1f))
            Text("week ${week.weekNumber}", fontSize = 12.sp, color = Tokens.Muted)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "${shortDate(week.weekStart)} – ${shortDate(week.weekEnd)}",
            fontSize = 12.sp,
            color = Tokens.Muted
        )
        Spacer(Modifier.height(10.dp))
        week.days.forEach { day -> DayRow(day) }
    }
}

@Composable
private fun DayRow(day: PlanDaySummary) {
    val date = runCatching { LocalDate.parse(day.date) }.getOrNull()
    val title = day.focus?.let { humaniseLabel(it) }
        ?: when (day.sport) {
            "strength" -> "Strength"
            "cycle" -> "Ride"
            else -> "Rest"
        }
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (day.isToday) Tokens.Surface else Tokens.Bg)
            .padding(horizontal = 10.dp, vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                date?.format(DateTimeFormatter.ofPattern("EEE", Locale.UK))?.uppercase(Locale.UK)
                    ?: "—",
                fontSize = 12.sp,
                letterSpacing = 0.6.sp,
                color = if (day.isToday) Tokens.Accent else Tokens.Muted,
                modifier = Modifier.width(46.dp)
            )
            Text(
                date?.dayOfMonth?.toString() ?: "—",
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.width(30.dp)
            )
            Spacer(Modifier.width(10.dp))
            Text(
                title,
                fontSize = 15.sp,
                fontWeight = if (day.isToday) FontWeight.SemiBold else FontWeight.Normal,
                color = if (day.sport == "rest") Tokens.Muted else Tokens.Fg,
                modifier = Modifier.weight(1f)
            )
            if (day.exercises > 0) {
                Text("${day.exercises} ex", fontSize = 12.sp, color = Tokens.Muted)
                Spacer(Modifier.width(10.dp))
            }
            Text(
                when (day.status) {
                    "completed" -> "✓"
                    "partial" -> "◐"
                    "missed" -> "missed"
                    "rest" -> "rest"
                    else -> if (day.isToday) "today" else ""
                },
                fontSize = 12.sp,
                color = when (day.status) {
                    "completed" -> Tokens.Accent
                    "missed" -> Tokens.Muted
                    else -> Tokens.Muted
                }
            )
        }
    }
}

private fun shortDate(raw: String): String =
    runCatching {
        LocalDate.parse(raw).format(DateTimeFormatter.ofPattern("d MMM", Locale.UK))
    }.getOrDefault(raw)
