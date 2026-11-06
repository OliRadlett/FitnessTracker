package uk.oli.fittrack.ui.routes

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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.domain.BikeRoute
import uk.oli.fittrack.domain.RouteFilter
import uk.oli.fittrack.domain.filterRoutes
import uk.oli.fittrack.domain.normalise
import uk.oli.fittrack.domain.orderRoutes
import uk.oli.fittrack.domain.routeHistory
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens

/**
 * The routes atlas, shape-first.
 *
 * Every route is drawn from its own `preview_polyline`: a shape is what tells
 * one route from another, and unlike a map it needs no tiles, no key and no
 * signal. The list is the map.
 */
@Composable
fun RoutesScreen(
    routes: List<BikeRoute>?,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
    var filter by remember { mutableStateOf(RouteFilter.All) }
    var open by remember { mutableStateOf<String?>(null) }

    val shown = remember(routes, filter) {
        orderRoutes(filterRoutes(routes.orEmpty(), filter))
    }

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
                    .padding(vertical = 6.dp, horizontal = 2.dp)
            )
            Spacer(Modifier.height(6.dp))
            Label("ROUTES")
            Spacer(Modifier.height(8.dp))
            Text("Routes.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(6.dp))
            Text(
                routes?.size?.let { "$it in the library" } ?: "Loading…",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.height(14.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RouteFilter.entries.forEach { option ->
                    val selected = option == filter
                    Text(
                        option.label,
                        fontSize = 12.sp,
                        color = if (selected) Tokens.Bg else Tokens.Fg,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (selected) Tokens.Accent else Tokens.Surface)
                            .clickable { filter = option }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
            Spacer(Modifier.height(14.dp))

            when {
                routes == null -> Text("Loading routes…", fontSize = 14.sp, color = Tokens.Muted)
                shown.isEmpty() -> {
                    Text(
                        if (routes.isEmpty()) "No routes yet." else "Nothing matches that filter.",
                        fontSize = 15.sp,
                        color = Tokens.Fg
                    )
                    if (routes.isEmpty()) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Routes come from your rides and imports, so they need a sign-in and a sync.",
                            fontSize = 13.sp,
                            color = Tokens.Muted
                        )
                        Spacer(Modifier.height(10.dp))
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .background(Tokens.Surface)
                                .clickable { onRefresh() }
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                        ) {
                            Text("Refresh", fontSize = 13.sp, color = Tokens.Accent)
                        }
                    }
                }
                else -> shown.forEach { route ->
                    RouteCard(
                        route = route,
                        open = open == route.id,
                        onToggle = { open = if (open == route.id) null else route.id }
                    )
                    Spacer(Modifier.height(12.dp))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun RouteCard(route: BikeRoute, open: Boolean, onToggle: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Tokens.Surface)
            .clickable { onToggle() }
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RouteShape(route, Modifier.size(if (open) 128.dp else 72.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    route.name,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium,
                    color = Tokens.Fg,
                    maxLines = 2
                )
                Spacer(Modifier.height(4.dp))
                Text(route.describe(), fontSize = 12.sp, color = Tokens.Muted)
                Spacer(Modifier.height(3.dp))
                Text(routeHistory(route), fontSize = 12.sp, color = Tokens.Muted)
            }
        }
        if (open) {
            Spacer(Modifier.height(12.dp))
            val details = listOfNotNull(
                route.where.takeIf { it.isNotBlank() },
                if (route.isLoop) "Loop" else "Point to point",
                route.surface?.let { "Surface: $it" },
                route.qualityScore?.let { "Quality ${it.toInt()}" },
                if (route.isFavourite) "Favourite" else null
            )
            Text(details.joinToString(" · "), fontSize = 12.sp, color = Tokens.Muted)
        }
    }
}

/** A route's silhouette, or a quiet placeholder when the server sent no shape. */
@Composable
private fun RouteShape(route: BikeRoute, modifier: Modifier = Modifier) {
    val shape = remember(route.id, route.shape) { normalise(route.shape) }
    Box(
        modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Bg),
        contentAlignment = Alignment.Center
    ) {
        if (shape.size < 2) {
            Text("—", fontSize = 18.sp, color = Tokens.Muted)
        } else {
            ShapeCanvas(shape)
        }
    }
}

@Composable
private fun ShapeCanvas(shape: List<Pair<Float, Float>>) {
    Canvas(Modifier.fillMaxSize().padding(8.dp)) {
        if (shape.size < 2) return@Canvas
        val pad = 4f
        val w = size.width - pad * 2
        val h = size.height - pad * 2
        val path = Path()
        shape.forEachIndexed { index, (x, y) ->
            // y grows downwards on a canvas; latitude grows upwards.
            val px = pad + x * w
            val py = pad + (1f - y) * h
            if (index == 0) path.moveTo(px, py) else path.lineTo(px, py)
        }
        drawPath(path, color = Tokens.Accent, style = Stroke(1.8f, cap = StrokeCap.Round))
        val (firstX, firstY) = shape.first()
        drawCircle(
            color = Tokens.Accent,
            radius = 3f,
            center = Offset(pad + firstX * w, pad + (1f - firstY) * h)
        )
    }
}
