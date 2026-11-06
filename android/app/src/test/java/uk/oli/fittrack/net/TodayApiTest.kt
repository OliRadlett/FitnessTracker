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
import java.util.concurrent.TimeUnit

/**
 * `/dashboard/today` is a `TodaySummary`; the verdict inside it is the
 * `TodayVerdict` from `backend/app/schemas/dashboard.py`.
 */
class TodayApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: TodayApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = TodayApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `the verdict becomes a brief`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"today_volume_kg":5326,"current_tsb":-12.4,"latest_recovery":68,
                     "verdict":{"should_rest":true,"headline":"Rest today",
                       "reasons":["TSB is -12","Three sessions in a row"],
                       "consensus":[
                         {"engine":"readiness","stance":"rest","confidence":"high"},
                         {"engine":"cross_domain","available":false,"reason":"not run yet"}
                       ]}}"""
            )
        )

        val brief = runBlocking { api.brief("tok") }!!

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/dashboard/today", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))

        assertEquals(true, brief.shouldRest)
        assertEquals("Rest today", brief.headline)
        assertEquals(2, brief.reasons.size)
        assertEquals(-12.4, brief.tsb!!, 0.001)
        assertEquals(68.0, brief.recovery!!, 0.001)
        assertEquals(5326.0, brief.volumeKg, 0.001)
        // The silent engine is reported as unavailable, not dropped: a list that
        // omits it reads as agreement.
        assertEquals(2, brief.consensus.size)
        assertEquals("unavailable", brief.consensus[1].stance)
    }

    @Test
    fun `reasons are capped and blanks dropped`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"verdict":{"headline":"Train","reasons":["a","","b","c","d"]}}"""
            )
        )

        val brief = runBlocking { api.brief("tok") }!!

        assertEquals(listOf("a", "b", "c"), brief.reasons)
        assertNull(brief.tsb)
    }

    @Test
    fun `no verdict is no brief, not an empty headline`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"current_tsb":-4}"""))
        assertNull(runBlocking { api.brief("tok") })

        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"verdict":{"headline":"   "}}""")
        )
        assertNull(runBlocking { api.brief("tok") })
    }

    @Test
    fun `a failed request throws so the screen can fall back`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        val error = runCatching { runBlocking { api.brief("tok") } }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(500, (error as ApiException).status)
    }
}
