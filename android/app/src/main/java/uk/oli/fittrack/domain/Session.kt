package uk.oli.fittrack.domain

import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

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
    /**
     * Null when the set was logged without one. The API allows that, and
     * inventing a 7 would make the app's copy of a session disagree with the
     * website's for no reason.
     */
    val rpe: Double? = null,
    val at: Long = 0L,
    /** A ramp-up set. Kept in history for fidelity, never used to prefill. */
    val isWarmup: Boolean = false,
    /** AMRAP set: as many reps as possible, so `reps` is a floor, not a target. */
    val isAmrap: Boolean = false,
    val note: String? = null,
    /** The server's set id once the session is on the server; null while local-only. */
    val serverId: String? = null,
    /**
     * The client-owned identity the API dedupes on. Stable across retries, and
     * the only way to find a set again after an append whose response was lost.
     */
    val clientId: String? = null
)

/** What the instrument is about to log. */
data class SetEntry(
    val weightKg: Double,
    val reps: Int,
    /** Null is a legitimate answer: the website logs sets without an RPE. */
    val rpe: Double?,
    val isWarmup: Boolean = false,
    val isAmrap: Boolean = false
)

/** A session in progress. Persisted after every set, so the process dying mid-workout costs nothing. */
@Serializable
data class SessionState(
    val id: String,
    val startedAt: Long,
    val plan: Plan,
    val sets: List<LoggedSet> = emptyList(),
    /**
     * Target rest between working sets, in seconds. Adjustable mid-session, and
     * persisted with everything else so a process death does not reset it.
     */
    val restSeconds: Int = DEFAULT_REST_SECONDS
) {
    /** Warm-ups are sets you did, but they are not sets the plan asked for. */
    val doneSets: Int get() = sets.count { !it.isWarmup }
}

data class Prefill(val weightKg: Double, val reps: Int, val rpe: Int)

/** One exercise's sets in the order they were performed, warm-ups included. */
data class ExerciseSets(val exercise: String, val sets: List<LoggedSet>) {
    val workingSets: List<LoggedSet> get() = sets.filterNot { it.isWarmup }

    /** Working volume only: a warm-up bar contributes no tonnage, by the backend's own rule. */
    val volumeKg: Double get() = SessionEngine.volumeKg(sets)
}

/**
 * Pure session logic. No Android, no I/O — every rule the gym depends on lives
 * here so it can be tested without a device.
 */
object SessionEngine {

    /** Sets that count towards the plan. A warm-up never does. */
    fun workingSets(sets: List<LoggedSet>): List<LoggedSet> = sets.filterNot { it.isWarmup }

    fun doneFor(state: SessionState, exercise: String): Int =
        state.sets.count { it.exercise == exercise && !it.isWarmup }

    /** The first exercise that still owes sets, in plan order. Null means the session is finished. */
    fun currentExercise(state: SessionState): PlanExercise? =
        state.plan.exercises.firstOrNull { doneFor(state, it.name) < it.sets }

    fun setNumber(state: SessionState, exercise: PlanExercise): Int =
        doneFor(state, exercise.name) + 1

    /**
     * What the fields should say before the next set, in order of truth:
     * the set you just did for this exercise, then the same exercise last
     * session, then the plan.
     *
     * Warm-ups are excluded at every step: prefilling the next working set from
     * a ramp-up would have you pressing a load you cannot handle.
     */
    fun prefill(
        state: SessionState,
        exercise: PlanExercise,
        history: List<FinishedSession> = emptyList()
    ): Prefill {
        val thisSession = state.sets.lastOrNull { it.exercise == exercise.name && !it.isWarmup }
        val previous = thisSession ?: HistoryEngine.lastSetFor(history, exercise.name)
        return if (previous != null) {
            Prefill(previous.weightKg, previous.reps, previous.rpe?.roundToInt() ?: DEFAULT_RPE)
        } else {
            Prefill(exercise.weightKg, exercise.reps, DEFAULT_RPE)
        }
    }

    fun volumeKg(sets: List<LoggedSet>): Double =
        workingSets(sets).sumOf { it.weightKg * it.reps }

    /** Heaviest first, so the summary reads like a scoreboard rather than a table. */
    fun volumeByExercise(sets: List<LoggedSet>): List<Pair<String, Double>> =
        groupedByExercise(sets)
            .map { it.exercise to it.volumeKg }
            .filter { it.second > 0.0 }
            .sortedByDescending { it.second }

    /**
     * Every exercise in the order it first appears, warm-ups kept. Session
     * detail needs the ramps shown; the plan and the summary must not count them.
     */
    fun groupedByExercise(sets: List<LoggedSet>): List<ExerciseSets> {
        val order = LinkedHashMap<String, MutableList<LoggedSet>>()
        for (set in sets) order.getOrPut(set.exercise) { mutableListOf() }.add(set)
        return order.map { (exercise, group) -> ExerciseSets(exercise, group) }
    }

    fun isComplete(state: SessionState): Boolean =
        state.plan.exercises.all { doneFor(state, it.name) >= it.sets }

    /** Clamp a rest adjustment into something a gym actually uses. */
    fun restTarget(currentSeconds: Int, deltaSeconds: Int): Int =
        (currentSeconds + deltaSeconds).coerceIn(MIN_REST_SECONDS, MAX_REST_SECONDS)

    /**
     * The plan a repeat of a finished session should prescribe: the same
     * exercises in the same order, the same number of **working** sets, and the
     * last working set's load and reps as the target.
     *
     * Warm-ups are deliberately not part of the plan — they are something you
     * ramp through, not a set the session owes you.
     */
    fun planFrom(session: FinishedSession): Plan = Plan(
        title = session.planTitle,
        exercises = groupedByExercise(session.sets).mapNotNull { group ->
            val working = group.workingSets
            val last = working.lastOrNull() ?: return@mapNotNull null
            PlanExercise(
                name = group.exercise,
                sets = working.size,
                reps = last.reps,
                weightKg = last.weightKg
            )
        }
    )

    const val DEFAULT_RPE = 7
}

/** Rest between working sets. The plan will own this later; the session owns it for now. */
const val DEFAULT_REST_SECONDS = 150
const val MIN_REST_SECONDS = 60
const val MAX_REST_SECONDS = 600
const val REST_STEP_SECONDS = 30
