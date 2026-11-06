package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class GoalsTest {

    private fun goal(
        id: String = "g",
        metric: String = "weight_kg",
        target: Double = 80.0,
        current: Double? = 88.9,
        starting: Double? = 92.0,
        targetDate: String? = null,
        status: String = "active",
        unit: String = ""
    ) = Goal(
        id = id,
        metric = metric,
        target = target,
        current = current,
        starting = starting,
        targetDate = targetDate,
        status = status,
        unit = unit
    )

    @Test
    fun `progress runs from the start, not from zero`() {
        // 92 → 80, now 88.9: 3.1 of 12 done.
        assertEquals(25.8, goal().progressPct!!, 0.1)
    }

    @Test
    fun `a goal with no start falls back to value over target, and clamps`() {
        assertEquals(75.0, goal(target = 60.0, current = 45.0, starting = null).progressPct!!, 0.001)
        assertEquals(100.0, goal(target = 60.0, current = 90.0, starting = null).progressPct!!, 0.001)
    }

    @Test
    fun `a server percentage wins`() {
        val server = goal().copy(serverProgressPct = 41.0)

        assertEquals(41.0, server.progressPct!!, 0.001)
    }

    @Test
    fun `a goal with no current value has no percentage`() {
        assertNull(goal(current = null).progressPct)
    }

    @Test
    fun `the unit comes from the registry and only when there is one`() {
        assertEquals("88.9 → 80", goal().describe())
        assertEquals("88.9 kg → 80 kg", goal(unit = "kg").describe())
        assertEquals("52", goal(target = 52.0, current = null).describe())
    }

    @Test
    fun `active goals come first, then the soonest, and finished ones last`() {
        val goals = listOf(
            goal(id = "archived", status = "archived", targetDate = "2026-10-01"),
            goal(id = "later", targetDate = "2027-01-31"),
            goal(id = "sooner", targetDate = "2026-11-30"),
            goal(id = "undated", targetDate = null)
        )

        assertEquals(
            listOf("sooner", "later", "undated", "archived"),
            orderedGoals(goals).map { it.id }
        )
        assertEquals(listOf("sooner", "later", "undated"), activeGoals(goals).map { it.id })
    }

    @Test
    fun `active goals are capped at three`() {
        val goals = (1..6).map { goal(id = "g$it", targetDate = "2026-1$it-01") }

        assertEquals(3, activeGoals(goals).size)
    }

    @Test
    fun `statuses read as words`() {
        assertEquals("Active", statusLabel("active"))
        assertEquals("Achieved", statusLabel("achieved"))
        assertEquals("Abandoned", statusLabel("abandoned"))
        assertEquals("Paused", statusLabel("paused"))
    }

    @Test
    fun `a metric label prefers the registry, then a readable fallback`() {
        val registry = listOf(GoalMetric("ftp_watts", "FTP", "W"))

        assertEquals("FTP", metricLabel("ftp_watts", registry))
        assertEquals("Bodyweight", metricLabel("weight_kg"))
        assertEquals("Weekly volume", metricLabel("weekly_volume_kg"))
        assertEquals("Some metric", metricLabel("some_metric"))
        assertEquals("W", metricUnit("ftp_watts", registry))
        assertEquals("", metricUnit("weight_kg"))
    }

    @Test
    fun `a metric that needs a filter is not offered`() {
        assertTrue(GoalMetric("squat_kg", "Squat").supported)
        assertTrue(!GoalMetric("squat_kg", "Squat", requiresFilter = listOf("exercise")).supported)
    }

    @Test
    fun `days left counts to the target date, and history is negative`() {
        val today = LocalDate.now()
        assertEquals(0L, goal(targetDate = today.toString()).daysLeft)
        assertEquals(10L, goal(targetDate = today.plusDays(10).toString()).daysLeft)
        assertEquals(-3L, goal(targetDate = today.minusDays(3).toString()).daysLeft)
        assertNull(goal(targetDate = null).daysLeft)
    }

    @Test
    fun `a malformed target date is no days rather than a crash`() {
        assertNull(goal(targetDate = "not a date").daysLeft)
    }
}
