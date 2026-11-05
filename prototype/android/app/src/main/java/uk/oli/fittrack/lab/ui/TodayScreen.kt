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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Session = listOf(
    "Bench Press" to "4 × 4",
    "Close Grip Bench Press" to "2 × 12",
    "Tricep Extension" to "3 × 12",
    "Machine Shoulder Press" to "2 × 9",
    "Incline Dumbbell Press" to "2 × 8",
    "Lateral Raise" to "3 × 12"
)

/**
 * Frames 1 and 5: the same screen, before and after training.
 *
 * The card is the session itself — six exercises, ticked off in the second
 * frame. Everything else is one week strip and one action. If this screen ever
 * needs two numbers to be actionable, the dashboard has leaked back in.
 *
 * Fixture: Tue 3 Nov 2026. Before: two rides this week (Fri 50 TSS, Sat 153).
 * After: the bench session adds a third bar and the card's rows are done.
 */
@Composable
fun TodayScreen(done: Boolean = false) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(18.dp))
            Text(
                "TUE 3 NOVEMBER",
                fontSize = 12.sp,
                letterSpacing = 0.7.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(10.dp))
            Text(
                if (done) "That's you for today." else "Push day.",
                fontSize = 30.sp,
                fontWeight = FontWeight.SemiBold,
                color = Tokens.Fg
            )
            Spacer(Modifier.height(22.dp))
            SessionCard(done)
            Spacer(Modifier.weight(1f))
            WeekStrip(withToday = done)
            Spacer(Modifier.height(10.dp))
            Text(
                if (done) "3 sessions · 7h 45m" else "2 sessions · 6h 27m",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(14.dp))
        }
        BottomAction {
            if (done) SecondaryButton("View session") else PrimaryButton("Start session")
        }
        BottomNav(NavKind.Today)
    }
}

@Composable
private fun SessionCard(done: Boolean) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Tokens.Surface)
            .padding(horizontal = 18.dp, vertical = 16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (done) {
                Text("✓", fontSize = 12.sp, color = Tokens.Accent)
                Spacer(Modifier.width(7.dp))
            }
            Text(
                if (done) "DONE · 19:20" else "6 EXERCISES · 16 SETS",
                fontSize = 12.sp,
                letterSpacing = 0.7.sp,
                fontWeight = FontWeight.Medium,
                color = if (done) Tokens.Accent else Tokens.Muted
            )
        }
        Spacer(Modifier.height(10.dp))
        Session.forEachIndexed { index, (name, scheme) ->
            val next = !done && index == 0
            Row(
                Modifier.fillMaxWidth().height(42.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(3.dp)
                        .height(18.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(if (next) Tokens.Accent else Tokens.Surface)
                )
                Spacer(Modifier.width(11.dp))
                Text(
                    name,
                    fontSize = 14.sp,
                    fontWeight = if (next) FontWeight.Medium else FontWeight.Normal,
                    color = if (done) Tokens.Muted else Tokens.Fg,
                    modifier = Modifier.weight(1f)
                )
                if (done) {
                    Text("✓", fontSize = 12.sp, color = Tokens.Accent)
                    Spacer(Modifier.width(10.dp))
                }
                Text(
                    scheme,
                    fontSize = 13.sp,
                    color = if (next) Tokens.Fg else Tokens.Muted,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.SurfaceLight))
        Spacer(Modifier.height(10.dp))
        Text(
            if (done) "5,326 kg · 1h 18m" else "Last time 1h 18m · 5,326 kg",
            fontSize = 13.sp,
            color = Tokens.Muted
        )
    }
}

/**
 * Fri 50 TSS, Sat 153 TSS, then nothing until the bench session lands in the
 * "after" frame. Bars scale to the 153 TSS ride, the week's max.
 */
@Composable
private fun WeekStrip(withToday: Boolean) {
    val days = listOf("W", "T", "F", "S", "S", "M", "T")
    val tss = listOf(0f, 0f, 50f, 153f, 0f, 0f, if (withToday) 58.7f else 0f)
    val max = 153f
    Column {
        Text(
            "LAST 7 DAYS",
            fontSize = 12.sp,
            letterSpacing = 0.7.sp,
            fontWeight = FontWeight.Medium,
            color = Tokens.Muted
        )
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            days.forEachIndexed { i, day ->
                val value = tss[i]
                Column(Modifier.weight(1f)) {
                    Box(
                        Modifier.fillMaxWidth().height(56.dp),
                        contentAlignment = Alignment.BottomCenter
                    ) {
                        val height = if (value <= 0f) 3.dp else (56f * (value / max)).dp
                        Box(
                            Modifier
                                .width(30.dp)
                                .height(height)
                                .clip(RoundedCornerShape(6.dp))
                                .background(if (value <= 0f) Tokens.SurfaceLight else Tokens.Accent)
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(
                        day,
                        fontSize = 12.sp,
                        color = Tokens.Muted,
                        modifier = Modifier.align(Alignment.CenterHorizontally)
                    )
                }
            }
        }
    }
}

/**
 * The primary action sits on its own deck: a hairline and a background, so a
 * short page reads as short rather than broken.
 */
@Composable
fun BottomAction(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Tokens.Bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.SurfaceLight))
        Box(Modifier.padding(horizontal = 20.dp, vertical = 14.dp)) { content() }
    }
}

@Composable
fun PrimaryButton(label: String, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Tokens.Accent)
            .testTag("primary"),
        contentAlignment = Alignment.Center
    ) {
        Text(label, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
    }
}

@Composable
fun SecondaryButton(label: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Tokens.SurfaceLight)
            .testTag("primary"),
        contentAlignment = Alignment.Center
    ) {
        Text(label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
    }
}
