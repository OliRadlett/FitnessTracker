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
 * A goal, with the percentage worked out when the server did not supply one.
 *
 * Progress from `starting_value` is the honest reading: a goal of "80 kg" from
 * a start of 100 kg is 20% done at 96 kg, not 120%.
 */
data class GoalProgress(
    val id: String,
    val metric: String,
    val target: Double,
    val current: Double? = null,
    val starting: Double? = null,
    val targetDate: String? = null,
    val status: String = "active",
    val serverProgressPct: Double? = null,
    val note: String? = null
) {
    val progressPct: Double?
        get() {
            serverProgressPct?.let { return it.coerceIn(0.0, 100.0) }
            val now = current ?: return null
            val start = starting
            return when {
                start == null && target > 0.0 -> (now / target * 100.0).coerceIn(0.0, 100.0)
                start != null && start != target ->
                    ((now - start) / (target - start) * 100.0).coerceIn(0.0, 100.0)
                now >= target -> 100.0
                else -> 0.0
            }
        }

    /** "78.5 → 80.0 kg", without pretending to know the metric's unit. */
    fun describe(current: Double? = this.current): String {
        val now = current ?: return formatMetric(target)
        return "${formatMetric(now)} → ${formatMetric(target)}"
    }

    private fun formatMetric(value: Double): String =
        if (value == value.toLong().toDouble()) value.toLong().toString()
        else String.format(java.util.Locale.UK, "%.1f", value)
}

/** Goals that still matter, soonest first; archived and done ones drop out. */
fun activeGoals(goals: List<GoalProgress>, limit: Int = 3): List<GoalProgress> =
    goals.filter { it.status == "active" }
        .sortedWith(compareBy({ it.targetDate ?: "9999-12-31" }, { it.metric }))
        .take(limit)

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
