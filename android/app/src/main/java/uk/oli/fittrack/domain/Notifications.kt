package uk.oli.fittrack.domain

import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/** One thing the server wanted to tell you. */
data class Notification(
    val id: String,
    val type: String,
    val title: String,
    val body: String,
    val severity: String = "info",
    val link: String = "",
    val read: Boolean = false,
    val createdAt: Long? = null
) {
    /** "Health alert", "PR", … — the type, as words. */
    val typeLabel: String
        get() = when (type) {
            "health_alert" -> "Health"
            "pr" -> "Record"
            "goal_milestone" -> "Goal"
            "plan_reminder" -> "Plan"
            "connection_reauth" -> "Connection"
            "ftp_stale" -> "FTP"
            "event_result" -> "Event"
            "race_day" -> "Race"
            else -> type.replace('_', ' ').replaceFirstChar { it.uppercase() }
        }

    /** Only a warning or an alert earns the accent colour. */
    val isUrgent: Boolean
        get() = severity == "warning" || severity == "critical" || severity == "error"

    fun age(now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String {
        val at = createdAt ?: return ""
        val then = Instant.ofEpochMilli(at).atZone(zone)
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val date = then.toLocalDate()
        return when {
            date == today -> then.format(
                java.time.format.DateTimeFormatter.ofPattern("HH:mm", Locale.UK)
            )
            date == today.minusDays(1) -> "Yesterday"
            date.isAfter(today.minusDays(7)) ->
                date.format(java.time.format.DateTimeFormatter.ofPattern("EEE", Locale.UK))
            else -> date.format(java.time.format.DateTimeFormatter.ofPattern("d MMM", Locale.UK))
        }
    }
}

/** Unread first, then newest — a list you can act on. */
fun orderNotifications(items: List<Notification>): List<Notification> =
    items.sortedWith(
        compareBy<Notification> { it.read }.thenByDescending { it.createdAt ?: 0L }
    )

/** The badge: "3 unread" or nothing when everything has been read. */
fun unreadLabel(items: List<Notification>): String {
    val unread = items.count { !it.read }
    return when {
        unread == 0 -> "All read"
        unread == 1 -> "1 unread"
        else -> "$unread unread"
    }
}
