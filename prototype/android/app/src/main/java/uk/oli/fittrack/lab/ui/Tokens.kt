package uk.oli.fittrack.lab.ui

import androidx.compose.ui.graphics.Color

/**
 * Design tokens for the phone surface.
 *
 * Derived from the web tokens in frontend/src/app/globals.css, with two
 * deliberate changes recorded in DECISIONS.md:
 *  - `Muted` is never rendered below full opacity. The web stat labels measured
 *    2.68:1 at 390dp because of opacity modifiers, not because of the token.
 *  - No text below 12sp. The web uses 10-11sp uppercase micro-labels.
 */
object Tokens {
    val Bg = Color(0xFF090E0E)          // --background 9 14 14
    val Surface = Color(0xFF121818)     // --surface 18 24 24
    val SurfaceLight = Color(0xFF1E2929) // --surface-light 30 41 41
    val Accent = Color(0xFF10B981)      // --accent emerald-500
    val Fg = Color(0xFFE6E6E6)          // --foreground
    val Muted = Color(0xFF94A3B8)       // --muted (7.58:1 on Bg)
    val OnAccent = Color(0xFF04150F)

    val LabelSize = 12
    val LabelTracking = 0.7f
}
