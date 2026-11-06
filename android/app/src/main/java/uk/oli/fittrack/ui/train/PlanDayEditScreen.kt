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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.PlanExercise
import uk.oli.fittrack.net.PlanDaySummary
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Editing one planned day — the one writing surface the phone gets.
 *
 * The website's plan editor is a desk tool; this is the sentence you actually
 * change on a phone ("legs moved to Friday", "bench is 3×5 at 90 today"). It
 * writes the whole day through one PATCH, so a half-saved day cannot exist.
 */
@Composable
fun PlanDayEditScreen(
    day: PlanDaySummary?,
    busy: Boolean,
    error: String?,
    onSave: (sport: String, focus: String, notes: String?, exercises: List<PlanExercise>) -> Unit,
    onBack: () -> Unit
) {
    if (day == null) {
        Box(Modifier.fillMaxSize().background(Tokens.Bg), contentAlignment = Alignment.Center) {
            Text("Nothing to edit.", fontSize = 14.sp, color = Tokens.Muted)
        }
        return
    }

    var sport by remember(day.id) { mutableStateOf(day.sport) }
    var focus by remember(day.id) { mutableStateOf(day.focus.orEmpty()) }
    var notes by remember(day.id) { mutableStateOf(day.notes.orEmpty()) }
    val rows = remember(day.id) {
        mutableStateListOf<PlanExercise>().apply { addAll(day.exercises) }
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
            Label("PLAN DAY")
            Spacer(Modifier.height(8.dp))
            Text(
                formatDay(day.date),
                fontSize = 28.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(16.dp))

            error?.let {
                Text(it, fontSize = 13.sp, color = Tokens.Accent)
                Spacer(Modifier.height(10.dp))
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("strength", "rest").forEach { option ->
                    val selected = sport == option
                    Text(
                        if (option == "strength") "Strength" else "Rest",
                        fontSize = 12.sp,
                        color = if (selected) Tokens.Bg else Tokens.Fg,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) Tokens.Accent else Tokens.Surface)
                            .clickable { sport = option }
                            .padding(horizontal = 12.dp, vertical = 7.dp)
                    )
                }
            }
            Spacer(Modifier.height(14.dp))

            Field(focus, "Focus (e.g. Push day)") { focus = it }
            Spacer(Modifier.height(16.dp))

            if (sport == "strength") {
                Label("EXERCISES")
                Spacer(Modifier.height(8.dp))
                rows.forEachIndexed { index, exercise ->
                    ExerciseRow(
                        exercise = exercise,
                        onChange = { rows[index] = it },
                        onRemove = { rows.removeAt(index) }
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Tokens.Surface)
                        .clickable {
                            rows.add(PlanExercise(name = "", sets = 3, reps = 5, weightKg = 0.0))
                        }
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("+ Add exercise", fontSize = 13.sp, color = Tokens.Accent)
                }
                Spacer(Modifier.height(16.dp))
            }

            Field(notes, "Notes (optional)") { notes = it }
            Spacer(Modifier.height(20.dp))

            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(if (busy) Tokens.Surface else Tokens.Accent)
                    .clickable(enabled = !busy) {
                        val cleaned = rows
                            .map { it.copy(name = it.name.trim()) }
                            .filter { it.name.isNotEmpty() && it.sets > 0 && it.reps > 0 }
                        onSave(sport, focus.trim(), notes.trim().ifBlank { null }, cleaned)
                    }
                    .padding(vertical = 15.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    if (busy) "Saving…" else "Save day",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (busy) Tokens.Muted else Tokens.Bg
                )
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ExerciseRow(
    exercise: PlanExercise,
    onChange: (PlanExercise) -> Unit,
    onRemove: () -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.Surface)
            .padding(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Field(
                exercise.name,
                "Exercise",
                Modifier.weight(1f)
            ) { onChange(exercise.copy(name = it)) }
            Spacer(Modifier.width(8.dp))
            Text(
                "×",
                fontSize = 16.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { onRemove() }
                    .padding(horizontal = 8.dp, vertical = 2.dp)
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NumberField(exercise.sets.toString(), "Sets", Modifier.weight(1f)) {
                onChange(exercise.copy(sets = it.toIntOrNull() ?: exercise.sets))
            }
            NumberField(exercise.reps.toString(), "Reps", Modifier.weight(1f)) {
                onChange(exercise.copy(reps = it.toIntOrNull() ?: exercise.reps))
            }
            NumberField(
                if (exercise.weightKg > 0.0) formatKg(exercise.weightKg) else "",
                "kg",
                Modifier.weight(1f)
            ) {
                onChange(exercise.copy(weightKg = it.toDoubleOrNull() ?: 0.0))
            }
        }
    }
}

@Composable
private fun Field(
    value: String,
    hint: String,
    modifier: Modifier = Modifier,
    onChange: (String) -> Unit
) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Bg)
            .padding(horizontal = 10.dp, vertical = 10.dp)
    ) {
        if (value.isEmpty()) Text(hint, fontSize = 13.sp, color = Tokens.Muted)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            cursorBrush = SolidColor(Tokens.Accent),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun NumberField(
    value: String,
    hint: String,
    modifier: Modifier = Modifier,
    onChange: (String) -> Unit
) {
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Bg)
            .padding(horizontal = 10.dp, vertical = 9.dp)
    ) {
        if (value.isEmpty()) Text(hint, fontSize = 12.sp, color = Tokens.Muted)
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            cursorBrush = SolidColor(Tokens.Accent),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

private fun formatKg(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString()
    else String.format(Locale.UK, "%.1f", value)

private fun formatDay(date: String): String = runCatching {
    LocalDate.parse(date).format(DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.UK))
}.getOrDefault(date)
