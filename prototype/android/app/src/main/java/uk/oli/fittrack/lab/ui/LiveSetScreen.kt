package uk.oli.fittrack.lab.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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

/**
 * Frame 2 of the flow: the set-entry instrument.
 *
 * Fixture: 3 Nov 2026 Bench Press session, set 2 of 4 at 90 kg x 4 @7 — the
 * real last set from the golden fixture. Prefill is the interaction thesis:
 * the number is already right, so logging is one tap.
 *
 * Layout note: weight, reps and RPE all sit in the bottom half, because the
 * hand is on the phone while the phone is on the floor next to a bench.
 */
@Composable
fun LiveSetScreen(resting: Boolean = false) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Header(resting)
            Spacer(Modifier.height(18.dp))
            if (resting) RestCard() else LastSetCard()
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                MetricStepper("WEIGHT", "kg", "90", Modifier.weight(1f))
                MetricStepper("REPS", "reps", "4", Modifier.weight(1f))
            }
            Spacer(Modifier.height(20.dp))
            ThisSession(resting)
            AddNote()
            Spacer(Modifier.weight(1f))
            RpeRow()
            Spacer(Modifier.height(18.dp))
        }
        BottomAction { LogButton(if (resting) "Log set 4" else "Log set") }
    }
}

@Composable
private fun Label(text: String) {
    Text(
        text = text,
        fontSize = Tokens.LabelSize.sp,
        letterSpacing = Tokens.LabelTracking.sp,
        fontWeight = FontWeight.Medium,
        color = Tokens.Muted
    )
}

private val Tabular = TextStyle(fontFeatureSettings = "tnum")

@Composable
private fun Chevron() {
    Canvas(Modifier.size(24.dp)) {
        val stroke = 2.2.dp.toPx()
        val w = size.width
        val h = size.height
        drawLine(
            Tokens.Fg,
            Offset(w * 0.62f, h * 0.20f),
            Offset(w * 0.34f, h * 0.50f),
            stroke,
            StrokeCap.Round
        )
        drawLine(
            Tokens.Fg,
            Offset(w * 0.34f, h * 0.50f),
            Offset(w * 0.62f, h * 0.80f),
            stroke,
            StrokeCap.Round
        )
    }
}

@Composable
private fun Header(resting: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(48.dp),
            contentAlignment = Alignment.Center
        ) { Chevron() }
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "Bench Press",
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(2.dp))
            Text(
                if (resting) "Push day · set 4 of 4" else "Push day · set 3 of 4",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
        }
        Text("42:18", fontSize = 13.sp, color = Tokens.Muted, style = Tabular)
    }
}

@Composable
private fun LastSetCard() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Label("LAST SET")
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "90 kg × 4",
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Fg,
                    style = Tabular
                )
                Spacer(Modifier.width(8.dp))
                Text("RPE 7", fontSize = 13.sp, color = Tokens.Accent)
            }
        }
        Text("4 min ago", fontSize = 13.sp, color = Tokens.Muted)
    }
}

/**
 * Rest replaces the last-set card in place. The set list, steppers, RPE and
 * primary action all stay exactly where they were — the timer must not cost you
 * the screen you were using.
 */
@Composable
private fun RestCard() {
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
                "1:42",
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
                    .fillMaxWidth(0.32f)
                    .fillMaxHeight()
                    .background(Tokens.Accent)
            )
        }
        Spacer(Modifier.height(10.dp))
        Row {
            Text("Next · set 4", fontSize = 13.sp, color = Tokens.Muted)
            Spacer(Modifier.width(6.dp))
            Text("90 × 4", fontSize = 13.sp, color = Tokens.Fg, style = Tabular)
        }
    }
}

@Composable
private fun MetricStepper(
    label: String,
    unit: String,
    value: String,
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
            Text(
                value,
                fontSize = 60.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                style = Tabular
            )
            Spacer(Modifier.width(6.dp))
            Text(
                unit,
                fontSize = 13.sp,
                color = Tokens.Muted,
                modifier = Modifier.padding(bottom = 12.dp)
            )
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StepButton("−", Modifier.weight(1f))
            StepButton("+", Modifier.weight(1f))
        }
    }
}

@Composable
private fun StepButton(glyph: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(58.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(Tokens.SurfaceLight),
        contentAlignment = Alignment.Center
    ) {
        Text(glyph, fontSize = 26.sp, color = Tokens.Fg)
    }
}

@Composable
private fun RpeRow() {
    Column {
        Label("RPE")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("6", "7", "8", "9", "10").forEach { rpe ->
                val selected = rpe == "7"
                Box(
                    Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (selected) Tokens.Accent.copy(alpha = 0.12f) else Tokens.Surface)
                        .then(
                            if (selected) {
                                Modifier.border(1.5.dp, Tokens.Accent, RoundedCornerShape(14.dp))
                            } else {
                                Modifier
                            }
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        rpe,
                        fontSize = 15.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (selected) Tokens.Accent else Tokens.Muted
                    )
                }
            }
        }
    }
}

/**
 * All four planned sets, not just the ones already done. "Two down, two to go"
 * is the state a lifter is in; the plan supplies the pending rows, so nothing
 * here is invented.
 */
@Composable
private fun ThisSession(resting: Boolean) {
    Column {
        Label("THIS SESSION")
        Spacer(Modifier.height(4.dp))
        SessionRow("Set 1", "90 × 4", "@7", done = true, current = false)
        SessionRow("Set 2", "90 × 4", "@7", done = true, current = false)
        SessionRow(
            "Set 3", "90 × 4",
            if (resting) "@7" else null,
            done = resting, current = !resting
        )
        SessionRow("Set 4", "90 × 4", null, done = false, current = resting)
    }
}

@Composable
private fun SessionRow(
    index: String,
    load: String,
    rpe: String?,
    done: Boolean,
    current: Boolean
) {
    val loadColor = when {
        done -> Tokens.Fg
        current -> Tokens.Fg
        else -> Tokens.Muted
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.width(4.dp).height(20.dp).clip(RoundedCornerShape(2.dp))
            .background(if (current) Tokens.Accent else Tokens.Bg))
        Spacer(Modifier.width(12.dp))
        Text(
            index,
            fontSize = 14.sp,
            color = if (current) Tokens.Fg else Tokens.Muted,
            modifier = Modifier.width(60.dp)
        )
        Text(load, fontSize = 15.sp, color = loadColor, style = Tabular)
        Spacer(Modifier.weight(1f))
        if (rpe != null) Text(rpe, fontSize = 13.sp, color = Tokens.Muted)
        if (done) {
            Spacer(Modifier.width(10.dp))
            Text("✓", fontSize = 14.sp, color = Tokens.Accent)
        }
    }
}

@Composable
private fun AddNote() {
    Row(
        Modifier.height(48.dp).fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("+", fontSize = 15.sp, color = Tokens.Muted)
        Spacer(Modifier.width(10.dp))
        Text("Add note", fontSize = 14.sp, color = Tokens.Muted)
    }
}

@Composable
private fun LogButton(label: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(72.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(Tokens.Accent)
            .testTag("primary"),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
        Spacer(Modifier.width(10.dp))
        Text("✓", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
    }
}
