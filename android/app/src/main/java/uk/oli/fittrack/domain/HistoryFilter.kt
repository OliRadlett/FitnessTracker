package uk.oli.fittrack.domain

/** How the log is being narrowed. Every field empty means "all of it". */
data class HistoryQuery(
    val text: String = "",
    val focus: String? = null,
    val exercise: String? = null,
    /** Only sessions inside the last N days; null means no date limit. */
    val days: Int? = null
) {
    val active: Int
        get() = listOf(
            text.isNotBlank(),
            focus != null,
            exercise != null,
            days != null
        ).count { it }

    val isEmpty: Boolean get() = active == 0
}

/**
 * Filtering for the log, kept out of the screen so it is testable.
 *
 * The website's browser searches focus, notes, program and exercise names at
 * once; the app has no program field, so it searches what it has.
 */
object HistoryFilter {

    fun apply(
        history: List<FinishedSession>,
        query: HistoryQuery,
        now: Long
    ): List<FinishedSession> {
        if (query.isEmpty) return history
        val needle = query.text.trim().lowercase()
        // A day is a calendar day, not 86,400,000 ms: the cutoff must not drift
        // by an hour when the clocks change.
        val cutoff = query.days?.let { days ->
            java.time.Instant.ofEpochMilli(now)
                .atZone(java.time.ZoneId.systemDefault())
                .minusDays(days.toLong())
                .toInstant()
                .toEpochMilli()
        }

        return history.filter { session ->
            (cutoff == null || session.endedAt >= cutoff) &&
                (query.focus == null || session.planTitle == query.focus) &&
                (query.exercise == null || session.sets.any { it.exercise == query.exercise }) &&
                (needle.isEmpty() || matches(session, needle))
        }
    }

    private fun matches(session: FinishedSession, needle: String): Boolean {
        if (session.planTitle.lowercase().contains(needle)) return true
        session.note?.let { if (it.lowercase().contains(needle)) return true }
        return session.sets.any { it.exercise.lowercase().contains(needle) }
    }

    /** Focuses present in the history, most frequent first. */
    fun focuses(history: List<FinishedSession>): List<String> =
        history.groupingBy { it.planTitle }
            .eachCount()
            .entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .map { it.key }

    /** Exercises present in the history, most frequent first. */
    fun exercises(history: List<FinishedSession>, limit: Int = 8): List<String> =
        history.flatMap { it.sets }
            .filterNot { it.isWarmup }
            .groupingBy { it.exercise }
            .eachCount()
            .entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .map { it.key }
            .take(limit)
}
