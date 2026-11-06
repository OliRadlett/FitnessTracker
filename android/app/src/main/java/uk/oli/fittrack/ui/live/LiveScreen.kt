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
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.PlanExercise
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.domain.SessionState
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
    onLog: (Double, Int, Int) -> Unit,
    onUndo: () -> Unit,
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
    var rpe by remember(exercise.name, setNumber) { mutableIntStateOf(prefill.rpe) }

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
            if (resting) RestCard(remaining) else LastSetCard(session, exercise)
            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricStepper(
                    label = "WEIGHT",
                    unit = "kg",
                    value = formatWeight(weight),
                    onMinus = { weight = (weight - 2.5f).coerceAtLeast(0f) },
                    onPlus = { weight += 2.5f },
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
            SetRows(session, exercise, setNumber, onUndo)
            Spacer(Modifier.weight(1f))
            RpeRow(rpe) { rpe = it }
            Spacer(Modifier.height(18.dp))
        }

        BottomAction {
            PrimaryButton(
                if (resting) "Log set $setNumber" else "Log set",
                onClick = { onLog(weight.toDouble(), reps, rpe) }
            )
        }
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
    val last = session.sets.lastOrNull { it.exercise == exercise.name }
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
private fun RestCard(remaining: Long) {
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
                    .fillMaxWidth((remaining / 150_000f).coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .background(Tokens.Accent)
            )
        }
        Spacer(Modifier.height(10.dp))
        Text("Rest is a suggestion — log early if you're ready.", fontSize = 13.sp, color = Tokens.Muted)
    }
}

@Composable
private fun MetricStepper(
    label: String,
    unit: String,
    value: String,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
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
    onUndo: () -> Unit
) {
    // Done rows must show what was actually logged, not what the plan asked for.
    val logged = session.sets.filter { it.exercise == exercise.name }
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("THIS EXERCISE")
            Spacer(Modifier.weight(1f))
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
        for (i in 1..exercise.sets) {
            val record = logged.getOrNull(i - 1)
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
                if (done) Text("✓", fontSize = 14.sp, color = Tokens.Accent)
            }
        }
    }
}

@Composable
private fun RpeRow(selected: Int, onSelect: (Int) -> Unit) {
    Column {
        Label("RPE")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(6, 7, 8, 9, 10).forEach { value ->
                val isSelected = value == selected
                Box(
                    Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (isSelected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
                        .then(
                            if (isSelected) Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(14.dp))
                            else Modifier
                        )
                        .clickable { onSelect(value) },
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        value.toString(),
                        fontSize = 15.sp,
                        fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (isSelected) Tokens.Accent else Tokens.Muted
                    )
                }
            }
        }
    }
}
