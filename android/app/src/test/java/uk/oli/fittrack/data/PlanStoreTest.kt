package uk.oli.fittrack.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import uk.oli.fittrack.domain.Plan
import uk.oli.fittrack.domain.PlanExercise
import java.nio.file.Files

class PlanStoreTest {

    private val dir = Files.createTempDirectory("plan-store").toFile()

    @After
    fun cleanUp() {
        dir.deleteRecursively()
    }

    @Test
    fun `nothing saved yet reads as nothing`() {
        assertNull(PlanStore(dir).load())
    }

    @Test
    fun `a plan survives a round trip`() {
        val plan = Plan(
            title = "Leg day",
            exercises = listOf(
                PlanExercise("Squat", sets = 5, reps = 3, weightKg = 100.0),
                PlanExercise("Romanian Deadlift", sets = 3, reps = 8, weightKg = 80.0)
            )
        )

        PlanStore(dir).save(plan)

        assertEquals(plan, PlanStore(dir).load())
    }

    @Test
    fun `a corrupted file reads as nothing rather than crashing`() {
        val file = java.io.File(dir, "plan.json")
        file.writeText("{not json")

        assertNull(PlanStore(dir).load())
    }
}
