package uk.oli.fittrack.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.Plan
import uk.oli.fittrack.domain.PlanExercise
import uk.oli.fittrack.domain.SessionState
import java.io.File

/**
 * The session in progress, written to disk on every set.
 *
 * A file, not Room: v0.1 has exactly one row of state and no queries. Room earns
 * its keep when the log grows history and needs indexes — at which point this
 * class is the seam to replace, not the screens.
 */
class SessionStore(filesDir: File) {

    private val file = File(filesDir, "session.json")
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun load(): SessionState? = runCatching {
        if (!file.exists()) return null
        json.decodeFromString<SessionState>(file.readText())
    }.getOrNull()

    fun save(state: SessionState) {
        runCatching { file.writeText(json.encodeToString(state)) }
    }

    fun clear() {
        runCatching { file.delete() }
    }
}

/**
 * The plan the app starts from, seeded from the real 3 Nov 2026 bench session.
 * It is a placeholder for GET /lifting/sessions + the training plan, and the
 * only place in the app that knows workout content.
 */
object SeedPlan {
    val pushDay = Plan(
        title = "Push day",
        exercises = listOf(
            PlanExercise("Bench Press", sets = 4, reps = 4, weightKg = 90.0),
            PlanExercise("Close Grip Bench Press", sets = 2, reps = 12, weightKg = 70.0),
            PlanExercise("Tricep Extension", sets = 3, reps = 12, weightKg = 46.0),
            PlanExercise("Machine Shoulder Press", sets = 2, reps = 9, weightKg = 40.0),
            PlanExercise("Incline Dumbbell Press", sets = 2, reps = 8, weightKg = 30.0),
            PlanExercise("Lateral Raise", sets = 3, reps = 12, weightKg = 7.5)
        )
    )
}

fun emptySession(plan: Plan): SessionState = SessionState(
    id = java.util.UUID.randomUUID().toString(),
    startedAt = System.currentTimeMillis(),
    plan = plan,
    sets = emptyList()
)

fun SessionState.withSet(set: LoggedSet): SessionState = copy(sets = sets + set)
