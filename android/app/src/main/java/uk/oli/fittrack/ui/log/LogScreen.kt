package uk.oli.fittrack.ui.log

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.HistoryFilter
import uk.oli.fittrack.domain.HistoryQuery
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
 * The website's browser filters on focus, exercise, dates and free text; the
 * same four live here, in a phone-sized shape: a search box always visible, and
 * the chip filters behind one tap so the list keeps the screen.
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

    val now = remember { System.currentTimeMillis() }
    var text by rememberSaveable { mutableStateOf("") }
    var focus by rememberSaveable { mutableStateOf<String?>(null) }
    var exercise by rememberSaveable { mutableStateOf<String?>(null) }
    var days by rememberSaveable { mutableStateOf<Int?>(null) }
    var expanded by rememberSaveable { mutableStateOf(false) }

    val query = HistoryQuery(text = text, focus = focus, exercise = exercise, days = days)
    val filtered = remember(history, text, focus, exercise, days) {
        HistoryFilter.apply(history, query, now)
    }
    val focuses = remember(history) { HistoryFilter.focuses(history) }
    val exercises = remember(history) { HistoryFilter.exercises(history) }

    Column {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Search focus, notes, exercise", fontSize = 14.sp, color = Tokens.Muted) },
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            modifier = Modifier.fillMaxWidth().testTag("log-search")
        )
        Spacer(Modifier.height(10.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            FilterChip("All", days == null) { days = null }
            Spacer(Modifier.width(6.dp))
            FilterChip("30d", days == 30) { days = 30 }
            Spacer(Modifier.width(6.dp))
            FilterChip("90d", days == 90) { days = 90 }
            Spacer(Modifier.width(6.dp))
            FilterChip("1y", days == 365) { days = 365 }
            Spacer(Modifier.weight(1f))
            Text(
                if (query.active == 0) "Filters"
                else "Filters · ${query.active}",
                fontSize = 13.sp,
                fontWeight = if (expanded) FontWeight.SemiBold else FontWeight.Normal,
                color = if (expanded || query.active > 0) Tokens.Accent else Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { expanded = !expanded }
                    .padding(horizontal = 8.dp, vertical = 6.dp)
            )
        }

        if (expanded) {
            Spacer(Modifier.height(10.dp))
            if (focuses.size > 1) {
                ChipRow("FOCUS", focuses, focus) { focus = if (focus == it) null else it }
                Spacer(Modifier.height(8.dp))
            }
            if (exercises.size > 1) {
                ChipRow("EXERCISE", exercises, exercise) { exercise = if (exercise == it) null else it }
            }
        }

        if (query.active > 0) {
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${filtered.size} of ${plural(history.size, "session")}",
                    fontSize = 12.sp,
                    color = Tokens.Muted
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "Clear",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable {
                            text = ""
                            focus = null
                            exercise = null
                            days = null
                        }
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                )
            }
        }

        if (filtered.isEmpty()) {
            Spacer(Modifier.height(18.dp))
            Text("No sessions match.", fontSize = 15.sp, color = Tokens.Fg)
            Spacer(Modifier.height(4.dp))
            Text("Loosen a filter or clear the search.", fontSize = 13.sp, color = Tokens.Muted)
            return@Column
        }

        val zone = ZoneId.systemDefault()
        val weekFields = WeekFields.ISO
        val groups = filtered.groupBy { session ->
            val date = Instant.ofEpochMilli(session.endedAt).atZone(zone).toLocalDate()
            date.get(weekFields.weekBasedYear()) * 100 + date.get(weekFields.weekOfWeekBasedYear())
        }

        groups.forEach { (_, sessions) ->
            val first = sessions.first()
            val weekStart = weekStart(first.endedAt, zone)
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label(weekLabel(weekStart))
                Spacer(Modifier.weight(1f))
                Text(
                    plural(sessions.size, "session"),
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
private fun FilterChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(if (selected) Tokens.Accent.copy(alpha = 0.14f) else Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 7.dp)
    ) {
        Text(
            label,
            fontSize = 12.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) Tokens.Accent else Tokens.Muted
        )
    }
}

@Composable
private fun ChipRow(
    label: String,
    options: List<String>,
    selected: String?,
    onSelect: (String) -> Unit
) {
    Column {
        Label(label)
        Spacer(Modifier.height(6.dp))
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            options.forEach { option ->
                FilterChip(option, option == selected) { onSelect(option) }
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
