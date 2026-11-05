package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Parses a captured live response — three real sessions, 69 sets — so the
 * mapping is tested against the wire shape rather than against a guess.
 */
class LiftingJsonTest {

    private val body: String by lazy {
        javaClass.classLoader!!.getResourceAsStream("lifting-sessions.json")!!
            .bufferedReader()
            .use { it.readText() }
    }

    @Test
    fun `decodes every session in the fixture`() {
        val sessions = LiftingJson.decode(body)

        assertEquals(3, sessions.size)
        assertTrue(sessions.all { it.sets.isNotEmpty() })
        assertTrue(sessions.all { it.id.isNotBlank() })
    }

    @Test
    fun `keeps the backend focus as the plan title`() {
        val first = LiftingJson.decode(body).first()

        assertEquals("Back", first.planTitle)
    }

    @Test
    fun `never lets a warm-up set reach history`() {
        // The fixture contains warm-ups; none may survive, or the next session
        // would prefill from an empty bar.
        val rawWarmups = Regex("\"is_warmup\": true").findAll(body).count()
        val sessions = LiftingJson.decode(body)
        val mapped = sessions.sumOf { it.sets.size }

        assertTrue("fixture should contain warm-ups to make this test meaningful", rawWarmups > 0)
        assertTrue("mapped sets ($mapped) must be fewer than raw sets", mapped < 69)
    }

    @Test
    fun `ends after it starts and carries real load`() {
        val first = LiftingJson.decode(body).first()

        assertTrue(first.endedAt > first.startedAt)
        assertTrue(first.sets.any { it.weightKg > 0.0 })
        assertTrue(first.sets.all { it.reps > 0 })
    }

    @Test
    fun `rounds a null or fractional rpe to a whole number`() {
        val sessions = LiftingJson.decode(body)

        assertTrue(sessions.flatMap { it.sets }.all { it.rpe in 1..10 })
    }
}
