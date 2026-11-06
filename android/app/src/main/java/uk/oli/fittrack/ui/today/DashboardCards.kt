package uk.oli.fittrack.ui.today

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.GoalProgress
import uk.oli.fittrack.domain.LoadTrend
import uk.oli.fittrack.domain.Readiness
import uk.oli.fittrack.domain.SleepDebt
import uk.oli.fittrack.domain.TodayDone
import uk.oli.fittrack.domain.TrainingLoad
import uk.oli.fittrack.domain.activeGoals
import uk.oli.fittrack.domain.formatDistanceKm
import uk.oli.fittrack.domain.formatRideDuration
import uk.oli.fittrack.domain.formLabel
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.plural
import uk.oli.fittrack.ui.theme.Tokens

/**
 * The dashboard's numbers, below the plan rather than above it.
 *
 * The website leads with metrics; the app deliberately does not. Today's job is
 * "what am I doing", and a screen that answers it has to put the plan first —
 * the review belongs under the act (docs/review-vs-act.md).
 */
@Composable
fun LoadCard(load: TrainingLoad) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("FITNESS · FATIGUE · FORM")
            Spacer(Modifier.weight(1f))
            Text(
                formLabel(load.tsb),
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Accent
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            LoadNumber("CTL", load.ctl, Tokens.Fg)
            LoadNumber("ATL", load.atl, Tokens.Muted)
            LoadNumber("TSB", load.tsb, Tokens.Accent)
        }
        load.tsbDelta7d()?.let { delta ->
            Spacer(Modifier.height(8.dp))
            Text(
                (if (delta > 0) "Form is up " else "Form is down ") +
                    formatWeight(kotlin.math.abs(delta).toFloat()) + " in 7 days" +
                    when (load.trend) {
                        LoadTrend.Rising -> " · getting fresher"
                        LoadTrend.Falling -> " · getting deeper"
                        LoadTrend.Flat -> " · steady"
                    },
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        }
        if (load.points.size >= 2) {
            Spacer(Modifier.height(12.dp))
            LoadLine(load.points.map { it.ctl })
        }
    }
}

@Composable
private fun LoadNumber(label: String, value: Double, colour: androidx.compose.ui.graphics.Color) {
    Column {
        Text(label, fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
        Spacer(Modifier.height(3.dp))
        Text(
            value.toInt().toString(),
            fontSize = 22.sp,
            fontWeight = FontWeight.SemiBold,
            color = colour,
            style = TextStyle(fontFeatureSettings = "tnum")
        )
    }
}

/** Fitness as a line: the shape of the last weeks, without axes to read. */
@Composable
private fun LoadLine(values: List<Double>) {
    val min = values.min()
    val max = values.max()
    val span = (max - min).takeIf { it > 0.0 } ?: 1.0
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(48.dp)
    ) {
        val stepX = size.width / (values.size - 1).coerceAtLeast(1)
        fun y(value: Double) = (size.height - 6f) * (1f - ((value - min) / span).toFloat()) + 3f
        val path = Path()
        values.forEachIndexed { index, value ->
            val x = stepX * index
            val pointY = y(value)
            if (index == 0) path.moveTo(x, pointY) else path.lineTo(x, pointY)
        }
        drawPath(path, color = Tokens.Muted.copy(alpha = 0.7f), style = Stroke(1.5f, cap = StrokeCap.Round))
    }
}

/** What has already been done today. Hidden when nothing has. */
@Composable
fun TodayDoneCard(done: TodayDone) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label("TODAY SO FAR")
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            if (done.tss > 0.0) LoadNumber("TSS", done.tss, Tokens.Fg)
            if (done.volumeKg > 0.0) {
                LoadNumber("LIFTED", done.volumeKg / 1000.0, Tokens.Fg)
                Text("t", fontSize = 11.sp, color = Tokens.Muted)
            }
            if (done.distanceMeters > 0.0) {
                LoadNumber("KM", done.distanceMeters / 1000.0, Tokens.Fg)
            }
            if (done.durationSeconds > 0) {
                Column {
                    Text("TIME", fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        "${done.durationSeconds / 60}m",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
            }
        }
        val counts = buildList {
            if (done.sessions > 0) add(plural(done.sessions, "session"))
            if (done.activities > 0) add(plural(done.activities, "activity"))
        }
        if (counts.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(counts.joinToString(" · "), fontSize = 12.sp, color = Tokens.Muted)
        }
    }
}

/** Recovery: the score when Whoop has one, else the honest message. */
@Composable
fun ReadinessCard(readiness: Readiness, sleep: SleepDebt?) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("READINESS")
            Spacer(Modifier.weight(1f))
            Text(readiness.label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
        }
        Spacer(Modifier.height(10.dp))
        if (!readiness.hasData) {
            Text(
                readiness.message ?: "Connect Whoop to get a readiness score.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                readiness.score?.let { LoadNumber("RECOVERY", it, Tokens.Fg) }
                readiness.hrvMs?.let { LoadNumber("HRV", it, Tokens.Muted) }
                readiness.restingHr?.let { LoadNumber("RHR", it, Tokens.Muted) }
            }
        }
        sleep?.let {
            Spacer(Modifier.height(10.dp))
            Text(
                if (it.isInDebt) {
                    "Sleep debt ${formatWeight(it.debtHours.toFloat())}h over ${it.windowDays} days " +
                        "(avg ${formatWeight(it.averageHours.toFloat())}h)"
                } else {
                    "Sleep is on target — avg ${formatWeight(it.averageHours.toFloat())}h over ${it.windowDays} days"
                },
                fontSize = 12.sp,
                color = if (it.isInDebt) Tokens.Accent else Tokens.Muted
            )
        }
    }
}

/** Up to three active goals, with progress that reads honestly. */
@Composable
fun GoalsCard(goals: List<GoalProgress>) {
    val shown = activeGoals(goals)
    if (shown.isEmpty()) return
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label("GOALS")
        shown.forEach { goal ->
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    goal.metric,
                    fontSize = 14.sp,
                    color = Tokens.Fg,
                    modifier = Modifier.weight(1f),
                    maxLines = 1
                )
                Text(goal.describe(), fontSize = 12.sp, color = Tokens.Muted)
            }
            Spacer(Modifier.height(5.dp))
            val pct = goal.progressPct
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(Tokens.Muted.copy(alpha = 0.18f))
            ) {
                if (pct != null) {
                    Box(
                        Modifier
                            .fillMaxWidth((pct / 100.0).toFloat().coerceIn(0f, 1f))
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(Tokens.Accent)
                    )
                }
            }
        }
    }
}

/** The week across both sports — the website's Weekly tab, compressed. */
@Composable
fun WeekCard(summary: uk.oli.fittrack.domain.WeekSummary, month: uk.oli.fittrack.domain.WeekSummary? = null) {
    if (summary.isEmpty && (month == null || month.isEmpty)) return
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("THIS WEEK")
            Spacer(Modifier.weight(1f))
            Text(
                plural(summary.daysTrained, "day") + " trained",
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            if (summary.sessions > 0) {
                Column {
                    Text("LIFTS", fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        summary.sessions.toString(),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
                Column {
                    Text("VOLUME", fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        "${(summary.volumeKg / 1000.0).toInt()}t",
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
            }
            if (summary.rides > 0) {
                Column {
                    Text("RIDES", fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        summary.rides.toString(),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
                Column {
                    Text("KM", fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        formatWeight(summary.distanceKm.toFloat()),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
            }
            if (summary.tss > 0.0) {
                Column {
                    Text("TSS", fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        summary.tss.toInt().toString(),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
            }
        }
        // The month in one line: the website's Monthly tab is a chart, and a
        // phone's dashboard reads better as a sentence than a second bar chart.
        if (month != null && !month.isEmpty) {
            Spacer(Modifier.height(10.dp))
            Text(
                "28 days: " + listOfNotNull(
                    month.sessions.takeIf { it > 0 }?.let { "$it lifts" },
                    month.volumeKg.takeIf { it > 0.0 }?.let { "${(it / 1000.0).toInt()}t" },
                    month.rides.takeIf { it > 0 }?.let { "$it rides" },
                    month.distanceKm.takeIf { it > 0.0 }?.let { "${formatWeight(it.toFloat())} km" },
                    month.tss.takeIf { it > 0.0 }?.let { "TSS ${it.toInt()}" }
                ).joinToString(" · "),
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        }
    }
}

/** The last few things done, lifts and rides in one list. */
@Composable
fun RecentCard(history: List<uk.oli.fittrack.domain.FinishedSession>, rides: List<uk.oli.fittrack.domain.Ride>) {
    data class Recent(
        val at: Long,
        val title: String,
        val detail: String,
        val isRide: Boolean
    )

    val recent = (history.map {
        Recent(
            at = it.endedAt,
            title = it.planTitle.ifBlank { "Session" },
            detail = "${(SessionEngineVolume(it))} kg · ${uk.oli.fittrack.ui.plural(
                uk.oli.fittrack.domain.SessionEngine.workingSets(it.sets).size, "set"
            )}",
            isRide = false
        )
    } + rides.map {
        Recent(
            at = it.startedAt,
            title = it.name,
            detail = uk.oli.fittrack.domain.formatDistanceKm(it.distanceKm) + " · " +
                uk.oli.fittrack.domain.formatRideDuration(it.durationSeconds),
            isRide = true
        )
    }).sortedByDescending { it.at }.take(4)

    if (recent.isEmpty()) return
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label("RECENT")
        recent.forEach { entry ->
            Spacer(Modifier.height(9.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .width(3.dp)
                        .height(26.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (entry.isRide) Tokens.Muted else Tokens.Accent)
                )
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        entry.title,
                        fontSize = 14.sp,
                        color = Tokens.Fg,
                        maxLines = 1
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(entry.detail, fontSize = 12.sp, color = Tokens.Muted)
                }
                Text(
                    shortDay(entry.at),
                    fontSize = 12.sp,
                    color = Tokens.Muted
                )
            }
        }
    }
}

/** The session's working volume, in kilos, rounded for display. */
private fun SessionEngineVolume(session: uk.oli.fittrack.domain.FinishedSession): Long =
    uk.oli.fittrack.domain.SessionEngine
        .volumeKg(uk.oli.fittrack.domain.SessionEngine.workingSets(session.sets))
        .toLong()

private fun shortDay(at: Long): String =
    java.time.Instant.ofEpochMilli(at)
        .atZone(java.time.ZoneId.systemDefault())
        .toLocalDate()
        .format(java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.UK))

/** A quiet line for the sections that are still loading. */
@Composable
fun DashboardPlaceholder(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .width(4.dp)
                .height(14.dp)
                .background(Tokens.Muted.copy(alpha = 0.4f))
        )
        Spacer(Modifier.width(10.dp))
        Text(text, fontSize = 12.sp, color = Tokens.Muted)
    }
}
