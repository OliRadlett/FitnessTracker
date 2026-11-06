package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LoggedSet
import java.time.LocalDate
import java.time.ZoneId

/**
 * The plan payload is shaped by `backend/app/schemas/training_plan.py`
 * (`TrainingPlanSummary`, `TrainingPlanRead`, `TrainingPlanDayRead` and the
 * `planned_exercises` entries, whose required keys are `exercise`/`sets`/`reps`).
 */
class PlanJsonTest {

    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String): Long =
        LocalDate.parse(date).atTime(18, 0).atZone(zone).toInstant().toEpochMilli()

    private val plansBody = """
        [
          {"id":"p-old","name":"Summer block","start_date":"2026-06-01","end_date":"2026-09-30"},
          {"id":"p-live","name":"Autumn block","start_date":"2026-10-01","end_date":"2026-12-31"}
        ]
    """.trimIndent()

    private val planBody = """
        {
          "id":"p-live","name":"Autumn block","start_date":"2026-10-01","end_date":"2026-12-31",
          "days":[
            {"day_date":"2026-11-05","sport":"strength","planned_focus":"push",
             "planned_exercises":[{"exercise":"Bench Press","sets":4,"reps":4,"rpe":8}]},
            {"day_date":"2026-11-06","sport":"cycle","planned_focus":null,
             "planned_exercises":null},
            {"day_date":"2026-11-06","sport":"strength","planned_focus":"legs",
             "planned_exercises":[
               {"exercise":"Back Squat","sets":5,"reps":3,"pct_1rm":0.85},
               {"exercise":"Leg Press ","sets":3,"reps":8},
               {"exercise":"","sets":3,"reps":8},
               {"exercise":"Calf Raise","sets":0,"reps":12}
             ]},
            {"day_date":"2026-11-07","sport":"rest","planned_exercises":null}
          ]
        }
    """.trimIndent()

    @Test
    fun `the plan whose dates bracket today wins`() {
        val plans = PlanJson.plans(plansBody)
        val today = LocalDate.parse("2026-11-06")

        assertEquals("p-live", PlanJson.activePlan(plans, today)?.id)
    }

    @Test
    fun `a day outside every plan has no plan`() {
        val plans = PlanJson.plans(plansBody)

        assertNull(PlanJson.activePlan(plans, LocalDate.parse("2027-01-05")))
    }

    @Test
    fun `today's strength session becomes the app's plan`() {
        val history = listOf(
            FinishedSession(
                id = "s1",
                planTitle = "Legs",
                startedAt = at("2026-11-01"),
                endedAt = at("2026-11-01"),
                sets = listOf(LoggedSet("Back Squat", 120.0, 3, 8.0, at("2026-11-01")))
            )
        )

        val day = PlanJson.today(PlanJson.plan(planBody)!!, LocalDate.parse("2026-11-06"), history)!!

        assertEquals("Legs", day.focus)
        assertEquals("Autumn block", day.planName)
        assertEquals(listOf("Back Squat", "Leg Press"), day.exercises.map { it.name })
        assertEquals(5, day.exercises[0].sets)
        assertEquals(3, day.exercises[0].reps)
        // A planned entry carries no load, so last time's weight is the target.
        assertEquals(120.0, day.exercises[0].weightKg, 0.001)
        // No history for the leg press: zero, and the stepper starts there.
        assertEquals(0.0, day.exercises[1].weightKg, 0.001)
    }

    @Test
    fun `blank names and empty prescriptions are dropped`() {
        val day = PlanJson.today(PlanJson.plan(planBody)!!, LocalDate.parse("2026-11-06"))!!

        assertTrue(day.exercises.none { it.name.isBlank() })
        assertTrue(day.exercises.none { it.sets == 0 })
        // Two of the four entries were unusable.
        assertEquals(4, day.planExerciseCount)
        assertEquals(2, day.exercises.size)
    }

    @Test
    fun `a rest day is not a session`() {
        assertNull(PlanJson.today(PlanJson.plan(planBody)!!, LocalDate.parse("2026-11-07")))
    }

    @Test
    fun `a day with no exercises is not a session`() {
        val noExercises = """
            {"id":"p","name":"Block","days":[
              {"day_date":"2026-11-06","sport":"strength","planned_focus":"legs",
               "planned_exercises":[]}
            ]}
        """.trimIndent()

        assertNull(PlanJson.today(PlanJson.plan(noExercises)!!, LocalDate.parse("2026-11-06")))
    }

    @Test
    fun `a missing focus still names the session`() {
        val noFocus = """
            {"id":"p","name":"Block","days":[
              {"day_date":"2026-11-06","sport":"strength",
               "planned_exercises":[{"exercise":"Bench Press","sets":3,"reps":5}]}
            ]}
        """.trimIndent()

        val day = PlanJson.today(PlanJson.plan(noFocus)!!, LocalDate.parse("2026-11-06"))!!

        assertEquals("Planned session", day.focus)
    }

    @Test
    fun `a malformed payload is no plan rather than a crash`() {
        assertTrue(PlanJson.plans("not json").isEmpty())
        assertNull(PlanJson.plan("{\"id\":123}"))
    }
}
