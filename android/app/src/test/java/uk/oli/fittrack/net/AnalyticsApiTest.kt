package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class AnalyticsApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: AnalyticsApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = AnalyticsApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `insights decode with their open data flattened`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"i1","insight_type":"sleep_performance","period":"28d",
                   "confidence":"high","sample_size":42,
                   "data":{"correlation":0.62,"avg_sleep_hours":7.4,"note":"stronger on good sleep"}},
                  {"id":"i2","insight_type":"load_ramp","period":"14d",
                   "confidence":"low","sample_size":3,"data":null},
                  {"id":"i3","insight_type":"","period":"x"}
                ]"""
            )
        )

        val insights = runBlocking { api.insights("tok") }

        assertEquals("/analytics/insights", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals(2, insights.size)
        val sleep = insights.first()
        assertEquals("sleep_performance", sleep.type)
        assertEquals("high", sleep.confidence)
        assertEquals(42, sleep.sampleSize)
        // Every scalar in `data`, in the order the server wrote it.
        assertEquals(listOf("correlation", "avg_sleep_hours", "note"), sleep.data.map { it.first })
        assertEquals("0.62", sleep.data.first().second)
        assertTrue(!insights.last().hasData)
    }

    @Test
    fun `recompute posts and returns the fresh insights`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[{"id":"i1","insight_type":"consistency","period":"90d",
                    "confidence":"medium","sample_size":12,"data":{"weeks":13}}]"""
            )
        )

        val fresh = runBlocking { api.recompute("tok") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/analytics/recompute", request.path)
        assertEquals(1, fresh.size)
        assertEquals("consistency", fresh.first().type)
    }

    @Test
    fun `failures are an empty list, and malformed bodies too`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        assertTrue(runBlocking { api.insights("tok") }.isEmpty())
        assertTrue(runBlocking { api.insights("tok") }.isEmpty())
        assertTrue(runBlocking { api.insights("tok") }.isEmpty())
    }

    @Test
    fun `nested objects are dropped rather than stringified into noise`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[{"id":"i1","insight_type":"cross_sport","period":"28d",
                    "confidence":"high","sample_size":9,
                    "data":{"rides":6,"detail":{"a":1},"sleep":true}}]"""
            )
        )

        val insight = runBlocking { api.insights("tok") }.single()

        assertEquals(listOf("rides", "sleep"), insight.data.map { it.first })
    }
}
