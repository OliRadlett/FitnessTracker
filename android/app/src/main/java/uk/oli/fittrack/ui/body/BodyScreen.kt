package uk.oli.fittrack.ui.body

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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.BodyTrend
import uk.oli.fittrack.domain.formatWeightKg
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.theme.Tokens
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Bodyweight: the number, the trend, and the weigh-ins behind it.
 *
 * The rolling average is the headline, not the last weigh-in: a single morning
 * moves a kilogram with water, and a trend is the only thing that answers "am I
 * going the right way".
 */
@Composable
fun BodyScreen(
    trend: BodyTrend?,
    onLogWeight: (Double) -> Unit,
    onDeleteWeight: (String) -> Unit,
    onRefresh: () -> Unit,
    onTab: (NavKind) -> Unit
) {
    var weight by rememberSaveable { mutableStateOf("") }
    val today = remember { LocalDate.now() }

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
            Spacer(Modifier.height(18.dp))
            Label("BODY")
            Spacer(Modifier.height(10.dp))
            Text("Bodyweight.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(20.dp))

            if (trend == null || trend.entries.isEmpty()) {
                Text("No weigh-ins yet.", fontSize = 15.sp, color = Tokens.Fg)
                Spacer(Modifier.height(6.dp))
                Text(
                    "Log one below, or sync a scale. It comes from GET /metrics/weight, so it needs a sign-in.",
                    fontSize = 13.sp,
                    color = Tokens.Muted
                )
                Spacer(Modifier.height(10.dp))
                LinkButton("Refresh", onRefresh)
            } else {
                val latest = trend.latest
                if (latest != null) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            formatWeightKg(latest.weightKg),
                            fontSize = 44.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = Tokens.Fg,
                            style = TextStyle(fontFeatureSettings = "tnum")
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("kg", fontSize = 15.sp, color = Tokens.Muted)
                        Spacer(Modifier.weight(1f))
                        trend.changeKg(today)?.let { change ->
                            Text(
                                (if (change > 0) "+" else "") + formatWeightKg(change) + " kg",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = Tokens.Accent,
                                style = TextStyle(fontFeatureSettings = "tnum")
                            )
                        }
                    }
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "30-day change · ${pluralSessions(trend.entries.size)} " +
                            "over ${trend.spanDays()} days",
                        fontSize = 12.sp,
                        color = Tokens.Muted
                    )
                }

                val points = trend.rollingPoints()
                if (points.size >= 2) {
                    Spacer(Modifier.height(22.dp))
                    Label("7-DAY AVERAGE")
                    Spacer(Modifier.height(10.dp))
                    WeightChart(points.map { it.second })
                }
            }

            Spacer(Modifier.height(24.dp))
            Label("LOG A WEIGH-IN")
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    OutlinedTextField(
                        value = weight,
                        onValueChange = { weight = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text("Weight kg", fontSize = 12.sp) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        textStyle = TextStyle(fontSize = 15.sp, color = Tokens.Fg)
                    )
                }
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .height(56.dp)
                        .width(84.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Tokens.Accent)
                        .clickable {
                            weight.replace(',', '.').toDoubleOrNull()?.let {
                                onLogWeight(it)
                                weight = ""
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Text("Save", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Bg)
                }
            }

            if (trend != null && trend.entries.isNotEmpty()) {
                Spacer(Modifier.height(24.dp))
                Label("WEIGH-INS")
                Spacer(Modifier.height(6.dp))
                trend.entries.reversed().take(14).forEach { entry ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            shortDate(entry.date),
                            fontSize = 13.sp,
                            color = Tokens.Muted,
                            modifier = Modifier.width(84.dp)
                        )
                        Text(
                            "${formatWeightKg(entry.weightKg)} kg",
                            fontSize = 14.sp,
                            color = Tokens.Fg,
                            modifier = Modifier.weight(1f),
                            style = TextStyle(fontFeatureSettings = "tnum")
                        )
                        Text(entry.source, fontSize = 11.sp, color = Tokens.Muted)
                        // Only a manual entry is ours to remove; a scale's reading
                        // belongs to the scale.
                        if (entry.isManual) {
                            Spacer(Modifier.width(8.dp))
                            Text(
                                "×",
                                fontSize = 16.sp,
                                color = Tokens.Muted,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable { onDeleteWeight(entry.id) }
                                    .padding(horizontal = 8.dp, vertical = 2.dp)
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
        }
        BottomNav(NavKind.Body, onTab)
    }
}

@Composable
private fun LinkButton(text: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
    }
}

/** A line with a dot per weigh-in: no axes, because the shape is the message. */
@Composable
private fun WeightChart(values: List<Double>) {
    val min = values.min()
    val max = values.max()
    val span = (max - min).takeIf { it > 0.0 } ?: 1.0
    Canvas(
        Modifier
            .fillMaxWidth()
            .height(110.dp)
    ) {
        val stepX = size.width / (values.size - 1).coerceAtLeast(1)
        fun y(value: Double) = (size.height - 12f) * (1f - ((value - min) / span).toFloat()) + 6f

        val path = Path()
        values.forEachIndexed { index, value ->
            val x = stepX * index
            val pointY = y(value)
            if (index == 0) path.moveTo(x, pointY) else path.lineTo(x, pointY)
        }
        drawPath(path, color = Tokens.Accent, style = Stroke(width = 2.5f, cap = StrokeCap.Round))
        values.forEachIndexed { index, value ->
            drawCircle(
                color = Tokens.Accent,
                radius = if (index == values.lastIndex) 4f else 2f,
                center = Offset(stepX * index, y(value))
            )
        }
    }
    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
        Text(formatWeightKg(min), fontSize = 11.sp, color = Tokens.Muted)
        Text(formatWeightKg(max), fontSize = 11.sp, color = Tokens.Muted)
    }
}

private fun pluralSessions(count: Int): String =
    if (count == 1) "1 weigh-in" else "$count weigh-ins"

private fun shortDate(raw: String): String =
    runCatching {
        LocalDate.parse(raw).format(DateTimeFormatter.ofPattern("d MMM", Locale.UK))
    }.getOrDefault(raw)
