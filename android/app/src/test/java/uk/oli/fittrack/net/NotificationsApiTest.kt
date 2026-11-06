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

class NotificationsApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: NotificationsApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = NotificationsApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `the list decodes, newest and unread intact`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"n1","type":"health_alert","title":"Resting HR is up",
                   "body":"+8 bpm over baseline","severity":"warning","link":"/health",
                   "read":false,"created_at":"2026-11-06T09:00:00+00:00"},
                  {"id":"n2","type":"pr","title":"Deadlift 190","body":"","severity":"info",
                   "read":true,"created_at":"2026-11-01T09:00:00+00:00"},
                  {"id":"","type":"pr","title":"No id"}
                ]"""
            )
        )

        val items = runBlocking { api.list("tok") }

        assertEquals("/notifications?limit=60", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals(listOf("n1", "n2"), items.map { it.id })
        assertTrue(items.first().isUrgent)
        assertEquals("Health", items.first().typeLabel)
        assertTrue(items.last().read)
    }

    @Test
    fun `the summary reports the unread count`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"total":12,"unread":3,"by_type":{"pr":2}}"""
            )
        )

        assertEquals(3, runBlocking { api.unreadCount("tok") })
        assertEquals("/notifications/summary", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
    }

    @Test
    fun `marking one read is a PATCH with only read`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"id":"n1","read":true}"""))

        assertTrue(runBlocking { api.markRead("tok", "n1") })

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", request.method)
        assertEquals("/notifications/n1/read", request.path)
        assertEquals("""{"read":true}""", request.body.readUtf8())
    }

    @Test
    fun `marking all read posts to read-all`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        assertTrue(runBlocking { api.markAllRead("tok") })

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/notifications/read-all", request.path)
    }

    @Test
    fun `a failure is an empty list, a zero count and a false write`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        assertTrue(runBlocking { api.list("tok") }.isEmpty())
        assertEquals(0, runBlocking { api.unreadCount("tok") })
        assertTrue(!runBlocking { api.markAllRead("tok") })
    }

    @Test
    fun `a malformed body is an empty list`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))

        assertTrue(runBlocking { api.list("tok") }.isEmpty())
    }
}
