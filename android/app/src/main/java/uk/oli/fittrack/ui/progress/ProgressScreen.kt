package uk.oli.fittrack.ui.progress

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.PersonalBest
import uk.oli.fittrack.domain.PersonalRecord
import uk.oli.fittrack.domain.ProgressEngine
import uk.oli.fittrack.domain.recordsByExercise
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.plural
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * What the training has bought you: personal bests, the best set in each rep
 * range, and the estimated-1RM line for one exercise.
 *
 * Computed from the sets the app already holds (see [ProgressEngine]), so it
 * works signed out and on a dead signal — and cannot disagree with the log.
 */
@Composable
fun ProgressScreen(
    history: List<FinishedSession>,
    records: List<PersonalRecord> = emptyList(),
    onAddRecord: (String, Double, Int, String?) -> Unit = { _, _, _, _ -> }
) {
    val bests = remember(history) { ProgressEngine.personalBests(history) }
    if (bests.isEmpty() && records.isEmpty()) {
        Column(Modifier.padding(top = 8.dp)) {
            Text("No progress yet.", fontSize = 15.sp, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                "Finish a session and your best lifts land here.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
        }
        return
    }

    if (bests.isNotEmpty()) {
        ComputedProgress(history, bests)
    }
    RecordsSection(records, onAddRecord)
}

/**
 * The server's records, side by side with the computed ones below. They are
 * kept apart on purpose: a number you typed in and a number the log proves
 * should not look the same.
 */
@Composable
private fun RecordsSection(
    records: List<PersonalRecord>,
    onAddRecord: (String, Double, Int, String?) -> Unit
) {
    var adding by rememberSaveable { mutableStateOf(false) }
    var exercise by rememberSaveable { mutableStateOf("") }
    var weight by rememberSaveable { mutableStateOf("") }
    var reps by rememberSaveable { mutableStateOf("") }
    var note by rememberSaveable { mutableStateOf("") }

    Column(Modifier.padding(top = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("RECORDS")
            Spacer(Modifier.weight(1f))
            Text(
                if (adding) "Cancel" else "+ Add",
                fontSize = 12.sp,
                color = Tokens.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { adding = !adding }
                    .padding(horizontal = 8.dp, vertical = 6.dp)
            )
        }
        Spacer(Modifier.height(6.dp))

        if (records.isEmpty()) {
            Text(
                "Manual records come from the server. Sign in to see and add them.",
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        } else {
            recordsByExercise(records).take(6).forEach { record ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        record.exercise,
                        fontSize = 14.sp,
                        color = Tokens.Fg,
                        modifier = Modifier.weight(1f)
                    )
                    if (record.manual) {
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(Tokens.Accent.copy(alpha = 0.12f))
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        ) {
                            Text("manual", fontSize = 10.sp, color = Tokens.Accent)
                        }
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        "${formatWeight(record.weightKg)} kg × ${record.reps}",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
            }
        }

        if (adding) {
            Spacer(Modifier.height(10.dp))
            RecordField("Exercise", exercise, "record-exercise") { exercise = it }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.weight(1f)) {
                    RecordField("Weight kg", weight, "record-weight") { weight = it }
                }
                Box(Modifier.weight(1f)) {
                    RecordField("Reps", reps, "record-reps") { reps = it }
                }
            }
            Spacer(Modifier.height(6.dp))
            RecordField("Note (optional)", note, "record-note") { note = it }
            Spacer(Modifier.height(8.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(44.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Tokens.Accent)
                    .clickable {
                        val w = weight.replace(',', '.').toDoubleOrNull() ?: 0.0
                        val r = reps.toIntOrNull() ?: 0
                        onAddRecord(exercise, w, r, note)
                        adding = false
                        exercise = ""
                        weight = ""
                        reps = ""
                        note = ""
                    },
                contentAlignment = Alignment.Center
            ) {
                Text(
                    "Save record",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Tokens.Bg
                )
            }
        }
    }
}

@Composable
private fun RecordField(
    label: String,
    value: String,
    tag: String,
    onChange: (String) -> Unit
) {
    androidx.compose.material3.OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag),
        singleLine = true,
        label = { Text(label, fontSize = 12.sp) },
        textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg)
    )
}

@Composable
private fun ComputedProgress(history: List<FinishedSession>, bests: List<PersonalBest>) {
    val exercises = remember(history) { ProgressEngine.exerciseNames(history) }
    var selected by rememberSaveable(history) {
        // Default to the exercise with the longest record, so the chart has
        // something to draw rather than landing on a one-off lift.
        mutableStateOf(exercises.firstOrNull() ?: bests.first().exercise)
    }
    val exercise = if (exercises.contains(selected)) selected
    else exercises.firstOrNull() ?: bests.first().exercise
    val ranges = remember(history, exercise) { ProgressEngine.bestByRepRange(history, exercise) }
    val series = remember(history, exercise) { ProgressEngine.progressSeries(history, exercise) }

    Column {
        Text(
            "From ${plural(history.size, "session")}. Warm-ups never count.",
            fontSize = 12.sp,
            color = Tokens.Muted
        )

        Spacer(Modifier.height(18.dp))
        Label("PERSONAL BESTS")
        Spacer(Modifier.height(6.dp))
        bests.take(6).forEach { best -> BestRow(best) }

        Spacer(Modifier.height(20.dp))
        Label("BY EXERCISE")
        Spacer(Modifier.height(8.dp))
        ExerciseChips(exercises, exercise) { selected = it }

        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("BEST BY REP RANGE")
            Spacer(Modifier.weight(1f))
            Text(exercise, fontSize = 12.sp, color = Tokens.Muted)
        }
        Spacer(Modifier.height(6.dp))
        ranges.forEach { (range, best) -> RangeRow(range.label, best) }

        Spacer(Modifier.height(20.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("ESTIMATED 1RM")
            Spacer(Modifier.weight(1f))
            series.lastOrNull()?.let {
                Text(
                    "${formatWeight(it.second)} kg",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Accent,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        ProgressChart(series)
    }
}

@Composable
private fun BestRow(best: PersonalBest) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(best.exercise, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = Tokens.Fg)
            Spacer(Modifier.height(2.dp))
            Text(shortDate(best.at), fontSize = 12.sp, color = Tokens.Muted)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                "${formatWeight(best.weightKg)} kg × ${best.reps}",
                fontSize = 15.sp,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "e1RM ${formatWeight(best.estimated1rm)}",
                fontSize = 12.sp,
                color = Tokens.Muted,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
    }
}

@Composable
private fun ExerciseChips(
    exercises: List<String>,
    selected: String,
    onSelect: (String) -> Unit
) {
    // Eight exercises is more than fits; the row scrolls rather than truncating
    // to whatever happened to be first.
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        exercises.forEach { name ->
            val isSelected = name == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isSelected) Tokens.Accent.copy(alpha = 0.14f) else Tokens.Surface)
                    .clickable { onSelect(name) }
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Text(
                    name,
                    fontSize = 13.sp,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (isSelected) Tokens.Accent else Tokens.Muted
                )
            }
        }
    }
}

@Composable
private fun RangeRow(label: String, best: PersonalBest?) {
    Row(
        Modifier.fillMaxWidth().height(38.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontSize = 13.sp, color = Tokens.Muted, modifier = Modifier.width(56.dp))
        Text(
            best?.let { "${formatWeight(it.weightKg)} kg × ${it.reps}" } ?: "—",
            fontSize = 14.sp,
            color = if (best == null) Tokens.Muted else Tokens.Fg,
            style = TextStyle(fontFeatureSettings = "tnum")
        )
        Spacer(Modifier.weight(1f))
        if (best != null) {
            Text(
                "e1RM ${formatWeight(best.estimated1rm)}",
                fontSize = 12.sp,
                color = Tokens.Muted,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
    }
}

/**
 * A 120 dp sparkline: enough to see the direction, not enough to lie about it.
 * The axis labels are the actual min and max, so the line is never decorative.
 */
@Composable
private fun ProgressChart(series: List<Pair<Long, Double>>) {
    if (series.size < 2) {
        Text(
            "Two sessions of an exercise and the line appears.",
            fontSize = 12.sp,
            color = Tokens.Muted
        )
        return
    }

    val values = series.map { it.second }
    val max = values.max()
    val min = values.min()
    val span = (max - min).takeIf { it > 0.0 } ?: 1.0

    Column {
        Box(
            Modifier
                .fillMaxWidth()
                .height(120.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Tokens.Surface)
                .padding(horizontal = 14.dp, vertical = 12.dp)
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 2.dp.toPx()
                val pointRadius = 3.dp.toPx()
                val usableWidth = size.width
                val usableHeight = size.height

                // Baseline: the floor of the chart is the lowest session, not zero.
                drawLine(
                    Tokens.SurfaceLight,
                    Offset(0f, usableHeight),
                    Offset(usableWidth, usableHeight),
                    stroke
                )

                val points = values.mapIndexed { index, value ->
                    val x = if (values.size == 1) 0f else usableWidth * index / (values.size - 1).toFloat()
                    val y = usableHeight - ((value - min) / span * (usableHeight - pointRadius * 2)).toFloat() - pointRadius
                    Offset(x, y)
                }

                val path = Path().apply {
                    moveTo(points.first().x, points.first().y)
                    points.drop(1).forEach { lineTo(it.x, it.y) }
                }
                drawPath(path, Tokens.Accent, style = Stroke(width = stroke, cap = StrokeCap.Round))
                points.forEachIndexed { index, point ->
                    val last = index == points.lastIndex
                    drawCircle(
                        if (last) Tokens.Accent else Tokens.Muted,
                        radius = if (last) pointRadius * 1.6f else pointRadius,
                        center = point
                    )
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Row {
            Text(
                "low ${formatWeight(min)} kg",
                fontSize = 12.sp,
                color = Tokens.Muted,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            Spacer(Modifier.weight(1f))
            Text(
                "high ${formatWeight(max)} kg",
                fontSize = 12.sp,
                color = Tokens.Muted,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
    }
}

private fun shortDate(at: Long): String =
    Instant.ofEpochMilli(at).atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.UK))
