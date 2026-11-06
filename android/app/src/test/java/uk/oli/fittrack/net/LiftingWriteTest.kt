package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.encodeToString
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LoggedSet
import java.time.LocalDate
import java.time.ZoneId
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
    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String, hour: Int): Long =
        LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

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
    fun `linkable activities come from the session's own path`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[{"id":"act-9","name":"Evening weights","source":"strava",
                     "start_date":"2026-11-04T18:00:00+00:00","duration_seconds":3600}]"""
            )
        )

        val candidates = runBlocking { api.linkableActivities("tok", "sess-7") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("GET", request.method)
        assertEquals("/lifting/sessions/sess-7/linkable-activities", request.path)
        assertEquals("act-9", candidates.single().id)
        assertEquals("Evening weights", candidates.single().name)
    }

    @Test
    fun `linking sends the activity id and unlinking sends null`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        runBlocking { api.linkActivity("tok", "sess-7", "act-9") }

        val link = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PUT", link.method)
        assertEquals("/lifting/sessions/sess-7/link", link.path)
        assertTrue(link.body.readUtf8().contains("\"activity_id\":\"act-9\""))

        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        runBlocking { api.linkActivity("tok", "sess-7", null) }

        val unlink = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertTrue(unlink.body.readUtf8().contains("\"activity_id\":null"))
    }

    @Test
    fun `the cached analysis is a GET, and a missing one is null rather than an error`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("null"))
        assertNull(runBlocking { api.sessionAnalysis("tok", "sess-7") })
        assertEquals("/lifting/sessions/sess-7/ai-analysis", server.takeRequest(5, TimeUnit.SECONDS)!!.path)

        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"id":"a1","analysis_type":"lifting","analysis_text":"  Solid volume.  ",
                     "model_used":"gemini-2.0","created_at":"2026-11-06T12:00:00+00:00"}"""
            )
        )

        val analysis = runBlocking { api.sessionAnalysis("tok", "sess-7") }!!

        assertEquals("Solid volume.", analysis.text)
        assertEquals("gemini-2.0", analysis.model)
        assertNotNull(analysis.createdAt)
    }

    @Test
    fun `asking for an analysis is a POST on the same path`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"id":"a1","analysis_text":"Fresh analysis","model_used":"gemini-2.0"}"""
            )
        )

        val analysis = runBlocking { api.requestSessionAnalysis("tok", "sess-7") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/lifting/sessions/sess-7/ai-analysis", request.path)
        assertEquals("Fresh analysis", analysis!!.text)
    }

    @Test
    fun `an unavailable model surfaces its status`() {
        server.enqueue(MockResponse().setResponseCode(501).setBody("""{"detail":"unset"}"""))

        val error = runCatching { runBlocking { api.requestSessionAnalysis("tok", "sess-7") } }
            .exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(501, (error as ApiException).status)
    }

    @Test
    fun `saving a warm-up template posts the ramp in order`() {
        server.enqueue(
            MockResponse().setResponseCode(201).setBody(
                """{"id":"t1","name":"Bench warmup","exercise_name":"Bench Press",
                     "steps":[{"step_number":1,"weight_kg":60,"reps":8},
                              {"step_number":2,"weight_kg":80,"reps":5,"notes":"paused"}]}"""
            )
        )

        val saved = runBlocking {
            api.createWarmupTemplate(
                "tok",
                " Bench warmup ",
                "Bench Press",
                listOf(
                    uk.oli.fittrack.domain.WarmupStep(60.0, 8),
                    uk.oli.fittrack.domain.WarmupStep(80.0, 5, "paused")
                )
            )
        }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/lifting/warmup-templates", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"name\":\"Bench warmup\""))
        assertTrue(body.contains("\"exercise_name\":\"Bench Press\""))
        // Steps are numbered by their position, so the server's order is ours.
        assertTrue(body.contains("\"step_number\":1"))
        assertTrue(body.contains("\"step_number\":2"))
        assertTrue(body.contains("\"weight_kg\":80.0"))
        assertTrue(body.contains("\"notes\":\"paused\""))

        assertEquals("t1", saved!!.id)
        assertEquals(2, saved.steps.size)
    }

    @Test
    fun `deleting a warm-up template hits its own path`() {
        server.enqueue(MockResponse().setResponseCode(204))

        runBlocking { api.deleteWarmupTemplate("tok", "t1") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/lifting/warmup-templates/t1", request.path)
    }

    @Test
    fun `a refused template save is an error, not a silent no-op`() {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"detail":"bad"}"""))

        val error = runCatching {
            runBlocking {
                api.createWarmupTemplate("tok", "x", null, listOf(uk.oli.fittrack.domain.WarmupStep(20.0, 10)))
            }
        }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(400, (error as ApiException).status)
    }

    @Test
    fun `deleting a session hits the session path`() {
        server.enqueue(MockResponse().setResponseCode(204))

        runBlocking { api.deleteSession("tok", "sess-7") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("DELETE", request.method)
        assertEquals("/lifting/sessions/sess-7", request.path)
    }

    @Test
    fun `editing the session sends the local date and clears an empty note`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))
        val session = FinishedSession(
            id = "sess-7",
            planTitle = "Legs",
            startedAt = at("2026-10-24", 18),
            endedAt = at("2026-10-24", 19),
            sets = emptyList(),
            note = null
        )

        runBlocking { api.updateSession("tok", "sess-7", LiftingSessionPatch.of(session, zone)) }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", request.method)
        assertEquals("/lifting/sessions/sess-7", request.path)
        val body = request.body.readUtf8()
        assertTrue("local calendar date: $body", body.contains("\"session_date\":\"2026-10-24\""))
        assertTrue("note cleared explicitly: $body", body.contains("\"notes\":null"))
        assertTrue(body.contains("\"focus\":\"Legs\""))
        assertTrue(body.contains("\"duration_seconds\":3600"))
        assertTrue("offset timestamp: $body", body.contains("\"started_at\":\"2026-10-24T18:00"))
    }

    @Test
    fun `appending a set posts to the session and keeps the server id`() {
        server.enqueue(
            MockResponse().setResponseCode(201).setBody(
                """
                {"id":"set-42","session_id":"sess-7","exercise_name":"Bench Press",
                 "set_number":2,"weight_kg":92.5,"reps":4,"rpe":8.0,
                 "is_warmup":false,"is_amrap":false,"notes":"belt","order_index":3,
                 "client_id":"phone-1"}
                """.trimIndent()
            )
        )

        val created = runBlocking {
            api.addSet(
                "tok",
                "sess-7",
                NewSetBody(
                    exercise_name = "Bench Press",
                    set_number = 2,
                    weight_kg = 92.5,
                    reps = 4,
                    rpe = 8.0,
                    is_warmup = false,
                    is_amrap = false,
                    notes = "belt",
                    client_id = "phone-1"
                )
            )
        }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("POST", request.method)
        assertEquals("/lifting/sessions/sess-7/sets", request.path)
        val body = request.body.readUtf8()
        assertTrue(body.contains("\"exercise_name\":\"Bench Press\""))
        assertTrue(body.contains("\"client_id\":\"phone-1\""))
        // order_index is the server's to assign; a client that sends one is
        // guessing at a value it cannot know.
        assertTrue("must not send order_index: $body", !body.contains("order_index"))

        assertEquals("set-42", created.serverId)
        assertEquals("Bench Press", created.exercise)
        assertEquals(92.5, created.weightKg, 0.001)
        assertEquals(4, created.reps)
        assertEquals(8.0, created.rpe!!, 0.001)
        assertEquals("belt", created.note)
    }
}
