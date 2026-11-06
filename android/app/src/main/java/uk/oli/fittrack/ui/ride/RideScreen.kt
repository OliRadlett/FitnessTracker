package uk.oli.fittrack.ui.ride

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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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
import uk.oli.fittrack.domain.CyclingSummary
import uk.oli.fittrack.domain.FtpPoint
import uk.oli.fittrack.domain.PowerCurvePoint
import uk.oli.fittrack.domain.PowerModel
import uk.oli.fittrack.domain.Ride
import uk.oli.fittrack.domain.TrainingLoad
import uk.oli.fittrack.domain.Vo2maxEstimate
import uk.oli.fittrack.domain.ZoneShare
import uk.oli.fittrack.domain.formatDistanceKm
import uk.oli.fittrack.domain.formatRideDuration
import uk.oli.fittrack.domain.formatZoneTime
import uk.oli.fittrack.domain.ftpChange
import uk.oli.fittrack.domain.headlineCurve
import uk.oli.fittrack.domain.meaningfulZones
import uk.oli.fittrack.domain.trendGlyph
import uk.oli.fittrack.net.CyclingSnapshot
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.theme.Tokens
import uk.oli.fittrack.ui.today.LoadCard
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The cycling page: what the last week cost, what the engine can do, and what
 * the rides are behind it.
 *
 * Read-only — a ride comes from Strava or Komoot, and the phone is not where it
 * gets edited. Every section is computed from the data on screen or from the
 * server's own numbers, so nothing here can disagree with the list beneath it.
 */
@Composable
fun RideScreen(
    rides: List<Ride>?,
    cycling: CyclingSnapshot? = null,
    load: TrainingLoad? = null,
    onRefresh: () -> Unit,
    onTab: (NavKind) -> Unit
) {
    val zone = remember { ZoneId.systemDefault() }
    val summary = cycling?.summary

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
            Label("RIDE")
            Spacer(Modifier.height(10.dp))
            Text("Riding.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(20.dp))

            if (summary != null && !summary.isEmpty) {
                SummaryCard(summary)
                Spacer(Modifier.height(12.dp))
            }
            load?.let {
                if (it.points.isNotEmpty()) {
                    LoadCard(it)
                    Spacer(Modifier.height(12.dp))
                }
            }
            cycling?.let { snapshot ->
                if (snapshot.curve.isNotEmpty() || snapshot.model?.hasFit == true) {
                    PowerCard(snapshot.curve, snapshot.model)
                    Spacer(Modifier.height(12.dp))
                }
                if (snapshot.zones.isNotEmpty()) {
                    ZonesCard(snapshot.zones)
                    Spacer(Modifier.height(12.dp))
                }
                if (snapshot.ftpHistory.isNotEmpty() || snapshot.vo2max != null) {
                    FitnessCard(snapshot.ftpHistory, snapshot.vo2max)
                    Spacer(Modifier.height(12.dp))
                }
            }

            if (rides == null || rides.isEmpty()) {
                Text("No rides yet.", fontSize = 15.sp, color = Tokens.Fg)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Rides come from your connected providers via /activities, so they need a sign-in and a sync.",
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
            } else {
                Label("RECENT RIDES")
                Spacer(Modifier.height(8.dp))
                rides.take(8).forEach { ride -> RideRow(ride, zone) }
            }
            Spacer(Modifier.height(20.dp))
        }
        BottomNav(NavKind.Ride, onTab)
    }
}

@Composable
private fun SummaryCard(summary: CyclingSummary) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Tokens.Surface)
            .padding(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("LAST 7 DAYS")
            Spacer(Modifier.weight(1f))
            Text(
                listOfNotNull(
                    summary.ftpWatts?.let { "FTP ${it.toInt()} W" },
                    summary.wattsPerKg?.let { String.format(Locale.UK, "%.1f W/kg", it) }
                ).joinToString(" · "),
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Tile("TSS", summary.tss.toInt().toString(), summary.tssDirection)
            Tile("RIDES", summary.rides.toString(), summary.ridesDirection)
            Tile("KM", formatDistanceKm(summary.distanceKm).removeSuffix(" km"), summary.distanceDirection)
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            // Hours keep a decimal: "3h" from 3.4 hides three quarters of an hour.
            Tile(
                "TIME",
                String.format(Locale.UK, "%.1f", summary.timeHours) + "h",
                summary.timeDirection
            )
            Tile("ELEV", "${summary.elevationM.toInt()}m", summary.elevationDirection)
        }
    }
}

@Composable
private fun Tile(label: String, value: String, direction: String) {
    Column {
        Text(label, fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
        Spacer(Modifier.height(3.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                value,
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            if (direction != "stable") {
                Spacer(Modifier.width(3.dp))
                Text(
                    trendGlyph(direction),
                    fontSize = 12.sp,
                    color = if (direction == "up") Tokens.Accent else Tokens.Muted
                )
            }
        }
    }
}

/** The power curve, as a table and, when there is a model, its three numbers. */
@Composable
private fun PowerCard(curve: List<PowerCurvePoint>, model: PowerModel?) {
    val headline = remember(curve) {
        headlineCurve(curve, listOf("5s", "1min", "5min", "20min", "60min"))
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label("POWER")
        Spacer(Modifier.height(10.dp))
        if (headline.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                headline.forEach { point ->
                    Column {
                        Text(point.label, fontSize = 10.sp, color = Tokens.Muted)
                        Spacer(Modifier.height(3.dp))
                        Text(
                            "${point.watts.toInt()}",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Fg,
                            style = TextStyle(fontFeatureSettings = "tnum")
                        )
                    }
                }
            }
        }
        model?.let { fit ->
            if (fit.cp != null || fit.pMax != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    listOfNotNull(
                        fit.cp?.let { "CP ${it.toInt()} W" },
                        fit.wPrime?.let { "W' ${(it / 1000).toInt()} kJ" },
                        fit.pMax?.let { "Pmax ${it.toInt()} W" }
                    ).joinToString(" · "),
                    fontSize = 12.sp,
                    color = Tokens.Muted
                )
            }
        }
    }
}

/** Time in zones: a bar per zone that got any. */
@Composable
private fun ZonesCard(zones: List<ZoneShare>) {
    val shown = remember(zones) { meaningfulZones(zones) }
    if (shown.isEmpty()) return
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label("TIME IN ZONES · 30 DAYS")
        Spacer(Modifier.height(10.dp))
        shown.forEach { share ->
            Column(Modifier.padding(bottom = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${share.zone} ${share.name}",
                        fontSize = 12.sp,
                        color = Tokens.Fg,
                        modifier = Modifier.weight(1f),
                        maxLines = 1
                    )
                    Text(
                        "${share.percentage.toInt()}% · ${formatZoneTime(share.seconds)}",
                        fontSize = 11.sp,
                        color = Tokens.Muted
                    )
                }
                Spacer(Modifier.height(4.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(5.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(Tokens.Muted.copy(alpha = 0.18f))
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth((share.percentage / 100.0).toFloat().coerceIn(0f, 1f))
                            .height(5.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(Tokens.Accent)
                    )
                }
            }
        }
    }
}

/** FTP history as a line plus the change, with VO2max beside it. */
@Composable
private fun FitnessCard(ftp: List<FtpPoint>, vo2max: Vo2maxEstimate?) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("FITNESS")
            Spacer(Modifier.weight(1f))
            val change = ftpChange(ftp)
            if (change != null) {
                Text(
                    (if (change > 0) "+" else "") + change.toInt() + " W",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Accent
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            ftp.lastOrNull()?.let {
                Column {
                    Text("FTP", fontSize = 10.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        "${it.watts.toInt()} W",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                    Text(shortDate(it.date), fontSize = 11.sp, color = Tokens.Muted)
                }
            }
            vo2max?.let {
                Column {
                    Text("VO2MAX", fontSize = 10.sp, color = Tokens.Muted)
                    Spacer(Modifier.height(3.dp))
                    Text(
                        String.format(Locale.UK, "%.1f", it.value),
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                    Text(it.classification, fontSize = 11.sp, color = Tokens.Muted)
                }
            }
        }
        if (ftp.size >= 2) {
            Spacer(Modifier.height(12.dp))
            FtpLine(ftp.map { it.watts })
        }
    }
}

@Composable
private fun FtpLine(values: List<Double>) {
    val min = values.min()
    val max = values.max()
    val span = (max - min).takeIf { it > 0.0 } ?: 1.0
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(44.dp)
    ) {
        val stepX = size.width / (values.size - 1).coerceAtLeast(1)
        fun y(value: Double) = (size.height - 6f) * (1f - ((value - min) / span).toFloat()) + 3f
        val path = Path()
        values.forEachIndexed { index, value ->
            val x = stepX * index
            val pointY = y(value)
            if (index == 0) path.moveTo(x, pointY) else path.lineTo(x, pointY)
        }
        drawPath(path, color = Tokens.Accent, style = Stroke(2f, cap = StrokeCap.Round))
        drawCircle(
            color = Tokens.Accent,
            radius = 3.5f,
            center = Offset(stepX * values.lastIndex, y(values.last()))
        )
    }
}

@Composable
private fun RideRow(ride: Ride, zone: ZoneId) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                ride.name,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                maxLines = 1
            )
            Spacer(Modifier.height(3.dp))
            Text(
                listOfNotNull(
                    shortDate(Instant.ofEpochMilli(ride.startedAt).atZone(zone).toLocalDate()),
                    ride.averagePower?.let { "avg ${it.toInt()} W" },
                    ride.averageHeartRate?.let { "avg ${it.toInt()} bpm" },
                    ride.tss?.let { "TSS ${it.toInt()}" }
                ).joinToString(" · "),
                fontSize = 12.sp,
                color = Tokens.Muted,
                maxLines = 1
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                formatDistanceKm(ride.distanceKm),
                fontSize = 15.sp,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            Spacer(Modifier.height(3.dp))
            Text(
                formatRideDuration(ride.durationSeconds),
                fontSize = 12.sp,
                color = Tokens.Muted,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
    }
}

private fun shortDate(date: String): String =
    runCatching {
        LocalDate.parse(date).format(DateTimeFormatter.ofPattern("d MMM", Locale.UK))
    }.getOrDefault(date)

private fun shortDate(date: LocalDate): String =
    date.format(DateTimeFormatter.ofPattern("d MMM", Locale.UK))
