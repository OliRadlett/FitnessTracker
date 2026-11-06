package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class DashboardTest {

    private val today = LocalDate.parse("2026-11-06")

    private fun load(
        ctl: Double = 43.0,
        atl: Double = 40.0,
        tsb: Double = 3.0,
        points: List<LoadPoint> = emptyList()
    ) = TrainingLoad(ctl, atl, tsb, points)

    private fun point(date: String, tss: Double, tsb: Double = 0.0) =
        LoadPoint(date = date, tss = tss, ctl = 40.0, atl = 40.0, tsb = tsb)

    @Test
    fun `form reads in words, from overloaded to detraining`() {
        assertEquals("Overloaded", formLabel(-45.0))
        assertEquals("Productive", formLabel(-20.0))
        assertEquals("Neutral", formLabel(0.0))
        assertEquals("Fresh", formLabel(12.0))
        assertEquals("Detraining", formLabel(30.0))
    }

    @Test
    fun `this week's TSS sums only the last seven days`() {
        val body = load(
            points = listOf(
                point("2026-10-25", 100.0),
                point("2026-11-02", 60.0),
                point("2026-11-05", 40.0)
            )
        )

        assertEquals(100.0, body.weekTss(today), 0.001)
    }

    @Test
    fun `the seven-day form delta needs a week of history`() {
        assertNull(load(points = List(7) { point("2026-11-0${it + 1}", 10.0) }).tsbDelta7d())

        val week = (1..8).map { day ->
            point("2026-10-${(30 + day).toString().padStart(2, '0')}", 10.0, tsb = day.toDouble())
        }
        // Last point is tsb 8; eight points back is tsb 1 â†’ +7.
        assertEquals(7.0, load(tsb = 8.0, points = week).tsbDelta7d()!!, 0.001)
        assertEquals(LoadTrend.Rising, load(tsb = 8.0, points = week).trend)
    }

    @Test
    fun `a falling form is a falling trend`() {
        val points = (1..8).map { day ->
            point("2026-10-${(30 + day).toString().padStart(2, '0')}", 10.0, tsb = 20.0 - day)
        }

        assertEquals(LoadTrend.Falling, load(tsb = 12.0, points = points).trend)
    }

    @Test
    fun `no history is a flat trend rather than a guess`() {
        assertEquals(LoadTrend.Flat, load().trend)
    }

    @Test
    fun `goal progress is measured from the starting value`() {
        // 92 → 80 kg, now 88.9: 3.1 of 12 kg done = 25.8%.
        val weight = Goal(
            id = "g", metric = "weight_kg", target = 80.0, current = 88.9, starting = 92.0
        )

        assertEquals(25.8, weight.progressPct!!, 0.1)
        assertEquals("88.9 → 80", weight.describe())
    }

    @Test
    fun `a goal with no starting value falls back to value over target`() {
        val ctl = Goal(id = "g", metric = "ctl", target = 60.0, current = 45.0)

        assertEquals(75.0, ctl.progressPct!!, 0.001)
    }

    @Test
    fun `progress is clamped and a met goal is entirely done`() {
        val past = Goal(id = "g", metric = "ctl", target = 60.0, current = 80.0)
        assertEquals(100.0, past.progressPct!!, 0.001)

        val behind = Goal(id = "g", metric = "ctl", target = 60.0, current = -4.0)
        assertEquals(0.0, behind.progressPct!!, 0.001)
    }

    @Test
    fun `a server percentage wins over the app's arithmetic`() {
        val goal = Goal(
            id = "g", metric = "ctl", target = 60.0, current = 45.0, serverProgressPct = 41.0
        )

        assertEquals(41.0, goal.progressPct!!, 0.001)
    }

    @Test
    fun `active goals are soonest first and capped`() {
        val goals = listOf(
            Goal("a", "weight_kg", 80.0, targetDate = "2026-12-31"),
            Goal("b", "ctl", 60.0, targetDate = "2026-11-30"),
            Goal("c", "ftp_watts", 300.0, targetDate = null),
            Goal("d", "archived", 1.0, status = "archived"),
            Goal("e", "squat_kg", 180.0, targetDate = "2027-01-31")
        )

        val shown = activeGoals(goals)

        assertEquals(listOf("b", "a", "e"), shown.map { it.id })
        assertTrue(shown.none { it.status != "active" })
    }

    @Test
    fun `the week counts both sports and the days they happened on`() {
        val history = listOf(
            session("2026-11-03", set("Bench Press", 100.0, 5)),
            session("2026-11-05", set("Back Squat", 140.0, 3), set("Back Squat", 60.0, 8, warmup = true)),
            session("2026-10-20", set("Bench Press", 100.0, 5)) // before the window
        )
        val rides = listOf(
            ride("2026-11-04", 40.0),
            ride("2026-11-06", 20.0),
            ride("2026-10-01", 99.0)
        )
        val load = load(points = listOf(point("2026-11-05", 50.0), point("2026-11-06", 30.0)))

        val week = weekSummary(history, rides, load, today)

        assertEquals(2, week.sessions)
        assertEquals(2, week.rides)
        // 100Ã—5 + 140Ã—3 (the warm-up does not count) = 500 + 420.
        assertEquals(920.0, week.volumeKg, 0.001)
        assertEquals(60.0, week.distanceKm, 0.001)
        assertEquals(80.0, week.tss, 0.001)
        // Four distinct days: 3, 4, 5 and 6 November.
        assertEquals(4, week.daysTrained)
        assertTrue(!week.isEmpty)
    }

    @Test
    fun `an empty week says so`() {
        val week = weekSummary(emptyList(), emptyList(), null, today)

        assertTrue(week.isEmpty)
        assertEquals(0, week.daysTrained)
        assertEquals(0.0, week.tss, 0.001)
    }

    private fun session(date: String, vararg sets: LoggedSet) = FinishedSession(
        id = "s-$date-${sets.size}",
        planTitle = "Push day",
        startedAt = at(date),
        endedAt = at(date),
        sets = sets.toList()
    )

    private fun set(exercise: String, weightKg: Double, reps: Int, warmup: Boolean = false) =
        LoggedSet(exercise, weightKg, reps, null, at("2026-11-01"), isWarmup = warmup)

    private fun ride(date: String, km: Double) = Ride(
        id = "r-$date",
        name = "Ride",
        source = "strava",
        sportType = "Ride",
        startedAt = at(date),
        durationSeconds = 3600,
        distanceMeters = km * 1000,
        elevationGainMeters = 0.0
    )

    private fun at(date: String): Long =
        LocalDate.parse(date).atTime(18, 0)
            .atZone(java.time.ZoneId.of("Europe/London")).toInstant().toEpochMilli()

    @Test
    fun `a day with nothing done is empty, and one ride is not`() {
        assertTrue(TodayDone().isEmpty)
        assertTrue(!TodayDone(distanceMeters = 20_000.0).isEmpty)
        assertTrue(!TodayDone(tss = 42.0).isEmpty)
    }

    @Test
    fun `readiness says something even without a score`() {
        val none = Readiness(score = null, level = "unknown", message = "No data")
        assertFalse(none.hasData)
        assertEquals("Unknown", none.label)

        val ready = Readiness(score = 82.0, level = "green")
        assertTrue(ready.hasData)
        assertEquals("Ready", ready.label)
    }

    @Test
    fun `sleep debt only counts when it is a real debt`() {
        assertTrue(SleepDebt(debtHours = 3.5, averageHours = 7.4, daysBelowTarget = 4, targetHours = 8.0, windowDays = 7).isInDebt)
        assertTrue(!SleepDebt(debtHours = 0.2, averageHours = 7.9, daysBelowTarget = 1, targetHours = 8.0, windowDays = 7).isInDebt)
    }
}
