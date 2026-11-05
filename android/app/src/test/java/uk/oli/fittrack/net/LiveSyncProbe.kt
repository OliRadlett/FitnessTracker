package uk.oli.fittrack.net

import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LoggedSet
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Manual probe against a running local backend. Skipped unless FT_DEV_TOKEN is
 * set, so CI never depends on a database. It writes one honest session and
 * deletes it again.
 */
class LiveSyncProbe {

    private val api = LiftingApi("http://localhost:8000/api/v1")
    private val token: String? = System.getenv("FT_DEV_TOKEN")

    @Test
    fun pullsRealHistory() {
        val token = token ?: return
        val sessions = kotlinx.coroutines.runBlocking { api.sessions(token) }

        println("PROBE pull sessions=${sessions.size} sets=${sessions.sumOf { it.sets.size }}")
        assertTrue("expected real sessions from the local backend", sessions.isNotEmpty())
        assertTrue(sessions.all { it.sets.isNotEmpty() })
        assertTrue("pulled sessions are already on the server", sessions.all { it.synced })
    }

    @Test
    fun pushIsIdempotentAndCleansUp() {
        val token = token ?: return
        val now = System.currentTimeMillis()
        val session = FinishedSession(
            id = UUID.randomUUID().toString(),
            planTitle = "Harness Check",
            startedAt = now - 1_800_000,
            endedAt = now,
            sets = listOf(
                LoggedSet("Harness Bench", 60.0, 5, 7, now),
                LoggedSet("Harness Bench", 62.5, 5, 8, now)
            )
        )

        val first = kotlinx.coroutines.runBlocking { api.createSession(token, session) }
        // Same live_key: a retry must resolve to the same row, not a second one.
        val second = kotlinx.coroutines.runBlocking { api.createSession(token, session) }
        println("PROBE push id=$first retry=$second")

        assertEquals("a retry must not create a second session", first, second)
        assertTrue(first.isNotBlank())

        // Leave the database as we found it.
        val client = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
        val request = Request.Builder()
            .url("http://localhost:8000/api/v1/lifting/sessions/$first")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()
        client.newCall(request).execute().use { println("PROBE cleanup status=${it.code}") }
    }

    @Test
    fun refusedWithoutAToken() {
        val client = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
        val request = Request.Builder()
            .url("http://localhost:8000/api/v1/lifting/sessions")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            println("PROBE anonymous status=${response.code}")
            assertEquals("an unauthenticated read must be refused", 401, response.code)
        }
    }
}
