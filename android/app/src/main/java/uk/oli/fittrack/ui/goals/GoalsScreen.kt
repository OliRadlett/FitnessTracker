package uk.oli.fittrack.ui.goals

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
import uk.oli.fittrack.domain.Goal
import uk.oli.fittrack.domain.GoalCheckIn
import uk.oli.fittrack.domain.GoalMetric
import uk.oli.fittrack.domain.metricLabel
import uk.oli.fittrack.domain.orderedGoals
import uk.oli.fittrack.domain.statusLabel
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens

/**
 * The goals page: every goal, what it is worth, and the two things you do with
 * one on a phone — check in, or finish it.
 *
 * Creating is here too, because "I want to be 80 kg by Christmas" is a thought
 * you have on the sofa, not at a desk.
 */
@Composable
fun GoalsScreen(
    goals: List<Goal>?,
    metrics: List<GoalMetric>,
    checkIns: Map<String, List<GoalCheckIn>>,
    busy: Boolean,
    message: String?,
    onCreate: (metric: String, target: Double, date: String?, note: String?) -> Unit,
    onCheckIn: (id: String, value: Double, note: String?) -> Unit,
    onStatus: (id: String, status: String) -> Unit,
    onDelete: (id: String) -> Unit,
    onExpand: (id: String) -> Unit,
    onBack: () -> Unit
) {
    var expanded by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }

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
                    .padding(vertical = 6.dp, horizontal = 2.dp)
            )
            Spacer(Modifier.height(6.dp))
            Label("GOALS")
            Spacer(Modifier.height(8.dp))
            Text("Goals.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                "Progress is measured from where you started, not from zero.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(16.dp))

            message?.let {
                Text(it, fontSize = 13.sp, color = Tokens.Accent)
                Spacer(Modifier.height(10.dp))
            }

            when {
                goals == null -> Text("Loading goals…", fontSize = 14.sp, color = Tokens.Muted)
                goals.isEmpty() -> {
                    Text("No goals yet.", fontSize = 15.sp, color = Tokens.Fg)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "A goal is a number with a date on it — bodyweight, FTP, a lift, weekly volume.",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
                else -> orderedGoals(goals).forEach { goal ->
                    GoalCard(
                        goal = goal,
                        open = expanded == goal.id,
                        checkIns = checkIns[goal.id],
                        onCreateCheckIn = { value, note -> onCheckIn(goal.id, value, note) },
                        onToggle = {
                            val next = if (expanded == goal.id) null else goal.id
                            expanded = next
                            next?.let(onExpand)
                        },
                        onStatus = { onStatus(goal.id, it) },
                        onDelete = { onDelete(goal.id) }
                    )
                    Spacer(Modifier.height(12.dp))
                }
            }

            Spacer(Modifier.height(6.dp))
            if (creating) {
                NewGoalForm(
                    metrics = metrics,
                    busy = busy,
                    onCancel = { creating = false },
                    onCreate = { metric, target, date, note ->
                        onCreate(metric, target, date, note)
                        creating = false
                    }
                )
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(Tokens.Surface)
                        .clickable { creating = true }
                        .padding(vertical = 14.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text("+ New goal", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun GoalCard(
    goal: Goal,
    open: Boolean,
    checkIns: List<GoalCheckIn>?,
    onCreateCheckIn: (Double, String?) -> Unit,
    onToggle: () -> Unit,
    onStatus: (String) -> Unit,
    onDelete: () -> Unit
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .clickable { onToggle() }
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                goal.label.ifBlank { metricLabel(goal.metric) },
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                modifier = Modifier.weight(1f)
            )
            if (!goal.isActive) {
                Text(
                    statusLabel(goal.status),
                    fontSize = 11.sp,
                    color = Tokens.Muted,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(Tokens.Muted.copy(alpha = 0.15f))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                )
            } else {
                Text(
                    goal.progressPct?.let { "${it.toInt()}%" } ?: "—",
                    fontSize = 12.sp,
                    color = Tokens.Accent
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(goal.describe(), fontSize = 13.sp, color = Tokens.Muted)
        Spacer(Modifier.height(8.dp))
        GoalBar(goal.progressPct)
        goal.targetDate?.let { date ->
            Spacer(Modifier.height(6.dp))
            Text(
                listOfNotNull(
                    date,
                    goal.daysLeft?.let { days ->
                        when {
                            days > 0 -> "$days days left"
                            days == 0L -> "today"
                            else -> "${-days} days ago"
                        }
                    }
                ).joinToString(" · "),
                fontSize = 11.sp,
                color = Tokens.Muted
            )
        }
        if (open) {
            Spacer(Modifier.height(14.dp))
            CheckInForm(busy = false, onSubmit = onCreateCheckIn)
            Spacer(Modifier.height(10.dp))
            if (checkIns == null) {
                Text("Loading check-ins…", fontSize = 12.sp, color = Tokens.Muted)
            } else if (checkIns.isEmpty()) {
                Text("No check-ins yet.", fontSize = 12.sp, color = Tokens.Muted)
            } else {
                Label("CHECK-INS")
                checkIns.take(5).forEach { entry ->
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(entry.date, fontSize = 12.sp, color = Tokens.Muted)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            goal.format(entry.value),
                            fontSize = 13.sp,
                            color = Tokens.Fg,
                            modifier = Modifier.weight(1f)
                        )
                        Text(entry.source, fontSize = 11.sp, color = Tokens.Muted)
                    }
                    entry.note?.let {
                        Text(it, fontSize = 12.sp, color = Tokens.Muted)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SmallAction("Mark achieved") { onStatus("achieved") }
                SmallAction("Archive") { onStatus("archived") }
                if (!goal.isActive) SmallAction("Reactivate") { onStatus("active") }
                SmallAction("Delete", danger = true) { onDelete() }
            }
        }
    }
}

@Composable
private fun GoalBar(pct: Double?) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(6.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(Tokens.Muted.copy(alpha = 0.18f))
    ) {
        if (pct != null) {
            Box(
                Modifier
                    .fillMaxWidth((pct / 100.0).toFloat().coerceIn(0f, 1f))
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(Tokens.Accent)
            )
        }
    }
}

@Composable
private fun CheckInForm(busy: Boolean, onSubmit: (Double, String?) -> Unit) {
    var value by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    Row(verticalAlignment = Alignment.CenterVertically) {
        Field(value, "Today's value", Modifier.weight(1f), numeric = true) { value = it }
        Spacer(Modifier.width(8.dp))
        SmallAction("Check in") {
            value.toDoubleOrNull()?.let { onSubmit(it, note.ifBlank { null }) }
            value = ""
            note = ""
        }
    }
    Spacer(Modifier.height(6.dp))
    Field(note, "Note (optional)", Modifier.fillMaxWidth(), numeric = false) { note = it }
    if (busy) {
        Spacer(Modifier.height(4.dp))
        Text("Saving…", fontSize = 11.sp, color = Tokens.Muted)
    }
}

@Composable
private fun NewGoalForm(
    metrics: List<GoalMetric>,
    busy: Boolean,
    onCancel: () -> Unit,
    onCreate: (String, Double, String?, String?) -> Unit
) {
    val supported = metrics.filter { it.supported }
    var metric by remember { mutableStateOf(supported.firstOrNull()?.key ?: "weight_kg") }
    var target by remember { mutableStateOf("") }
    var date by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Label("NEW GOAL")
        Spacer(Modifier.height(10.dp))
        if (supported.isNotEmpty()) {
            Column {
                supported.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEach { option ->
                            val selected = option.key == metric
                            Text(
                                option.label,
                                fontSize = 12.sp,
                                color = if (selected) Tokens.Bg else Tokens.Fg,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (selected) Tokens.Accent else Tokens.Bg)
                                    .clickable { metric = option.key }
                                    .padding(horizontal = 10.dp, vertical = 6.dp)
                            )
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                }
            }
            Spacer(Modifier.height(4.dp))
        }
        Field(target, "Target", Modifier.fillMaxWidth(), numeric = true) { target = it }
        Spacer(Modifier.height(6.dp))
        Field(date, "Target date (YYYY-MM-DD, optional)", Modifier.fillMaxWidth(), numeric = false) { date = it }
        Spacer(Modifier.height(6.dp))
        Field(note, "Note (optional)", Modifier.fillMaxWidth(), numeric = false) { note = it }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SmallAction(if (busy) "Saving…" else "Create") {
                val value = target.toDoubleOrNull()
                if (value != null) {
                    onCreate(metric, value, date.ifBlank { null }, note.ifBlank { null })
                }
            }
            SmallAction("Cancel") { onCancel() }
        }
    }
}

@Composable
private fun SmallAction(label: String, danger: Boolean = false, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
        color = if (danger) Tokens.Muted else Tokens.Accent,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 6.dp)
    )
}

@Composable
private fun Field(
    value: String,
    hint: String,
    modifier: Modifier = Modifier,
    numeric: Boolean,
    onChange: (String) -> Unit
) {
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Bg)
            .padding(horizontal = 10.dp, vertical = 10.dp)
    ) {
        if (value.isEmpty()) {
            Text(hint, fontSize = 13.sp, color = Tokens.Muted)
        }
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(fontSize = 14.sp, color = Tokens.Fg),
            cursorBrush = SolidColor(Tokens.Accent),
            keyboardOptions = KeyboardOptions(
                keyboardType = if (numeric) KeyboardType.Decimal else KeyboardType.Text
            ),
            modifier = Modifier.fillMaxWidth()
        )
    }
}
