package uk.oli.fittrack.ui.plan

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.Plan
import uk.oli.fittrack.domain.PlanExercise
import uk.oli.fittrack.ui.BottomAction
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.SecondaryButton
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.theme.Tokens

/**
 * Edit today's plan on the phone.
 *
 * This exists because the app prescribed the same seeded session every day. It
 * is deliberately a *quick* editor — change sets, reps, load, remove an
 * exercise, add one — not the web's full plan builder.
 */
@Composable
fun PlanEditorScreen(
    plan: Plan,
    onSave: (Plan) -> Unit,
    onCancel: () -> Unit
) {
    var draft by remember(plan) { mutableStateOf(plan) }
    var selected by remember { mutableIntStateOf(0) }
    var adding by remember { mutableStateOf(false) }
    var newName by remember { mutableStateOf("") }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .statusBarsPadding()
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Cancel",
                fontSize = 14.sp,
                color = Tokens.Muted,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { onCancel() }
                    .padding(horizontal = 8.dp, vertical = 10.dp)
            )
            Spacer(Modifier.weight(1f))
            Text("Edit plan", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.weight(1f))
            Text(
                "Save",
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Accent,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { onSave(draft.copy(exercises = draft.exercises.ifEmpty { plan.exercises })) }
                    .padding(horizontal = 8.dp, vertical = 10.dp)
            )
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp)
        ) {
            Label("${draft.exercises.size} EXERCISES · ${draft.totalSets} SETS")
            Spacer(Modifier.height(10.dp))

            draft.exercises.forEachIndexed { index, exercise ->
                val isSelected = index == selected
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 10.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(Tokens.Surface)
                        .clickable { selected = index }
                        .padding(14.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            exercise.name,
                            fontSize = 15.sp,
                            fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal,
                            color = Tokens.Fg,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            "${exercise.sets} × ${exercise.reps} @ ${formatWeight(exercise.weightKg)} kg",
                            fontSize = 13.sp,
                            color = Tokens.Muted,
                            style = TextStyle(fontFeatureSettings = "tnum")
                        )
                    }

                    if (isSelected) {
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MiniStepper(
                                "SETS", exercise.sets.toString(),
                                onMinus = { draft = draft.replace(index, exercise.copy(sets = (exercise.sets - 1).coerceAtLeast(1))) },
                                onPlus = { draft = draft.replace(index, exercise.copy(sets = (exercise.sets + 1).coerceAtMost(10))) },
                                modifier = Modifier.weight(1f)
                            )
                            MiniStepper(
                                "REPS", exercise.reps.toString(),
                                onMinus = { draft = draft.replace(index, exercise.copy(reps = (exercise.reps - 1).coerceAtLeast(1))) },
                                onPlus = { draft = draft.replace(index, exercise.copy(reps = (exercise.reps + 1).coerceAtMost(30))) },
                                modifier = Modifier.weight(1f)
                            )
                            MiniStepper(
                                "KG", formatWeight(exercise.weightKg),
                                onMinus = { draft = draft.replace(index, exercise.copy(weightKg = (exercise.weightKg - 2.5).coerceAtLeast(0.0))) },
                                onPlus = { draft = draft.replace(index, exercise.copy(weightKg = exercise.weightKg + 2.5)) },
                                modifier = Modifier.weight(1f)
                            )
                        }
                        Spacer(Modifier.height(10.dp))
                        Text(
                            "Remove exercise",
                            fontSize = 13.sp,
                            color = Tokens.Muted,
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .clickable {
                                    draft = draft.copy(exercises = draft.exercises.filterIndexed { i, _ -> i != index })
                                    selected = (selected - 1).coerceAtLeast(0)
                                }
                                .padding(vertical = 8.dp)
                        )
                    }
                }
            }

            if (adding) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(Tokens.Surface)
                        .padding(14.dp)
                ) {
                    Label("NEW EXERCISE")
                    Spacer(Modifier.height(8.dp))
                    BasicTextField(
                        value = newName,
                        onValueChange = { newName = it },
                        singleLine = true,
                        textStyle = TextStyle(color = Tokens.Fg, fontSize = 16.sp),
                        cursorBrush = SolidColor(Tokens.Accent),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(6.dp))
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.SurfaceLight))
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.weight(1f)) {
                            SecondaryButton("Cancel") {
                                adding = false
                                newName = ""
                            }
                        }
                        Box(Modifier.weight(1f)) {
                            PrimaryButton("Add") {
                                val name = newName.trim()
                                if (name.isNotEmpty()) {
                                    draft = draft.copy(
                                        exercises = draft.exercises + PlanExercise(
                                            name = name, sets = 3, reps = 10, weightKg = 20.0
                                        )
                                    )
                                    selected = draft.exercises.lastIndex
                                }
                                adding = false
                                newName = ""
                            }
                        }
                    }
                }
            } else {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .clickable { adding = true }
                        .padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("+", fontSize = 15.sp, color = Tokens.Accent)
                    Spacer(Modifier.width(10.dp))
                    Text("Add exercise", fontSize = 14.sp, color = Tokens.Accent)
                }
            }
            Spacer(Modifier.height(24.dp))
        }

        BottomAction {
            PrimaryButton("Save plan") {
                onSave(draft.copy(exercises = draft.exercises.ifEmpty { plan.exercises }))
            }
        }
    }
}

@Composable
private fun MiniStepper(
    label: String,
    value: String,
    onMinus: () -> Unit,
    onPlus: () -> Unit,
    modifier: Modifier = Modifier,
    tag: String = label.lowercase()
) {
    Column(modifier) {
        Text(label, fontSize = 11.sp, letterSpacing = 0.6.sp, color = Tokens.Muted)
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            StepButton("−", onMinus, "$tag-minus")
            Text(
                value,
                fontSize = 15.sp,
                color = Tokens.Fg,
                style = TextStyle(fontFeatureSettings = "tnum"),
                modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            StepButton("+", onPlus, "$tag-plus")
        }
    }
}

@Composable
private fun StepButton(glyph: String, onClick: () -> Unit, tag: String) {
    Box(
        Modifier
            .width(44.dp)
            .height(44.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.SurfaceLight)
            .clickable { onClick() }
            .testTag(tag),
        contentAlignment = Alignment.Center
    ) {
        Text(glyph, fontSize = 18.sp, color = Tokens.Fg)
    }
}

private fun Plan.replace(index: Int, exercise: PlanExercise): Plan =
    copy(exercises = exercises.mapIndexed { i, existing -> if (i == index) exercise else existing })
