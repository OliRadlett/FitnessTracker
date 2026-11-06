package uk.oli.fittrack.ui.log

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.plural
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.WeekFields
import java.util.Locale

/**
 * The log: everything you have finished, newest first, grouped by week.
 *
 * Read-only on purpose. Editing history is a different feature with different
 * consequences (PRs, records), and it should not arrive by accident.
 */
@Composable
fun LogScreen(
    history: List<FinishedSession>,
    onOpen: (String) -> Unit
) {
    if (history.isEmpty()) {
        Column(Modifier.padding(top = 8.dp)) {
            Text("No sessions yet.", fontSize = 15.sp, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                "Finish a session and it lands here.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
        }
        return
    }

    val zone = ZoneId.systemDefault()
    val weekFields = WeekFields.ISO
    val groups = history.groupBy { session ->
        val date = Instant.ofEpochMilli(session.endedAt).atZone(zone).toLocalDate()
        date.get(weekFields.weekBasedYear()) * 100 + date.get(weekFields.weekOfWeekBasedYear())
    }

    Column {
        groups.forEach { (_, sessions) ->
            val first = sessions.first()
            val weekStart = weekStart(first.endedAt, zone)
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label(weekLabel(weekStart))
                Spacer(Modifier.weight(1f))
                Text(
                    "${sessions.size} session${if (sessions.size == 1) "" else "s"}",
                    fontSize = 12.sp,
                    color = Tokens.Muted
                )
            }
            Spacer(Modifier.height(4.dp))
            sessions.forEach { session ->
                SessionRow(session, zone) { onOpen(session.id) }
            }
        }
    }
}

@Composable
private fun SessionRow(session: FinishedSession, zone: ZoneId, onClick: () -> Unit) {
    val date = Instant.ofEpochMilli(session.endedAt).atZone(zone).toLocalDate()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.width(52.dp)) {
            Text(
                date.format(DateTimeFormatter.ofPattern("EEE", Locale.UK)).uppercase(Locale.UK),
                fontSize = 12.sp,
                letterSpacing = 0.6.sp,
                color = Tokens.Muted
            )
            Text(
                date.dayOfMonth.toString(),
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(session.planTitle, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Tokens.Fg)
            Spacer(Modifier.height(3.dp))
            Text(
                "${plural(SessionEngine.workingSets(session.sets).size, "set")}" +
                    " · ${formatWeight(session.volumeKg.toFloat())} kg",
                fontSize = 13.sp,
                color = Tokens.Muted,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
        Text("›", fontSize = 20.sp, color = Tokens.Muted)
    }
}

private fun weekStart(millis: Long, zone: ZoneId): LocalDate {
    val date = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
    return date.minusDays((date.dayOfWeek.value - 1).toLong())
}

private fun weekLabel(start: LocalDate): String {
    val end = start.plusDays(6)
    val fmt = DateTimeFormatter.ofPattern("d MMM", Locale.UK)
    return "${start.format(fmt)} – ${end.format(fmt)}".uppercase(Locale.UK)
}

/** Kept for the divider style used between week groups. */
@Composable
private fun WeekRule() {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.SurfaceLight))
}
