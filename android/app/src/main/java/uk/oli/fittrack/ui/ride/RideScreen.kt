package uk.oli.fittrack.ui.ride

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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.Ride
import uk.oli.fittrack.domain.formatDistanceKm
import uk.oli.fittrack.domain.formatRideDuration
import uk.oli.fittrack.domain.formatWindowDuration
import uk.oli.fittrack.domain.ridesInWindow
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The cycling side: what you rode, and what it cost.
 *
 * Read-only on purpose — a ride comes from Strava/Komoot, and the phone is not
 * the place it gets edited. The numbers are computed from the rides on screen,
 * so the summary cannot disagree with the list under it.
 */
@Composable
fun RideScreen(
    rides: List<Ride>?,
    onRefresh: () -> Unit,
    onTab: (NavKind) -> Unit
) {
    val today = remember { LocalDate.now() }
    val zone = remember { ZoneId.systemDefault() }
    val week = remember(rides, today) { ridesInWindow(rides.orEmpty(), today, 7, zone) }

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
                Spacer(Modifier.height(20.dp))
            } else {
                WeekCard(
                    count = week.count,
                    distanceKm = week.distanceKm,
                    durationSeconds = week.durationSeconds,
                    tss = week.tss,
                    hasTss = week.hasTss
                )
                Spacer(Modifier.height(22.dp))
                Label("RECENT RIDES")
                Spacer(Modifier.height(8.dp))
                rides.take(12).forEach { ride -> RideRow(ride, zone) }
                Spacer(Modifier.height(20.dp))
            }
        }
        BottomNav(NavKind.Ride, onTab)
    }
}

@Composable
private fun WeekCard(
    count: Int,
    distanceKm: Double,
    durationSeconds: Int,
    tss: Double,
    hasTss: Boolean
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Tokens.Surface)
            .padding(18.dp)
    ) {
        Label("LAST 7 DAYS")
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                formatDistanceKm(distanceKm),
                fontSize = 34.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
            Number("RIDES", count.toString())
            Number("TIME", formatWindowDuration(durationSeconds))
            if (hasTss) Number("TSS", tss.toInt().toString())
        }
    }
}

@Composable
private fun Number(label: String, value: String) {
    Column {
        Text(label, fontSize = 10.sp, letterSpacing = 0.8.sp, color = Tokens.Muted)
        Spacer(Modifier.height(3.dp))
        Text(
            value,
            fontSize = 15.sp,
            color = Tokens.Fg,
            style = TextStyle(fontFeatureSettings = "tnum")
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
                    shortDate(ride.startedAt, zone),
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

private fun shortDate(at: Long, zone: ZoneId): String =
    Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
        .format(DateTimeFormatter.ofPattern("d MMM", Locale.UK))
