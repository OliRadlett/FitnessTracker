package uk.oli.fittrack.ui.done

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.formatDuration
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.theme.Tokens

/**
 * The summary, computed from what was actually logged — not from the plan and
 * not from a constant. If the numbers here are wrong, the session was wrong.
 */
@Composable
fun DoneScreen(session: SessionState, onDone: () -> Unit) {
    val volume = SessionEngine.volumeKg(session.sets)
    val lastAt = session.sets.maxOfOrNull { it.at } ?: session.startedAt
    val duration = lastAt - session.startedAt
    val topSet = session.sets.maxByOrNull { it.weightKg }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
            .padding(horizontal = 20.dp)
    ) {
        Spacer(Modifier.height(18.dp))
        Label(session.plan.title.uppercase())
        Spacer(Modifier.height(10.dp))
        Text("Session done.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
        Spacer(Modifier.height(20.dp))

        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Tokens.Surface)
                .padding(20.dp)
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    formatWeight(volume.toFloat()),
                    fontSize = 54.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
                Spacer(Modifier.width(8.dp))
                Text("kg lifted", fontSize = 14.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 12.dp))
            }
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                MiniStat("SETS", session.doneSets.toString())
                MiniStat("TIME", formatDuration(duration))
                MiniStat(
                    "TOP SET",
                    topSet?.let { "${formatWeight(it.weightKg)} × ${it.reps}" } ?: "—"
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        Label("BY EXERCISE")
        Spacer(Modifier.height(8.dp))
        SessionEngine.volumeByExercise(session.sets).forEach { (name, kg) ->
            Row(
                Modifier.fillMaxWidth().height(44.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(name, fontSize = 14.sp, color = Tokens.Fg, modifier = Modifier.weight(1f))
                Text(
                    "${formatWeight(kg.toFloat())} kg",
                    fontSize = 13.sp,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }
        Spacer(Modifier.weight(1f))
        BottomAction { PrimaryButton("Done", onDone) }
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
