package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class HistoryFilterTest {

    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String): Long =
        LocalDate.parse(date).atTime(18, 0).atZone(zone).toInstant().toEpochMilli()

    private fun set(exercise: String, kg: Double = 100.0, reps: Int = 5, warmup: Boolean = false) =
        LoggedSet(exercise, kg, reps, 8.0, 0L, isWarmup = warmup)

    private fun session(
        date: String,
        title: String = "Push day",
        note: String? = null,
        labels: SessionLabels? = null,
        sets: List<LoggedSet>
    ) = FinishedSession(
        id = "s-$date-${title.hashCode()}",
        planTitle = title,
        startedAt = at(date),
        endedAt = at(date),
        sets = sets,
        note = note,
        labels = labels
    )

    private val history = listOf(
        session("2026-11-05", title = "Push day", note = "felt strong", sets = listOf(set("Bench Press"))),
        session("2026-11-03", title = "Legs", sets = listOf(set("Back Squat"), set("Leg Press"))),
        session(
            "2026-09-01",
            title = "Push day",
            sets = listOf(set("Bench Press"), set("Tricep Extension"))
        )
    )

    private val now = at("2026-11-06")

    @Test
    fun `an empty query keeps everything`() {
        assertEquals(history, HistoryFilter.apply(history, HistoryQuery(), now))
    }

    @Test
    fun `text matches the focus, the note and exercise names`() {
        assertEquals(
            listOf("Legs"),
            HistoryFilter.apply(history, HistoryQuery(text = "legs"), now).map { it.planTitle }
        )
        assertEquals(1, HistoryFilter.apply(history, HistoryQuery(text = "strong"), now).size)
        assertEquals(2, HistoryFilter.apply(history, HistoryQuery(text = "bench"), now).size)
    }

    @Test
    fun `text is case-insensitive and ignores surrounding space`() {
        assertEquals(2, HistoryFilter.apply(history, HistoryQuery(text = "  BENCH "), now).size)
    }

    @Test
    fun `focus filters to one kind of session`() {
        val filtered = HistoryFilter.apply(history, HistoryQuery(focus = "Push day"), now)

        assertEquals(2, filtered.size)
        assertTrue(filtered.all { it.planTitle == "Push day" })
    }

    @Test
    fun `exercise filters to sessions that contain it`() {
        val filtered = HistoryFilter.apply(history, HistoryQuery(exercise = "Back Squat"), now)

        assertEquals(listOf("Legs"), filtered.map { it.planTitle })
    }

    @Test
    fun `a warm-up still counts as the exercise being present`() {
        val withWarmup = listOf(
            session(
                "2026-11-05",
                sets = listOf(set("Back Squat", 60.0, 8, warmup = true), set("Bench Press"))
            )
        )

        assertEquals(
            1,
            HistoryFilter.apply(withWarmup, HistoryQuery(exercise = "Back Squat"), now).size
        )
    }

    @Test
    fun `days drops sessions older than the window`() {
        val filtered = HistoryFilter.apply(history, HistoryQuery(days = 30), now)

        assertEquals(listOf("Push day", "Legs"), filtered.map { it.planTitle })
    }

    @Test
    fun `filters combine`() {
        val filtered = HistoryFilter.apply(
            history,
            HistoryQuery(text = "bench", focus = "Push day", days = 30),
            now
        )

        assertEquals(1, filtered.size)
        assertEquals(
            "2026-11-05",
            LocalDate.ofInstant(java.time.Instant.ofEpochMilli(filtered.single().endedAt), zone).toString()
        )
    }

    @Test
    fun `focuses are ordered by frequency then name`() {
        assertEquals(listOf("Push day", "Legs"), HistoryFilter.focuses(history))
    }

    @Test
    fun `a focus stored with a trailing space is the same focus`() {
        // The real account has both "Legs" and "Legs "; two identical chips is a
        // worse outcome than one chip that matches both.
        val withSpace = listOf(
            session("2026-11-01", title = "Legs", sets = listOf(set("Squat"))),
            session("2026-11-02", title = "Legs ", sets = listOf(set("Squat")))
        )

        assertEquals(listOf("Legs"), HistoryFilter.focuses(withSpace))
        assertEquals(2, HistoryFilter.apply(withSpace, HistoryQuery(focus = "Legs"), now).size)
    }

    @Test
    fun `an exercise stored with a trailing space is the same exercise`() {
        val withSpace = listOf(
            session("2026-11-01", sets = listOf(set("Bench Press ")))
        )

        assertEquals(listOf("Bench Press"), HistoryFilter.exercises(withSpace))
        assertEquals(
            1,
            HistoryFilter.apply(withSpace, HistoryQuery(exercise = "Bench Press"), now).size
        )
    }

    @Test
    fun `exercise options exclude warm-ups and are ordered by frequency`() {
        val withWarmups = history + session(
            "2026-11-04",
            title = "Legs",
            sets = listOf(set("Back Squat", 200.0, 6, warmup = true))
        )

        val options = HistoryFilter.exercises(withWarmups)

        assertEquals(listOf("Bench Press", "Back Squat", "Leg Press", "Tricep Extension"), options)
    }

    @Test
    fun `the active count matches the filters set`() {
        assertEquals(0, HistoryQuery().active)
        assertEquals(2, HistoryQuery(text = "x", days = 30).active)
        assertEquals(3, HistoryQuery(text = "x", days = 30, focus = "Push day").active)
    }

    @Test
    fun `split and class filters use the classifier labels`() {
        val labelled = listOf(
            session(
                "2026-11-01",
                labels = SessionLabels(split = "push", lift = "bench", klass = "volume_hypertrophy"),
                sets = listOf(set("Bench Press"))
            ),
            session(
                "2026-11-02",
                labels = SessionLabels(split = "legs", lift = "squat", klass = "max_strength"),
                sets = listOf(set("Back Squat"))
            ),
            session("2026-11-03", sets = listOf(set("Bench Press")))
        )

        assertEquals(1, HistoryFilter.apply(labelled, HistoryQuery(split = "legs"), now).size)
        assertEquals(1, HistoryFilter.apply(labelled, HistoryQuery(klass = "max_strength"), now).size)
        // An unlabelled session matches neither, rather than leaking through.
        assertEquals(0, HistoryFilter.apply(labelled, HistoryQuery(split = "upper"), now).size)
    }

    @Test
    fun `split and class options are ordered by frequency`() {
        val labelled = listOf(
            session("2026-11-01", labels = SessionLabels(split = "push", klass = "max_strength"), sets = listOf(set("A"))),
            session("2026-11-02", labels = SessionLabels(split = "push", klass = "max_strength"), sets = listOf(set("B"))),
            session("2026-11-03", labels = SessionLabels(split = "legs", klass = "volume_hypertrophy"), sets = listOf(set("C")))
        )

        assertEquals(listOf("push", "legs"), HistoryFilter.splits(labelled))
        assertEquals(listOf("max_strength", "volume_hypertrophy"), HistoryFilter.classes(labelled))
    }

    @Test
    fun `labels are humanised for chips`() {
        assertEquals("Max strength", humaniseLabel("max_strength"))
        assertEquals("Push", humaniseLabel("push"))
    }
}
