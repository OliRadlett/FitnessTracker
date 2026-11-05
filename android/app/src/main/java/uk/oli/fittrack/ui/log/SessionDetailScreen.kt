package uk.oli.fittrack.ui.log

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.SessionEngine
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.formatDuration
import uk.oli.fittrack.ui.formatWeight
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One finished session, read-only. The same numbers the summary showed at the time. */
@Composable
fun SessionDetailScreen(session: FinishedSession, onBack: () -> Unit) {
    val date = Instant.ofEpochMilli(session.endedAt).atZone(ZoneId.systemDefault())
    val topSet = session.sets.maxByOrNull { it.weightKg }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
            .padding(horizontal = 20.dp)
    ) {
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
                Text(session.planTitle, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
                Spacer(Modifier.height(2.dp))
                Text(
                    date.format(DateTimeFormatter.ofPattern("EEE d MMM · HH:mm", Locale.UK)),
                    fontSize = 13.sp,
                    color = Tokens.Muted
                )
            }
        }

        Spacer(Modifier.height(18.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Tokens.Surface)
                .padding(20.dp)
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    formatWeight(session.volumeKg.toFloat()),
                    fontSize = 46.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Fg,
                    style = TextStyle(fontFeatureSettings = "tnum")
                )
                Spacer(Modifier.width(8.dp))
                Text("kg lifted", fontSize = 14.sp, color = Tokens.Muted, modifier = Modifier.padding(bottom = 10.dp))
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                MiniStat("SETS", session.sets.size.toString())
                MiniStat("TIME", formatDuration(session.endedAt - session.startedAt))
                MiniStat("TOP SET", topSet?.let { "${formatWeight(it.weightKg)} × ${it.reps}" } ?: "—")
            }
        }

        Spacer(Modifier.height(22.dp))
        Label("BY EXERCISE")
        Spacer(Modifier.height(8.dp))
        SessionEngine.volumeByExercise(session.sets).forEach { (name, kg) ->
            Row(
                Modifier.fillMaxWidth().height(42.dp),
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
