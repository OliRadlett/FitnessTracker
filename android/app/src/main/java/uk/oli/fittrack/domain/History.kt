package uk.oli.fittrack.domain

import kotlinx.serialization.Serializable

/** A session that actually happened, kept so the next one can learn from it. */
@Serializable
data class FinishedSession(
    val id: String,
    val planTitle: String,
    val startedAt: Long,
    val endedAt: Long,
    val sets: List<LoggedSet>
) {
    val volumeKg: Double get() = SessionEngine.volumeKg(sets)
}

object HistoryEngine {

    /** Newest first. The store writes this order; this is a safety net for old files. */
    fun newestFirst(history: List<FinishedSession>): List<FinishedSession> =
        history.sortedByDescending { it.endedAt }

    /**
     * The most recent set you performed for an exercise, across sessions.
     * This is what "last time" means, and what the next session prefills from.
     */
    fun lastSetFor(history: List<FinishedSession>, exercise: String): LoggedSet? =
        newestFirst(history).firstNotNullOfOrNull { session ->
            session.sets.lastOrNull { it.exercise == exercise }
        }

    /** The most recent finished session, whatever it was. */
    fun lastSession(history: List<FinishedSession>): FinishedSession? = newestFirst(history).firstOrNull()

    /** Volume per local day for the last [days] days, oldest first, zero-filled. */
    fun dailyVolume(
        history: List<FinishedSession>,
        nowMillis: Long,
        days: Int = 7,
        zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
        dayOf: (Long) -> java.time.LocalDate = { millis ->
            java.time.Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
        }
    ): List<Pair<java.time.LocalDate, Double>> {
        val today = dayOf(nowMillis)
        val start = today.minusDays((days - 1).toLong())
        val totals = mutableMapOf<java.time.LocalDate, Double>()
        for (session in history) {
            val day = dayOf(session.endedAt)
            if (day < start || day > today) continue
            totals[day] = (totals[day] ?: 0.0) + session.volumeKg
        }
        return (0 until days).map { offset ->
            val day = start.plusDays(offset.toLong())
            day to (totals[day] ?: 0.0)
        }
    }
}
