package uk.oli.fittrack.lab.ui

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

/**
 * Frame 4 of the flow: the session summary.
 *
 * One number you'd screenshot, then the six exercises that made it. All values
 * are the real 3 Nov Bench Press session. No percentage comparison, because the
 * previous push day is not in the fixture — showing "+2.4%" would be invented.
 */
@Composable
fun SessionDoneScreen() {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(18.dp))
            Text(
                "TUE 3 NOVEMBER · 18:02–19:20",
                fontSize = 12.sp,
                letterSpacing = 0.7.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Muted
            )
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
                        "5,326",
                        fontSize = 54.sp,
                        fontWeight = FontWeight.Medium,
                        color = Tokens.Fg,
                        style = TextStyle(fontFeatureSettings = "tnum")
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "kg lifted",
                        fontSize = 14.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    MiniStat("SETS", "16")
                    MiniStat("TIME", "1h 18m")
                    MiniStat("AVG HR", "113 bpm")
                }
            }

            Spacer(Modifier.height(24.dp))
            Text(
                "BY EXERCISE",
                fontSize = 12.sp,
                letterSpacing = 0.7.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(8.dp))
            ExerciseRow("Close Grip Bench Press", "1,680 kg", "2 sets")
            ExerciseRow("Bench Press", "1,440 kg", "4 sets")
            ExerciseRow("Tricep Extension", "1,416 kg", "3 sets")
            ExerciseRow("Machine Shoulder Press", "760 kg", "2 sets")
            ExerciseRow("Incline Dumbbell Press", "480 kg", "2 sets")
            ExerciseRow("Lateral Raise", "270 kg", "3 sets")
        }
        BottomAction { PrimaryButton("Done") }
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
private fun ExerciseRow(name: String, volume: String, sets: String) {
    Row(
        Modifier.fillMaxWidth().height(44.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(name, fontSize = 14.sp, color = Tokens.Fg, modifier = Modifier.weight(1f))
        Text(sets, fontSize = 12.sp, color = Tokens.Muted)
        Spacer(Modifier.width(14.dp))
        Text(volume, fontSize = 13.sp, color = Tokens.Fg, style = TextStyle(fontFeatureSettings = "tnum"))
    }
}
