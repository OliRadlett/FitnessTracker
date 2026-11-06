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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.ExerciseSets
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.HistoryEngine
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.LinkedActivity
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.domain.humaniseLabel
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
 * Everything the website can change here is changeable too: a set's numbers,
 * the session's date/focus/note, a missing set and a missing exercise — and a
 * set or the session can be deleted.
 */
@Composable
fun SessionDetailScreen(
    session: FinishedSession,
    onBack: () -> Unit,
    onEditSet: (Int, SetEdit) -> Unit = { _, _ -> },
    onDeleteSet: (Int) -> Unit = {},
    onDeleteSession: () -> Unit = {},
    onEditSession: (Long, String?, String?) -> Unit = { _, _, _ -> },
    onAddSets: (String, List<SetEdit>) -> Unit = { _, _ -> },
    linkCandidates: List<LinkedActivity> = emptyList(),
    onLoadLinkable: () -> Unit = {},
    onLinkActivity: (LinkedActivity?) -> Unit = {},
    onCancelLink: () -> Unit = {},
    canRepeat: Boolean = true,
    onRepeat: () -> Unit = {}
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
    var editingSession by remember(session.id) { mutableStateOf(false) }
    var addingTo by remember(session.id) { mutableStateOf<String?>(null) }
    var addingExercise by remember(session.id) { mutableStateOf(false) }

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
                "Edit",
                fontSize = 13.sp,
                color = Tokens.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable {
                        editingSession = !editingSession
                        editing = null
                        addingExercise = false
                    }
                    .padding(horizontal = 10.dp, vertical = 10.dp)
            )
            Text(
                "Delete",
                fontSize = 13.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { confirmingDelete = true }
                    .padding(horizontal = 8.dp, vertical = 10.dp)
            )
        }

        if (editingSession) {
            SessionEditor(
                session = session,
                onSave = { days, focus, note ->
                    onEditSession(days, focus, note)
                    editingSession = false
                },
                onCancel = { editingSession = false }
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

            val labels = session.labels
            val linked = session.linkedActivity
            if (labels != null) {
                item {
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        labels.split?.let { LabelChip(humaniseLabel(it)) }
                        labels.lift?.let { LabelChip(humaniseLabel(it)) }
                        labels.klass?.let { LabelChip(humaniseLabel(it)) }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }

            // Linking stands on its own: a session with no labels and no link is
            // exactly the one that needs the button.
            item {
                Spacer(Modifier.height(12.dp))
                if (linked != null) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(Tokens.Surface)
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Label("STRAVA")
                            Spacer(Modifier.width(10.dp))
                            Text(
                                linked.name,
                                fontSize = 14.sp,
                                color = Tokens.Fg,
                                modifier = Modifier.weight(1f)
                            )
                            linked.durationSeconds?.let {
                                Text(formatDuration(it * 1000L), fontSize = 12.sp, color = Tokens.Muted)
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "Unlink",
                                fontSize = 12.sp,
                                color = Tokens.Muted,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onLinkActivity(null) }
                                    .padding(horizontal = 8.dp, vertical = 6.dp)
                            )
                        }
                    } else if (linkCandidates.isEmpty()) {
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .clip(RoundedCornerShape(14.dp))
                                .background(Tokens.Surface)
                                .clickable { onLoadLinkable() },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                "Link a Strava activity",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                color = Tokens.Accent
                            )
                        }
                    } else {
                        Column {
                            Label("LINK AN ACTIVITY")
                            Spacer(Modifier.height(4.dp))
                            linkCandidates.forEach { candidate ->
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .clickable { onLinkActivity(candidate) }
                                        .padding(vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        candidate.name,
                                        fontSize = 14.sp,
                                        color = Tokens.Fg,
                                        modifier = Modifier.weight(1f)
                                    )
                                    candidate.durationSeconds?.let {
                                        Text(formatDuration(it * 1000L), fontSize = 12.sp, color = Tokens.Muted)
                                    }
                                }
                            }
                            Text(
                                "Cancel",
                                fontSize = 12.sp,
                                color = Tokens.Muted,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable { onCancelLink() }
                                    .padding(horizontal = 8.dp, vertical = 6.dp)
                            )
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
                    ExerciseHeader(
                        group = group,
                        onAddSet = {
                            editing = null
                            addingExercise = false
                            addingTo = if (addingTo == group.exercise) null else group.exercise
                        }
                    )
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
                if (addingTo == group.exercise) {
                    item(key = "add-${group.exercise}") {
                        val template = group.workingSets.lastOrNull()
                            ?: group.sets.lastOrNull()
                            ?: LoggedSet(group.exercise, 20.0, 5)
                        SetEditor(
                            set = template,
                            title = "Add set",
                            saveLabel = "Add",
                            onSave = { edit ->
                                onAddSets(group.exercise, listOf(edit))
                                addingTo = null
                            },
                            onDelete = null,
                            onCancel = { addingTo = null }
                        )
                    }
                }
            }

            item {
                Spacer(Modifier.height(22.dp))
                if (addingExercise) {
                    AddExerciseForm(
                        onAdd = { name, specs ->
                            onAddSets(name, specs)
                            addingExercise = false
                        },
                        onCancel = { addingExercise = false }
                    )
                } else {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .background(Tokens.Surface)
                            .clickable {
                                addingTo = null
                                editing = null
                                addingExercise = true
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            "+ Add exercise",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            color = Tokens.Accent
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))
                // Repeating is the commonest next action after looking at a
                // session, so it gets the strongest button on the screen.
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(if (canRepeat) Tokens.Accent else Tokens.Surface)
                        .clickable(enabled = canRepeat) { onRepeat() },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        if (canRepeat) "Repeat this session" else "Finish the session in progress first",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (canRepeat) Tokens.OnAccent else Tokens.Muted
                    )
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
private fun ExerciseHeader(group: ExerciseSets, onAddSet: () -> Unit) {
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
            // A forgotten set is the commonest thing to fix, so it is one tap
            // from the exercise it belongs to.
            Text(
                "+ Set",
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { onAddSet() }
                    .padding(start = 10.dp, top = 10.dp, bottom = 10.dp)
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

/** A classifier label, read-only: the server decides these, the phone shows them. */
@Composable
private fun LabelChip(text: String) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Accent.copy(alpha = 0.12f))
            .padding(horizontal = 10.dp, vertical = 5.dp)
    ) {
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
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
    title: String = "Edit set",
    saveLabel: String = "Save",
    onSave: (SetEdit) -> Unit,
    onDelete: (() -> Unit)? = null,
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label(title.uppercase(Locale.UK))
            Spacer(Modifier.weight(1f))
            if (set.exercise.isNotBlank()) {
                Text(set.exercise, fontSize = 12.sp, color = Tokens.Muted)
            }
        }
        Spacer(Modifier.height(10.dp))
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
        val options = listOf<Double?>(null, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0)
        options.chunked(5).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { option ->
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
            Spacer(Modifier.height(6.dp))
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
            if (onDelete != null) {
                Text(
                    "Delete set",
                    fontSize = 13.sp,
                    color = Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { confirmDelete = true }
                        .padding(horizontal = 8.dp, vertical = 8.dp)
                )
            }
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
                Text(saveLabel, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
            }
        }

        if (confirmDelete && onDelete != null) {
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
private fun SessionEditor(
    session: FinishedSession,
    onSave: (Long, String?, String?) -> Unit,
    onCancel: () -> Unit
) {
    val zone = ZoneId.systemDefault()
    var focus by remember(session.id) { mutableStateOf(session.planTitle) }
    var note by remember(session.id) { mutableStateOf(session.note.orEmpty()) }
    var days by remember(session.id) { mutableStateOf(0L) }

    val moved = HistoryEngine.shifted(session, days, zone)
    val dateLabel = Instant.ofEpochMilli(moved.startedAt).atZone(zone)
        .format(DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.UK))

    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 6.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(14.dp)
    ) {
        Label("EDIT SESSION")
        Spacer(Modifier.height(10.dp))

        Label("DATE")
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            StepButton("−", { days -= 1 }, Modifier.width(56.dp))
            Text(
                dateLabel,
                fontSize = 14.sp,
                color = Tokens.Fg,
                textAlign = TextAlign.Center,
                modifier = Modifier.weight(1f)
            )
            StepButton("+", { days += 1 }, Modifier.width(56.dp))
        }
        if (days != 0L) {
            Spacer(Modifier.height(4.dp))
            Text(
                if (days > 0) "Moving $days day${if (days == 1L) "" else "s"} later"
                else "Moving ${-days} day${if (days == -1L) "" else "s"} earlier",
                fontSize = 12.sp,
                color = Tokens.Muted
            )
        }

        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = focus,
            onValueChange = { focus = it },
            placeholder = { Text("Focus", fontSize = 14.sp, color = Tokens.Muted) },
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            modifier = Modifier.fillMaxWidth().testTag("focus-field")
        )
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            placeholder = { Text("Notes", fontSize = 14.sp, color = Tokens.Muted) },
            minLines = 2,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            modifier = Modifier.fillMaxWidth().testTag("note-field")
        )

        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
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
                    .clickable { onSave(days, focus, note) }
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            ) {
                Text("Save", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
            }
        }
    }
}

@Composable
private fun AddExerciseForm(
    onAdd: (String, List<SetEdit>) -> Unit,
    onCancel: () -> Unit
) {
    var name by remember { mutableStateOf("") }
    var sets by remember { mutableIntStateOf(3) }
    var weight by remember { mutableFloatStateOf(20f) }
    var reps by remember { mutableIntStateOf(8) }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(14.dp)
    ) {
        Label("ADD EXERCISE")
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            placeholder = { Text("Exercise name", fontSize = 14.sp, color = Tokens.Muted) },
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            modifier = Modifier.fillMaxWidth().testTag("exercise-name")
        )
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StepField(
                label = "SETS",
                value = sets.toString(),
                unit = "",
                onMinus = { sets = (sets - 1).coerceAtLeast(1) },
                onPlus = { sets = (sets + 1).coerceAtMost(10) },
                modifier = Modifier.weight(1f)
            )
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (name.isBlank()) {
                Text("Name the exercise first.", fontSize = 12.sp, color = Tokens.Muted)
            }
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
                    .background(if (name.isBlank()) Tokens.SurfaceLight else Tokens.Accent)
                    .clickable(enabled = name.isNotBlank()) {
                        onAdd(
                            name.trim(),
                            List(sets) {
                                SetEdit(
                                    weight_kg = weight.toDouble(),
                                    reps = reps,
                                    rpe = null,
                                    is_warmup = false,
                                    is_amrap = false,
                                    notes = null
                                )
                            }
                        )
                    }
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            ) {
                Text(
                    "Add",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (name.isBlank()) Tokens.Muted else Tokens.OnAccent
                )
            }
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
