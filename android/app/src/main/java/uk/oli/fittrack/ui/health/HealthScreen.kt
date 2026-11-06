package uk.oli.fittrack.ui.health

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.CalendarDay
import uk.oli.fittrack.domain.HealthSnapshot
import uk.oli.fittrack.domain.RecoveryBand
import uk.oli.fittrack.domain.monthDays
import uk.oli.fittrack.domain.monthStart
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Health, in four numbers rather than ten charts.
 *
 * On a phone the question is "am I recovered, am I sleeping, is my breathing
 * normal". Every reading here comes from an endpoint the dashboard and the body
 * tab already use, so this screen cannot disagree with them.
 */
@Composable
fun HealthScreen(
    health: HealthSnapshot?,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
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
            Spacer(Modifier.height(12.dp))
            BackRow(onBack)
            Spacer(Modifier.height(6.dp))
            Label("HEALTH")
            Spacer(Modifier.height(8.dp))
            Text("Health.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                "Recovery, sleep and breathing — the three things an athlete checks before training.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(16.dp))

            if (health == null) {
                Text("Loading health…", fontSize = 14.sp, color = Tokens.Muted)
                Spacer(Modifier.height(12.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.Surface)
                        .clickable { onRefresh() }
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    Text("Refresh", fontSize = 13.sp, color = Tokens.Accent)
                }
            } else if (health.isEmpty) {
                Text("No health data yet.", fontSize = 15.sp, color = Tokens.Fg)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Recovery and sleep come from Whoop; breathing rate from the same daily metrics. " +
                        "Connect a device and sync.",
                    fontSize = 13.sp,
                    color = Tokens.Muted
                )
            } else {
                health.readiness?.let { readiness ->
                    Card("RECOVERY", readiness.label) {
                        if (!readiness.hasData) {
                            Text(
                                readiness.message ?: "No recovery score.",
                                fontSize = 13.sp,
                                color = Tokens.Muted
                            )
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                                readiness.score?.let { Number("SCORE", it.toInt().toString()) }
                                readiness.hrvMs?.let { Number("HRV", it.toInt().toString()) }
                                readiness.restingHr?.let { Number("RHR", it.toInt().toString()) }
                            }
                        }
                        health.sleepDebt?.let { debt ->
                            Spacer(Modifier.height(10.dp))
                            Text(
                                if (debt.isInDebt) {
                                    "Sleep debt ${format1(debt.debtHours)}h over ${debt.windowDays} days"
                                } else {
                                    "No sleep debt over ${debt.windowDays} days"
                                },
                                fontSize = 12.sp,
                                color = if (debt.isInDebt) Tokens.Accent else Tokens.Muted
                            )
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                }

                health.sleepConsistency?.let { consistency ->
                    Card("SLEEP TIMING", consistency.label) {
                        Text(consistency.describe(), fontSize = 13.sp, color = Tokens.Fg)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Consistency ${consistency.score?.toInt() ?: "—"} over " +
                                "${consistency.daysAnalysed} of ${consistency.windowDays} nights",
                            fontSize = 12.sp,
                            color = Tokens.Muted
                        )
                    }
                    Spacer(Modifier.height(12.dp))
                }

                health.respiratoryRate?.let { breathing ->
                    Card("BREATHING", breathing.trend.replaceFirstChar { it.uppercase() }) {
                        Text(breathing.describe(), fontSize = 13.sp, color = Tokens.Fg)
                        breathing.recentAverage?.let {
                            Spacer(Modifier.height(6.dp))
                            Text(
                                "7-day average ${format1(it)} br/min",
                                fontSize = 12.sp,
                                color = Tokens.Muted
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * The month, as a grid. Each cell carries what happened (a lift dot, a ride dot)
 * and how recovered you were (its tint), so a month reads at a glance.
 */
@Composable
fun CalendarScreen(
    month: YearMonth,
    days: Map<String, CalendarDay>?,
    onMonth: (Int) -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
    var selected by remember(month) { mutableStateOf<String?>(null) }
    val dates = remember(month) { monthDays(month) }
    val (first, blanks) = remember(month) { monthStart(month) }

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
            Spacer(Modifier.height(12.dp))
            BackRow(onBack)
            Spacer(Modifier.height(6.dp))
            Label("CALENDAR")
            Spacer(Modifier.height(8.dp))
            Text(
                month.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.UK)),
                fontSize = 28.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MonthButton("‹") { onMonth(-1) }
                MonthButton("This month") { onMonth(0) }
                MonthButton("›") { onMonth(1) }
            }
            Spacer(Modifier.height(14.dp))

            Row(Modifier.fillMaxWidth()) {
                listOf("M", "T", "W", "T", "F", "S", "S").forEach { label ->
                    Text(
                        label,
                        fontSize = 11.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
            Spacer(Modifier.height(6.dp))

            if (days == null) {
                Text("Loading the month…", fontSize = 14.sp, color = Tokens.Muted)
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.Surface)
                        .clickable { onRefresh() }
                        .padding(horizontal = 14.dp, vertical = 10.dp)
                ) {
                    Text("Refresh", fontSize = 13.sp, color = Tokens.Accent)
                }
            } else {
                // Seven per row, with the blanks that put the 1st on its weekday.
                val cells: List<LocalDate?> = List(blanks) { null } + dates
                cells.chunked(7).forEach { week ->
                    Row(Modifier.fillMaxWidth()) {
                        week.forEach { date ->
                            Box(Modifier.weight(1f).padding(2.dp)) {
                                if (date == null) {
                                    Spacer(Modifier.size(38.dp))
                                } else {
                                    DayCell(
                                        date = date,
                                        day = days[date.toString()],
                                        selected = selected == date.toString(),
                                        onClick = {
                                            selected = if (selected == date.toString()) null
                                            else date.toString()
                                        }
                                    )
                                }
                            }
                        }
                        // Pad the last row so the columns stay aligned.
                        repeat(7 - week.size) { Box(Modifier.weight(1f)) {} }
                    }
                }
                if (first.monthValue == month.monthValue) {
                    Spacer(Modifier.height(12.dp))
                }
                selected?.let { date ->
                    val day = days[date]
                    Spacer(Modifier.height(12.dp))
                    DayDetail(date, day)
                }
                if (days.values.all { it.isEmpty }) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "Nothing logged this month.",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun DayCell(
    date: LocalDate,
    day: CalendarDay?,
    selected: Boolean,
    onClick: () -> Unit
) {
    val tint = when (day?.recoveryBand) {
        RecoveryBand.Green -> Tokens.Accent.copy(alpha = 0.22f)
        RecoveryBand.Amber -> Tokens.Muted.copy(alpha = 0.22f)
        RecoveryBand.Red -> Tokens.Muted.copy(alpha = 0.10f)
        null -> Color.Transparent
    }
    Column(
        Modifier
            .fillMaxWidth()
            .height(46.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Tokens.Surface else tint)
            .clickable { onClick() }
            .padding(3.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            date.dayOfMonth.toString(),
            fontSize = 12.sp,
            color = if (selected) Tokens.Accent else Tokens.Fg,
            style = TextStyle(fontFeatureSettings = "tnum")
        )
        Spacer(Modifier.height(3.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            if (day?.hasLift == true) Dot(Tokens.Accent)
            if (day?.hasRide == true) Dot(Tokens.Muted)
        }
    }
}

@Composable
private fun Dot(colour: Color) {
    Box(
        Modifier
            .size(5.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(colour)
    )
}

@Composable
private fun DayDetail(date: String, day: CalendarDay?) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Tokens.Surface)
            .padding(14.dp)
    ) {
        Text(
            runCatching {
                LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.UK))
            }.getOrDefault(date),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = Tokens.Fg
        )
        if (day == null || day.isEmpty) {
            Spacer(Modifier.height(6.dp))
            Text("Nothing logged.", fontSize = 12.sp, color = Tokens.Muted)
            return@Column
        }
        day.describe().takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, fontSize = 12.sp, color = Tokens.Muted)
        }
        day.entries.forEach { entry ->
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    entry.focus ?: entry.name,
                    fontSize = 13.sp,
                    color = Tokens.Fg,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    listOfNotNull(
                        entry.minutes.takeIf { it > 0 }?.let { "${it}m" },
                        entry.distanceKm.takeIf { it > 0.0 }?.let { "${format1(it)} km" },
                        entry.tss?.let { "TSS ${it.toInt()}" }
                    ).joinToString(" · "),
                    fontSize = 11.sp,
                    color = Tokens.Muted
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(
            listOfNotNull(
                day.recoveryScore?.let { "Recovery ${it.toInt()}%" },
                day.sleepHours?.let { "Sleep ${format1(it)}h" },
                day.hrvMs?.let { "HRV ${it.toInt()}" },
                day.restingHr?.let { "RHR ${it.toInt()}" },
                day.strain?.let { "Strain ${format1(it)}" }
            ).joinToString(" · "),
            fontSize = 11.sp,
            color = Tokens.Muted
        )
    }
}

@Composable
private fun Card(label: String, trailing: String, content: @Composable () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label(label)
            Spacer(Modifier.weight(1f))
            Text(trailing, fontSize = 12.sp, color = Tokens.Accent)
        }
        Spacer(Modifier.height(10.dp))
        content()
    }
}

@Composable
private fun Number(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
        Spacer(Modifier.height(3.dp))
        Text(
            value,
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
            color = Tokens.Fg,
            style = TextStyle(fontFeatureSettings = "tnum")
        )
    }
}

@Composable
private fun MonthButton(label: String, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 12.sp,
        color = Tokens.Fg,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 7.dp)
    )
}

@Composable
private fun BackRow(onBack: () -> Unit) {
    Text(
        "‹ Back",
        fontSize = 14.sp,
        color = Tokens.Muted,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable { onBack() }
            .padding(vertical = 6.dp, horizontal = 2.dp)
    )
}

private fun format1(value: Double): String =
    String.format(Locale.UK, "%.1f", value)
