package uk.oli.fittrack.ui.live

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.PlanExercise
import uk.oli.fittrack.domain.PlateMath
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.domain.SessionState
import uk.oli.fittrack.domain.SetEntry
import uk.oli.fittrack.domain.WarmupTemplate
import uk.oli.fittrack.ui.BottomAction
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.formatRemaining
import uk.oli.fittrack.ui.formatRpe
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.plural
import uk.oli.fittrack.ui.theme.Tokens

private val Tabular = TextStyle(fontFeatureSettings = "tnum")

/**
 * The instrument. Weight, reps and RPE all sit in the bottom half, because the
 * hand is on the phone while the phone is on the floor next to a bench.
 *
 * Every field is prefilled from the set you just did, so logging a repeat set is
 * one tap and no keyboard.
 */
@Composable
fun LiveScreen(
    session: SessionState,
    restUntil: Long?,
    now: Long,
    history: List<FinishedSession>,
    warmupTemplates: List<WarmupTemplate> = emptyList(),
    onApplyWarmup: (WarmupTemplate) -> Unit = {},
    onDeleteWarmup: (WarmupTemplate) -> Unit = {},
    onSaveWarmups: () -> Unit = {},
    onLog: (SetEntry) -> Unit,
    onUndo: () -> Unit,
    onAdjustRest: (Int) -> Unit,
    onBack: () -> Unit,
    onFinish: () -> Unit
) {
    val exercise = SessionEngine.currentExercise(session)
    if (exercise == null) {
        CompletedScreen(session, onFinish)
        return
    }

    val resting = restUntil != null && restUntil > now
    val remaining = if (resting) (restUntil ?: now) - now else 0L
    val setNumber = SessionEngine.setNumber(session, exercise)
    val prefill = SessionEngine.prefill(session, exercise, history)

    var weight by remember(exercise.name, setNumber) { mutableFloatStateOf(prefill.weightKg.toFloat()) }
    var reps by remember(exercise.name, setNumber) { mutableIntStateOf(prefill.reps) }
    var rpe by remember(exercise.name, setNumber) { mutableStateOf<Double?>(prefill.rpe.toDouble()) }
    // A ramp-up is usually several sets in a row, so the toggle survives a log;
    // it resets when the exercise does.
    var warmup by remember(exercise.name) { mutableStateOf(false) }
    var amrap by remember(exercise.name) { mutableStateOf(false) }
    // RPE is collapsed by default, as it is on the website: most sets do not
    // need one, and the instrument has a 360 × 804 dp budget.
    var rpeOpen by remember(exercise.name) { mutableStateOf(false) }
    var warmupOpen by remember(session.id) { mutableStateOf(false) }
    // Which bar is on the rack. A calculator that assumes 20 kg is wrong half
    // the time in a gym with a 15 kg women's bar.
    var barKg by remember(session.id) { mutableFloatStateOf(PlateMath.DEFAULT_BAR_KG.toFloat()) }
    val plates = PlateMath.loadout(weight.toDouble(), barKg.toDouble())

    // The VM only ticks while resting; the session clock has to run all the time.
    var clock by remember { mutableLongStateOf(session.startedAt) }
    LaunchedEffect(session.id, session.sets.size) {
        while (true) {
            clock = System.currentTimeMillis()
            delay(1000)
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(top = 14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier.size(48.dp).clip(RoundedCornerShape(12.dp)).clickable { onBack() },
                    contentAlignment = Alignment.Center
                ) { Chevron() }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        exercise.name,
                        fontSize = 22.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Tokens.Fg
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "${session.plan.title} · set $setNumber of ${exercise.sets}" +
                            " · ${formatRemaining(clock - session.startedAt)}",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
                // You do not always complete the plan. Without this, the only way
                // out of a session is to log all sixteen sets.
                Text(
                    "Finish",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Accent,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onFinish() }
                        .padding(horizontal = 12.dp, vertical = 10.dp)
                )
            }

            Spacer(Modifier.height(18.dp))
            if (resting) {
                RestCard(remaining, session.restSeconds, onAdjustRest)
            } else {
                LastSetCard(session, exercise)
            }
            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricStepper(
                    label = "WEIGHT",
                    unit = "kg",
                    value = formatWeight(weight),
                    onMinus = { weight = (weight - 2.5f).coerceAtLeast(0f) },
                    onPlus = { weight += 2.5f },
                    caption = {
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "bar ${formatWeight(barKg)} ▾",
                                    fontSize = 12.sp,
                                    color = Tokens.Muted,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .clickable {
                                            barKg = if (barKg == PlateMath.DEFAULT_BAR_KG.toFloat()) {
                                                PlateMath.LIGHT_BAR_KG.toFloat()
                                            } else {
                                                PlateMath.DEFAULT_BAR_KG.toFloat()
                                            }
                                        }
                                        .padding(vertical = 2.dp)
                                )
                            }
                            Text(
                                plates.describe(),
                                fontSize = 12.sp,
                                color = if (plates.shortfallKg > 0.0) Tokens.Muted else Tokens.Fg
                            )
                        }
                    },
                    modifier = Modifier.weight(1f)
                )
                MetricStepper(
                    label = "REPS",
                    unit = "reps",
                    value = reps.toString(),
                    onMinus = { reps = (reps - 1).coerceAtLeast(1) },
                    onPlus = { reps += 1 },
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(Modifier.height(20.dp))
            SetRows(
                session = session,
                exercise = exercise,
                setNumber = setNumber,
                templates = if (warmupOpen) warmupTemplates else emptyList(),
                hasTemplates = warmupTemplates.isNotEmpty(),
                warmupOpen = warmupOpen,
                onToggleWarmups = { warmupOpen = !warmupOpen },
                onApplyWarmup = {
                    onApplyWarmup(it)
                    warmupOpen = false
                },
                onDeleteWarmup = onDeleteWarmup,
                onSaveWarmups = onSaveWarmups,
                onUndo = onUndo
            )
            Spacer(Modifier.weight(1f))
            SetFlags(
                warmup = warmup,
                amrap = amrap,
                rpe = rpe,
                rpeOpen = rpeOpen,
                onWarmup = { warmup = !warmup },
                onAmrap = { amrap = !amrap },
                onRpeToggle = { rpeOpen = !rpeOpen }
            )
            if (rpeOpen) {
                Spacer(Modifier.height(8.dp))
                RpeRow(rpe) {
                    rpe = it
                    rpeOpen = false
                }
            }
            Spacer(Modifier.height(14.dp))
        }

        BottomAction {
            PrimaryButton(
                when {
                    warmup -> "Log warm-up"
                    resting -> "Log set $setNumber"
                    else -> "Log set"
                },
                onClick = { onLog(SetEntry(weight.toDouble(), reps, rpe, warmup, amrap)) }
            )
        }
    }
}

/** Warm-up and AMRAP are set properties, not afterthoughts: flag them as you log. */
@Composable
private fun SetFlags(
    warmup: Boolean,
    amrap: Boolean,
    rpe: Double?,
    rpeOpen: Boolean,
    onWarmup: () -> Unit,
    onAmrap: () -> Unit,
    onRpeToggle: () -> Unit
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        FlagChip("Warm-up", warmup, onWarmup)
        Spacer(Modifier.width(8.dp))
        FlagChip("AMRAP", amrap, onAmrap)
        Spacer(Modifier.weight(1f))
        // Collapsed by default, as on the website; tapping opens the grid.
        Text(
            "RPE ${formatRpe(rpe)}",
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            color = if (rpeOpen) Tokens.Accent else Tokens.Fg,
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(Tokens.Surface)
                .testTag("rpe-pill")
                .clickable { onRpeToggle() }
                .padding(horizontal = 12.dp, vertical = 11.dp)
        )
    }
    if (warmup) {
        Spacer(Modifier.height(4.dp))
        Text("warm-up · does not count", fontSize = 12.sp, color = Tokens.Muted)
    }
}

@Composable
private fun FlagChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .height(40.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
            .then(
                if (selected) Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(12.dp))
                else Modifier
            )
            .clickable { onClick() }
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text,
            fontSize = 13.sp,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) Tokens.Accent else Tokens.Muted
        )
    }
}

@Composable
private fun CompletedScreen(session: SessionState, onFinish: () -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(24.dp))
            Text("Session complete.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(8.dp))
            Text(
                "${plural(session.doneSets, "set")} · ${formatWeight(SessionEngine.volumeKg(session.sets).toFloat())} kg",
                fontSize = 15.sp,
                color = Tokens.Muted
            )
        }
        BottomAction { PrimaryButton("View summary", onFinish) }
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

@Composable
private fun LastSetCard(session: SessionState, exercise: PlanExercise) {
    // The card is the reference for the next *working* set, so a ramp-up never
    // becomes the thing the instrument is quoting back at you.
    val last = session.sets.lastOrNull { it.exercise == exercise.name && !it.isWarmup }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Label(if (last == null) "PLANNED" else "LAST SET")
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${formatWeight(last?.weightKg ?: exercise.weightKg)} kg × ${last?.reps ?: exercise.reps}",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Fg,
                    style = Tabular
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "RPE ${formatRpe(last?.rpe ?: SessionEngine.DEFAULT_RPE.toDouble())}",
                    fontSize = 13.sp,
                    color = Tokens.Accent
                )
            }
        }
        if (last != null) {
            Text("just now", fontSize = 13.sp, color = Tokens.Muted)
        }
    }
}

@Composable
private fun RestCard(remaining: Long, targetSeconds: Int, onAdjust: (Int) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("RESTING")
            Spacer(Modifier.weight(1f))
            Text(
                formatRemaining(remaining),
                fontSize = 22.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Accent,
                style = Tabular
            )
        }
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(Tokens.SurfaceLight)
        ) {
            Box(
                Modifier
                    .fillMaxWidth((remaining / (targetSeconds * 1000f)).coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .background(Tokens.Accent)
            )
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "target ${formatRemaining(targetSeconds * 1000L)}",
                fontSize = 12.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.weight(1f))
            RestAdjust("−30s") { onAdjust(-30) }
            Spacer(Modifier.width(8.dp))
            RestAdjust("+30s") { onAdjust(30) }
        }
        Spacer(Modifier.height(8.dp))
        Text("Rest is a suggestion — log early if you're ready.", fontSize = 12.sp, color = Tokens.Muted)
    }
}

/** Adjusting rest mid-rest is the whole point; the target belongs where the clock is. */
@Composable
private fun RestAdjust(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .height(34.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.SurfaceLight)
            .clickable { onClick() }
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Tokens.Fg)
    }
}

@Composable
private fun MetricStepper(
    label: String,
    unit: String,
    value: String,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
    caption: (@Composable () -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label(label)
        Spacer(Modifier.height(2.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, fontSize = 60.sp, fontWeight = FontWeight.Medium, color = Tokens.Fg, style = Tabular)
            Spacer(Modifier.width(6.dp))
            Text(unit, fontSize = 13.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 12.dp))
        }
        if (caption != null) {
            Spacer(Modifier.height(4.dp))
            caption()
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StepButton("−", onMinus, Modifier.weight(1f))
            StepButton("+", onPlus, Modifier.weight(1f))
        }
    }
}

@Composable
private fun StepButton(glyph: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(58.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(Tokens.SurfaceLight)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text(glyph, fontSize = 26.sp, color = Tokens.Fg)
    }
}

@Composable
private fun SetRows(
    session: SessionState,
    exercise: PlanExercise,
    setNumber: Int,
    templates: List<WarmupTemplate>,
    hasTemplates: Boolean,
    warmupOpen: Boolean,
    onToggleWarmups: () -> Unit,
    onApplyWarmup: (WarmupTemplate) -> Unit,
    onDeleteWarmup: (WarmupTemplate) -> Unit,
    onSaveWarmups: () -> Unit,
    onUndo: () -> Unit
) {
    // Done rows must show what was actually logged, not what the plan asked for.
    // Warm-ups get their own muted rows: they are real sets, but the plan's
    // numbering belongs to working sets alone.
    val logged = session.sets.filter { it.exercise == exercise.name }
    val warmups = logged.filter { it.isWarmup }
    val working = logged.filterNot { it.isWarmup }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("THIS EXERCISE")
            Spacer(Modifier.weight(1f))
            // A saved ramp is one tap, and it lands as flagged warm-ups rather
            // than as sets the plan has to count.
            if (hasTemplates) {
                Text(
                    "Warm-ups",
                    fontSize = 13.sp,
                    color = if (warmupOpen) Tokens.Accent else Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onToggleWarmups() }
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                )
            }
            // A fat-finger at the gym must be recoverable, not permanent.
            if (session.sets.isNotEmpty()) {
                Text(
                    "Undo",
                    fontSize = 13.sp,
                    color = Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { onUndo() }
                        .padding(horizontal = 8.dp, vertical = 6.dp)
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        if (warmupOpen) {
            // "Save these…" sits at the TOP of the expanded list: with four
            // warm-ups already logged the list is taller than the space above
            // the action deck, and the save action at the bottom was invisible
            // on a 360x804 phone (found on device).
            val logged = session.sets.count {
                it.isWarmup && it.exercise.trim() == exercise.name.trim()
            }
            if (logged > 0) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onSaveWarmups() }
                        .padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "Save these $logged warm-ups as a template",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium,
                        color = Tokens.Accent,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
            templates.forEach { template ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onApplyWarmup(template) }
                        .padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(template.name, fontSize = 14.sp, color = Tokens.Fg, modifier = Modifier.weight(1f))
                    Text(
                        "${template.steps.size} steps · " +
                            "${formatWeight(template.steps.first().weightKg)}–" +
                            "${formatWeight(template.steps.last().weightKg)} kg",
                        fontSize = 12.sp,
                        color = Tokens.Muted
                    )
                    Spacer(Modifier.width(6.dp))
                    // Delete is a small target on purpose: applying is the
                    // common action, removing a template is the rare one.
                    Text(
                        "×",
                        fontSize = 16.sp,
                        color = Tokens.Muted,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable { onDeleteWarmup(template) }
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }
            Spacer(Modifier.height(4.dp))
        }
        warmups.forEachIndexed { index, set ->
            Row(
                Modifier.fillMaxWidth().height(34.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(Modifier.width(4.dp).height(16.dp))
                Spacer(Modifier.width(12.dp))
                Text(
                    "W${index + 1}",
                    fontSize = 13.sp,
                    color = Tokens.Muted,
                    modifier = Modifier.width(60.dp)
                )
                Text(
                    "${formatWeight(set.weightKg)} × ${set.reps}",
                    fontSize = 14.sp,
                    color = Tokens.Muted,
                    style = Tabular
                )
                Spacer(Modifier.weight(1f))
                Text("warm-up", fontSize = 12.sp, color = Tokens.Muted)
            }
        }
        for (i in 1..exercise.sets) {
            val record = working.getOrNull(i - 1)
            val done = record != null
            val current = i == setNumber
            Row(
                Modifier.fillMaxWidth().height(48.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(4.dp)
                        .height(20.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (current) Tokens.Accent else Tokens.Bg)
                )
                Spacer(Modifier.width(12.dp))
                Text(
                    "Set $i",
                    fontSize = 14.sp,
                    color = if (current) Tokens.Fg else Tokens.Muted,
                    modifier = Modifier.width(60.dp)
                )
                Text(
                    if (record != null) {
                        "${formatWeight(record.weightKg)} × ${record.reps}"
                    } else {
                        "${formatWeight(exercise.weightKg)} × ${exercise.reps}"
                    },
                    fontSize = 15.sp,
                    color = if (done || current) Tokens.Fg else Tokens.Muted,
                    style = Tabular
                )
                Spacer(Modifier.weight(1f))
                if (record?.isAmrap == true) {
                    Text("AMRAP", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
                    Spacer(Modifier.width(6.dp))
                }
                if (done) Text("✓", fontSize = 14.sp, color = Tokens.Accent)
            }
        }
    }
}

@Composable
private fun RpeRow(selected: Double?, onSelect: (Double?) -> Unit) {
    // Half points matter: "8.5" is a real answer, and the website can log it.
    // Two rows of five fit where ten chips in one row do not.
    val options = listOf<Double?>(null, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0)
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("RPE")
            Spacer(Modifier.weight(1f))
            Text("optional · half points", fontSize = 12.sp, color = Tokens.Muted)
        }
        Spacer(Modifier.height(8.dp))
        options.chunked(5).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { value ->
                    val isSelected = value == selected
                    Box(
                        Modifier
                            .weight(1f)
                            .height(44.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (isSelected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
                            .then(
                                if (isSelected) Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(12.dp))
                                else Modifier
                            )
                            .clickable { onSelect(value) },
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            value?.let { formatRpe(it) } ?: "—",
                            fontSize = 14.sp,
                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (isSelected) Tokens.Accent else Tokens.Muted
                        )
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
        }
    }
}
