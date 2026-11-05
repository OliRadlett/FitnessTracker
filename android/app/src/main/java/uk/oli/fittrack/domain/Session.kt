package uk.oli.fittrack.domain

import kotlinx.serialization.Serializable

@Serializable
data class PlanExercise(
    val name: String,
    val sets: Int,
    val reps: Int,
    val weightKg: Double
)

@Serializable
data class Plan(
    val title: String,
    val exercises: List<PlanExercise>
) {
    val totalSets: Int get() = exercises.sumOf { it.sets }
}

@Serializable
data class LoggedSet(
    val exercise: String,
    val weightKg: Double,
    val reps: Int,
    val rpe: Int,
    val at: Long
)

/** A session in progress. Persisted after every set, so the process dying mid-workout costs nothing. */
@Serializable
data class SessionState(
    val id: String,
    val startedAt: Long,
    val plan: Plan,
    val sets: List<LoggedSet> = emptyList()
) {
    val doneSets: Int get() = sets.size
}

data class Prefill(val weightKg: Double, val reps: Int, val rpe: Int)

/**
 * Pure session logic. No Android, no I/O — every rule the gym depends on lives
 * here so it can be tested without a device.
 */
object SessionEngine {

    fun doneFor(state: SessionState, exercise: String): Int =
        state.sets.count { it.exercise == exercise }

    /** The first exercise that still owes sets, in plan order. Null means the session is finished. */
    fun currentExercise(state: SessionState): PlanExercise? =
        state.plan.exercises.firstOrNull { doneFor(state, it.name) < it.sets }

    fun setNumber(state: SessionState, exercise: PlanExercise): Int =
        doneFor(state, exercise.name) + 1

    /**
     * What the fields should say before the next set: the set you just did for
     * this exercise, else the plan. RPE falls back to the plan's target effort.
     */
    fun prefill(state: SessionState, exercise: PlanExercise): Prefill {
        val last = state.sets.lastOrNull { it.exercise == exercise.name }
        return if (last != null) {
            Prefill(last.weightKg, last.reps, last.rpe)
        } else {
            Prefill(exercise.weightKg, exercise.reps, DEFAULT_RPE)
        }
    }

    fun volumeKg(sets: List<LoggedSet>): Double =
        sets.sumOf { it.weightKg * it.reps }

    /** Heaviest first, so the summary reads like a scoreboard rather than a table. */
    fun volumeByExercise(sets: List<LoggedSet>): List<Pair<String, Double>> =
        sets.groupBy { it.exercise }
            .map { (name, group) -> name to volumeKg(group) }
            .sortedByDescending { it.second }

    fun isComplete(state: SessionState): Boolean =
        state.plan.exercises.all { doneFor(state, it.name) >= it.sets }

    const val DEFAULT_RPE = 7
}

/** Rest between working sets. Fixed for v0.1; the plan will own it later. */
const val REST_MILLIS = 150_000L
