package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import uk.oli.fittrack.domain.PlanExercise
import java.util.concurrent.TimeUnit

/**
 * The one write path the phone has into a training plan: a single day's PATCH.
 * The body is the part worth pinning — only the fields that changed may be sent,
 * or an edit to the focus would rewrite the prescription.
 */
class PlanDayWriteTest {

    private lateinit var server: MockWebServer
    private lateinit var api: PlanApi

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

    private fun respond(code: Int, body: String = "{}") {
        server.enqueue(MockResponse().setResponseCode(code).setBody(body))
    }

    @Test
    fun `a focus edit sends only the focus`() {
        respond(200)

        val result = runBlocking {
            api.saveDay("tok", "p1", "d1", PlanDayEdit(focus = "Legs"))
        }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("PATCH", request.method)
        assertEquals("/training-plans/p1/days/d1", request.path)
        assertEquals("""{"planned_focus":"Legs"}""", request.body.readUtf8())
        assertTrue(result is PlanDaySave.Saved)
    }

    @Test
    fun `a prescription edit sends exercises with their load`() {
        respond(200)

        runBlocking {
            api.saveDay(
                "tok", "p1", "d1",
                PlanDayEdit(
                    exercises = listOf(
                        PlanExercise("Bench Press", 3, 5, 90.0),
                        PlanExercise("Row", 3, 8, 0.0)
                    )
                )
            )
        }

        val body = server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()
        assertTrue(body.contains(""""exercise":"Bench Press""""))
        assertTrue(body.contains(""""sets":3"""))
        assertTrue(body.contains(""""weight_kg":90.0"""))
        // A bodyweight exercise carries no load key at all.
        val rowStart = body.indexOf(""""exercise":"Row"""")
        assertTrue(!body.substring(rowStart).contains("weight_kg"))
    }

    @Test
    fun `a conflict carries the server's sentence`() {
        respond(
            409,
            """{"detail":"A cycle session already exists on 2026-11-07"}"""
        )

        val result = runBlocking {
            api.saveDay("tok", "p1", "d1", PlanDayEdit(sport = "cycle"))
        }

        assertTrue(result is PlanDaySave.Refused)
        assertEquals(
            "A cycle session already exists on 2026-11-07",
            (result as PlanDaySave.Refused).message
        )
    }

    @Test
    fun `a refusal with no detail still says something`() {
        respond(500, "")

        val result = runBlocking { api.saveDay("tok", "p1", "d1", PlanDayEdit(focus = "x")) }

        assertTrue(result is PlanDaySave.Refused)
        assertTrue((result as PlanDaySave.Refused).message.contains("500"))
    }

    @Test
    fun `a rest day sends rest and no exercises`() {
        respond(200)

        runBlocking {
            api.saveDay("tok", "p1", "d1", PlanDayEdit(sport = "rest", exercises = emptyList()))
        }

        val body = server.takeRequest(5, TimeUnit.SECONDS)!!.body.readUtf8()
        assertTrue(body.contains(""""sport":"rest""""))
        assertTrue(body.contains(""""planned_exercises":[]"""))
    }

    @Test
    fun `the week carries the plan id and day ids, so a day can be edited`() {
        val body = """
            {"plan_id":"p1","week_number":11,"week_start":"2026-11-02","week_end":"2026-11-08",
             "days":[
               {"id":"d1","day_date":"2026-11-03","sport":"strength","planned_focus":"Push",
                "planned_exercises":[{"exercise":"Bench Press","sets":3,"reps":5,"weight_kg":90.0}],
                "notes":"knee felt fine"},
               {"id":"d2","day_date":"2026-11-04","sport":"rest"}
             ]}
        """.trimIndent()

        val week = WeekJson.decode(body, "Post summer strength", java.time.LocalDate.parse("2026-11-06"))!!

        assertEquals("p1", week.planId)
        assertEquals("d1", week.days.first().id)
        assertTrue(week.days.first().canEdit)
        assertEquals(90.0, week.days.first().exercises.first().weightKg, 0.001)
        assertEquals("knee felt fine", week.days.first().notes)
        assertEquals("rest", week.days.last().sport)
    }

    @Test
    fun `a day without an id cannot be edited`() {
        val body = """
            {"plan_id":"p1","week_number":1,"days":[{"day_date":"2026-11-03","sport":"strength"}]}
        """.trimIndent()

        val week = WeekJson.decode(body, "Plan", java.time.LocalDate.parse("2026-11-06"))!!

        assertTrue(!week.days.first().canEdit)
    }
}
