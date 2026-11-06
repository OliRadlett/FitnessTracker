package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

/**
 * Progress is arithmetic over sets the app already holds, so it is tested
 * without a screen: a wrong PR is worse than a missing one.
 */
class ProgressEngineTest {

    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String, hour: Int = 18): Long =
        LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private fun set(
        exercise: String,
        kg: Double,
        reps: Int,
        warmup: Boolean = false,
        whenAt: Long = 0L
    ) = LoggedSet(exercise, kg, reps, 8.0, whenAt, isWarmup = warmup)

    private fun session(date: String, vararg sets: LoggedSet) = FinishedSession(
        id = "s-$date",
        planTitle = "Push day",
        startedAt = at(date, 18),
        endedAt = at(date, 19),
        sets = sets.toList()
    )

    @Test
    fun `a single is its own estimated max`() {
        assertEquals(130.0, ProgressEngine.estimated1rm(130.0, 1), 0.001)
    }

    @Test
    fun `brzycki estimates a five-rep set`() {
        // 100 × 36 / (37 − 5) = 112.5
        assertEquals(112.5, ProgressEngine.estimated1rm(100.0, 5), 0.001)
    }

    @Test
    fun `the estimate never divides by zero on a high-rep set`() {
        val e1rm = ProgressEngine.estimated1rm(60.0, 40)

        assertTrue(e1rm > 60.0)
        assertTrue(e1rm.isFinite())
    }

    @Test
    fun `personal bests are per exercise and ignore warm-ups`() {
        val history = listOf(
            session(
                "2026-11-01",
                set("Bench Press", 130.0, 2),
                set("Bench Press", 60.0, 8, warmup = true),
                set("Squat", 160.0, 3)
            ),
            session("2026-11-05", set("Bench Press", 120.0, 5))
        )

        val bests = ProgressEngine.personalBests(history)

        assertEquals(listOf("Squat", "Bench Press"), bests.map { it.exercise })
        // 130 × 2 is 133.7 e1RM; 120 × 5 is 135 — the best lift is not the
        // heaviest one, which is the whole reason this is estimated.
        assertEquals(120.0, bests.first { it.exercise == "Bench Press" }.weightKg, 0.001)
        assertEquals(5, bests.first { it.exercise == "Bench Press" }.reps)
    }

    @Test
    fun `a heavy warm-up is never a personal best`() {
        val history = listOf(
            session("2026-11-01", set("Squat", 200.0, 5, warmup = true), set("Squat", 120.0, 5))
        )

        assertEquals(120.0, ProgressEngine.personalBests(history).single().weightKg, 0.001)
    }

    @Test
    fun `every rep range is reported, empty ones included`() {
        val history = listOf(
            session("2026-11-01", set("Bench Press", 100.0, 5), set("Bench Press", 130.0, 1))
        )

        val ranges = ProgressEngine.bestByRepRange(history, "Bench Press")

        assertEquals(ProgressEngine.REP_RANGES, ranges.map { it.first })
        assertEquals(130.0, ranges.first { it.first.label == "1" }.second!!.weightKg, 0.001)
        assertEquals(100.0, ranges.first { it.first.label == "4–6" }.second!!.weightKg, 0.001)
        assertNull(ranges.first { it.first.label == "7–12" }.second)
        assertNull(ranges.first { it.first.label == "12+" }.second)
    }

    @Test
    fun `at equal weight the rep range prefers more reps`() {        val history = listOf(
            session("2026-11-01", set("Bench Press", 100.0, 4), set("Bench Press", 100.0, 6))
        )

        val best = ProgressEngine.bestByRepRange(history, "Bench Press")
            .first { it.first.label == "4–6" }.second!!

        assertEquals(6, best.reps)
    }

    @Test
    fun `progress is one point per session, oldest first`() {
        val history = listOf(
            session("2026-11-05", set("Bench Press", 120.0, 5)),
            session("2026-10-20", set("Bench Press", 100.0, 5)),
            session("2026-11-01", set("Bench Press", 110.0, 5), set("Bench Press", 130.0, 1))
        )

        val series = ProgressEngine.progressSeries(history, "Bench Press")

        assertEquals(3, series.size)
        assertTrue(series[0].first < series[1].first)
        assertTrue(series[1].first < series[2].first)
        assertEquals(112.5, series[0].second, 0.001)
        // 130 × 1 beats 110 × 5 for the same session (130 vs 123.75).
        assertEquals(130.0, series[1].second, 0.001)
    }

    @Test
    fun `the series is capped to the most recent sessions`() {
        val history = (1..10).map { day ->
            session(
                "2026-11-${day.toString().padStart(2, '0')}",
                set("Bench Press", 100.0 + day, 5)
            )
        }

        val series = ProgressEngine.progressSeries(history, "Bench Press", limit = 3)

        assertEquals(3, series.size)
        assertEquals(110.0 * 1.125, series.last().second, 0.001)
    }

    @Test
    fun `an exercise with no sets has an empty series`() {
        assertTrue(ProgressEngine.progressSeries(listOf(session("2026-11-01")), "Bench Press").isEmpty())
    }

    @Test
    fun `a lift stored with a trailing space is one personal best`() {
        val history = listOf(
            session("2026-11-01", set("Bench Press ", 100.0, 5)),
            session("2026-11-02", set("Bench Press", 110.0, 5))
        )

        val bests = ProgressEngine.personalBests(history)

        assertEquals(1, bests.size)
        assertEquals("Bench Press", bests.single().exercise)
        assertEquals(110.0, bests.single().weightKg, 0.001)
    }

    @Test
    fun `exercise names are ordered by how often they appear`() {
        val history = listOf(
            session("2026-11-01", set("Bench Press", 100.0, 5), set("Squat", 140.0, 3)),
            session("2026-11-02", set("Bench Press", 100.0, 5)),
            session("2026-11-03", set("Bench Press", 40.0, 12, warmup = true))
        )

        assertEquals(listOf("Bench Press", "Squat"), ProgressEngine.exerciseNames(history))
    }

    @Test
    fun `an exercise with a long record outranks one with a single big session`() {
        // The chart needs two sessions to draw; five sets in one session is not
        // a history, so Squat must come second even though it carries more work.
        val history = listOf(
            session("2026-11-01", set("Bench Press", 100.0, 5), set("Squat", 200.0, 5)),
            session("2026-11-02", set("Bench Press", 100.0, 5)),
            session("2026-11-03", set("Bench Press", 100.0, 5))
        )

        assertEquals(listOf("Bench Press", "Squat"), ProgressEngine.exerciseNames(history))
    }

    @Test
    fun `records collapse to one row per lift, best first`() {
        val records = listOf(
            PersonalRecord("a", "Bench Press", 100.0, 5, e1rm = 116.0),
            PersonalRecord("b", "Bench Press ", 120.0, 3, e1rm = 132.0),
            PersonalRecord("c", "Back Squat", 150.0, 5, e1rm = 174.0, manual = true)
        )

        val rows = recordsByExercise(records)

        assertEquals(listOf("Back Squat", "Bench Press"), rows.map { it.exercise })
        // The trimmed names are one lift, and the stronger row wins.
        assertEquals(132.0, rows[1].e1rm, 0.001)
        assertTrue(rows[0].manual)
    }
}
