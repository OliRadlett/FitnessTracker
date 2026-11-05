package uk.oli.fittrack.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.ui.theme.Tokens

enum class NavKind { Today, Train, Ride, Body, You }

private data class Tab(val kind: NavKind, val label: String)

private val tabs = listOf(
    Tab(NavKind.Today, "Today"),
    Tab(NavKind.Train, "Train"),
    Tab(NavKind.Ride, "Ride"),
    Tab(NavKind.Body, "Body"),
    Tab(NavKind.You, "You")
)

@Composable
fun Label(text: String) {
    Text(
        text = text,
        fontSize = 12.sp,
        letterSpacing = 0.7.sp,
        fontWeight = FontWeight.Medium,
        color = Tokens.Muted
    )
}

/** Five destinations, no More drawer. */
@Composable
fun BottomNav(active: NavKind?, onSelect: (NavKind) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Tokens.Surface)
            .navigationBarsPadding()
            .padding(bottom = 8.dp)
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
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { onSelect(tab.kind) }
                        .padding(vertical = 6.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Canvas(Modifier.size(24.dp)) { glyph(tab.kind, color, 1.7.dp.toPx()) }
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

private fun DrawScope.glyph(kind: NavKind, color: Color, stroke: Float) {
    val w = size.width
    val h = size.height
    when (kind) {
        NavKind.Today -> {
            drawLine(color, Offset(w * 0.16f, h * 0.46f), Offset(w * 0.5f, h * 0.16f), stroke, StrokeCap.Round)
            drawLine(color, Offset(w * 0.5f, h * 0.16f), Offset(w * 0.84f, h * 0.46f), stroke, StrokeCap.Round)
            drawLine(color, Offset(w * 0.25f, h * 0.43f), Offset(w * 0.25f, h * 0.85f), stroke, StrokeCap.Round)
            drawLine(color, Offset(w * 0.75f, h * 0.43f), Offset(w * 0.75f, h * 0.85f), stroke, StrokeCap.Round)
            drawLine(color, Offset(w * 0.25f, h * 0.85f), Offset(w * 0.75f, h * 0.85f), stroke, StrokeCap.Round)
        }
        NavKind.Train -> {
            drawLine(color, Offset(w * 0.30f, h * 0.5f), Offset(w * 0.70f, h * 0.5f), stroke, StrokeCap.Round)
            drawRoundRect(
                color, topLeft = Offset(w * 0.12f, h * 0.30f), size = Size(w * 0.10f, h * 0.40f),
                cornerRadius = CornerRadius(stroke, stroke), style = Stroke(stroke)
            )
            drawRoundRect(
                color, topLeft = Offset(w * 0.78f, h * 0.30f), size = Size(w * 0.10f, h * 0.40f),
                cornerRadius = CornerRadius(stroke, stroke), style = Stroke(stroke)
            )
        }
        NavKind.Ride -> {
            drawCircle(color, radius = w * 0.17f, center = Offset(w * 0.27f, h * 0.68f), style = Stroke(stroke))
            drawCircle(color, radius = w * 0.17f, center = Offset(w * 0.73f, h * 0.68f), style = Stroke(stroke))
            drawLine(color, Offset(w * 0.27f, h * 0.68f), Offset(w * 0.46f, h * 0.36f), stroke, StrokeCap.Round)
            drawLine(color, Offset(w * 0.46f, h * 0.36f), Offset(w * 0.62f, h * 0.36f), stroke, StrokeCap.Round)
            drawLine(color, Offset(w * 0.62f, h * 0.36f), Offset(w * 0.73f, h * 0.68f), stroke, StrokeCap.Round)
        }
        NavKind.Body -> {
            val pts = listOf(
                Offset(w * 0.10f, h * 0.52f), Offset(w * 0.32f, h * 0.52f),
                Offset(w * 0.42f, h * 0.26f), Offset(w * 0.58f, h * 0.74f),
                Offset(w * 0.68f, h * 0.52f), Offset(w * 0.90f, h * 0.52f)
            )
            for (i in 0 until pts.size - 1) drawLine(color, pts[i], pts[i + 1], stroke, StrokeCap.Round)
        }
        NavKind.You -> {
            drawCircle(color, radius = w * 0.17f, center = Offset(w * 0.5f, h * 0.34f), style = Stroke(stroke))
            drawArc(
                color = color, startAngle = 195f, sweepAngle = 150f, useCenter = false,
                topLeft = Offset(w * 0.20f, h * 0.48f), size = Size(w * 0.60f, h * 0.52f),
                style = Stroke(stroke)
            )
        }
    }
}

/** The primary action sits on its own deck so a short page reads as short, not broken. */
@Composable
fun BottomAction(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Tokens.Bg)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Tokens.SurfaceLight))
        Box(Modifier.padding(horizontal = 20.dp, vertical = 14.dp)) { content() }
    }
}

@Composable
fun PrimaryButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Tokens.Accent)
            .clickable { onClick() }
            .testTag("primary"),
        contentAlignment = Alignment.Center
    ) {
        Text(label, fontSize = 17.sp, fontWeight = FontWeight.Bold, color = Tokens.OnAccent)
    }
}

@Composable
fun SecondaryButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(64.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Tokens.SurfaceLight)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Text(label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
    }
}
