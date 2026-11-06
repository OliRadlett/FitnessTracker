package uk.oli.fittrack.ui.done

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.domain.SessionState
import uk.oli.fittrack.ui.BottomAction
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.formatDuration
import uk.oli.fittrack.ui.formatRpe
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The summary, computed from what was actually logged — not from the plan and
 * not from a constant. If the numbers here are wrong, the session was wrong.
 *
 * The finish is also where the session's own RPE and note are captured, as the
 * website's finish sheet does: they describe the hour, not any single set.
 */
@Composable
fun DoneScreen(
    session: SessionState,
    previous: FinishedSession?,
    records: List<uk.oli.fittrack.domain.PersonalBest> = emptyList(),
    onDone: (note: String?, rpeSession: Double?) -> Unit
) {
    val volume = SessionEngine.volumeKg(session.sets)
    val lastAt = session.sets.maxOfOrNull { it.at } ?: session.startedAt
    val duration = lastAt - session.startedAt
    val topSet = SessionEngine.workingSets(session.sets).maxByOrNull { it.weightKg }

    var rpe by remember { mutableStateOf<Double?>(null) }
    var note by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
        ) {
            Spacer(Modifier.height(18.dp))
            Label(session.plan.title.uppercase())
            Spacer(Modifier.height(10.dp))
            Text("Session done.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
        Spacer(Modifier.height(20.dp))

        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Tokens.Surface)
                .padding(20.dp)
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    formatWeight(volume.toFloat()),
                    fontSize = 54.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
                Spacer(Modifier.width(8.dp))
                Text("kg lifted", fontSize = 14.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 12.dp))
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                MiniStat("SETS", session.doneSets.toString())
                MiniStat("TIME", formatDuration(duration))
                MiniStat(
                    "TOP SET",
                    topSet?.let { "${formatWeight(it.weightKg)} × ${it.reps}" } ?: "—"
                )
            }
        }

        if (previous != null) {
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Previous", fontSize = 13.sp, color = Tokens.Muted)
                Spacer(Modifier.width(8.dp))
                Text(
                    "${formatWeight(previous.volumeKg.toFloat())} kg",
                    fontSize = 13.sp,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
                Spacer(Modifier.weight(1f))
                Text(shortDate(previous.endedAt), fontSize = 13.sp, color = Tokens.Muted)
            }
        }

        if (records.isNotEmpty()) {
            Spacer(Modifier.height(24.dp))
            Label(if (records.size == 1) "NEW RECORD" else "NEW RECORDS")
            Spacer(Modifier.height(8.dp))
            records.forEach { record ->
                Row(
                    Modifier.fillMaxWidth().height(40.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        record.exercise,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = Tokens.Accent,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        "${formatWeight(record.weightKg)} kg × ${record.reps}",
                        fontSize = 13.sp,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                }
            }
        }

        Spacer(Modifier.height(24.dp))
        Label("BY EXERCISE")
        Spacer(Modifier.height(8.dp))
        SessionEngine.volumeByExercise(session.sets).forEach { (name, kg) ->
            Row(
                Modifier.fillMaxWidth().height(44.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(name, fontSize = 14.sp, color = Tokens.Fg, modifier = Modifier.weight(1f))
                Text(
                    "${formatWeight(kg.toFloat())} kg",
                    fontSize = 13.sp,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }

        Spacer(Modifier.height(22.dp))
        Label("HOW DID IT FEEL?")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            // Rough whole-number effort for the session. "—" is a real answer.
            (listOf(null) + listOf(6.0, 7.0, 8.0, 9.0, 10.0)).forEach { option ->
                val selected = option == rpe
                Box(
                    Modifier
                        .weight(1f)
                        .height(42.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (selected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
                        .then(
                            if (selected) Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(12.dp))
                            else Modifier
                        )
                        .clickable { rpe = option },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        option?.let { formatRpe(it) } ?: "—",
                        fontSize = 14.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (selected) Tokens.Accent else Tokens.Muted
                    )
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            placeholder = { Text("Session note", fontSize = 14.sp, color = Tokens.Muted) },
            minLines = 2,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            modifier = Modifier.fillMaxWidth().testTag("session-note")
        )
        Spacer(Modifier.height(20.dp))
    }

        BottomAction {
            PrimaryButton("Done", onClick = { onDone(note.ifBlank { null }, rpe) })
        }
    }
}

@Composable
private fun MiniStat(label: String, value: String) {
    Column {
        Text(
            label,
            fontSize = 12.sp,
            letterSpacing = 0.7.sp,
            fontWeight = FontWeight.Medium,
            color = Tokens.Muted
        )
        Spacer(Modifier.height(3.dp))
        Text(value, fontSize = 17.sp, color = Tokens.Fg, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}

private fun shortDate(at: Long): String =
    Instant.ofEpochMilli(at)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("d MMM", Locale.UK))
