package uk.oli.fittrack.domain

import kotlinx.serialization.Serializable

/**
 * The three Jev axes the website shows as session chips. All nullable: a
 * session the classifier has not reached yet has no labels, and an unlabelled
 * session must still read as a session.
 */
@Serializable
data class SessionLabels(
    /** push / pull / legs / upper / lower / full_body */
    val split: String? = null,
    /** squat / bench / deadlift / overhead_press / accessory */
    val lift: String? = null,
    /** max_strength / volume_hypertrophy / speed_power / technique / … */
    val klass: String? = null
) {
    val any: Boolean get() = split != null || lift != null || klass != null
}

/** The Strava activity a session was matched to, if any. */
@Serializable
data class LinkedActivity(
    val id: String,
    val name: String,
    val source: String = "strava",
    val startAt: Long = 0L,
    val durationSeconds: Int? = null
)

/** A session that actually happened, kept so the next one can learn from it. */
@Serializable
data class FinishedSession(
    val id: String,
    val planTitle: String,
    val startedAt: Long,
    val endedAt: Long,
    val sets: List<LoggedSet>,
    /**
     * True once the session exists on the server. Pulled sessions arrive true;
     * a session logged on this phone starts false and is pushed on the next sync.
     * After a successful push the id becomes the server id, so the following pull
     * cannot bring the same workout back under a different one.
     */
    val synced: Boolean = false,
    /** What you wrote about the session. Shown on the detail screen, editable later. */
    val note: String? = null,
    /** The session's own RPE (a whole-session effort rating, not a per-set one). */
    val rpeSession: Double? = null,
    /** Classifier output; read-only here. */
    val labels: SessionLabels? = null,
    /** The Strava ride/walk the session was linked to, if any. */
    val linkedActivity: LinkedActivity? = null
) {
    val volumeKg: Double get() = SessionEngine.volumeKg(sets)
}

object HistoryEngine {

    /** Newest first. The store writes this order; this is a safety net for old files. */
    fun newestFirst(history: List<FinishedSession>): List<FinishedSession> =
        history.sortedByDescending { it.endedAt }

    /**
     * The most recent **working** set you performed for an exercise, across
     * sessions. This is what "last time" means, and what the next session
     * prefills from — a warm-up is not a reference lift.
     */
    fun lastSetFor(history: List<FinishedSession>, exercise: String): LoggedSet? =
        newestFirst(history).firstNotNullOfOrNull { session ->
            session.sets.lastOrNull { it.exercise == exercise && !it.isWarmup }
        }

    /** The most recent finished session, whatever it was. */
    fun lastSession(history: List<FinishedSession>): FinishedSession? = newestFirst(history).firstOrNull()

    /**
     * Move a session by whole days, keeping its time of day and its duration.
     *
     * `plusDays` on a zoned time is the only arithmetic that survives a DST
     * boundary: adding 86,400,000 ms to the instant would move a 18:00 session
     * to 17:00 or 19:00 the day the clocks change.
     */
    fun shifted(
        session: FinishedSession,
        days: Long,
        zone: java.time.ZoneId = java.time.ZoneId.systemDefault()
    ): FinishedSession {
        if (days == 0L) return session
        fun shift(millis: Long): Long =
            java.time.Instant.ofEpochMilli(millis).atZone(zone).plusDays(days)
                .toInstant().toEpochMilli()

        return session.copy(
            startedAt = shift(session.startedAt),
            endedAt = shift(session.endedAt)
        )
    }

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
