package uk.oli.fittrack.ui

import java.util.Locale

fun formatWeight(value: Float): String =
    if (value % 1f == 0f) value.toInt().toString()
    else String.format(Locale.UK, "%.1f", value)

fun formatWeight(value: Double): String = formatWeight(value.toFloat())

fun formatDuration(millis: Long): String {
    val minutes = millis / 60_000
    return when {
        minutes < 1 -> "<1m"
        minutes >= 60 -> "${minutes / 60}h ${minutes % 60}m"
        else -> "${minutes}m"
    }
}

fun formatRemaining(millis: Long): String {
    val total = (millis / 1000).coerceAtLeast(0)
    return String.format(Locale.UK, "%d:%02d", total / 60, total % 60)
}

/**
 * RPE as the website prints it: half points kept, whole numbers without a
 * trailing `.0`, and an em dash when the set carried none.
 */
fun formatRpe(rpe: Double?): String = when {
    rpe == null -> "—"
    rpe % 1.0 == 0.0 -> rpe.toInt().toString()
    else -> String.format(Locale.UK, "%.1f", rpe)
}

/** "1 set" / "2 sets" — counts read as prose on a screen this small. */
fun plural(count: Int, singular: String, plural: String = singular + "s"): String =
    "$count " + if (count == 1) singular else plural
