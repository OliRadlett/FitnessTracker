package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class HistoryEngineTest {

    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String, hour: Int = 18): Long =
        LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private fun set(
        exercise: String,
        kg: Double,
        reps: Int,
        rpe: Int = 7,
        whenAt: Long = 0L,
        warmup: Boolean = false
    ) = LoggedSet(exercise, kg, reps, rpe.toDouble(), whenAt, isWarmup = warmup)

    private fun finished(
        date: String,
        title: String = "Push day",
        sets: List<LoggedSet>
    ) = FinishedSession(
        id = "s-$date",
        planTitle = title,
        startedAt = at(date, 18),
        endedAt = at(date, 19),
        sets = sets
    )

    @Test
    fun `last set comes from the newest session that contains the exercise`() {
        val history = listOf(
            finished("2026-11-03", sets = listOf(set("Bench Press", 90.0, 4))),
            finished("2026-11-05", sets = listOf(set("Squat", 120.0, 5)))
        )

        val last = HistoryEngine.lastSetFor(history, "Bench Press")

        assertEquals(90.0, last!!.weightKg, 0.001)
    }

    @Test
    fun `newest session wins when the exercise appears twice`() {
        val history = listOf(
            finished("2026-11-01", sets = listOf(set("Bench Press", 85.0, 4))),
            finished("2026-11-04", sets = listOf(set("Bench Press", 92.5, 3, rpe = 8)))
        )

        val last = HistoryEngine.lastSetFor(history, "Bench Press")

        assertEquals(92.5, last!!.weightKg, 0.001)
        assertEquals(3, last.reps)
        assertEquals(8.0, last.rpe!!, 0.001)
    }

    @Test
    fun `a warm-up is never the last set of an exercise`() {
        val history = listOf(
            finished(
                "2026-11-04",
                sets = listOf(
                    set("Bench Press", 60.0, 8, rpe = 4, warmup = true),
                    set("Bench Press", 90.0, 4, rpe = 8)
                )
            )
        )

        val last = HistoryEngine.lastSetFor(history, "Bench Press")

        assertEquals(90.0, last!!.weightKg, 0.001)
        assertFalse(last.isWarmup)
    }

    @Test
    fun `an exercise never performed has no last set`() {
        val history = listOf(finished("2026-11-03", sets = listOf(set("Squat", 120.0, 5))))

        assertNull(HistoryEngine.lastSetFor(history, "Bench Press"))
    }

    @Test
    fun `order is newest first regardless of how the file was written`() {
        val history = listOf(
            finished("2026-11-01", sets = listOf(set("Bench Press", 85.0, 4))),
            finished("2026-11-05", sets = listOf(set("Bench Press", 92.5, 4))),
            finished("2026-11-03", sets = listOf(set("Bench Press", 90.0, 4)))
        )

        val ordered = HistoryEngine.newestFirst(history).map { it.id }

        assertEquals(listOf("s-2026-11-05", "s-2026-11-03", "s-2026-11-01"), ordered)
    }

    @Test
    fun `daily volume fills empty days with zero`() {
        val history = listOf(
            finished("2026-11-03", sets = listOf(set("Bench Press", 90.0, 4))) // 360 kg
        )

        val strip = HistoryEngine.dailyVolume(history, nowMillis = at("2026-11-05", 12), days = 5, zone = zone)

        assertEquals(listOf("2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"),
            strip.map { it.first.toString() })
        assertEquals(listOf(0.0, 0.0, 360.0, 0.0, 0.0), strip.map { it.second })
    }

    @Test
    fun `two sessions on one day sum`() {
        val history = listOf(
            finished("2026-11-03", sets = listOf(set("Bench Press", 90.0, 4))),
            finished("2026-11-03", sets = listOf(set("Squat", 100.0, 5)))
        )

        val strip = HistoryEngine.dailyVolume(history, nowMillis = at("2026-11-03", 23), days = 1, zone = zone)

        assertEquals(360.0 + 500.0, strip.single().second, 0.001)
    }

    @Test
    fun `sessions older than the window are ignored`() {
        val history = listOf(
            finished("2026-10-20", sets = listOf(set("Bench Press", 90.0, 4))),
            finished("2026-11-04", sets = listOf(set("Bench Press", 90.0, 4)))
        )

        val strip = HistoryEngine.dailyVolume(history, nowMillis = at("2026-11-05", 12), days = 7, zone = zone)

        assertEquals(360.0, strip.sumOf { it.second }, 0.001)
    }
}
