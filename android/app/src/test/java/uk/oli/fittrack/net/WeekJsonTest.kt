package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

/**
 * `GET /training-plans/{id}/week/{n}` returns a `TrainingWeekResponse`; a
 * `TrainingWeekDay` is a plan day plus `day_status` and the actuals.
 */
class WeekJsonTest {

    private val today = LocalDate.parse("2026-11-06")

    @Test
    fun `the week becomes seven-ish rows in plan order`() {
        val body = """
            {"plan_id":"p","week_number":7,"week_start":"2026-11-02","week_end":"2026-11-08",
             "days":[
               {"day_date":"2026-11-02","sport":"cycle","planned_focus":null},
               {"day_date":"2026-11-03","sport":"strength","planned_focus":"push",
                "planned_exercises":[{"exercise":"Bench Press","sets":4,"reps":4}]},
               {"day_date":"2026-11-06","sport":"strength","planned_focus":"legs","day_status":"completed",
                "planned_exercises":[{"exercise":"Back Squat","sets":5,"reps":3}]}
             ]}
        """.trimIndent()

        val week = WeekJson.decode(body, "Autumn block", today)!!

        assertEquals("Autumn block", week.planName)
        assertEquals(7, week.weekNumber)
        assertEquals(3, week.days.size)
        assertEquals("cycle", week.days[0].sport)
        assertNull(week.days[0].focus)
        assertEquals("push", week.days[1].focus)
        assertEquals(1, week.days[1].exercises)
        assertEquals("completed", week.days[2].status)
        assertEquals(listOf(false, false, true), week.days.map { it.isToday })
    }

    @Test
    fun `a day with no explicit status is pending unless the API says it is done`() {
        val body = """
            {"week_number":1,"days":[
              {"day_date":"2026-11-02","sport":"strength","planned_focus":"push"},
              {"day_date":"2026-11-03","sport":"strength","planned_focus":"pull","completed":true}
            ]}
        """.trimIndent()

        val week = WeekJson.decode(body, "Block", LocalDate.parse("2026-11-02"))!!

        assertEquals("pending", week.days[0].status)
        assertEquals("completed", week.days[1].status)
    }

    @Test
    fun `an empty or malformed week is no week rather than a crash`() {
        assertNull(WeekJson.decode("""{"week_number":3,"days":[]}""", "Block", today))
        assertNull(WeekJson.decode("not json", "Block", today))
        assertNull(WeekJson.decode("""{"days":[{"sport":"strength"}]}""", "Block", today))
    }
}
