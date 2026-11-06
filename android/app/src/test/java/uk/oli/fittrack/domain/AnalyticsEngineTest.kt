package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class AnalyticsEngineTest {

    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String, hour: Int = 18): Long =
        LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private fun session(
        date: String,
        title: String = "Push day",
        vararg sets: LoggedSet
    ) = FinishedSession(
        id = "s-$date-${title.hashCode()}-${sets.size}",
        planTitle = title,
        startedAt = at(date),
        endedAt = at(date),
        sets = sets.toList()
    )

    private fun set(exercise: String, weightKg: Double, reps: Int, warmup: Boolean = false) =
        LoggedSet(exercise, weightKg, reps, null, at("2026-11-01"), isWarmup = warmup)

    // Friday 6 November 2026; the week starting Monday 2 November is the last bar.
    private val now = at("2026-11-06")

    @Test
    fun `eight weeks oldest first, zero filled`() {
        val weeks = AnalyticsEngine.weeklyVolume(emptyList(), now)

        assertEquals(8, weeks.size)
        assertEquals(LocalDate.parse("2026-09-14"), LocalDate.ofInstant(java.time.Instant.ofEpochMilli(weeks.first().weekStart), zone))
        assertEquals(LocalDate.parse("2026-11-02"), LocalDate.ofInstant(java.time.Instant.ofEpochMilli(weeks.last().weekStart), zone))
        assertTrue(weeks.all { it.volumeKg == 0.0 && it.sessions == 0 })
    }

    @Test
    fun `volume lands in the week it happened, warm-ups excluded`() {
        val history = listOf(
            session("2026-10-28", "Pull", set("Row", 60.0, 10), set("Row", 60.0, 10)),
            session("2026-11-03", "Push", set("Bench Press", 100.0, 5), set("Bench Press", 60.0, 10, warmup = true)),
            // The Monday after this week's start is a new bar.
            session("2026-11-02", "Legs", set("Squat", 100.0, 5))
        )

        val weeks = AnalyticsEngine.weeklyVolume(history, now)

        // Last bar is the week of 2 Nov: Push + Legs, 100×5 + 100×5 = 1000.
        assertEquals(1000.0, weeks.last().volumeKg, 0.001)
        assertEquals(2, weeks.last().sessions)
        // Two working sets: the warm-up does not count.
        assertEquals(2, weeks.last().sets)
        // The week before holds the pull session: 60×10 ×2 = 1200.
        assertEquals(1200.0, weeks[weeks.size - 2].volumeKg, 0.001)
    }

    @Test
    fun `a session older than the window is not in a bar`() {
        val history = listOf(session("2026-06-01", "Legs", set("Squat", 100.0, 5)))

        val weeks = AnalyticsEngine.weeklyVolume(history, now)

        assertEquals(0.0, weeks.sumOf { it.volumeKg }, 0.001)
    }

    @Test
    fun `balance is volume by focus, biggest first, with an Other tail`() {
        val history = listOf(
            session("2026-11-02", "Push", set("Bench Press", 100.0, 5)),   // 500
            session("2026-11-03", "Legs", set("Squat", 140.0, 5)),         // 700
            session("2026-11-04", "Pull", set("Row", 60.0, 10)),           // 600
            session("2026-11-05", "Arms", set("Curl", 20.0, 12)),          // 240
            session("2026-11-06", "Conditioning", set("Sled", 50.0, 10))   // 500
        )

        val slices = AnalyticsEngine.balance(history, now, top = 2)

        assertEquals(3, slices.size)
        assertEquals("Legs", slices[0].label)
        assertEquals(700.0, slices[0].volumeKg, 0.001)
        assertEquals("Pull", slices[1].label)
        // Push + Arms + Conditioning fold into one tail row.
        assertEquals("Other", slices[2].label)
        assertEquals(500.0 + 240.0 + 500.0, slices[2].volumeKg, 0.001)
        assertEquals(5, slices.sumOf { it.sets })
    }

    @Test
    fun `most trained counts working sets, one session per exercise per session`() {
        val history = listOf(
            session("2026-11-02", "Push", set("Bench Press", 100.0, 5), set("Bench Press", 100.0, 5), set("Fly", 20.0, 12)),
            session("2026-11-04", "Push", set("Bench Press", 105.0, 5), set("Bench Press", 60.0, 10, warmup = true)),
            session("2026-11-05", "Legs", set("Squat", 140.0, 5))
        )

        val lifts = AnalyticsEngine.mostTrained(history, now)

        assertEquals(listOf("Bench Press", "Squat", "Fly"), lifts.map { it.exercise })
        // Three working bench sets over two sessions; the warm-up is not counted.
        assertEquals(3, lifts[0].sets)
        assertEquals(2, lifts[0].sessions)
    }

    @Test
    fun `a window of no weeks is no weeks`() {
        assertTrue(AnalyticsEngine.weeklyVolume(emptyList(), now, weeks = 0).isEmpty())
        assertTrue(AnalyticsEngine.balance(emptyList(), now, weeks = 0).isEmpty())
        assertTrue(AnalyticsEngine.mostTrained(emptyList(), now, weeks = 0).isEmpty())
    }
}
