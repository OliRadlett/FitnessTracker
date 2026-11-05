package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LoggedSet
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * The backend's lifting-session payload, mapped onto the app's own history type.
 *
 * The wire shape is captured from a live `GET /lifting/sessions` (see
 * `src/test/resources/lifting-sessions.json`) rather than guessed: the field
 * names are snake_case, `rpe` is a float or null, and warm-up sets are flagged
 * rather than separated.
 */
@Serializable
private data class SessionDto(
    val id: String,
    val session_date: String? = null,
    val focus: String? = null,
    val program_name: String? = null,
    val duration_seconds: Int? = null,
    val started_at: String? = null,
    val ended_at: String? = null,
    val sets: List<SetDto> = emptyList()
)

@Serializable
private data class SetDto(
    val exercise_name: String,
    val weight_kg: Double = 0.0,
    val reps: Int = 0,
    val rpe: Double? = null,
    val is_warmup: Boolean = false,
    val order_index: Int = 0
)

object LiftingJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(body: String): List<FinishedSession> =
        json.decodeFromString<List<SessionDto>>(body).mapNotNull { it.toFinished() }

    private fun SessionDto.toFinished(): FinishedSession? {
        val start = parseInstant(started_at) ?: parseDate(session_date) ?: return null
        val end = parseInstant(ended_at) ?: (start + (duration_seconds ?: 0) * 1000L)

        // A warm-up is not what you did for a work set and must never prefill the
        // next one, so it is dropped here rather than filtered at every read.
        val working = sets.filterNot { it.is_warmup }.sortedBy { it.order_index }
        if (working.isEmpty()) return null

        return FinishedSession(
            id = id,
            planTitle = focus?.takeIf { it.isNotBlank() }
                ?: program_name?.takeIf { it.isNotBlank() }
                ?: "Lifting",
            startedAt = start,
            endedAt = end,
            sets = working.map { set ->
                LoggedSet(
                    exercise = set.exercise_name,
                    weightKg = set.weight_kg,
                    reps = set.reps,
                    rpe = (set.rpe ?: 7.0).roundToInt(),
                    at = end
                )
            }
        )
    }

    /** The API writes offsets, but tolerate a naive timestamp rather than dropping the row. */
    private fun parseInstant(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        runCatching { OffsetDateTime.parse(raw) }
            .onSuccess { return it.toInstant().toEpochMilli() }
        return runCatching {
            LocalDateTime.parse(raw).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull()
    }

    /** `session_date` is a plain date; 18:00 is a defensible default for a gym session. */
    private fun parseDate(raw: String?): Long? {
        if (raw.isNullOrBlank()) return null
        return runCatching {
            LocalDate.parse(raw).atTime(18, 0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        }.getOrNull()
    }
}

class LiftingApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun sessions(token: String, limit: Int = 60): List<FinishedSession> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions?limit=$limit")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not load lifting history (${response.code})")
                }
                LiftingJson.decode(body)
            }
        }
}
