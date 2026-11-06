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
 * The cycling page is five endpoints under `/api/v1/cycling`. Shapes come from
 * `backend/app/schemas/cycling.py`.
 */
class CyclingApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: CyclingApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = CyclingApi(server.url("/").toString().trimEnd('/'))
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

    private val summaryBody = """
        {"recent_tss":210.5,"recent_distance_km":61.4,"recent_time_hours":3.2,
         "recent_elevation_m":540,"recent_rides":2,
         "ftp_watts":280,"power_to_weight":3.15,
         "tss_trend":{"direction":"up"},"rides_trend":{"direction":"stable"},
         "distance_trend":{"direction":"down"}}
    """.trimIndent()

    private val curveBody = """
        {"data":[
          {"duration_label":"5s","duration_seconds":5,"best_power_watts":1100},
          {"duration_label":"1min","duration_seconds":60,"best_power_watts":520},
          {"duration_label":"20min","duration_seconds":1200,"best_power_watts":300},
          {"duration_label":"60min","duration_seconds":3600,"best_power_watts":null}
        ],"ftp_watts":280,"cp":265,"w_prime":18000,"p_max":1150,"model_r_squared":0.94}
    """.trimIndent()

    private val zonesBody = """
        {"ftp_watts":280,"total_time_seconds":7200,"zones":[
          {"zone":"Z2","zone_name":"Endurance","time_seconds":3600,"percentage":50},
          {"zone":"Z4","zone_name":"Threshold","time_seconds":1800,"percentage":25},
          {"zone":"Z7","zone_name":"Neuromuscular","time_seconds":0,"percentage":0}
        ]}
    """.trimIndent()

    private val ftpBody = """
        [{"ftp_watts":270,"effective_date":"2026-09-01","source":"manual"},
         {"ftp_watts":280,"effective_date":"2026-10-15","source":"estimated"}]
    """.trimIndent()

    private val vo2maxBody = """
        {"vo2max":52.4,"confidence":0.8,"method":"power_estimate","classification":"Good"}
    """.trimIndent()

    @Test
    fun `the snapshot carries the cycling page`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/metrics-summary" to summaryBody,
                "/cycling/power-curve" to curveBody,
                "/cycling/power-model" to curveBody,
                "/cycling/power-zones" to zonesBody,
                "/cycling/ftp-history" to ftpBody,
                "/cycling/vo2max" to vo2maxBody
            )
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        val summary = snapshot.summary!!
        assertEquals(210.5, summary.tss, 0.001)
        assertEquals(2, summary.rides)
        assertEquals(280.0, summary.ftpWatts!!, 0.001)
        assertEquals("up", summary.tssDirection)
        assertEquals("down", summary.distanceDirection)

        // A curve point with no power is dropped rather than shown as zero.
        assertEquals(listOf("5s", "1min", "20min"), snapshot.curve.map { it.label })
        assertEquals(265.0, snapshot.model!!.cp!!, 0.001)
        assertEquals(18000.0, snapshot.model!!.wPrime!!, 0.001)

        // The empty zone is dropped.
        assertEquals(listOf("Z2", "Z4"), snapshot.zones.map { it.zone })
        assertEquals(50.0, snapshot.zones.first().percentage, 0.001)

        assertEquals(2, snapshot.ftpHistory.size)
        assertEquals("2026-10-15", snapshot.ftpHistory.last().date)
        assertEquals("Good", snapshot.vo2max!!.classification)
    }

    @Test
    fun `a section can fail without taking the page with it`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/metrics-summary" to summaryBody,
                "/cycling/power-curve" to curveBody,
                "/cycling/power-model" to curveBody,
                "/cycling/power-zones" to zonesBody,
                "/cycling/ftp-history" to ftpBody,
                "/cycling/vo2max" to vo2maxBody
            ),
            failing = setOf("/cycling/power-curve", "/cycling/vo2max")
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertTrue(snapshot.curve.isEmpty())
        assertNull(snapshot.vo2max)
        assertEquals(210.5, snapshot.summary!!.tss, 0.001)
        assertEquals(2, snapshot.zones.size)
    }

    @Test
    fun `the zone window is asked for in days`() {
        server.dispatcher = dispatcher(mapOf("/cycling/power-zones" to zonesBody))

        runBlocking { api.powerZones("tok", days = 90) }

        assertEquals("/cycling/power-zones?days=90", server.takeRequest().path)
    }

    @Test
    fun `a malformed body is no data rather than a crash`() {
        server.dispatcher = dispatcher(
            mapOf(
                "/cycling/metrics-summary" to "not json",
                "/cycling/power-curve" to "not json",
                "/cycling/power-model" to "not json",
                "/cycling/power-zones" to "not json",
                "/cycling/ftp-history" to "not json",
                "/cycling/vo2max" to "not json"
            )
        )

        val snapshot = runBlocking { api.snapshot("tok") }

        assertNull(snapshot.summary)
        assertTrue(snapshot.curve.isEmpty())
        assertTrue(snapshot.zones.isEmpty())
        assertTrue(snapshot.ftpHistory.isEmpty())
        assertNull(snapshot.vo2max)
        assertTrue(snapshot.isEmpty)
    }

    @Test
    fun `an FTP history with no usable rows is empty`() {
        server.dispatcher = dispatcher(
            mapOf("/cycling/ftp-history" to """[{"ftp_watts":0,"effective_date":"2026-10-01"}]""")
        )

        assertTrue(runBlocking { api.ftpHistory("tok") }.isEmpty())
    }
}
