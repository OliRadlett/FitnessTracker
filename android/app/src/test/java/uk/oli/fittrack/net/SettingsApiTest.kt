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
import java.util.concurrent.TimeUnit

class SettingsApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: SettingsApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = SettingsApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `preferences decode`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"unit_system":"imperial","locale":"en-GB","time_format":"12h","height_cm":181}"""
            )
        )

        val prefs = runBlocking { api.preferences("tok") }!!

        assertEquals("/preferences", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals("imperial", prefs.unitSystem)
        assertEquals("12h", prefs.timeFormat)
        assertEquals(181.0, prefs.heightCm!!, 0.001)
    }

    @Test
    fun `connections decode with their health fields`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"c1","provider":"strava","status":"active",
                   "last_synced_at":"2026-11-06T09:00:00+00:00","consecutive_failures":0},
                  {"id":"c2","provider":"whoop","status":"needs_reauth",
                   "last_error":"token expired","consecutive_failures":3}
                ]"""
            )
        )

        val connections = runBlocking { api.connections("tok") }

        assertEquals("/connections/", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals(2, connections.size)
        assertEquals("Strava", connections.first().name)
        assertEquals("token expired", connections.last().lastError)
        assertTrue(connections.last().isBroken)
    }

    @Test
    fun `a units change sends only that preference`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"unit_system":"imperial","locale":"en-GB","time_format":"24h"}"""
            )
        )

        val updated = runBlocking { api.updatePreferences("tok", unitSystem = "imperial") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", request.method)
        assertEquals("/preferences", request.path)
        assertEquals("""{"unit_system":"imperial"}""", request.body.readUtf8())
        assertEquals("imperial", updated!!.unitSystem)
    }

    @Test
    fun `a clock change is separate from the units`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody("""{"unit_system":"metric","time_format":"12h"}""")
        )

        runBlocking { api.updatePreferences("tok", timeFormat = "12h") }

        assertEquals(
            """{"time_format":"12h"}""",
            server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()
        )
    }

    @Test
    fun `failures leave the page empty rather than throwing`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        assertNull(runBlocking { api.preferences("tok") })
        assertTrue(runBlocking { api.connections("tok") }.isEmpty())
        assertNull(runBlocking { api.updatePreferences("tok", unitSystem = "metric") })
    }

    @Test
    fun `the snapshot keeps connections when preferences fail`() {
        // Both calls run concurrently, so a queue can serve them in either
        // order — dispatch on the path.
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse =
                if (request.path.orEmpty().startsWith("/connections")) {
                    MockResponse().setResponseCode(200).setBody(
                        """[{"id":"c1","provider":"strava","status":"active"}]"""
                    )
                } else {
                    MockResponse().setResponseCode(500).setBody("{}")
                }
        }

        val snapshot = runBlocking { api.snapshot("tok") }

        assertNull(snapshot.preferences)
        assertEquals(1, snapshot.connections.size)
    }
}
