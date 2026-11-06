package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import uk.oli.fittrack.domain.Goal
import uk.oli.fittrack.domain.GoalCheckIn
import uk.oli.fittrack.domain.GoalMetric
import java.util.concurrent.TimeUnit

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
    val alignment_pct: Double? = null,
    val direction: String? = null,
    val notes: String? = null
)

@Serializable
private data class MetricDto(
    val key: String = "",
    val label: String = "",
    val unit: String = "",
    val requires_filter: List<String>? = null,
    val default_direction: String = "increase"
)

@Serializable
private data class CheckInDto(
    val id: String = "",
    val check_in_date: String = "",
    val value: Double = 0.0,
    val note: String? = null,
    val source: String = "manual"
)

@Serializable
private data class CreateGoalDto(
    val metric: String,
    val target_value: Double,
    val target_date: String? = null,
    val notes: String? = null
)

@Serializable
private data class CreateCheckInDto(val value: Double, val note: String? = null)

@Serializable
private data class StatusDto(val status: String)

internal object GoalsJson {

    // `explicitNulls = false`: an absent note is an absent key, not a null the
    // server has to decide about.
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }

    fun goals(body: String): List<Goal> = runCatching {
        json.decodeFromString<List<GoalDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        val metric = dto.metric.trim()
        // A goal with no metric cannot be shown, let alone progressed.
        if (dto.id.isBlank() || metric.isEmpty()) return@mapNotNull null
        Goal(
            id = dto.id,
            metric = metric,
            target = dto.target_value,
            current = dto.current_value,
            starting = dto.starting_value,
            targetDate = dto.target_date,
            status = dto.status.ifBlank { "active" },
            serverProgressPct = dto.progress_pct,
            note = dto.notes?.takeIf { it.isNotBlank() },
            direction = dto.direction
        )
    }

    fun metrics(body: String): List<GoalMetric> = runCatching {
        json.decodeFromString<List<MetricDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        if (dto.key.isBlank()) return@mapNotNull null
        GoalMetric(
            key = dto.key,
            label = dto.label.ifBlank { dto.key },
            unit = dto.unit,
            defaultDirection = dto.default_direction,
            requiresFilter = dto.requires_filter.orEmpty()
        )
    }

    fun checkIns(body: String): List<GoalCheckIn> = runCatching {
        json.decodeFromString<List<CheckInDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        if (dto.id.isBlank() || dto.check_in_date.isBlank()) return@mapNotNull null
        GoalCheckIn(
            id = dto.id,
            date = dto.check_in_date,
            value = dto.value,
            note = dto.note?.takeIf { it.isNotBlank() },
            source = dto.source.ifBlank { "manual" }
        )
    }

    fun createBody(metric: String, target: Double, targetDate: String?, note: String?): String =
        json.encodeToString(
            CreateGoalDto.serializer(),
            CreateGoalDto(
                metric = metric,
                target_value = target,
                target_date = targetDate,
                notes = note?.takeIf { it.isNotBlank() }
            )
        )

    fun checkInBody(value: Double, note: String?): String =
        json.encodeToString(
            CreateCheckInDto.serializer(),
            CreateCheckInDto(value = value, note = note?.takeIf { it.isNotBlank() })
        )

    fun statusBody(status: String): String =
        json.encodeToString(StatusDto.serializer(), StatusDto(status = status))
}

/**
 * Goals: read, create, check in, archive.
 *
 * The write paths are the point of this page — the dashboard already shows three
 * goals, and a phone that cannot check one in is a phone that makes you open a
 * laptop to say "87.9 today".
 */
class GoalsApi(private val baseUrl: String) {

    // `/goals` evaluates every goal's current value, which can take a while on
    // an account with history — 20 s timed out on device while the POST was
    // fine, which read as "the goal you just created does not exist".
    private val client = OkHttpClient.Builder()
        .callTimeout(60, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun execute(request: Request): String? =
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }

    private fun builder(path: String, token: String) = Request.Builder()
        .url("$baseUrl$path")
        .header("Authorization", "Bearer $token")

    /** Null when the request failed; an empty list means the account has none. */
    suspend fun goalsOrNull(token: String): List<Goal>? = withContext(Dispatchers.IO) {
        (load(token) as? GoalsLoad.Ok)?.goals
    }

    /**
     * The goals, or why they could not be fetched.
     *
     * The code matters: on device `GET /goals` failed while `POST /goals`
     * succeeded, and "no goals" and "the server said 500" have to look
     * different — one is a fact about the account, the other is a bug.
     */
    suspend fun load(token: String): GoalsLoad = withContext(Dispatchers.IO) {
        client.newCall(builder("/goals", token).get().build()).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                return@withContext GoalsLoad.Failed(response.code, body.take(200))
            }
            GoalsLoad.Ok(GoalsJson.goals(body))
        }
    }

    suspend fun goals(token: String): List<Goal> = goalsOrNull(token).orEmpty()

    suspend fun metrics(token: String): List<GoalMetric> = withContext(Dispatchers.IO) {
        execute(builder("/goals/metrics", token).get().build())?.let(GoalsJson::metrics).orEmpty()
    }

    suspend fun checkIns(token: String, goalId: String): List<GoalCheckIn> =
        withContext(Dispatchers.IO) {
            execute(builder("/goals/$goalId/checkins", token).get().build())
                ?.let(GoalsJson::checkIns).orEmpty()
        }

    /** Returns the created goal, or null when the server refused. */
    suspend fun create(
        token: String,
        metric: String,
        target: Double,
        targetDate: String? = null,
        note: String? = null
    ): Goal? = withContext(Dispatchers.IO) {
        val body = GoalsJson.createBody(metric, target, targetDate, note)
            .toRequestBody(jsonType)
        val raw = execute(builder("/goals", token).post(body).build()) ?: return@withContext null
        GoalsJson.goals("[$raw]").firstOrNull()
    }

    suspend fun addCheckIn(
        token: String,
        goalId: String,
        value: Double,
        note: String? = null
    ): Boolean = withContext(Dispatchers.IO) {
        val body = GoalsJson.checkInBody(value, note).toRequestBody(jsonType)
        execute(builder("/goals/$goalId/checkins", token).post(body).build()) != null
    }

    suspend fun setStatus(token: String, goalId: String, status: String): Boolean =
        withContext(Dispatchers.IO) {
            val body = GoalsJson.statusBody(status).toRequestBody(jsonType)
            execute(builder("/goals/$goalId", token).patch(body).build()) != null
        }

    suspend fun delete(token: String, goalId: String): Boolean = withContext(Dispatchers.IO) {
        client.newCall(builder("/goals/$goalId", token).delete().build()).execute().use {
            it.isSuccessful
        }
    }

    /** Goals plus the metric registry, fetched together. */
    suspend fun snapshot(token: String): GoalsSnapshot = coroutineScope {
        val goals = async { runCatching { load(token) }.getOrNull() }
        val metrics = async { runCatching { metrics(token) }.getOrNull().orEmpty() }
        when (val result = goals.await()) {
            is GoalsLoad.Ok -> GoalsSnapshot(goals = result.goals, metrics = metrics.await())
            is GoalsLoad.Failed -> GoalsSnapshot(
                metrics = metrics.await(),
                goalsFailed = true,
                failureCode = result.code
            )
            // The call itself threw: no status to report, but still not "empty".
            null -> GoalsSnapshot(metrics = metrics.await(), goalsFailed = true)
        }
    }
}

/** What `GET /goals` said. */
sealed interface GoalsLoad {
    data class Ok(val goals: List<Goal>) : GoalsLoad
    data class Failed(val code: Int, val body: String = "") : GoalsLoad
}

/** The goals page's data; either half may be empty. */
data class GoalsSnapshot(
    val goals: List<Goal> = emptyList(),
    val metrics: List<GoalMetric> = emptyList(),
    /**
     * True when the goals request failed rather than returned nothing: an empty
     * list and an unreachable server must not look the same on screen.
     */
    val goalsFailed: Boolean = false,
    val failureCode: Int? = null
)
