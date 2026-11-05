package uk.oli.fittrack.ui

import java.util.Locale

fun formatWeight(value: Float): String =
    if (value % 1f == 0f) value.toInt().toString()
    else String.format(Locale.UK, "%.1f", value)

fun formatWeight(value: Double): String = formatWeight(value.toFloat())

fun formatDuration(millis: Long): String {
    val minutes = millis / 60_000
    return if (minutes >= 60) "${minutes / 60}h ${minutes % 60}m" else "${minutes}m"
}

fun formatRemaining(millis: Long): String {
    val total = (millis / 1000).coerceAtLeast(0)
    return String.format(Locale.UK, "%d:%02d", total / 60, total % 60)
}
