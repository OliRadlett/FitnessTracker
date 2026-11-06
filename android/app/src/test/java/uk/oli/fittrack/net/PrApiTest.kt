package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * `GET /lifting/prs` returns `PersonalRecordRead`s; a record with no
 * `session_id` is one that was typed in by hand.
 */
class PrApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: PrApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = PrApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `records decode, with manual ones marked`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"pr-1","exercise_name":"Bench Press","record_type":"1rm","weight_kg":120,
                   "reps":5,"estimated_1rm":135.0,"achieved_date":"2026-11-04","session_id":"s-1"},
                  {"id":"pr-2","exercise_name":"Back Squat ","weight_kg":180,"reps":3,
                   "achieved_date":"2026-10-01","session_id":null,"notes":"gym comp"}
                ]"""
            )
        )

        val records = runBlocking { api.prs("tok") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/lifting/prs?limit=50", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))

        assertEquals(2, records.size)
        val bench = records[0]
        assertEquals("Bench Press", bench.exercise)
        assertEquals(135.0, bench.e1rm, 0.001)
        assertEquals(false, bench.manual)

        val squat = records[1]
        // Trimmed at the boundary, as everywhere else.
        assertEquals("Back Squat", squat.exercise)
        assertTrue(squat.manual)
        assertEquals("gym comp", squat.note)
        // No server estimate: the app's own Brzycki figure fills in (180 × 36/34).
        assertEquals(190.6, squat.e1rm, 0.2)
    }

    @Test
    fun `a record with no lift or no reps is not a record`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"pr-1","exercise_name":"","weight_kg":120,"reps":5},
                  {"id":"pr-2","exercise_name":"Bench Press","weight_kg":0,"reps":5},
                  {"id":"pr-3","exercise_name":"Bench Press","weight_kg":100,"reps":0}
                ]"""
            )
        )

        assertTrue(runBlocking { api.prs("tok") }.isEmpty())
    }

    @Test
    fun `adding a record posts the schema's fields`() {
        server.enqueue(
            MockResponse().setResponseCode(201).setBody(
                """{"id":"pr-9","exercise_name":"Deadlift","weight_kg":200,"reps":2,
                    "estimated_1rm":208.7,"achieved_date":"2026-11-06","session_id":null}"""
            )
        )

        val saved = runBlocking {
            api.addPr("tok", " Deadlift ", 200.0, 2, LocalDate.parse("2026-11-06"), "  ")
        }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/lifting/prs", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"exercise_name\":\"Deadlift\""))
        assertTrue(body.contains("\"record_type\":\"1rm\""))
        assertTrue(body.contains("\"weight_kg\":200.0"))
        assertTrue(body.contains("\"achieved_date\":\"2026-11-06\""))
        // A blank note is omitted rather than sent as an empty string.
        assertTrue(body.contains("\"notes\":null") || !body.contains("notes"))

        assertEquals("Deadlift", saved!!.exercise)
        assertTrue(saved.manual)
    }

    @Test
    fun `a refused record is an error the caller can report`() {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"detail":"bad"}"""))

        val error = runCatching {
            runBlocking { api.addPr("tok", "Bench", 100.0, 5, LocalDate.now(), null) }
        }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(400, (error as ApiException).status)
    }

    @Test
    fun `a failed fetch throws rather than looking like an empty record book`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        val error = runCatching { runBlocking { api.prs("tok") } }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(500, (error as ApiException).status)
    }
}
