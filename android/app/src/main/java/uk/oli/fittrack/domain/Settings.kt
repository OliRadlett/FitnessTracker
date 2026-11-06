package uk.oli.fittrack.domain

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.Locale

/** How the numbers are written, as the server stores it. */
data class Preferences(
    val unitSystem: String = "metric",
    val locale: String = "en-GB",
    val timeFormat: String = "24h",
    val heightCm: Double? = null
) {
    val isMetric: Boolean get() = unitSystem != "imperial"

    /** "Metric · kg, km · 24h" — the summary line. */
    fun describe(): String {
        val units = if (isMetric) "Metric · kg, km" else "Imperial · lb, mi"
        return "$units · $timeFormat"
    }
}

/** One provider connection, and whether it is carrying data. */
data class Connection(
    val id: String,
    val provider: String,
    val status: String = "active",
    val lastSyncedAt: Long? = null,
    val lastError: String? = null,
    val consecutiveFailures: Int = 0
) {
    val name: String
        get() = provider.replaceFirstChar { it.uppercase(Locale.UK) }

    val isBroken: Boolean
        get() = status != "active" || consecutiveFailures >= 2 || lastError != null

    /** "Synced 2h ago", "Never synced", "Needs re-auth". */
    fun health(now: Long = System.currentTimeMillis()): String {
        if (status == "needs_reauth" || status == "revoked") return "Needs re-auth"
        lastError?.let { return "Last error: ${it.take(60)}" }
        val at = lastSyncedAt ?: return "Never synced"
        val hours = ChronoUnit.HOURS.between(
            Instant.ofEpochMilli(at),
            Instant.ofEpochMilli(now)
        )
        return when {
            hours < 1 -> "Synced just now"
            hours < 24 -> "Synced ${hours}h ago"
            hours < 48 -> "Synced yesterday"
            else -> "Synced ${hours / 24} days ago"
        }
    }

    /** A stale connection is the one thing a settings page must shout about. */
    fun isStale(now: Long = System.currentTimeMillis(), hours: Long = 48): Boolean {
        val at = lastSyncedAt ?: return true
        return ChronoUnit.HOURS.between(Instant.ofEpochMilli(at), Instant.ofEpochMilli(now)) >= hours
    }
}

/** Both halves of the settings page; either may be missing. */
data class SettingsSnapshot(
    val preferences: Preferences? = null,
    val connections: List<Connection> = emptyList()
) {
    val broken: List<Connection> get() = connections.filter { it.isBroken }
}

/** The providers the website offers, in the order a reader expects. */
val KNOWN_PROVIDERS = listOf("strava", "whoop", "wahoo", "komoot", "withings", "garmin")

/** Connections in provider order, unknown ones last. */
fun orderConnections(items: List<Connection>): List<Connection> =
    items.sortedWith(
        compareBy(
            { KNOWN_PROVIDERS.indexOf(it.provider.lowercase(Locale.UK)).let { i -> if (i < 0) 99 else i } },
            { it.provider }
        )
    )

/** "3 connections · 1 needs attention". */
fun connectionsLabel(items: List<Connection>): String {
    val broken = items.count { it.isBroken }
    val total = if (items.size == 1) "1 connection" else "${items.size} connections"
    return if (broken == 0) total else "$total · $broken needs attention"
}

/** A date as a settings row reads it. */
fun syncedDate(at: Long?, zone: ZoneId = ZoneId.systemDefault()): String {
    val millis = at ?: return "Never"
    return Instant.ofEpochMilli(millis).atZone(zone)
        .format(java.time.format.DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.UK))
}
