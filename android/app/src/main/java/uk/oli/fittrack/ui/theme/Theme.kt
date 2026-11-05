package uk.oli.fittrack.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * Brand tokens, carried over from the web (`frontend/src/app/globals.css`) and
 * from the design lab. Two rules came out of the lab and hold here:
 * muted text is never alpha-blended, and nothing renders below 12sp.
 */
object Tokens {
    val Bg = Color(0xFF090E0E)
    val Surface = Color(0xFF121818)
    val SurfaceLight = Color(0xFF1E2929)
    val Accent = Color(0xFF10B981)
    val Fg = Color(0xFFE6E6E6)
    val Muted = Color(0xFF94A3B8)
    val OnAccent = Color(0xFF04150F)
}

@Composable
fun FitTrackTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Tokens.Accent,
            onPrimary = Tokens.OnAccent,
            background = Tokens.Bg,
            onBackground = Tokens.Fg,
            surface = Tokens.Surface,
            onSurface = Tokens.Fg,
            surfaceVariant = Tokens.SurfaceLight,
            onSurfaceVariant = Tokens.Muted
        ),
        content = content
    )
}
