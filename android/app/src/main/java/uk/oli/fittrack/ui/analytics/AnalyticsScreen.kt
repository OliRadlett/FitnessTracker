package uk.oli.fittrack.ui.analytics

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.Confidence
import uk.oli.fittrack.domain.Insight
import uk.oli.fittrack.domain.dataLabel
import uk.oli.fittrack.domain.orderInsights
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens

/**
 * Analytics: the computed insights.
 *
 * The website also carries season and load tabs, but the phone already shows
 * load on Today and the Ride tab. What this page adds is the part that is only
 * here: what the nightly job concluded, and how much evidence it had.
 */
@Composable
fun AnalyticsScreen(
    insights: List<Insight>?,
    busy: Boolean,
    onRecompute: () -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
    val shown = orderInsights(insights.orEmpty())

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
                    .padding(vertical = 6.dp)
            )
            Spacer(Modifier.height(6.dp))
            Label("ANALYTICS")
            Spacer(Modifier.height(8.dp))
            Text("Analytics.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                "What the nightly job found in your data — and how sure it is.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Action(if (busy) "Recomputing…" else "Recompute") { if (!busy) onRecompute() }
                Action("Refresh") { onRefresh() }
            }
            Spacer(Modifier.height(16.dp))

            when {
                insights == null -> Text("Loading insights…", fontSize = 14.sp, color = Tokens.Muted)
                shown.isEmpty() -> {
                    Text("No insights yet.", fontSize = 15.sp, color = Tokens.Fg)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Insights are computed nightly from enough history to be worth trusting. " +
                            "Recompute asks for them now; with little history it will find little.",
                        fontSize = 13.sp,
                        color = Tokens.Muted
                    )
                }
                else -> shown.forEach { insight ->
                    InsightCard(insight)
                    Spacer(Modifier.height(12.dp))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun InsightCard(insight: Insight) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                insight.title,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
                color = Tokens.Fg,
                modifier = Modifier.weight(1f)
            )
            ConfidenceChip(insight.confidenceLevel, insight.confidence)
        }
        insight.meta().takeIf { it.isNotBlank() }?.let {
            Spacer(Modifier.height(4.dp))
            Text(it, fontSize = 11.sp, color = Tokens.Muted)
        }
        if (!insight.hasData) {
            Spacer(Modifier.height(8.dp))
            Text(
                "Not enough data to say anything yet.",
                fontSize = 12.sp,
                color = Tokens.Muted
            )
            return@Column
        }
        Spacer(Modifier.height(10.dp))
        insight.data.forEach { (key, value) ->
            Row(Modifier.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    dataLabel(key),
                    fontSize = 12.sp,
                    color = Tokens.Muted,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    value,
                    fontSize = 13.sp,
                    color = Tokens.Fg
                )
            }
        }
    }
}

@Composable
private fun ConfidenceChip(level: Confidence, label: String) {
    if (level == Confidence.Unknown) return
    Text(
        label,
        fontSize = 10.sp,
        letterSpacing = 0.5.sp,
        fontWeight = FontWeight.Medium,
        color = if (level == Confidence.High) Tokens.Bg else Tokens.Fg,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(if (level == Confidence.High) Tokens.Accent else Tokens.Muted.copy(alpha = 0.25f))
            .padding(horizontal = 6.dp, vertical = 2.dp)
    )
}

@Composable
private fun Action(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Tokens.Accent)
    }
}
