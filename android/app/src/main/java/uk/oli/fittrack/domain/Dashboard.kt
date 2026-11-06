package uk.oli.fittrack.domain

import java.time.LocalDate

/** One day of the load model. */
data class LoadPoint(
    val date: String,
    val tss: Double,
    val ctl: Double,
    val atl: Double,
    val tsb: Double
)

/** Fitness, fatigue and form, with the recent history for a line. */
data class TrainingLoad(
    val ctl: Double,
    val atl: Double,
    val tsb: Double,
    val points: List<LoadPoint> = emptyList()
) {
    /** This week's TSS, summed from the model rather than a second endpoint. */
    fun weekTss(today: LocalDate): Double {
        val from = today.minusDays(6).toString()
        return points.filter { it.date >= from }.sumOf { it.tss }
    }

    /** How form has moved over the last week; positive is fresher. */
    fun tsbDelta7d(): Double? {
        if (points.size < 8) return null
        return tsb - points[points.size - 8].tsb
    }

    val trend: LoadTrend
        get() = when {
            points.size < 8 -> LoadTrend.Flat
            tsbDelta7d() == null -> LoadTrend.Flat
            tsbDelta7d()!! > 5.0 -> LoadTrend.Rising
            tsbDelta7d()!! < -5.0 -> LoadTrend.Falling
            else -> LoadTrend.Flat
        }
}

enum class LoadTrend { Rising, Falling, Flat }

/**
 * Form, in the language a lifter uses. The bands follow the usual TSB reading:
 * deeply negative is overload, positive is fresh — with the caveat that a very
 * high form after no training is detraining, not fitness.
 */
fun formLabel(tsb: Double): String = when {
    tsb > 25.0 -> "Detraining"
    tsb > 5.0 -> "Fresh"
    tsb >= -10.0 -> "Neutral"
    tsb >= -30.0 -> "Productive"
    else -> "Overloaded"
}

/** One day's worth of what has already been done, from the today summary. */
data class TodayDone(
    val tss: Double = 0.0,
    val volumeKg: Double = 0.0,
    val distanceMeters: Double = 0.0,
    val durationSeconds: Int = 0,
    val activities: Int = 0,
    val sessions: Int = 0
) {
    val isEmpty: Boolean
        get() = activities == 0 && sessions == 0 && tss <= 0.0 && volumeKg <= 0.0 &&
            distanceMeters <= 0.0
}

/** Recovery, as the readiness endpoint reports it. */
data class Readiness(
    val score: Double?,
    val level: String,
    val hrvMs: Double? = null,
    val restingHr: Double? = null,
    val message: String? = null,
    val date: String? = null
) {
    val hasData: Boolean get() = score != null || hrvMs != null || restingHr != null

    /** A word for the level, because "yellow" on its own says nothing. */
    val label: String
        get() = when (level) {
            "green" -> "Ready"
            "yellow" -> "Moderate"
            "red" -> "Recover"
            else -> "Unknown"
        }
}

/** Cumulative sleep debt over the window. */
data class SleepDebt(
    val debtHours: Double,
    val averageHours: Double,
    val daysBelowTarget: Int,
    val targetHours: Double,
    val windowDays: Int
) {
    val isInDebt: Boolean get() = debtHours >= 1.0
}

/**
 * Goals live in [Goal] (domain/Goals.kt): the dashboard and the goals page must
 * agree about progress, so they share one model.
 */

/** The week at a glance: the website's Weekly tab, in a few numbers. */
data class WeekSummary(
    val sessions: Int = 0,
    val rides: Int = 0,
    val volumeKg: Double = 0.0,
    val distanceKm: Double = 0.0,
    val tss: Double = 0.0,
    val daysTrained: Int = 0
) {
    val isEmpty: Boolean
        get() = sessions == 0 && rides == 0
}

/**
 * The last seven days across both sports.
 *
 * Lifting volume comes from the sets (never the server's stored total, which can
 * be stale), riding distance from the rides, and TSS from the load model when it
 * has one — the same three rules every other screen follows.
 */
fun weekSummary(
    history: List<FinishedSession>,
    rides: List<Ride>,
    load: TrainingLoad?,
    today: LocalDate,
    zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
    days: Long = 7
): WeekSummary {
    val since = today.minusDays(days)
    fun inWindow(date: LocalDate) = !date.isBefore(since) && !date.isAfter(today)
    fun dayOf(at: Long) = java.time.Instant.ofEpochMilli(at).atZone(zone).toLocalDate()

    val sessions = history.filter { inWindow(dayOf(it.endedAt)) }
    val weekRides = rides.filter { inWindow(it.localDate(zone)) }
    val trained = buildSet {
        sessions.forEach { add(dayOf(it.endedAt)) }
        weekRides.forEach { add(it.localDate(zone)) }
    }

    return WeekSummary(
        sessions = sessions.size,
        rides = weekRides.size,
        volumeKg = sessions.sumOf { SessionEngine.volumeKg(SessionEngine.workingSets(it.sets)) },
        distanceKm = weekRides.sumOf { it.distanceKm },
        tss = load?.weekTss(today) ?: 0.0,
        daysTrained = trained.size
    )
}
