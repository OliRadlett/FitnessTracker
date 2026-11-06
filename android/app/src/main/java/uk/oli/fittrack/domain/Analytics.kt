package uk.oli.fittrack.domain

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** One week of training, as the volume bars read it. */
data class WeekVolume(
    /** Midnight on the Monday that starts the week. */
    val weekStart: Long,
    val volumeKg: Double,
    val sessions: Int,
    val sets: Int
)

/** Where the work went: one slice per focus, plus "Other" when there are many. */
data class BalanceSlice(val label: String, val volumeKg: Double, val sets: Int)

/** How often a lift was trained, and how much of it. */
data class LiftFrequency(
    val exercise: String,
    val sets: Int,
    val sessions: Int,
    val volumeKg: Double
)

/**
 * The website's Lifting › Analytics tab, computed from the cached history
 * instead of the `/charts` endpoints. Same reasoning as [ProgressEngine]: the
 * screen then cannot disagree with the log it is drawn from, and it works on a
 * dead signal.
 *
 * Every number here excludes warm-ups, which are kept in the log but are not
 * work — counting them would flatter the volume and the balance both.
 */
object AnalyticsEngine {

    /**
     * The last [weeks] Monday-based weeks, oldest first, zero-filled. A week
     * with no sessions is a zero bar, not a missing one: the gap is the point.
     */
    fun weeklyVolume(
        history: List<FinishedSession>,
        now: Long,
        weeks: Int = 8,
        zone: ZoneId = ZoneId.systemDefault()
    ): List<WeekVolume> {
        if (weeks <= 0) return emptyList()
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val thisMonday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val starts = (weeks - 1 downTo 0).map { thisMonday.minusWeeks(it.toLong()) }

        val byWeek = history.groupBy { session ->
            Instant.ofEpochMilli(session.endedAt).atZone(zone).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        }

        return starts.map { start ->
            val sessions = byWeek[start].orEmpty()
            WeekVolume(
                weekStart = start.atStartOfDay(zone).toInstant().toEpochMilli(),
                volumeKg = sessions.sumOf { SessionEngine.volumeKg(SessionEngine.workingSets(it.sets)) },
                sessions = sessions.size,
                sets = sessions.sumOf { SessionEngine.workingSets(it.sets).size }
            )
        }
    }

    /**
     * Volume by focus over the window, biggest first. Everything past [top]
     * folds into "Other" so a phone does not print a fifteen-row legend.
     */
    fun balance(
        history: List<FinishedSession>,
        now: Long,
        weeks: Int = 8,
        zone: ZoneId = ZoneId.systemDefault(),
        top: Int = 4
    ): List<BalanceSlice> {
        val window = windowed(history, now, weeks, zone)
        val byFocus = window.groupBy { it.planTitle.trim().ifBlank { "Other" } }
            .map { (label, sessions) ->
                BalanceSlice(
                    label = label,
                    volumeKg = sessions.sumOf { SessionEngine.volumeKg(SessionEngine.workingSets(it.sets)) },
                    sets = sessions.sumOf { SessionEngine.workingSets(it.sets).size }
                )
            }
            .filter { it.volumeKg > 0.0 }
            .sortedByDescending { it.volumeKg }

        if (byFocus.size <= top) return byFocus
        val head = byFocus.take(top)
        val rest = byFocus.drop(top)
        return head + BalanceSlice(
            label = "Other",
            volumeKg = rest.sumOf { it.volumeKg },
            sets = rest.sumOf { it.sets }
        )
    }

    /** The lifts trained most often in the window, by working sets. */
    fun mostTrained(
        history: List<FinishedSession>,
        now: Long,
        weeks: Int = 8,
        zone: ZoneId = ZoneId.systemDefault(),
        limit: Int = 5
    ): List<LiftFrequency> {
        val window = windowed(history, now, weeks, zone)
        data class Tally(var sets: Int = 0, var sessions: Int = 0, var volume: Double = 0.0)

        val tallies = linkedMapOf<String, Tally>()
        window.forEach { session ->
            val working = SessionEngine.workingSets(session.sets)
            working.groupBy { it.exercise.trim() }.forEach { (exercise, sets) ->
                if (exercise.isEmpty()) return@forEach
                val tally = tallies.getOrPut(exercise) { Tally() }
                tally.sets += sets.size
                tally.sessions += 1
                tally.volume += SessionEngine.volumeKg(sets)
            }
        }

        return tallies.entries
            .map { (exercise, t) -> LiftFrequency(exercise, t.sets, t.sessions, t.volume) }
            .sortedWith(compareByDescending<LiftFrequency> { it.sets }.thenByDescending { it.volumeKg })
            .take(limit)
    }

    /** The sessions inside the same window the week bars cover. */
    private fun windowed(
        history: List<FinishedSession>,
        now: Long,
        weeks: Int,
        zone: ZoneId
    ): List<FinishedSession> {
        if (weeks <= 0) return emptyList()
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val thisMonday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val firstMonday = thisMonday.minusWeeks((weeks - 1).toLong())
        val start = firstMonday.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = today.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        return history.filter { it.endedAt in start until end }
    }
}
