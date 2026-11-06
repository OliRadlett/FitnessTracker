package uk.oli.fittrack.ui.activities

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.ActivityDetail
import uk.oli.fittrack.domain.ActivitySummary
import uk.oli.fittrack.domain.ActivityWindow
import uk.oli.fittrack.domain.feedDate
import uk.oli.fittrack.domain.filterActivities
import uk.oli.fittrack.domain.formatKm
import uk.oli.fittrack.domain.formatRideDuration
import uk.oli.fittrack.domain.normalise
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens

/**
 * The activities feed, and one activity in detail.
 *
 * The website's `/activities` is a list, five filters, a comparison mode and a
 * replay theatre. The phone gets what a phone is for: find a ride, see what it
 * was, look at its shape.
 */
@Composable
fun ActivitiesScreen(
    activities: List<ActivitySummary>?,
    detail: ActivityDetail?,
    loadingDetail: Boolean,
    onWindow: (ActivityWindow) -> Unit,
    onSport: (String?) -> Unit,
    onOpen: (String) -> Unit,
    onClose: () -> Unit,
    onBack: () -> Unit
) {
    if (detail != null) {
        ActivityDetailScreen(detail = detail, onClose = onClose)
        return
    }

    var window by remember { mutableStateOf(ActivityWindow.Year) }
    var sport by remember { mutableStateOf<String?>(null) }
    val shown = remember(activities, window, sport) {
        filterActivities(activities.orEmpty(), sport, window)
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
            Spacer(Modifier.height(12.dp))
            Text(
                "‹ Back",
                fontSize = 14.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onBack() }
                    .padding(vertical = 6.dp)
            )
            Spacer(Modifier.height(6.dp))
            Label("ACTIVITIES")
            Spacer(Modifier.height(8.dp))
            Text("Activities.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                activities?.let { "${it.size} in the feed" } ?: "Loading…",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(null to "All", "ride" to "Rides", "lift" to "Lifts").forEach { (key, label) ->
                    Chip(label, selected = sport == key) {
                        sport = key
                        onSport(key)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActivityWindow.entries.forEach { option ->
                    Chip(option.label, selected = window == option) {
                        window = option
                        onWindow(option)
                    }
                }
            }
            Spacer(Modifier.height(14.dp))

            when {
                activities == null -> Text("Loading activities…", fontSize = 14.sp, color = Tokens.Muted)
                shown.isEmpty() -> {
                    Text("Nothing in this window.", fontSize = 15.sp, color = Tokens.Fg)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "The feed holds whatever Strava, Komoot and Wahoo have sent.",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
                else -> shown.forEach { activity ->
                    ActivityRow(activity) { onOpen(activity.id) }
                    Spacer(Modifier.height(10.dp))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 12.sp,
        color = if (selected) Tokens.Bg else Tokens.Fg,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Tokens.Accent else Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp)
    )
}

@Composable
private fun ActivityRow(activity: ActivitySummary, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Surface)
            .clickable { onClick() }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.Bg),
            contentAlignment = Alignment.Center
        ) {
            Text(
                if (activity.isLift) "L" else if (activity.isRide) "R" else "·",
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Accent
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                activity.name,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                maxLines = 1
            )
            Spacer(Modifier.height(3.dp))
            Text(
                listOfNotNull(
                    feedDate(activity.startedAt),
                    activity.sportLabel,
                    activity.describe().takeIf { it.isNotBlank() }
                ).joinToString(" · "),
                fontSize = 12.sp,
                color = Tokens.Muted,
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis
            )
            activity.labels().takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(3.dp))
                Text(it, fontSize = 11.sp, color = Tokens.Muted, maxLines = 1)
            }
        }
    }
}

/** One activity: its shape when the server sent one, and its numbers. */
@Composable
fun ActivityDetailScreen(detail: ActivityDetail, onClose: () -> Unit) {
    val activity = detail.summary
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
            Text(
                "‹ Activities",
                fontSize = 14.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onClose() }
                    .padding(vertical = 6.dp)
            )
            Spacer(Modifier.height(6.dp))
            Text(
                activity.name,
                fontSize = 26.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(4.dp))
            Text(
                listOfNotNull(
                    activity.localDate().format(
                        java.time.format.DateTimeFormatter.ofPattern("EEEE d MMMM", java.util.Locale.UK)
                    ),
                    activity.sportLabel,
                    activity.source.replaceFirstChar { it.uppercase() }
                ).joinToString(" · "),
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(14.dp))

            if (detail.canDraw) {
                val shape = remember(detail.shape) { normalise(detail.shape) }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(220.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Tokens.Surface)
                        .padding(12.dp)
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        val pad = 6f
                        val w = size.width - pad * 2
                        val h = size.height - pad * 2
                        val path = Path()
                        shape.forEachIndexed { index, (x, y) ->
                            val px = pad + x * w
                            val py = pad + (1f - y) * h
                            if (index == 0) path.moveTo(px, py) else path.lineTo(px, py)
                        }
                        drawPath(path, color = Tokens.Accent, style = Stroke(2.5f, cap = StrokeCap.Round))
                        val (fx, fy) = shape.first()
                        drawCircle(
                            color = Tokens.Accent,
                            radius = 4f,
                            center = Offset(pad + fx * w, pad + (1f - fy) * h)
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
            }

            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(Tokens.Surface)
                    .padding(16.dp)
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    activity.distanceKm.takeIf { it > 0.05 }?.let { Stat("DISTANCE", formatKm(it)) }
                    activity.durationSeconds.takeIf { it > 0 }?.let {
                        Stat("TIME", formatRideDuration(it))
                    }
                    activity.elevationMeters.takeIf { it > 1.0 }?.let { Stat("CLIMB", "${it.toInt()} m") }
                }
                if (activity.averagePower != null || activity.averageHeartRate != null ||
                    activity.tss != null
                ) {
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        activity.averagePower?.let { Stat("POWER", "${it.toInt()} W") }
                        activity.averageHeartRate?.let { Stat("HR", "${it.toInt()} bpm") }
                        activity.tss?.let { Stat("TSS", it.toInt().toString()) }
                        activity.averageSpeedKph?.let {
                            Stat("SPEED", String.format(java.util.Locale.UK, "%.1f km/h", it))
                        }
                    }
                }
                activity.labels().takeIf { it.isNotBlank() }?.let { labels ->
                    Spacer(Modifier.height(12.dp))
                    Text(labels, fontSize = 12.sp, color = Tokens.Muted)
                }
                activity.routeName?.let { route ->
                    Spacer(Modifier.height(10.dp))
                    Text("Route: $route", fontSize = 12.sp, color = Tokens.Muted)
                }
                activity.linkedLift?.let { lift ->
                    Spacer(Modifier.height(10.dp))
                    Text(
                        listOfNotNull(
                            "Linked lift",
                            lift.focus?.replaceFirstChar { it.uppercase() },
                            lift.volumeKg?.let { "${it.toInt()} kg" }
                        ).joinToString(" · "),
                        fontSize = 12.sp,
                        color = Tokens.Accent
                    )
                }
                detail.notes?.let { note ->
                    Spacer(Modifier.height(12.dp))
                    Text(note, fontSize = 13.sp, color = Tokens.Fg)
                }
                if (detail.hasStreams) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "Streams recorded — the website shows the full replay.",
                        fontSize = 11.sp,
                        color = Tokens.Muted
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Stat(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
        Spacer(Modifier.height(3.dp))
        Text(
            value,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            color = Tokens.Fg,
            style = TextStyle(fontFeatureSettings = "tnum")
        )
    }
}
