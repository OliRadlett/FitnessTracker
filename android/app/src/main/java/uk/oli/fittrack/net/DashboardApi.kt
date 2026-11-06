package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.GoalProgress
import uk.oli.fittrack.domain.LoadPoint
import uk.oli.fittrack.domain.Readiness
import uk.oli.fittrack.domain.SleepDebt
import uk.oli.fittrack.domain.TrainingLoad
import java.util.concurrent.TimeUnit

@Serializable
private data class LoadPointDto(
    val date: String = "",
    val tss: Double = 0.0,
    val ctl: Double = 0.0,
    val atl: Double = 0.0,
    val tsb: Double = 0.0
)

@Serializable
private data class TrainingLoadDto(
    val data: List<LoadPointDto> = emptyList(),
    val current_ctl: Double = 0.0,
    val current_atl: Double = 0.0,
    val current_tsb: Double = 0.0
)

@Serializable
private data class ReadinessDto(
    val recovery_score: Double? = null,
    val readiness: String = "unknown",
    val hrv_ms: Double? = null,
    val resting_hr: Double? = null,
    val message: String? = null,
    val date: String? = null
)

@Serializable
private data class SleepDebtDto(
    val debt_hours: Double = 0.0,
    val avg_sleep_hours: Double = 0.0,
    val days_below_target: Int = 0,
    val target_hours: Double = 8.0,
    val window_days: Int = 7
)

@Serializable
private data class GoalDto(
    val id: String = "",
    val metric: String = "",
    val target_value: Double = 0.0,
    val current_value: Double? = null,
    val starting_value: Double? = null,
    val target_date: String? = null,
    val status: String = "active",
    val progress_pct: Double? = null,
    val notes: String? = null
)

internal object DashboardJson {

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    fun load(body: String): TrainingLoad? = runCatching {
        json.decodeFromString<TrainingLoadDto>(body)
    }.getOrNull()?.let { dto ->
        val points = dto.data.mapNotNull { point ->
            if (point.date.isBlank()) return@mapNotNull null
            LoadPoint(
                date = point.date,
                tss = point.tss,
                ctl = point.ctl,
                atl = point.atl,
                tsb = point.tsb
            )
        }
        TrainingLoad(
            ctl = dto.current_ctl,
            atl = dto.current_atl,
            tsb = dto.current_tsb,
            points = points
        )
    }

    fun readiness(body: String): Readiness? = runCatching {
        json.decodeFromString<ReadinessDto>(body)
    }.getOrNull()?.let { dto ->
        Readiness(
            score = dto.recovery_score,
            level = dto.readiness.ifBlank { "unknown" },
            hrvMs = dto.hrv_ms,
            restingHr = dto.resting_hr,
            message = dto.message?.takeIf { it.isNotBlank() },
            date = dto.date
        )
    }

    fun sleepDebt(body: String): SleepDebt? = runCatching {
        json.decodeFromString<SleepDebtDto>(body)
    }.getOrNull()?.let {
        SleepDebt(
            debtHours = it.debt_hours,
            averageHours = it.avg_sleep_hours,
            daysBelowTarget = it.days_below_target,
            targetHours = it.target_hours,
            windowDays = it.window_days
        )
    }

    fun goals(body: String): List<GoalProgress> = runCatching {
        json.decodeFromString<List<GoalDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        val metric = dto.metric.trim()
        // A goal with no metric cannot be shown, let alone progressed.
        if (dto.id.isBlank() || metric.isEmpty()) return@mapNotNull null
        GoalProgress(
            id = dto.id,
            metric = metric,
            target = dto.target_value,
            current = dto.current_value,
            starting = dto.starting_value,
            targetDate = dto.target_date,
            status = dto.status.ifBlank { "active" },
            serverProgressPct = dto.progress_pct,
            note = dto.notes?.takeIf { it.isNotBlank() }
        )
    }
}

/**
 * The web dashboard, as data: training load, readiness, sleep debt and goals.
 *
 * The app's rule is the same as the website's — one fetch per section, each
 * fail-open — so a missing Whoop connection costs the readiness card and
 * nothing else. Four independent calls are issued concurrently; a slow endpoint
 * cannot hold the other three hostage.
 */
class DashboardApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun request(path: String, token: String) = Request.Builder()
        .url("$baseUrl$path")
        .header("Authorization", "Bearer $token")
        .get()
        .build()

    private fun get(path: String, token: String): String? =
        client.newCall(request(path, token)).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }

    suspend fun load(token: String, days: Int = 42): TrainingLoad? = withContext(Dispatchers.IO) {
        get("/cycling/training-load?days=$days", token)?.let(DashboardJson::load)
    }

    suspend fun readiness(token: String): Readiness? = withContext(Dispatchers.IO) {
        get("/metrics/readiness", token)?.let(DashboardJson::readiness)
    }

    suspend fun sleepDebt(token: String, days: Int = 7): SleepDebt? = withContext(Dispatchers.IO) {
        get("/metrics/sleep-debt?days=$days", token)?.let(DashboardJson::sleepDebt)
    }

    suspend fun goals(token: String): List<GoalProgress> = withContext(Dispatchers.IO) {
        get("/goals", token)?.let(DashboardJson::goals).orEmpty()
    }

    /**
     * Everything the dashboard needs, fetched together. Each section is allowed
     * to come back empty: the screen shows the sections it has.
     */
    suspend fun snapshot(token: String, days: Int = 42): DashboardSnapshot =
        coroutineScope {
            val load = async { runCatching { load(token, days) }.getOrNull() }
            val readiness = async { runCatching { readiness(token) }.getOrNull() }
            val sleep = async { runCatching { sleepDebt(token) }.getOrNull() }
            val goals = async { runCatching { goals(token) }.getOrNull().orEmpty() }
            DashboardSnapshot(
                load = load.await(),
                readiness = readiness.await(),
                sleepDebt = sleep.await(),
                goals = goals.await()
            )
        }
}

/** One dashboard's worth of server data; any field may be null. */
data class DashboardSnapshot(
    val load: TrainingLoad? = null,
    val readiness: Readiness? = null,
    val sleepDebt: SleepDebt? = null,
    val goals: List<GoalProgress> = emptyList()
)
