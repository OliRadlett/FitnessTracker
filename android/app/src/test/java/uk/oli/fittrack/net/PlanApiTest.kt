package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * The plan lookup is two calls — the summaries, then the one plan — and the
 * interesting behaviour is what it says when there is nothing to train.
 */
class PlanApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: PlanApi

    private val today = LocalDate.parse("2026-11-06")

    private val plansBody = """
        [{"id":"p-live","name":"Autumn block","start_date":"2026-10-01","end_date":"2026-12-31"}]
    """.trimIndent()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = PlanApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun planBody(dayJson: String) = """
        {"id":"p-live","name":"Autumn block","days":[$dayJson]}
    """.trimIndent()

    @Test
    fun `today's planned session comes back as a plan`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody(plansBody))
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                planBody(
                    """{"day_date":"2026-11-06","sport":"strength","planned_focus":"legs",
                        "planned_exercises":[{"exercise":"Back Squat","sets":5,"reps":3}]}"""
                )
            )
        )

        val lookup = runBlocking { api.todayPlan("tok", today, emptyList()) }

        assertTrue(lookup is PlanLookup.Planned)
        val day = (lookup as PlanLookup.Planned).day
        assertEquals("Legs", day.focus)
        assertEquals("Autumn block", day.planName)
        assertEquals(listOf("Back Squat"), day.exercises.map { it.name })

        val first = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/training-plans", first.path)
        assertEquals("Bearer tok", first.getHeader("Authorization"))
        val second = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/training-plans/p-live", second.path)
    }

    @Test
    fun `a rest day is reported as such, not as a failure`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody(plansBody))
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                planBody("""{"day_date":"2026-11-06","sport":"rest"}""")
            )
        )

        val lookup = runBlocking { api.todayPlan("tok", today, emptyList()) }

        assertEquals(PlanLookup.NoneToday("Autumn block"), lookup)
    }

    @Test
    fun `a plan that does not cover today is unavailable`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[{"id":"p-old","name":"Summer","start_date":"2026-06-01","end_date":"2026-09-30"}]"""
            )
        )

        assertEquals(PlanLookup.Unavailable, runBlocking { api.todayPlan("tok", today, emptyList()) })
    }

    @Test
    fun `a failed request is unavailable rather than a rest day`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"detail":"boom"}"""))

        assertEquals(PlanLookup.Unavailable, runBlocking { api.todayPlan("tok", today, emptyList()) })
    }
}
