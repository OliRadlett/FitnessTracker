package uk.oli.fittrack.domain

/** The best set you have done for an exercise, judged by estimated 1RM. */
data class PersonalBest(
    val exercise: String,
    val weightKg: Double,
    val reps: Int,
    val at: Long
) {
    val estimated1rm: Double get() = ProgressEngine.estimated1rm(weightKg, reps)
}

/** A rep bucket, as the website's best-by-rep-range strip groups them. */
data class RepRange(val label: String, val minReps: Int, val maxReps: Int?) {
    fun contains(reps: Int): Boolean = reps >= minReps && (maxReps == null || reps <= maxReps)
}

/**
 * Progress computed from the sets themselves.
 *
 * The website reads its PRs from a server table; this reads the same sets
 * locally, so the screen works on a phone with no signal and cannot disagree
 * with the log it is drawn from. Manual PRs (no session behind them) are the one
 * thing that needs the server, and the app does not offer them yet.
 */
object ProgressEngine {

    val REP_RANGES = listOf(
        RepRange("1", 1, 1),
        RepRange("2–3", 2, 3),
        RepRange("4–6", 4, 6),
        RepRange("7–12", 7, 12),
        RepRange("12+", 13, null)
    )

    /**
     * Brzycki: 1RM = w × 36 / (37 − reps). A single is its own 1RM. Beyond ~30
     * reps the denominator goes to zero, so reps are capped for the estimate —
     * a 30-rep set tells you very little about a max anyway.
     */
    fun estimated1rm(weightKg: Double, reps: Int): Double =
        if (reps <= 1) weightKg else weightKg * 36.0 / (37.0 - reps.coerceAtMost(30))

    /** The heaviest estimated 1RM per exercise, strongest first. */
    fun personalBests(history: List<FinishedSession>): List<PersonalBest> =
        history.flatMap { it.sets }
            .filterNot { it.isWarmup }
            .groupBy { it.exercise }
            .mapNotNull { (name, sets) ->
                sets.maxByOrNull { estimated1rm(it.weightKg, it.reps) }
                    ?.let { PersonalBest(name, it.weightKg, it.reps, it.at) }
            }
            .sortedByDescending { it.estimated1rm }

    /**
     * The heaviest set in each rep bucket for one exercise, with an empty bucket
     * kept as null so the strip always shows five ranges — a blank row is
     * information ("you have never done a single"), a missing row is not.
     */
    fun bestByRepRange(
        history: List<FinishedSession>,
        exercise: String
    ): List<Pair<RepRange, PersonalBest?>> {
        val sets = history.flatMap { it.sets }
            .filter { it.exercise == exercise && !it.isWarmup }
        return REP_RANGES.map { range ->
            val best = sets.filter { range.contains(it.reps) }
                // Heaviest wins; at equal weight, more reps is the better set.
                .maxByOrNull { it.weightKg * 1_000.0 + it.reps }
                ?.let { PersonalBest(exercise, it.weightKg, it.reps, it.at) }
            range to best
        }
    }

    /** Best estimated 1RM per session for one exercise, oldest first, capped at [limit]. */
    fun progressSeries(
        history: List<FinishedSession>,
        exercise: String,
        limit: Int = 20
    ): List<Pair<Long, Double>> =
        HistoryEngine.newestFirst(history)
            .take(limit)
            .mapNotNull { session ->
                val best = session.sets
                    .filter { it.exercise == exercise && !it.isWarmup }
                    .maxByOrNull { estimated1rm(it.weightKg, it.reps) }
                    ?: return@mapNotNull null
                session.endedAt to estimated1rm(best.weightKg, best.reps)
            }
            .reversed()

    /** Exercises seen in history, most-frequent first. */
    fun exerciseNames(history: List<FinishedSession>, limit: Int = 8): List<String> =
        history.flatMap { it.sets }
            .filterNot { it.isWarmup }
            .groupingBy { it.exercise }
            .eachCount()
            .entries
            .sortedByDescending { it.value }
            .map { it.key }
            .take(limit)
}
