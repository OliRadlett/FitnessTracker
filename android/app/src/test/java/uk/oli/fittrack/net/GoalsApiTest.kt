package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * Goals: read, create, check in, archive. The write bodies are the part worth
 * pinning — a phone that sends `status` under the wrong key silently does
 * nothing.
 */
class GoalsApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: GoalsApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = GoalsApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun dispatcher(bodies: Map<String, String>, failing: Set<String> = emptySet()) =
        object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path.orEmpty()
                val key = bodies.keys.firstOrNull { path.startsWith(it) }
                    ?: return MockResponse().setResponseCode(404)
                if (key in failing) return MockResponse().setResponseCode(500).setBody("{}")
                return MockResponse().setResponseCode(200).setBody(bodies.getValue(key))
            }
        }

    private val goalsBody = """
        [{"id":"g1","metric":"weight_kg","target_value":80,"current_value":88.9,
          "starting_value":92,"target_date":"2026-12-31","status":"active",
          "direction":"decrease","progress_pct":25.8},
         {"id":"g2","metric":"  ","target_value":1}]
    """.trimIndent()

    private val metricsBody = """
        [{"key":"weight_kg","label":"Bodyweight","unit":"kg","default_direction":"decrease"},
         {"key":"ftp_watts","label":"FTP","unit":"W"},
         {"key":"squat_kg","label":"Squat","unit":"kg","requires_filter":["exercise"]}]
    """.trimIndent()

    private val checkInsBody = """
        [{"id":"c1","check_in_date":"2026-11-01","value":89.4,"note":"morning","source":"manual"},
         {"id":"c2","check_in_date":"2026-11-05","value":88.9,"source":"auto"}]
    """.trimIndent()

    @Test
    fun `goals decode with their server percentage and direction`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody(goalsBody))

        val goals = runBlocking { api.goals("tok") }

        assertEquals("/goals", server.takeRequest().path)
        // The row with a blank metric is dropped.
        assertEquals(1, goals.size)
        assertEquals(25.8, goals.first().serverProgressPct!!, 0.001)
        assertEquals("decrease", goals.first().direction)
    }

    @Test
    fun `the metric registry says which metrics need a filter`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody(metricsBody))

        val metrics = runBlocking { api.metrics("tok") }

        assertEquals(3, metrics.size)
        assertEquals("Bodyweight", metrics.first().label)
        assertTrue(metrics.first().supported)
        assertTrue(!metrics.last().supported)
    }

    @Test
    fun `creating posts the metric, target, date and note`() {
        server.enqueue(
            MockResponse().setResponseCode(201).setBody(
                """{"id":"g9","metric":"ftp_watts","target_value":300,"status":"active"}"""
            )
        )

        val created = runBlocking {
            api.create("tok", "ftp_watts", 300.0, "2027-01-31", "by spring")
        }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/goals", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"metric\":\"ftp_watts\""))
        assertTrue(body.contains("\"target_value\":300.0"))
        assertTrue(body.contains("\"target_date\":\"2027-01-31\""))
        assertTrue(body.contains("\"notes\":\"by spring\""))
        assertEquals("g9", created!!.id)
    }

    @Test
    fun `a blank note is omitted rather than sent as empty`() {
        server.enqueue(
            MockResponse().setResponseCode(201).setBody("""{"id":"g9","metric":"ctl","target_value":60}""")
        )

        runBlocking { api.create("tok", "ctl", 60.0, null, "   ") }

        val body = server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()
        assertTrue(!body.contains("notes"))
        assertTrue(!body.contains("target_date"))
    }

    @Test
    fun `check-ins are read and written under the goal`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody(checkInsBody))
        val entries = runBlocking { api.checkIns("tok", "g1") }
        assertEquals("/goals/g1/checkins", server.takeRequest().path)
        assertEquals(2, entries.size)
        assertEquals("morning", entries.first().note)

        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"id":"c3"}"""))
        val ok = runBlocking { api.addCheckIn("tok", "g1", 88.2, "evening") }
        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertTrue(ok)
        assertEquals("POST", request.method)
        assertEquals("/goals/g1/checkins", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"value\":88.2"))
        assertTrue(body.contains("\"note\":\"evening\""))
    }

    @Test
    fun `a status change is a PATCH with only the status`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"id":"g1","status":"achieved"}"""))

        val ok = runBlocking { api.setStatus("tok", "g1", "achieved") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertTrue(ok)
        assertEquals("PATCH", request.method)
        assertEquals("""{"status":"achieved"}""", request.body.readUtf8())
    }

    @Test
    fun `deleting reports whether it worked`() {
        server.enqueue(MockResponse().setResponseCode(204))

        assertTrue(runblockingDelete())

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/goals/g1", request.path)
    }

    @Test
    fun `a refused delete is false, not a crash`() {
        server.enqueue(MockResponse().setResponseCode(404).setBody("{}"))

        assertTrue(!runblockingDelete())
    }

    private fun runblockingDelete(): Boolean = runBlocking { api.delete("tok", "g1") }

    @Test
    fun `the snapshot keeps the goals when the registry fails`() {
        server.dispatcher = dispatcher(
            mapOf("/goals/metrics" to metricsBody, "/goals" to goalsBody),
            failing = setOf("/goals/metrics")
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertEquals(1, snapshot.goals.size)
        assertTrue(snapshot.metrics.isEmpty())
    }

    @Test
    fun `malformed bodies are empty lists`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        assertTrue(runBlocking { api.goals("tok") }.isEmpty())
        assertTrue(runBlocking { api.metrics("tok") }.isEmpty())
    }
}
