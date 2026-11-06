package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.oli.fittrack.domain.SessionEngine

/**
 * Parses a captured live response — three real sessions, 69 sets — so the
 * mapping is tested against the wire shape rather than against a guess.
 *
 * Fidelity matters here in both directions: a set the website shows must appear
 * in the app, and a set that must not drive the next workout (a warm-up) must
 * still be visible without ever becoming a reference.
 */
class LiftingJsonTest {

    private val body: String by lazy {
        javaClass.classLoader!!.getResourceAsStream("lifting-sessions.json")!!
            .bufferedReader()
            .use { it.readText() }
    }

    private val sessions by lazy { LiftingJson.decode(body) }

    @Test
    fun `decodes every session in the fixture`() {
        assertEquals(3, sessions.size)
        assertTrue(sessions.all { it.sets.isNotEmpty() })
        assertTrue(sessions.all { it.id.isNotBlank() })
    }

    @Test
    fun `keeps the backend focus as the plan title`() {
        assertEquals("Back", sessions.first().planTitle)
    }

    @Test
    fun `keeps warm-ups, flagged, rather than dropping them`() {
        // The fixture has five warm-ups across 69 sets. Dropping them made the
        // app's copy of a session disagree with the website's.
        val raws = Regex("\"is_warmup\": true").findAll(body).count()
        val mapped = sessions.sumOf { it.sets.size }
        val warmups = sessions.sumOf { session -> session.sets.count { it.isWarmup } }

        assertEquals("fixture should contain warm-ups to make this test meaningful", 5, raws)
        assertEquals(69, mapped)
        assertEquals(raws, warmups)
    }

    @Test
    fun `volume counts working sets only, as the backend does`() {
        // 2026-08-15 Legs: 13,000 kg of sets, 1,490 kg of them warm-ups.
        assertEquals(11510.0, sessions[1].volumeKg, 0.001)
        assertEquals(22, sessions[1].sets.size - sessions[1].sets.count { it.isWarmup })
    }

    @Test
    fun `a missing rpe stays missing instead of being invented`() {
        val withRpe = sessions.flatMap { it.sets }.filter { it.rpe != null }
        val withoutRpe = sessions.flatMap { it.sets }.filter { it.rpe == null }

        assertEquals(27, withoutRpe.size)
        assertTrue(withRpe.all { it.rpe!! in 1.0..10.0 })
        assertTrue(withRpe.any { it.rpe == 9.0 })
    }

    @Test
    fun `set notes and session notes survive`() {
        assertEquals(6, sessions.sumOf { session -> session.sets.count { it.note != null } })
        assertEquals(2, sessions.count { it.note != null })
    }

    @Test
    fun `server set ids are kept so a set can be edited later`() {
        val sets = sessions.flatMap { it.sets }

        assertTrue(sets.all { it.serverId != null })
        assertEquals(sets.size, sets.mapNotNull { it.serverId }.distinct().size)
    }

    @Test
    fun `sets keep the order the server recorded`() {
        val legs = sessions[1]
        val squats = legs.sets.filter { it.exercise == "Back Squat" }

        assertEquals(listOf(60.0, 80.0, 100.0, 110.0, 120.0), squats.take(5).map { it.weightKg })
        assertTrue(squats.take(5).all { it.isWarmup })
        assertTrue(squats.drop(5).none { it.isWarmup })
    }

    @Test
    fun `ends after it starts and carries real load`() {
        val first = sessions.first()

        assertTrue(first.endedAt > first.startedAt)
        assertTrue(first.sets.any { it.weightKg > 0.0 })
        assertTrue(first.sets.all { it.reps > 0 })
    }

    @Test
    fun `every session is marked as already on the server`() {
        assertTrue(sessions.all { it.synced })
    }

    @Test
    fun `prefill from a real session uses the last working set, not the last warm-up`() {
        val squatSets = sessions[1].sets.filter { it.exercise == "Back Squat" }
        val working = SessionEngine.workingSets(squatSets)

        assertEquals(9, squatSets.size)
        assertEquals(5, squatSets.size - working.size)
        // The ramp ends at 120; the first working set is 130. A prefill that read
        // the last row regardless of the flag would offer the warm-up instead.
        assertEquals(120.0, squatSets[4].weightKg, 0.001)
        assertTrue(squatSets[4].isWarmup)
        assertEquals(130.0, working.first().weightKg, 0.001)
    }

    @Test
    fun `a session of nothing but warm-ups is not history`() {
        val onlyWarmups = """
            [{"id":"x","session_date":"2026-11-04","focus":"Test",
              "sets":[{"exercise_name":"Bench Press","weight_kg":60,"reps":8,"is_warmup":true}]}]
        """.trimIndent()

        assertTrue(LiftingJson.decode(onlyWarmups).isEmpty())
    }

    @Test
    fun `a set with no id still decodes`() {
        val noId = """
            [{"id":"x","session_date":"2026-11-04","focus":"Test","notes":"felt good",
              "sets":[{"exercise_name":"Bench Press","weight_kg":90,"reps":4,"rpe":8}]}]
        """.trimIndent()

        val decoded = LiftingJson.decode(noId).single()

        assertNull(decoded.sets.single().serverId)
        assertEquals("felt good", decoded.note)
        assertNotNull(decoded.sets.single().rpe)
    }
}
