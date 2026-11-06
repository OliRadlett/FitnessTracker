package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The shape is `WarmupTemplateRead` in `backend/app/schemas/lifting.py`:
 * `{id, name, exercise_name, steps:[{step_number, weight_kg, reps, notes}]}`.
 */
class WarmupJsonTest {

    @Test
    fun `a template keeps its steps in order`() {
        val body = """
            [{"id":"t1","name":"Squat ramp","exercise_name":"Back Squat",
              "steps":[
                {"step_number":3,"weight_kg":100,"reps":3},
                {"step_number":1,"weight_kg":60,"reps":8},
                {"step_number":2,"weight_kg":80,"reps":5,"notes":"paused"}
              ]}]
        """.trimIndent()

        val template = WarmupJson.decode(body).single()

        assertEquals("Squat ramp", template.name)
        assertEquals("Back Squat", template.exercise)
        assertEquals(listOf(60.0, 80.0, 100.0), template.steps.map { it.weightKg })
        assertEquals(8, template.steps.first().reps)
        assertEquals("paused", template.steps[1].note)
    }

    @Test
    fun `a template with no usable steps is not offered`() {
        val body = """
            [{"id":"t1","name":"Empty","steps":[]},
             {"id":"t2","name":"Zero reps","steps":[{"step_number":1,"weight_kg":60,"reps":0}]},
             {"id":"t3","name":"Real","steps":[{"step_number":1,"weight_kg":60,"reps":8}]}]
        """.trimIndent()

        assertEquals(listOf("Real"), WarmupJson.decode(body).map { it.name })
    }

    @Test
    fun `a nameless or exerciseless template still works`() {
        val body = """
            [{"id":"t1","name":"  ","exercise_name":null,
              "steps":[{"step_number":1,"weight_kg":20,"reps":10}]}]
        """.trimIndent()

        val template = WarmupJson.decode(body).single()

        assertEquals("Warm-up", template.name)
        assertEquals(null, template.exercise)
    }

    @Test
    fun `a malformed payload is no templates rather than a crash`() {
        assertTrue(WarmupJson.decode("not json").isEmpty())
        assertTrue(WarmupJson.decode("""{"id":"not-a-list"}""").isEmpty())
    }
}
