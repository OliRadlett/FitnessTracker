package uk.oli.fittrack.domain

import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** One weigh-in, as `/metrics/weight` returns it. */
@Serializable
data class WeightEntry(
    val id: String,
    val date: String,
    val weightKg: Double,
    /** manual / withings / whoop — only a manual entry can be edited here. */
    val source: String = "manual",
    val bodyFatPercent: Double? = null
) {
    val isManual: Boolean get() = source == "manual"

    fun localDate(): LocalDate? = runCatching { LocalDate.parse(date) }.getOrNull()
}

/**
 * Weight history plus the 7-day rolling average the API computes.
 *
 * The rolling average is the number to read: a single weigh-in moves by a
 * kilogram either way with water, and a trend is what "am I losing weight"
 * actually means.
 */
data class BodyTrend(
    val entries: List<WeightEntry>,
    val rolling: List<Pair<String, Double>> = emptyList()
) {
    val latest: WeightEntry? get() = entries.maxByOrNull { it.date }

    /** What the trend has done over the last [days], in kilos; null without two points. */
    fun changeKg(today: LocalDate, days: Long = 30, zone: ZoneId = ZoneId.systemDefault()): Double? {
        if (entries.isEmpty()) return null
        val cutoff = today.minusDays(days)
        val then = entries
            .mapNotNull { entry -> entry.localDate()?.let { it to entry.weightKg } }
            .filter { it.first <= cutoff }
            .maxByOrNull { it.first }?.second ?: return null
        val now = latest?.weightKg ?: return null
        return now - then
    }

    /** The rolling average as epoch-millis points, for a line chart. */
    fun rollingPoints(zone: ZoneId = ZoneId.systemDefault()): List<Pair<Long, Double>> =
        rolling.mapNotNull { (date, kg) ->
            runCatching {
                LocalDate.parse(date).atStartOfDay(zone).toInstant().toEpochMilli() to kg
            }.getOrNull()
        }

    /** Days between the first and last weigh-in, for "over N days". */
    fun spanDays(): Long {
        val dates = entries.mapNotNull { it.localDate() }.sorted()
        if (dates.size < 2) return 0
        return ChronoUnit.DAYS.between(dates.first(), dates.last())
    }
}

/** A weight as kilo-and-a-bit, without inventing precision. */
fun formatWeightKg(weightKg: Double): String =
    if (weightKg == weightKg.toLong().toDouble()) weightKg.toLong().toString()
    else String.format(java.util.Locale.UK, "%.1f", weightKg)

/** Guard against a fat-fingered "7" or "700" being sent as a bodyweight. */
fun plausibleWeight(kg: Double): Boolean = kg in 20.0..400.0
