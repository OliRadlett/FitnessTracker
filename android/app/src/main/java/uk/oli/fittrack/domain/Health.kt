package uk.oli.fittrack.domain

import java.time.LocalDate
import java.time.YearMonth

/** Breathing rate, with the comparison that makes it mean something. */
data class RespiratoryRate(
    val current: Double?,
    val recentAverage: Double? = null,
    val baselineAverage: Double? = null,
    val trend: String = "stable",
    val date: String? = null
) {
    val hasData: Boolean get() = current != null || recentAverage != null

    /** "15.2 br/min · up from 14.8" — the change is the useful part. */
    fun describe(): String {
        val now = current ?: return "No reading"
        val text = String.format(java.util.Locale.UK, "%.1f br/min", now)
        val baseline = baselineAverage ?: return text
        val delta = now - baseline
        if (kotlin.math.abs(delta) < 0.1) return "$text · steady"
        val word = if (delta > 0) "up" else "down"
        return "$text · $word from ${String.format(java.util.Locale.UK, "%.1f", baseline)}"
    }
}

/** How regular sleep timing is; a low spread is good. */
data class SleepConsistency(
    val score: Double?,
    val averageBedtime: String? = null,
    val spreadMinutes: Double? = null,
    val daysAnalysed: Int = 0,
    val windowDays: Int = 7
) {
    val hasData: Boolean get() = score != null

    val label: String
        get() = when {
            score == null -> "Unknown"
            score >= 80.0 -> "Very consistent"
            score >= 60.0 -> "Fairly consistent"
            score >= 40.0 -> "Variable"
            else -> "Irregular"
        }

    /** "±34 min · in bed around 23:10". */
    fun describe(): String {
        val parts = buildList {
            spreadMinutes?.let { add("±${it.toInt()} min") }
            averageBedtime?.takeIf { it.isNotBlank() }?.let { add("in bed around $it") }
        }
        return parts.joinToString(" · ")
    }
}

/** Everything the health page shows; any field may be null. */
data class HealthSnapshot(
    val readiness: Readiness? = null,
    val sleepDebt: SleepDebt? = null,
    val respiratoryRate: RespiratoryRate? = null,
    val sleepConsistency: SleepConsistency? = null
) {
    val isEmpty: Boolean
        get() = readiness?.hasData != true && sleepDebt == null &&
            respiratoryRate?.hasData != true && sleepConsistency?.hasData != true
}

/** One thing done on a day, for the calendar. */
data class CalendarEntry(
    val id: String,
    val name: String,
    val sportType: String,
    val minutes: Int = 0,
    val distanceKm: Double = 0.0,
    val tss: Double? = null,
    val focus: String? = null
) {
    val isLift: Boolean
        get() = sportType.equals("WeightTraining", true) ||
            sportType.equals("strength", true) ||
            sportType.equals("Workout", true) ||
            focus != null
}

/** A day in the calendar: what was done, and how recovered you were. */
data class CalendarDay(
    val date: String,
    val entries: List<CalendarEntry> = emptyList(),
    val recoveryScore: Double? = null,
    val hrvMs: Double? = null,
    val restingHr: Double? = null,
    val sleepHours: Double? = null,
    val strain: Double? = null
) {
    val hasLift: Boolean get() = entries.any { it.isLift }
    val hasRide: Boolean get() = entries.any { !it.isLift }
    val isEmpty: Boolean get() = entries.isEmpty() && recoveryScore == null && sleepHours == null

    /** The recovery band the cell is coloured by; null when there is no score. */
    val recoveryBand: RecoveryBand?
        get() = recoveryScore?.let {
            when {
                it >= 70.0 -> RecoveryBand.Green
                it >= 40.0 -> RecoveryBand.Amber
                else -> RecoveryBand.Red
            }
        }

    /** "2 sessions · 62 kg" or "Ridden 41 km", for the day's detail header. */
    fun describe(): String {
        val lifts = entries.count { it.isLift }
        val rides = entries.count { !it.isLift }
        val parts = buildList {
            if (lifts > 0) add(if (lifts == 1) "1 lift" else "$lifts lifts")
            if (rides > 0) add(if (rides == 1) "1 ride" else "$rides rides")
            val km = entries.filter { !it.isLift }.sumOf { it.distanceKm }
            if (km > 0.0) add(formatKm(km))
        }
        return parts.joinToString(" · ")
    }
}

enum class RecoveryBand { Green, Amber, Red }

/** The first day of the month and how many blank cells precede it (Mon-first). */
fun monthStart(month: YearMonth): Pair<LocalDate, Int> {
    val first = month.atDay(1)
    // Monday = 0 … Sunday = 6, so a Monday-first grid has no leading blanks.
    val blanks = first.dayOfWeek.value - 1
    return first to blanks
}

/** Every day of the month, in order. */
fun monthDays(month: YearMonth): List<LocalDate> =
    (1..month.lengthOfMonth()).map { month.atDay(it) }
