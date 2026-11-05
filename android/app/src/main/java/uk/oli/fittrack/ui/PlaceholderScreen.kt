package uk.oli.fittrack.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.ui.theme.Tokens
import java.util.Locale

/**
 * Honest placeholder. These four tabs are specified in the parity matrix and not
 * built yet; the screen says so rather than showing an empty shell that looks
 * broken.
 */
@Composable
fun PlaceholderScreen(tab: String, onTab: (NavKind) -> Unit) {
    val kind = NavKind.entries.firstOrNull { it.name.lowercase(Locale.UK) == tab } ?: NavKind.Train
    val copy = when (kind) {
        NavKind.Today -> "The session, one action."
        NavKind.Train -> "Plan, calendar, lifting history, videos and goals."
        NavKind.Ride -> "Cycling, routes, climbs and 3D replay."
        NavKind.Body -> "Health, sleep, HRV and season insights."
        NavKind.You -> "Settings, notifications and the guide."
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .statusBarsPadding()
    ) {
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(18.dp))
            Label("NOT BUILT YET")
            Spacer(Modifier.height(10.dp))
            Text(kind.name, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(8.dp))
            Text(copy, fontSize = 15.sp, color = Tokens.Muted)
            Spacer(Modifier.height(6.dp))
            Text(
                "Specified in prototype/android/PARITY.md. This build ships the gym flow first.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
        }
        BottomNav(kind, onTab)
    }
}
