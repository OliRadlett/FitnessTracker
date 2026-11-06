package uk.oli.fittrack.ui.you

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.AuthUiState
import uk.oli.fittrack.ui.BottomNav
import uk.oli.fittrack.ui.Label
import uk.oli.fittrack.ui.NavKind
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.SecondaryButton
import uk.oli.fittrack.ui.theme.Tokens
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private fun clock(at: Long): String =
    Instant.ofEpochMilli(at)
        .atZone(ZoneId.systemDefault())
        .format(DateTimeFormatter.ofPattern("HH:mm"))

/**
 * Account and settings. Sign-in lives here rather than in front of the app:
 * logging a set must never wait on a network round trip.
 */
@Composable
fun YouScreen(
    auth: AuthUiState,
    syncedAt: Long? = null,
    syncError: String? = null,
    goalCount: Int = 0,
    routeCount: Int = 0,
    onOpenGoals: () -> Unit = {},
    onOpenRoutes: () -> Unit = {},
    onOpenHealth: () -> Unit = {},
    onOpenCalendar: () -> Unit = {},
    activityCount: Int = 0,
    onOpenActivities: () -> Unit = {},
    unread: Int = 0,
    onOpenNotifications: () -> Unit = {},
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onTab: (NavKind) -> Unit
) {
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
            Label("ACCOUNT")
            Spacer(Modifier.height(10.dp))
            Text("You", fontSize = 30.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
            Spacer(Modifier.height(20.dp))

            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(Tokens.Surface)
                    .padding(18.dp)
            ) {
                Text(
                    if (auth.signedIn) "SIGNED IN" else "NOT SIGNED IN",
                    fontSize = 12.sp,
                    letterSpacing = 0.7.sp,
                    fontWeight = FontWeight.Medium,
                    color = if (auth.signedIn) Tokens.Accent else Tokens.Muted
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    auth.email ?: "Your session log stays on this phone.",
                    fontSize = 16.sp,
                    color = Tokens.Fg
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    if (auth.signedIn) {
                        "Your log syncs both ways: sets logged here go up, history comes down."
                    } else {
                        "Sign in with Google to be ready for sync."
                    },
                    fontSize = 13.sp,
                    color = Tokens.Muted
                )
                Spacer(Modifier.height(16.dp))
                if (auth.signedIn) {
                    SecondaryButton("Sign out", onSignOut)
                } else {
                    PrimaryButton("Continue with Google", onSignIn)
                }
                auth.error?.let {
                    Spacer(Modifier.height(10.dp))
                    Text(it, fontSize = 13.sp, color = Tokens.Muted)
                }
                if (auth.signedIn) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        when {
                            syncError != null -> "History sync failed: $syncError"
                            syncedAt != null -> "History synced at ${clock(syncedAt)}"
                            else -> "Syncing history…"
                        },
                        fontSize = 12.sp,
                        color = Tokens.Muted
                    )
                }
            }

            Spacer(Modifier.height(24.dp))
            Label("GOALS")
            Spacer(Modifier.height(8.dp))
            NavRow(
                if (goalCount > 0) "$goalCount active goal${if (goalCount == 1) "" else "s"}"
                else "Set a goal"
            ) { onOpenGoals() }

            Spacer(Modifier.height(20.dp))
            Label("ROUTES")
            Spacer(Modifier.height(8.dp))
            NavRow(if (routeCount > 0) "$routeCount in the library" else "Routes") { onOpenRoutes() }

            Spacer(Modifier.height(20.dp))
            Label("HEALTH & CALENDAR")
            Spacer(Modifier.height(8.dp))
            NavRow("Health") { onOpenHealth() }
            Spacer(Modifier.height(8.dp))
            NavRow("Calendar") { onOpenCalendar() }

            Spacer(Modifier.height(20.dp))
            Label("ACTIVITIES")
            Spacer(Modifier.height(8.dp))
            NavRow(if (activityCount > 0) "$activityCount in the feed" else "Activities") {
                onOpenActivities()
            }
            Spacer(Modifier.height(8.dp))
            NavRow(if (unread > 0) "Notifications · $unread unread" else "Notifications") {
                onOpenNotifications()
            }

            Spacer(Modifier.height(24.dp))
            Label("THIS BUILD")
            Spacer(Modifier.height(8.dp))
            Text(
                "The dashboard, the lifting log, the cycling page, goals and routes; plan " +
                    "editing, health and the calendar are next.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.weight(1f))
        }
        BottomNav(NavKind.You, onTab)
    }
}

/** A row that opens another screen: the same shape for goals and routes. */
@Composable
private fun NavRow(label: String, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Tokens.Surface)
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, fontSize = 14.sp, color = Tokens.Fg, modifier = Modifier.weight(1f))
        Text("›", fontSize = 16.sp, color = Tokens.Muted)
    }
}
