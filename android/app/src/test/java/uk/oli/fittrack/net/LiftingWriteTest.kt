package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import uk.oli.fittrack.domain.LoggedSet
import java.util.concurrent.TimeUnit

/**
 * The write half of a finished session: editing one set, deleting it, and
 * deleting the session. A real MockWebServer is used because the wire shape is
 * the contract — the nulls in particular, which `encodeDefaults = false` would
 * silently drop and thereby turn "clear the RPE" into "leave the old one".
 */
class LiftingWriteTest {

    private lateinit var server: MockWebServer
    private lateinit var api: LiftingApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = LiftingApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private val set = LoggedSet(
        exercise = "Back Squat",
        weightKg = 130.0,
        reps = 3,
        rpe = 9.5,
        at = 0L,
        note = "belt on",
        serverId = "set-1"
    )

    @Test
    fun `editing a set patches every field, nulls included`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        runBlocking {
            api.updateSet(
                "tok",
                "set-1",
                SetEdit(weight_kg = 132.5, reps = 3, rpe = null, is_warmup = false, is_amrap = true, notes = null)
            )
        }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", request.method)
        assertEquals("/lifting/sets/set-1", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))

        val body = request.body.readUtf8()
        assertTrue("explicit null rpe: $body", body.contains("\"rpe\":null"))
        assertTrue("explicit null notes: $body", body.contains("\"notes\":null"))
        assertTrue(body.contains("\"weight_kg\":132.5"))
        assertTrue(body.contains("\"is_amrap\":true"))
    }

    @Test
    fun `a set edit round-trips the values the app holds`() {
        val body = LiftingPatchJson.encodeToString(SetEdit.of(set))

        assertTrue(body.contains("\"rpe\":9.5"))
        assertTrue(body.contains("\"notes\":\"belt on\""))
        assertTrue(body.contains("\"is_warmup\":false"))
    }

    @Test
    fun `a rejected edit surfaces the status`() {
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"detail":"bad"}"""))

        try {
            runBlocking { api.updateSet("tok", "set-1", SetEdit.of(set)) }
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(422, e.status)
        }
    }

    @Test
    fun `deleting a set uses the set id, not the session id`() {
        server.enqueue(MockResponse().setResponseCode(204))

        runBlocking { api.deleteSet("tok", "set-9") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/lifting/sets/set-9", request.path)
    }

    @Test
    fun `deleting a session hits the session path`() {
        server.enqueue(MockResponse().setResponseCode(204))

        runBlocking { api.deleteSession("tok", "sess-7") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/lifting/sessions/sess-7", request.path)
    }
}
