package uk.oli.fittrack.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.domain.SessionState
import uk.oli.fittrack.ui.BottomAction
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.theme.Tokens
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The whole home screen: today's session and one action.
 *
 * No week strip and no load numbers yet — there is no history in v0.1, and an
 * empty chart is worse than an honest empty state.
 */
@Composable
fun TodayScreen(
    session: SessionState?,
    signedIn: Boolean,
    onSignIn: () -> Unit,
    onStart: () -> Unit,
    onResume: () -> Unit,
    onTab: (NavKind) -> Unit
) {
    val plan = session?.plan ?: uk.oli.fittrack.data.SeedPlan.pushDay
    val dateLabel = remember {
        LocalDate.now().format(DateTimeFormatter.ofPattern("EEE d MMMM", Locale.UK))
            .uppercase(Locale.UK)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .statusBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(18.dp))
            Text(
                dateLabel,
                fontSize = 12.sp,
                letterSpacing = 0.7.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(10.dp))
            Text(
                if (session != null) "In progress." else "${plan.title}.",
                fontSize = 30.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(22.dp))
            PlanCard(plan, session)
            if (session == null) {
                Spacer(Modifier.height(12.dp))
                Text(
                    "Nothing logged yet today.",
                    fontSize = 13.sp,
                    color = Tokens.Muted
                )
            }
            if (!signedIn) {
                Spacer(Modifier.height(18.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .clickable { onSignIn() }
                        .padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Not signed in", fontSize = 13.sp, color = Tokens.Muted)
                    Spacer(Modifier.weight(1f))
                    Text("Sign in →", fontSize = 13.sp, color = Tokens.Accent)
                }
            }
            Spacer(Modifier.weight(1f))
        }
        BottomAction {
            if (session != null) {
                PrimaryButton("Resume session", onResume)
            } else {
                PrimaryButton("Start session", onStart)
            }
        }
        BottomNav(NavKind.Today, onTab)
    }
}

@Composable
private fun PlanCard(plan: uk.oli.fittrack.domain.Plan, session: SessionState?) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 18.dp, vertical = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Align the header with the exercise names, which sit past the accent bar.
            Spacer(Modifier.width(14.dp))
            if (session != null) {
                Text("●", fontSize = 11.sp, color = Tokens.Accent)
                Spacer(Modifier.width(7.dp))
            }
            Label(
                if (session == null) {
                    "${plan.exercises.size} EXERCISES · ${plan.totalSets} SETS"
                } else {
                    "${session.doneSets} OF ${plan.totalSets} SETS LOGGED"
                }
            )
        }
        Spacer(Modifier.height(10.dp))

        val current = session?.let { SessionEngine.currentExercise(it) }
        plan.exercises.forEachIndexed { index, exercise ->
            val done = session?.let { SessionEngine.doneFor(it, exercise.name) } ?: 0
            val isNext = exercise.name == current?.name || (session == null && index == 0)
            Row(
                Modifier.fillMaxWidth().height(42.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(3.dp)
                        .height(18.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(
                            when {
                                isNext -> Tokens.Accent
                                done >= exercise.sets -> Tokens.Accent.copy(alpha = 0.35f)
                                else -> Tokens.Surface
                            }
                        )
                )
                Spacer(Modifier.width(11.dp))
                Text(
                    exercise.name,
                    fontSize = 14.sp,
                    fontWeight = if (isNext) FontWeight.Medium else FontWeight.Normal,
                    color = if (done >= exercise.sets) Tokens.Muted else Tokens.Fg,
                    modifier = Modifier.weight(1f)
                )
                if (done > 0) {
                    Text(
                        "$done/${exercise.sets}",
                        fontSize = 12.sp,
                        color = if (done >= exercise.sets) Tokens.Accent else Tokens.Muted,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                    Spacer(Modifier.width(10.dp))
                }
                Text(
                    "${exercise.sets} × ${exercise.reps}",
                    fontSize = 13.sp,
                    color = if (isNext) Tokens.Fg else Tokens.Muted,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }
    }
}
