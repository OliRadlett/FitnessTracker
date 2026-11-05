package uk.oli.fittrack.lab.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Hand-drawn nav glyphs. Five icons is not worth a 30 MB material-icons
 * dependency in a lab that rebuilds every two minutes, and drawing them keeps
 * every pixel ours.
 */
enum class NavKind { Today, Train, Ride, Body, You }

private fun DrawScope.glyph(kind: NavKind, color: Color, stroke: Float) {
    when (kind) {
        NavKind.Today -> {
            // A house: roof, walls, door.
            drawLine(color, Offset(size.width * 0.16f, size.height * 0.46f), Offset(size.width * 0.5f, size.height * 0.16f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.5f, size.height * 0.16f), Offset(size.width * 0.84f, size.height * 0.46f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.25f, size.height * 0.43f), Offset(size.width * 0.25f, size.height * 0.85f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.75f, size.height * 0.43f), Offset(size.width * 0.75f, size.height * 0.85f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.25f, size.height * 0.85f), Offset(size.width * 0.75f, size.height * 0.85f), stroke, StrokeCap.Round)
        }
        NavKind.Train -> {
            // A barbell: bar, two plates.
            drawLine(color, Offset(size.width * 0.30f, size.height * 0.5f), Offset(size.width * 0.70f, size.height * 0.5f), stroke, StrokeCap.Round)
            drawRoundRect(color, topLeft = Offset(size.width * 0.12f, size.height * 0.30f), size = Size(size.width * 0.10f, size.height * 0.40f), cornerRadius = androidx.compose.ui.geometry.CornerRadius(stroke, stroke), style = Stroke(stroke))
            drawRoundRect(color, topLeft = Offset(size.width * 0.78f, size.height * 0.30f), size = Size(size.width * 0.10f, size.height * 0.40f), cornerRadius = androidx.compose.ui.geometry.CornerRadius(stroke, stroke), style = Stroke(stroke))
        }
        NavKind.Ride -> {
            // Two wheels and a frame.
            drawCircle(color, radius = size.width * 0.17f, center = Offset(size.width * 0.27f, size.height * 0.68f), style = Stroke(stroke))
            drawCircle(color, radius = size.width * 0.17f, center = Offset(size.width * 0.73f, size.height * 0.68f), style = Stroke(stroke))
            drawLine(color, Offset(size.width * 0.27f, size.height * 0.68f), Offset(size.width * 0.46f, size.height * 0.36f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.46f, size.height * 0.36f), Offset(size.width * 0.62f, size.height * 0.36f), stroke, StrokeCap.Round)
            drawLine(color, Offset(size.width * 0.62f, size.height * 0.36f), Offset(size.width * 0.73f, size.height * 0.68f), stroke, StrokeCap.Round)
        }
        NavKind.Body -> {
            // A pulse line: the health surface, without a heart cliché.
            val pts = listOf(
                Offset(size.width * 0.10f, size.height * 0.52f),
                Offset(size.width * 0.32f, size.height * 0.52f),
                Offset(size.width * 0.42f, size.height * 0.26f),
                Offset(size.width * 0.58f, size.height * 0.74f),
                Offset(size.width * 0.68f, size.height * 0.52f),
                Offset(size.width * 0.90f, size.height * 0.52f)
            )
            for (i in 0 until pts.size - 1) {
                drawLine(color, pts[i], pts[i + 1], stroke, StrokeCap.Round)
            }
        }
        NavKind.You -> {
            drawCircle(color, radius = size.width * 0.17f, center = Offset(size.width * 0.5f, size.height * 0.34f), style = Stroke(stroke))
            drawArc(
                color = color,
                startAngle = 195f,
                sweepAngle = 150f,
                useCenter = false,
                topLeft = Offset(size.width * 0.20f, size.height * 0.48f),
                size = Size(size.width * 0.60f, size.height * 0.52f),
                style = Stroke(stroke)
            )
        }
    }
}

@Composable
private fun NavGlyph(kind: NavKind, color: Color) {
    Canvas(Modifier.size(24.dp)) {
        glyph(kind, color, stroke = 1.7.dp.toPx())
    }
}

private data class Tab(val kind: NavKind, val label: String)

private val tabs = listOf(
    Tab(NavKind.Today, "Today"),
    Tab(NavKind.Train, "Train"),
    Tab(NavKind.Ride, "Ride"),
    Tab(NavKind.Body, "Body"),
    Tab(NavKind.You, "You")
)

/**
 * Five destinations, no More drawer. Parity lives in the matrix, not in a
 * second navigation truth.
 */
@Composable
fun BottomNav(active: NavKind) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Tokens.Surface)
            .padding(bottom = 10.dp)
    ) {
        Row(
            Modifier.fillMaxWidth().height(62.dp).padding(horizontal = 6.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            tabs.forEach { tab ->
                val selected = tab.kind == active
                val color = if (selected) Tokens.Accent else Tokens.Muted
                Column(
                    Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    NavGlyph(tab.kind, color)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        tab.label,
                        fontSize = 12.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                        color = color
                    )
                }
            }
        }
    }
}
