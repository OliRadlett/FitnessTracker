package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.CalendarDay
import uk.oli.fittrack.domain.CalendarEntry
import uk.oli.fittrack.domain.HealthSnapshot
import uk.oli.fittrack.domain.RespiratoryRate
import uk.oli.fittrack.domain.SleepConsistency
import java.util.concurrent.TimeUnit

@Serializable
private data class RespiratoryDto(
    val current_rr: Double? = null,
    val recent_avg_rr: Double? = null,
    val baseline_avg_rr: Double? = null,
    val trend: String? = null,
    val date: String? = null
)

@Serializable
private data class SleepConsistencyDto(
    val consistency_score: Double? = null,
    val avg_bedtime: String? = null,
    val std_minutes: Double? = null,
    val days_analyzed: Int = 0,
    val window_days: Int = 7
)

@Serializable
private data class CalendarActivityDto(
    val id: String = "",
    val date: String = "",
    val sport_type: String = "",
    val name: String = "",
    val duration_seconds: Int? = null,
    val distance_meters: Double? = null,
    val tss: Double? = null,
    val focus: String? = null
)

@Serializable
private data class CalendarMetricDto(
    val date: String = "",
    val recovery_score: Double? = null,
    val hrv_ms: Double? = null,
    val strain: Double? = null,
    val sleep_duration_minutes: Double? = null,
    val sleep_efficiency: Double? = null,
    val resting_hr: Double? = null,
    val respiratory_rate: Double? = null
)

@Serializable
private data class CalendarDto(
    val activities: List<CalendarActivityDto> = emptyList(),
    val daily_metrics: List<CalendarMetricDto> = emptyList()
)

internal object HealthJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun respiratory(body: String): RespiratoryRate? = runCatching {
        json.decodeFromString<RespiratoryDto>(body)
    }.getOrNull()?.let { dto ->
        if (dto.current_rr == null && dto.recent_avg_rr == null) return null
        RespiratoryRate(
            current = dto.current_rr,
            recentAverage = dto.recent_avg_rr,
            baselineAverage = dto.baseline_avg_rr,
            trend = dto.trend ?: "stable",
            date = dto.date
        )
    }

    fun sleepConsistency(body: String): SleepConsistency? = runCatching {
        json.decodeFromString<SleepConsistencyDto>(body)
    }.getOrNull()?.let { dto ->
        SleepConsistency(
            score = dto.consistency_score,
            averageBedtime = dto.avg_bedtime,
            spreadMinutes = dto.std_minutes,
            daysAnalysed = dto.days_analyzed,
            windowDays = dto.window_days
        )
    }

    /** The month's days, keyed by date, with the day's entries merged in. */
    fun calendar(body: String): Map<String, CalendarDay> = runCatching {
        json.decodeFromString<CalendarDto>(body)
    }.getOrDefault(CalendarDto()).let { dto ->
        val byDate = LinkedHashMap<String, CalendarDay>()

        dto.activities.filter { it.date.isNotBlank() }.forEach { activity ->
            val day = byDate.getOrPut(activity.date) { CalendarDay(activity.date) }
            byDate[activity.date] = day.copy(
                entries = day.entries + CalendarEntry(
                    id = activity.id,
                    name = activity.name.ifBlank { "Activity" },
                    sportType = activity.sport_type.ifBlank { "Ride" },
                    minutes = (activity.duration_seconds ?: 0) / 60,
                    distanceKm = (activity.distance_meters ?: 0.0) / 1000.0,
                    tss = activity.tss,
                    focus = activity.focus?.takeIf { it.isNotBlank() }
                )
            )
        }

        // A day can have recovery data and no activity; it still gets a cell.
        dto.daily_metrics.filter { it.date.isNotBlank() }.forEach { metric ->
            val day = byDate.getOrPut(metric.date) { CalendarDay(metric.date) }
            byDate[metric.date] = day.copy(
                recoveryScore = metric.recovery_score,
                hrvMs = metric.hrv_ms,
                restingHr = metric.resting_hr,
                sleepHours = metric.sleep_duration_minutes?.let { it / 60.0 },
                strain = metric.strain
            )
        }
        byDate
    }
}

/**
 * Health and the calendar.
 *
 * Health is deliberately four numbers rather than the website's ten charts: on a
 * phone, "am I recovered, am I sleeping, is my breathing normal" is the whole
 * question, and a chart you cannot read is not an answer.
 */
class HealthApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun get(path: String, token: String): String? =
        client.newCall(
            Request.Builder()
                .url("$baseUrl$path")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        ).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }

    suspend fun respiratoryRate(token: String): RespiratoryRate? = withContext(Dispatchers.IO) {
        get("/metrics/respiratory-rate", token)?.let(HealthJson::respiratory)
    }

    suspend fun sleepConsistency(token: String, days: Int = 7): SleepConsistency? =
        withContext(Dispatchers.IO) {
            get("/metrics/sleep-consistency?days=$days", token)
                ?.let(HealthJson::sleepConsistency)
        }

    suspend fun calendar(
        token: String,
        start: String,
        end: String
    ): Map<String, CalendarDay> = withContext(Dispatchers.IO) {
        get("/activities/calendar?start_date=$start&end_date=$end", token)
            ?.let(HealthJson::calendar)
            .orEmpty()
    }

    /** Readiness and sleep debt come from the dashboard's endpoints, so they are
     * passed in rather than fetched twice with a different cache key. */
    suspend fun snapshot(
        token: String,
        readiness: uk.oli.fittrack.domain.Readiness?,
        sleepDebt: uk.oli.fittrack.domain.SleepDebt?
    ): HealthSnapshot = coroutineScope {
        val rr = async { runCatching { respiratoryRate(token) }.getOrNull() }
        val sc = async { runCatching { sleepConsistency(token) }.getOrNull() }
        HealthSnapshot(
            readiness = readiness,
            sleepDebt = sleepDebt,
            respiratoryRate = rr.await(),
            sleepConsistency = sc.await()
        )
    }
}
