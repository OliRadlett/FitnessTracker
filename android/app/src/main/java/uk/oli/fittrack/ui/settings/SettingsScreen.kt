package uk.oli.fittrack.ui.settings

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
import uk.oli.fittrack.domain.Connection
import uk.oli.fittrack.domain.Preferences
import uk.oli.fittrack.domain.SettingsSnapshot
import uk.oli.fittrack.domain.connectionsLabel
import uk.oli.fittrack.domain.orderConnections
import uk.oli.fittrack.domain.syncedDate
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.theme.Tokens

/**
 * Settings: how the numbers are written, and whether the connections carrying
 * them are healthy.
 *
 * The phone can change the two preferences that change what it shows — units and
 * clock — and can see every connection's last sync and last error. Authorising a
 * provider is an OAuth browser flow, so the rows say where it happens.
 */
@Composable
fun SettingsScreen(
    snapshot: SettingsSnapshot?,
    email: String?,
    onUnit: (String) -> Unit,
    onTimeFormat: (String) -> Unit,
    onRefresh: () -> Unit,
    onBack: () -> Unit
) {
    val preferences = snapshot?.preferences
    val connections = orderConnections(snapshot?.connections.orEmpty())

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
            Label("SETTINGS")
            Spacer(Modifier.height(8.dp))
            Text("Settings.", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(16.dp))

            Label("ACCOUNT")
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Tokens.Surface)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        email ?: "Not signed in",
                        fontSize = 14.sp,
                        color = Tokens.Fg,
                        maxLines = 1
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        "Signing out is on You. Signing in is Google.",
                        fontSize = 12.sp,
                        color = Tokens.Muted
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
            Label("UNITS")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Metric · kg, km", preferences?.isMetric == true) { onUnit("metric") }
                Chip("Imperial · lb, mi", preferences?.isMetric == false) { onUnit("imperial") }
            }

            Spacer(Modifier.height(20.dp))
            Label("CLOCK")
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("24-hour", preferences?.timeFormat == "24h") { onTimeFormat("24h") }
                Chip("12-hour", preferences?.timeFormat == "12h") { onTimeFormat("12h") }
            }

            Spacer(Modifier.height(20.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Label("CONNECTIONS")
                Spacer(Modifier.weight(1f))
                Text(
                    connectionsLabel(connections),
                    fontSize = 12.sp,
                    color = if (snapshot?.broken?.isNotEmpty() == true) Tokens.Accent else Tokens.Muted
                )
            }
            Spacer(Modifier.height(8.dp))
            when {
                snapshot == null -> Text("Loading…", fontSize = 14.sp, color = Tokens.Muted)
                connections.isEmpty() -> {
                    Text("No providers connected.", fontSize = 15.sp, color = Tokens.Fg)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Connect Strava, Whoop, Wahoo or Withings on the website; the phone reads what they send.",
                        fontSize = 12.sp,
                        color = Tokens.Muted
                    )
                }
                else -> connections.forEach { connection ->
                    ConnectionRow(connection)
                    Spacer(Modifier.height(8.dp))
                }
            }

            Spacer(Modifier.height(16.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(Tokens.Surface)
                    .clickable { onRefresh() }
                    .padding(horizontal = 14.dp, vertical = 10.dp)
            ) {
                Text("Refresh", fontSize = 13.sp, color = Tokens.Accent)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    Text(
        label,
        fontSize = 12.sp,
        color = if (selected) Tokens.Bg else Tokens.Fg,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Tokens.Accent else Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 7.dp)
    )
}

@Composable
private fun ConnectionRow(connection: Connection) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Surface)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(connection.name, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = Tokens.Fg)
            Spacer(Modifier.height(3.dp))
            Text(
                connection.health(),
                fontSize = 12.sp,
                color = if (connection.isBroken) Tokens.Accent else Tokens.Muted,
                maxLines = 2
            )
        }
        Text(
            syncedDate(connection.lastSyncedAt),
            fontSize = 11.sp,
            color = Tokens.Muted
        )
    }
}
