package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * `/metrics/weight` returns `{entries, rolling_avg}`; the POST answers with the
 * entry it upserted.
 */
class BodyApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: BodyApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = BodyApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `history decodes into a trend`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"entries":[
                     {"id":"w1","date":"2026-11-04","weight_kg":80.2,"source":"withings"},
                     {"id":"w2","date":"2026-11-06","weight_kg":79.4,"source":"manual","body_fat_percent":18.2},
                     {"id":"w3","date":"2026-11-05","weight_kg":0,"source":"manual"}
                   ],
                   "rolling_avg":[{"date":"2026-11-04","weight_kg":80.2},
                                  {"date":"2026-11-06","weight_kg":79.8}]}"""
            )
        )

        val trend = runBlocking { api.weight("tok") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/metrics/weight?days=90", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))

        // The zero weigh-in is dropped; the rest are oldest first.
        assertEquals(listOf("2026-11-04", "2026-11-06"), trend.entries.map { it.date })
        assertEquals("2026-11-06", trend.latest?.date)
        assertEquals(18.2, trend.latest!!.bodyFatPercent!!, 0.001)
        assertEquals(false, trend.latest!!.isManual == false)
        assertEquals(2, trend.rolling.size)
    }

    @Test
    fun `an empty history is an empty trend, not a failure`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"entries":[],"rolling_avg":[]}"""))

        val trend = runBlocking { api.weight("tok") }

        assertTrue(trend.entries.isEmpty())
        assertTrue(trend.rolling.isEmpty())
    }

    @Test
    fun `logging a weight posts the API's fields`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"id":"w9","date":"2026-11-06","weight_kg":79.4,"source":"manual"}"""
            )
        )

        val entry = runBlocking { api.addWeight("tok", 79.4, LocalDate.parse("2026-11-06")) }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/metrics/weight", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"weight_kg\":79.4"))
        assertTrue(body.contains("\"date\":\"2026-11-06\""))

        assertEquals("w9", entry!!.id)
        assertEquals(79.4, entry.weightKg, 0.001)
    }

    @Test
    fun `deleting a weigh-in hits its own path`() {
        server.enqueue(MockResponse().setResponseCode(204))

        runBlocking { api.deleteWeight("tok", "w9") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/metrics/weight/w9", request.path)
    }

    @Test
    fun `a refused weigh-in surfaces its status`() {
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"detail":"bad"}"""))

        val error = runCatching { runBlocking { api.addWeight("tok", 79.4) } }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(422, (error as ApiException).status)
    }

    @Test
    fun `a malformed body is no trend rather than a crash`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))

        // The API returns an empty trend so the screen shows its empty state.
        assertNull(BodyJson.decode("not json"))
        assertTrue(runBlocking { api.weight("tok") }.entries.isEmpty())
    }
}
