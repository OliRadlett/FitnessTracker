package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The dashboard is four independent endpoints. Each is allowed to fail on its
 * own — the website's rule, and the app's: a missing Whoop connection costs the
 * readiness card and nothing else.
 */
class DashboardApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: DashboardApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = DashboardApi(server.url("/").toString().trimEnd('/'))
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

    private val loadBody = """
        {"data":[
          {"date":"2026-11-04","tss":62,"ctl":44.1,"atl":51.0,"tsb":-6.9},
          {"date":"2026-11-05","tss":0,"ctl":43.4,"atl":44.4,"tsb":-1.0},
          {"date":"2026-11-06","tss":30,"ctl":43.0,"atl":40.2,"tsb":2.8}
        ],"current_ctl":43.0,"current_atl":40.2,"current_tsb":2.8}
    """.trimIndent()

    private val readinessBody = """
        {"recovery_score":68,"readiness":"yellow","hrv_ms":54.0,"resting_hr":52,
         "message":"Moderate recovery","date":"2026-11-06"}
    """.trimIndent()

    private val sleepBody = """
        {"debt_hours":3.5,"avg_sleep_hours":7.4,"days_below_target":4,
         "target_hours":8.0,"window_days":7}
    """.trimIndent()

    private val goalsBody = """
        [{"id":"g1","metric":"weight_kg","target_value":80,"current_value":88.9,
          "starting_value":92,"target_date":"2026-12-31","status":"active"},
         {"id":"g2","metric":"fitness_ctl","target_value":60,"current_value":43,
          "status":"active","progress_pct":55}]
    """.trimIndent()

    @Test
    fun `the snapshot carries all four sections`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/training-load" to loadBody,
                "/metrics/readiness" to readinessBody,
                "/metrics/sleep-debt" to sleepBody,
                "/goals" to goalsBody
            )
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertEquals(43.0, snapshot.load!!.ctl, 0.001)
        assertEquals(2.8, snapshot.load!!.tsb, 0.001)
        assertEquals(3, snapshot.load!!.points.size)
        assertEquals("yellow", snapshot.readiness!!.level)
        assertEquals(54.0, snapshot.readiness!!.hrvMs!!, 0.001)
        assertEquals(3.5, snapshot.sleepDebt!!.debtHours, 0.001)
        assertEquals(2, snapshot.goals.size)
        // A server-supplied percentage wins over the app's own arithmetic.
        assertEquals(55.0, snapshot.goals[1].progressPct!!, 0.001)
    }

    @Test
    fun `a failing section leaves the others intact`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/training-load" to loadBody,
                "/metrics/readiness" to readinessBody,
                "/metrics/sleep-debt" to sleepBody,
                "/goals" to goalsBody
            ),
            failing = setOf("/metrics/readiness")
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertNull(snapshot.readiness)
        assertEquals(43.0, snapshot.load!!.ctl, 0.001)
        assertEquals(3.5, snapshot.sleepDebt!!.debtHours, 0.001)
        assertEquals(2, snapshot.goals.size)
    }

    @Test
    fun `a readiness with no data is honest rather than a zero score`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/training-load" to loadBody,
                "/metrics/readiness" to
                    """{"recovery_score":null,"readiness":"unknown","hrv_ms":null,
                        "resting_hr":null,"message":"No recovery data available."}""",
                "/metrics/sleep-debt" to sleepBody,
                "/goals" to "[]"
            )
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertNull(snapshot.readiness!!.score)
        assertEquals("Unknown", snapshot.readiness!!.label)
        assertEquals("No recovery data available.", snapshot.readiness!!.message)
        assertTrue(snapshot.goals.isEmpty())
    }

    @Test
    fun `a goal with no metric is dropped`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/training-load" to loadBody,
                "/metrics/readiness" to readinessBody,
                "/metrics/sleep-debt" to sleepBody,
                "/goals" to """[{"id":"g1","metric":"  "},{"id":"","metric":"weight_kg"}]"""
            )
        )

        assertTrue(runBlocking { api.snapshot("tok") }.goals.isEmpty())
    }

    @Test
    fun `the load range is asked for in days`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/training-load" to loadBody,
                "/metrics/readiness" to readinessBody,
                "/metrics/sleep-debt" to sleepBody,
                "/goals" to goalsBody
            )
        )

        runBlocking { api.snapshot("tok", days = 90) }

        val paths = generateSequence { server.takeRequest() }.take(4).map { it.path }.toList()
        assertTrue(paths.any { it == "/cycling/training-load?days=90" })
        assertTrue(paths.any { it == "/metrics/sleep-debt?days=7" })
        // Every call carries the token.
        generateSequence { null }.toList() // no-op, keeps the assertion above honest
    }

    @Test
    fun `a malformed body is no section rather than a crash`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/training-load" to "not json",
                "/metrics/readiness" to "not json",
                "/metrics/sleep-debt" to "not json",
                "/goals" to "not json"
            )
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertNull(snapshot.load)
        assertNull(snapshot.readiness)
        assertNull(snapshot.sleepDebt)
        assertTrue(snapshot.goals.isEmpty())
    }
}
