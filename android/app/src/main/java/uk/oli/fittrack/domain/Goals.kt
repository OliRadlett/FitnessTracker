package uk.oli.fittrack.domain

import java.time.LocalDate

/**
 * A goal, as `GET /goals` gives it and as the goals page needs it.
 *
 * Progress is measured from `starting` when the server has one: a goal of 80 kg
 * from a start of 100 kg is 20% done at 96 kg, not 120%. A server-supplied
 * percentage wins where it exists, because the server knows about filters the
 * phone does not decode.
 */
data class Goal(
    val id: String,
    val metric: String,
    val target: Double,
    val current: Double? = null,
    val starting: Double? = null,
    val targetDate: String? = null,
    val status: String = "active",
    val serverProgressPct: Double? = null,
    val note: String? = null,
    val direction: String? = null,
    /** Filled from the metrics registry: "Bodyweight", "FTP", … */
    val label: String = "",
    val unit: String = ""
) {
    val progressPct: Double?
        get() {
            serverProgressPct?.let { return it.coerceIn(0.0, 100.0) }
            val now = current ?: return null
            val start = starting
            return when {
                start == null && target > 0.0 -> (now / target * 100.0).coerceIn(0.0, 100.0)
                start != null && start != target ->
                    ((now - start) / (target - start) * 100.0).coerceIn(0.0, 100.0)
                now >= target -> 100.0
                else -> 0.0
            }
        }

    val isActive: Boolean get() = status == "active"

    /** "78.5 → 80 kg", without pretending to know more than the registry said. */
    fun describe(current: Double? = this.current): String {
        val now = current ?: return format(target)
        return "${format(now)} → ${format(target)}"
    }

    fun format(value: Double): String {
        val number = if (value == value.toLong().toDouble()) value.toLong().toString()
        else String.format(java.util.Locale.UK, "%.1f", value)
        return if (unit.isBlank()) number else "$number $unit"
    }

    val daysLeft: Long?
        get() = targetDate?.let {
            runCatching { java.time.temporal.ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(it)) }
                .getOrNull()
        }
}

/** One entry in the metrics registry (`GET /goals/metrics`). */
data class GoalMetric(
    val key: String,
    val label: String,
    val unit: String = "",
    val defaultDirection: String = "increase",
    /** Metrics that need a filter (e.g. an exercise name) are not offered yet. */
    val requiresFilter: List<String> = emptyList()
) {
    val supported: Boolean get() = requiresFilter.isEmpty()
}

/** One check-in on a goal. */
data class GoalCheckIn(
    val id: String,
    val date: String,
    val value: Double,
    val note: String? = null,
    val source: String = "manual"
)

/** Active first, then by nearest target date; a finished goal still shows last. */
fun orderedGoals(goals: List<Goal>): List<Goal> = goals.sortedWith(
    compareBy(
        { if (it.isActive) 0 else 1 },
        { it.targetDate ?: "9999-12-31" },
        { it.metric }
    )
)

fun activeGoals(goals: List<Goal>, limit: Int = 3): List<Goal> =
    orderedGoals(goals).filter { it.isActive }.take(limit)

/** "active", "achieved", "archived" — as a person reads it. */
fun statusLabel(status: String): String = when (status) {
    "active" -> "Active"
    "achieved" -> "Achieved"
    "expired" -> "Expired"
    "abandoned" -> "Abandoned"
    "archived" -> "Archived"
    else -> status.replaceFirstChar { it.uppercase() }
}

/** A metric's label, falling back to a readable form of its key. */
fun metricLabel(key: String, registry: List<GoalMetric> = emptyList()): String {
    registry.firstOrNull { it.key == key }?.label?.let { return it }
    return when (key) {
        "weight_kg" -> "Bodyweight"
        "ftp_watts" -> "FTP"
        "ctl" -> "Fitness (CTL)"
        "squat_kg" -> "Back squat"
        "bench_kg" -> "Bench press"
        "deadlift_kg" -> "Deadlift"
        "weekly_volume_kg" -> "Weekly volume"
        "vo2max" -> "VO2max"
        else -> key.replace('_', ' ')
            .replaceFirstChar { it.uppercase() }
    }
}

/** The unit for a metric, from the registry when it has one. */
fun metricUnit(key: String, registry: List<GoalMetric> = emptyList()): String =
    registry.firstOrNull { it.key == key }?.unit.orEmpty()
