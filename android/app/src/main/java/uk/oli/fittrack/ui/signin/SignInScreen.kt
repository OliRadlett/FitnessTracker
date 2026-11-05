package uk.oli.fittrack.ui.signin

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import uk.oli.fittrack.AuthUiState
import uk.oli.fittrack.ui.PrimaryButton
import uk.oli.fittrack.ui.theme.Tokens

/**
 * The front door. One identity, one button — and it says what is wrong rather
 * than failing silently.
 */
@Composable
fun SignInScreen(
    state: AuthUiState,
    configured: Boolean,
    onSignIn: (Activity) -> Unit
) {
    val context = LocalContext.current
    val activity = context.findActivity()

    Column(
        Modifier
            .fillMaxSize()
            .background(Tokens.Bg)
            .systemBarsPadding()
            .padding(horizontal = 24.dp)
    ) {
        Spacer(Modifier.weight(1f))
        Text("FitTrack", fontSize = 40.sp, fontWeight = FontWeight.SemiBold, color = Tokens.Fg)
        Spacer(Modifier.height(10.dp))
        Text(
            "Training, one set at a time.",
            fontSize = 16.sp,
            color = Tokens.Muted
        )
        Spacer(Modifier.weight(1f))

        when {
            !configured -> Text(
                "Sign-in is not configured in this build.\n" +
                    "Set googleWebClientId in android/local.properties (see docs/ANDROID-AUTH.md).",
                fontSize = 13.sp,
                color = Tokens.Muted
            )
            state.signingIn -> Text("Signing in…", fontSize = 14.sp, color = Tokens.Muted)
            else -> PrimaryButton("Continue with Google") {
                activity?.let(onSignIn)
            }
        }

        state.error?.let { message ->
            Spacer(Modifier.height(12.dp))
            Text(message, fontSize = 13.sp, color = Tokens.Muted)
        }

        Spacer(Modifier.height(16.dp))
        Text(
            "Your session log stays on this phone until you sign in.",
            fontSize = 12.sp,
            color = Tokens.Muted
        )
        Spacer(Modifier.height(32.dp))
    }
}

private fun Context.findActivity(): Activity? {
    var current = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
