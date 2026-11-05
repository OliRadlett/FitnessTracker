package uk.oli.fittrack.net

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Manual probe: talks to a running local backend. Skipped unless FT_DEV_TOKEN is
 * set, so CI never depends on a database. Deleted after the one-off check.
 */
class LiveSyncProbe {
    @Test
    fun pullsRealHistory() {
        val token = System.getenv("FT_DEV_TOKEN") ?: return
        val sessions = kotlinx.coroutines.runBlocking {
            LiftingApi("http://localhost:8000/api/v1").sessions(token)
        }
        println("PROBE sessions=${sessions.size} sets=${sessions.sumOf { it.sets.size }}")
        println("PROBE newest=${sessions.maxByOrNull { it.endedAt }?.planTitle} " +
            "title=${sessions.maxByOrNull { it.endedAt }?.planTitle}")
        assertTrue("expected real sessions from the local backend", sessions.isNotEmpty())
        assertTrue(sessions.all { it.sets.isNotEmpty() })
    }
}
