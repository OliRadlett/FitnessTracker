package uk.oli.fittrack.ui.log

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.ExerciseSets
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.net.SetEdit
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.formatDuration
import uk.oli.fittrack.ui.formatRpe
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.plural
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * One finished session, in the same shape the website shows it: every set,
 * warm-ups included, grouped by exercise, with notes and the session's own RPE.
 *
 * Read-only for now — editing lands with the write path — but the data is the
 * whole session rather than a summary of it, because a session you cannot
 * inspect is a session you cannot trust.
 */
@Composable
fun SessionDetailScreen(
    session: FinishedSession,
    onBack: () -> Unit,
    onEditSet: (Int, SetEdit) -> Unit = { _, _ -> },
    onDeleteSet: (Int) -> Unit = {},
    onDeleteSession: () -> Unit = {}
) {
    val zone = ZoneId.systemDefault()
    val start = Instant.ofEpochMilli(session.startedAt).atZone(zone)
    val working = SessionEngine.workingSets(session.sets)
    val warmups = session.sets.size - working.size
    val topSet = working.maxByOrNull { it.weightKg }
    val groups = SessionEngine.groupedByExercise(session.sets)

    // The index into `session.sets` of the row being edited, or null. Editing an
    // already-logged set is a couch job, so it is inline rather than a sheet.
    var editing by remember(session.id) { mutableStateOf<Int?>(null) }
    var confirmingDelete by remember(session.id) { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = 12.dp, end = 20.dp, top = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).clickable { onBack() },
                contentAlignment = Alignment.Center
            ) { Chevron() }
            Spacer(Modifier.width(4.dp))
            Column(Modifier.weight(1f)) {
                Text(session.planTitle, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
                Spacer(Modifier.height(2.dp))
                Text(
                    start.format(DateTimeFormatter.ofPattern("EEE d MMM yyyy · HH:mm", Locale.UK)) +
                        " · " + formatDuration(session.endedAt - session.startedAt),
                    fontSize = 13.sp,
                    color = Tokens.Muted
                )
            }
            Text(
                "Delete",
                fontSize = 13.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { confirmingDelete = true }
                    .padding(horizontal = 10.dp, vertical = 10.dp)
            )
        }

        if (confirmingDelete) {
            ConfirmRow(
                question = "Delete this session? It goes from the website too.",
                confirm = "Delete",
                onConfirm = {
                    confirmingDelete = false
                    onDeleteSession()
                },
                onCancel = { confirmingDelete = false }
            )
        }

        LazyColumn(
            Modifier.weight(1f).padding(horizontal = 20.dp),
            contentPadding = PaddingValues(top = 18.dp, bottom = 28.dp)
        ) {
            item {
                HeroCard(
                    volumeKg = session.volumeKg,
                    workingSets = working.size,
                    warmupSets = warmups,
                    durationMillis = session.endedAt - session.startedAt,
                    topSet = topSet,
                    rpeSession = session.rpeSession
                )
            }

            val note = session.note
            if (note != null) {
                item {
                    Spacer(Modifier.height(12.dp))
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(Tokens.Surface)
                            .padding(16.dp)
                    ) {
                        Label("NOTES")
                        Spacer(Modifier.height(6.dp))
                        Text(note, fontSize = 14.sp, color = Tokens.Fg)
                    }
                }
            }

            item {
                Spacer(Modifier.height(22.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Label("EXERCISES")
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${plural(groups.size, "exercise")} · ${plural(session.sets.size, "set")}",
                        fontSize = 12.sp,
                        color = Tokens.Muted
                    )
                }
                Spacer(Modifier.height(2.dp))
                Text("Tap a set to edit it.", fontSize = 12.sp, color = Tokens.Muted)
            }

            var offset = 0
            groups.forEach { group ->
                val start = offset
                offset += group.sets.size
                item(key = "header-${group.exercise}") {
                    ExerciseHeader(group)
                }
                itemsIndexed(group.sets) { index, set ->
                    val global = start + index
                    Column {
                        SetRow(
                            set = set,
                            number = index + 1,
                            onClick = { editing = if (editing == global) null else global }
                        )
                        if (editing == global) {
                            SetEditor(
                                set = set,
                                onSave = { edit ->
                                    onEditSet(global, edit)
                                    editing = null
                                },
                                onDelete = {
                                    onDeleteSet(global)
                                    editing = null
                                },
                                onCancel = { editing = null }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroCard(
    volumeKg: Double,
    workingSets: Int,
    warmupSets: Int,
    durationMillis: Long,
    topSet: LoggedSet?,
    rpeSession: Double?
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Tokens.Surface)
            .padding(20.dp)
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                formatWeight(volumeKg),
                fontSize = 46.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "kg lifted",
                fontSize = 14.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(bottom = 10.dp)
            )
        }
        Text(
            if (warmupSets > 0) "${plural(workingSets, "working set")} · ${plural(warmupSets, "warm-up")}"
            else plural(workingSets, "working set"),
            fontSize = 13.sp,
            color = Tokens.Muted
        )
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            MiniStat("TIME", formatDuration(durationMillis))
            MiniStat("TOP SET", topSet?.let { "${formatWeight(it.weightKg)} × ${it.reps}" } ?: "—")
            MiniStat("RPE", formatRpe(rpeSession))
        }
    }
}

@Composable
private fun ExerciseHeader(group: ExerciseSets) {
    val warmups = group.sets.size - group.workingSets.size
    Column {
        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                group.exercise,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg,
                modifier = Modifier.weight(1f)
            )
            Text(
                if (warmups > 0) "${plural(group.workingSets.size, "set")} + ${plural(warmups, "warm-up")}"
                else plural(group.sets.size, "set"),
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        }
        Spacer(Modifier.height(2.dp))
        Text(
            "${formatWeight(group.volumeKg)} kg",
            fontSize = 12.sp,
            color = Tokens.Muted,
            style = TextStyle(fontFeatureSettings = "tnum")
        )
        Spacer(Modifier.height(6.dp))
    }
}

@Composable
private fun SetRow(set: LoggedSet, number: Int, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .clickable { onClick() }
            .alpha(if (set.isWarmup) 0.6f else 1f)
            .padding(vertical = 7.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                number.toString(),
                fontSize = 12.sp,
                color = Tokens.Muted,
                textAlign = TextAlign.Center,
                modifier = Modifier.width(20.dp),
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "${formatWeight(set.weightKg)} kg × ${set.reps}",
                fontSize = 15.sp,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
            Spacer(Modifier.width(8.dp))
            if (set.isWarmup) Badge("W", Tokens.Muted)
            if (set.isAmrap) {
                if (set.isWarmup) Spacer(Modifier.width(4.dp))
                Badge("AMRAP", Tokens.Accent)
            }
            Spacer(Modifier.weight(1f))
            Text(
                "RPE ${formatRpe(set.rpe)}",
                fontSize = 13.sp,
                color = if (set.rpe == null) Tokens.Muted else Tokens.Accent,
                style = TextStyle(fontFeatureSettings = "tnum")
            )
        }
        val note = set.note
        if (note != null) {
            Text(
                note,
                fontSize = 12.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(start = 30.dp, top = 3.dp)
            )
        }
    }
}

@Composable
private fun Badge(text: String, color: androidx.compose.ui.graphics.Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(5.dp))
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    ) {
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = color)
    }
}

@Composable
private fun SetEditor(
    set: LoggedSet,
    onSave: (SetEdit) -> Unit,
    onDelete: () -> Unit,
    onCancel: () -> Unit
) {
    var weight by remember(set) { mutableFloatStateOf(set.weightKg.toFloat()) }
    var reps by remember(set) { mutableIntStateOf(set.reps) }
    var rpe by remember(set) { mutableStateOf(set.rpe) }
    var warmup by remember(set) { mutableStateOf(set.isWarmup) }
    var amrap by remember(set) { mutableStateOf(set.isAmrap) }
    var note by remember(set) { mutableStateOf(set.note.orEmpty()) }
    var confirmDelete by remember(set) { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 10.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.SurfaceLight)
            .padding(14.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StepField(
                label = "WEIGHT",
                value = formatWeight(weight),
                unit = "kg",
                onMinus = { weight = (weight - 2.5f).coerceAtLeast(0f) },
                onPlus = { weight += 2.5f },
                modifier = Modifier.weight(1f)
            )
            StepField(
                label = "REPS",
                value = reps.toString(),
                unit = "",
                onMinus = { reps = (reps - 1).coerceAtLeast(1) },
                onPlus = { reps += 1 },
                modifier = Modifier.weight(1f)
            )
        }

        Spacer(Modifier.height(12.dp))
        Label("RPE")
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            // A half-point RPE pulled from the website is preserved untouched;
            // the chips offer whole numbers plus "none", which is what the app
            // itself can log.
            (listOf(null) + listOf(6.0, 7.0, 8.0, 9.0, 10.0)).forEach { option ->
                val selected = option == rpe
                Box(
                    Modifier
                        .weight(1f)
                        .height(40.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (selected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
                        .then(
                            if (selected) Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(10.dp))
                            else Modifier
                        )
                        .clickable { rpe = option },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        option?.let { formatRpe(it) } ?: "—",
                        fontSize = 13.sp,
                        color = if (selected) Tokens.Accent else Tokens.Muted
                    )
                }
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ToggleChip("Warm-up", warmup) { warmup = !warmup }
            ToggleChip("AMRAP", amrap) { amrap = !amrap }
            Spacer(Modifier.weight(1f))
        }

        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            placeholder = { Text("Note", fontSize = 14.sp, color = Tokens.Muted) },
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Delete set",
                fontSize = 13.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { confirmDelete = true }
                    .padding(horizontal = 8.dp, vertical = 8.dp)
            )
            Spacer(Modifier.weight(1f))
            Text(
                "Cancel",
                fontSize = 13.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onCancel() }
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            )
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Tokens.Accent)
                    .clickable {
                        onSave(
                            SetEdit(
                                weight_kg = weight.toDouble(),
                                reps = reps,
                                rpe = rpe,
                                is_warmup = warmup,
                                is_amrap = amrap,
                                notes = note.ifBlank { null }
                            )
                        )
                    }
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            ) {
                Text("Save", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
            }
        }

        if (confirmDelete) {
            Spacer(Modifier.height(8.dp))
            ConfirmRow(
                question = "Delete this set?",
                confirm = "Delete",
                onConfirm = onDelete,
                onCancel = { confirmDelete = false }
            )
        }
    }
}

@Composable
private fun StepField(
    label: String,
    value: String,
    unit: String,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Surface)
            .padding(10.dp)
    ) {
        Label(label)
        Spacer(Modifier.height(2.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, fontSize = 26.sp, fontWeight = FontWeight.Medium, color = Tokens.Fg)
            if (unit.isNotBlank()) {
                Spacer(Modifier.width(4.dp))
                Text(unit, fontSize = 12.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 5.dp))
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StepButton("−", onMinus, Modifier.weight(1f))
            StepButton("+", onPlus, Modifier.weight(1f))
        }
    }
}

@Composable
private fun StepButton(glyph: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(38.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.SurfaceLight)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text(glyph, fontSize = 20.sp, color = Tokens.Fg)
    }
}

@Composable
private fun ToggleChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
            .then(
                if (selected) Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(10.dp))
                else Modifier
            )
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 9.dp)
    ) {
        Text(
            text,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) Tokens.Accent else Tokens.Muted
        )
    }
}

/** An inline yes/no for destructive actions: no dialog window, so it renders in a screenshot. */
@Composable
private fun ConfirmRow(
    question: String,
    confirm: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(question, fontSize = 13.sp, color = Tokens.Fg, modifier = Modifier.weight(1f))
        Text(
            "Cancel",
            fontSize = 13.sp,
            color = Tokens.Muted,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable { onCancel() }
                .padding(horizontal = 8.dp, vertical = 6.dp)
        )
        Spacer(Modifier.width(4.dp))
        Text(
            confirm,
            fontSize = 13.sp,
            fontWeight = FontWeight.SemiBold,
            color = Tokens.Accent,
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable { onConfirm() }
                .padding(horizontal = 8.dp, vertical = 6.dp)
        )
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

@Composable
private fun Chevron() {
    Canvas(Modifier.size(24.dp)) {
        val stroke = 2.2.dp.toPx()
        drawLine(Tokens.Fg, Offset(size.width * 0.62f, size.height * 0.20f), Offset(size.width * 0.34f, size.height * 0.50f), stroke, StrokeCap.Round)
        drawLine(Tokens.Fg, Offset(size.width * 0.34f, size.height * 0.50f), Offset(size.width * 0.62f, size.height * 0.80f), stroke, StrokeCap.Round)
    }
}
