package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

/**
 * The plan's week numbers count Monday-based weeks from its own start, so the
 * Train tab's arrows can page to a real week rather than a calendar one.
 */
class PlanWeeksTest {

    private val start = LocalDate.parse("2026-10-28") // a Wednesday
    private val end = LocalDate.parse("2026-12-31")

    @Test
    fun `the week the plan starts in is week one`() {
        assertEquals(1, PlanWeeks.weekNumber(start, LocalDate.parse("2026-10-28")))
        // The Monday before the start is the same week.
        assertEquals(1, PlanWeeks.weekNumber(start, LocalDate.parse("2026-10-26")))
        // And the Sunday after is still week one.
        assertEquals(1, PlanWeeks.weekNumber(start, LocalDate.parse("2026-11-01")))
    }

    @Test
    fun `the following Monday starts week two`() {
        assertEquals(2, PlanWeeks.weekNumber(start, LocalDate.parse("2026-11-02")))
        assertEquals(2, PlanWeeks.weekNumber(start, LocalDate.parse("2026-11-08")))
        assertEquals(3, PlanWeeks.weekNumber(start, LocalDate.parse("2026-11-09")))
    }

    @Test
    fun `a date before the plan is clamped to week one rather than zero`() {
        assertEquals(1, PlanWeeks.weekNumber(start, LocalDate.parse("2026-09-01")))
    }

    @Test
    fun `the plan's extent counts its partial first and last weeks`() {
        // 26 Oct (Monday of the start week) through 28 Dec (Monday of the week
        // the plan ends in) is ten weeks, not eleven: the end is inclusive.
        assertEquals(10, PlanWeeks.totalWeeks(start, end))
    }

    @Test
    fun `paging is clamped to the plan`() {
        assertEquals(1, PlanWeeks.clamp(0, 10))
        assertEquals(1, PlanWeeks.clamp(-5, 10))
        assertEquals(10, PlanWeeks.clamp(11, 10))
        assertEquals(7, PlanWeeks.clamp(7, 10))
    }
}
