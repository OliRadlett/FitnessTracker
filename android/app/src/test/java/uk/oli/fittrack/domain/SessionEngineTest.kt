package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionEngineTest {

    private val legacyJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    private val plan = Plan(
        title = "Push day",
        exercises = listOf(
            PlanExercise("Bench Press", sets = 2, reps = 4, weightKg = 90.0),
            PlanExercise("Lateral Raise", sets = 2, reps = 12, weightKg = 7.5)
        )
    )

    private fun started() = SessionState(id = "s1", startedAt = 0L, plan = plan)

    private fun stateWith(vararg sets: LoggedSet) = started().copy(sets = sets.toList())

    private fun set(exercise: String, kg: Double, reps: Int, rpe: Int = 7, warmup: Boolean = false) =
        LoggedSet(exercise, kg, reps, rpe.toDouble(), at = 0L, isWarmup = warmup)

    @Test
    fun `starts on the first exercise`() {
        assertEquals("Bench Press", SessionEngine.currentExercise(started())?.name)
    }

    @Test
    fun `moves to the next exercise only when the sets are done`() {
        val one = stateWith(set("Bench Press", 90.0, 4))
        assertEquals("Bench Press", SessionEngine.currentExercise(one)?.name)

        val two = stateWith(set("Bench Press", 90.0, 4), set("Bench Press", 90.0, 4))
        assertEquals("Lateral Raise", SessionEngine.currentExercise(two)?.name)
    }

    @Test
    fun `prefill repeats the set you just did`() {
        val state = stateWith(set("Bench Press", 92.5, 3, rpe = 8))
        val prefill = SessionEngine.prefill(state, plan.exercises.first())

        assertEquals(92.5, prefill.weightKg, 0.001)
        assertEquals(3, prefill.reps)
        assertEquals(8, prefill.rpe)
    }

    @Test
    fun `prefill falls back to the plan before any set`() {
        val prefill = SessionEngine.prefill(started(), plan.exercises.first())

        assertEquals(90.0, prefill.weightKg, 0.001)
        assertEquals(4, prefill.reps)
        assertEquals(SessionEngine.DEFAULT_RPE, prefill.rpe)
    }

    @Test
    fun `volume is weight times reps, summed`() {
        val state = stateWith(
            set("Bench Press", 90.0, 4),
            set("Lateral Raise", 7.5, 12)
        )
        assertEquals(360.0 + 90.0, SessionEngine.volumeKg(state.sets), 0.001)
    }

    @Test
    fun `summary is heaviest first`() {
        val state = stateWith(
            set("Lateral Raise", 7.5, 12),
            set("Bench Press", 90.0, 4)
        )
        assertEquals(listOf("Bench Press", "Lateral Raise"), SessionEngine.volumeByExercise(state.sets).map { it.first })
    }

    @Test
    fun `session is complete only when every planned set is logged`() {
        assertFalse(SessionEngine.isComplete(stateWith(set("Bench Press", 90.0, 4))))

        val done = stateWith(
            set("Bench Press", 90.0, 4),
            set("Bench Press", 90.0, 4),
            set("Lateral Raise", 7.5, 12),
            set("Lateral Raise", 7.5, 12)
        )
        assertTrue(SessionEngine.isComplete(done))
        assertNull(SessionEngine.currentExercise(done))
    }

    @Test
    fun `extra sets beyond the plan do not resurrect the exercise`() {
        val over = stateWith(
            set("Bench Press", 90.0, 4),
            set("Bench Press", 90.0, 4),
            set("Bench Press", 90.0, 4)
        )
        assertEquals("Lateral Raise", SessionEngine.currentExercise(over)?.name)
    }

    @Test
    fun `set number is one past what is logged`() {
        val state = stateWith(set("Bench Press", 90.0, 4))
        assertEquals(2, SessionEngine.setNumber(state, plan.exercises.first()))
    }

    @Test
    fun `a warm-up does not count towards the plan`() {
        val state = stateWith(set("Bench Press", 60.0, 8, warmup = true))

        assertEquals(0, SessionEngine.doneFor(state, "Bench Press"))
        assertEquals("Bench Press", SessionEngine.currentExercise(state)?.name)
        assertEquals(1, SessionEngine.setNumber(state, plan.exercises.first()))
    }

    @Test
    fun `a warm-up never prefills the next working set`() {
        val state = stateWith(
            set("Bench Press", 60.0, 8, rpe = 4, warmup = true),
            set("Bench Press", 90.0, 4, rpe = 8)
        )

        val prefill = SessionEngine.prefill(state, plan.exercises.first())

        assertEquals(90.0, prefill.weightKg, 0.001)
        assertEquals(8, prefill.rpe)
    }

    @Test
    fun `volume excludes warm-ups, matching the backend`() {
        val state = stateWith(
            set("Bench Press", 60.0, 8, warmup = true),
            set("Bench Press", 90.0, 4)
        )

        assertEquals(360.0, SessionEngine.volumeKg(state.sets), 0.001)
    }

    @Test
    fun `a repeat plan copies working sets and skips warm-ups`() {
        val session = FinishedSession(
            id = "s1",
            planTitle = "Legs",
            startedAt = 0L,
            endedAt = 1_000L,
            sets = listOf(
                LoggedSet("Back Squat", 60.0, 8, 4.0, isWarmup = true),
                LoggedSet("Back Squat", 130.0, 3, 9.0),
                LoggedSet("Back Squat", 130.0, 3, 9.0),
                LoggedSet("Leg Press", 200.0, 10, 8.0)
            )
        )

        val plan = SessionEngine.planFrom(session)

        assertEquals("Legs", plan.title)
        assertEquals(listOf("Back Squat", "Leg Press"), plan.exercises.map { it.name })
        assertEquals(2, plan.exercises[0].sets)
        assertEquals(3, plan.exercises[0].reps)
        assertEquals(130.0, plan.exercises[0].weightKg, 0.001)
        assertEquals(1, plan.exercises[1].sets)
        assertEquals(200.0, plan.exercises[1].weightKg, 0.001)
    }

    @Test
    fun `a session of nothing but warm-ups cannot be repeated`() {
        val session = FinishedSession(
            id = "s1",
            planTitle = "Legs",
            startedAt = 0L,
            endedAt = 1_000L,
            sets = listOf(LoggedSet("Back Squat", 60.0, 8, 4.0, isWarmup = true))
        )

        assertTrue(SessionEngine.planFrom(session).exercises.isEmpty())
    }

    @Test
    fun `finishing carries the session note and effort, not just the sets`() {
        val state = stateWith(
            set("Bench Press", 90.0, 4),
            set("Bench Press", 92.5, 4)
        ).copy(startedAt = 1_000L)

        val finished = SessionEngine.finished(state, "  felt strong  ", 8.5)

        assertEquals("felt strong", finished.note)
        assertEquals(8.5, finished.rpeSession!!, 0.001)
        assertEquals(state.sets.size, finished.sets.size)
        assertEquals("Push day", finished.planTitle)
        // The session ends at the last set that was actually logged.
        assertEquals(state.sets.maxOf { it.at }, finished.endedAt)
    }

    @Test
    fun `a blank note is no note`() {
        val finished = SessionEngine.finished(started(), "   ", null)

        assertNull(finished.note)
        assertNull(finished.rpeSession)
    }

    @Test
    fun `rest target steps by half a minute and stays in range`() {
        assertEquals(180, SessionEngine.restTarget(DEFAULT_REST_SECONDS, 30))
        assertEquals(120, SessionEngine.restTarget(DEFAULT_REST_SECONDS, -30))
        assertEquals(MAX_REST_SECONDS, SessionEngine.restTarget(MAX_REST_SECONDS, 30))
        assertEquals(MIN_REST_SECONDS, SessionEngine.restTarget(MIN_REST_SECONDS, -30))
    }

    @Test
    fun `an old session file without a rest target still loads`() {
        // The field arrived after sessions were already being written to disk;
        // a missing one must not throw away the workout in progress.
        val legacy = """{"id":"s","startedAt":0,"plan":{"title":"T","exercises":[]},"sets":[]}"""

        val decoded = legacyJson.decodeFromString<SessionState>(legacy)

        assertEquals(DEFAULT_REST_SECONDS, decoded.restSeconds)
    }

    @Test
    fun `grouping keeps every set and first-appearance order`() {
        val sets = listOf(
            set("Bench Press", 60.0, 8, warmup = true),
            set("Bench Press", 90.0, 4),
            set("Lateral Raise", 7.5, 12)
        )

        val groups = SessionEngine.groupedByExercise(sets)

        assertEquals(listOf("Bench Press", "Lateral Raise"), groups.map { it.exercise })
        assertEquals(2, groups.first().sets.size)
        assertEquals(1, groups.first().workingSets.size)
        assertEquals(360.0, groups.first().volumeKg, 0.001)
    }
}
