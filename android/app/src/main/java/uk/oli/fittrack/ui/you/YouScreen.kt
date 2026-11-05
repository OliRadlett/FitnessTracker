package uk.oli.fittrack.ui.you

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

/**
 * Account and settings. Sign-in lives here rather than in front of the app:
 * logging a set must never wait on a network round trip.
 */
@Composable
fun YouScreen(
    auth: AuthUiState,
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
        Column(Modifier.weight(1f).padding(horizontal = 20.dp)) {
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
                        "Sync is not wired up yet — the log is still local."
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
            }

            Spacer(Modifier.height(24.dp))
            Label("THIS BUILD")
            Spacer(Modifier.height(8.dp))
            Text(
                "Today, live logging and the summary. Plan sync, history and the " +
                    "Train/Ride/Body tabs are next; prototype/android/PARITY.md has the map.",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            Spacer(Modifier.weight(1f))
        }
        BottomNav(NavKind.You, onTab)
    }
}
