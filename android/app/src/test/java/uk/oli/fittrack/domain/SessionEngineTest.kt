package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionEngineTest {

    private val plan = Plan(
        title = "Push day",
        exercises = listOf(
            PlanExercise("Bench Press", sets = 2, reps = 4, weightKg = 90.0),
            PlanExercise("Lateral Raise", sets = 2, reps = 12, weightKg = 7.5)
        )
    )

    private fun started() = SessionState(id = "s1", startedAt = 0L, plan = plan)

    private fun stateWith(vararg sets: LoggedSet) = started().copy(sets = sets.toList())

    private fun set(exercise: String, kg: Double, reps: Int, rpe: Int = 7) =
        LoggedSet(exercise, kg, reps, rpe, at = 0L)

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
}
