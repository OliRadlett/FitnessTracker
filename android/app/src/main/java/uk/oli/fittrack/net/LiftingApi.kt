package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LinkedActivity
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.SessionLabels
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

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
    val notes: String? = null,
    val rpe_session: Double? = null,
    val duration_seconds: Int? = null,
    val started_at: String? = null,
    val ended_at: String? = null,
    val session_split: String? = null,
    val session_lift: String? = null,
    val session_class: String? = null,
    val linked_activity: LinkedActivityDto? = null,
    val sets: List<SetDto> = emptyList()
)

@Serializable
private data class LinkedActivityDto(
    val id: String,
    val name: String = "",
    val source: String = "strava",
    val start_date: String? = null,
    val duration_seconds: Int? = null
)

@Serializable
private data class ActivityDto(
    val id: String,
    val name: String = "",
    val source: String = "strava",
    val start_date: String? = null,
    val duration_seconds: Int? = null
)

/** `PUT /sessions/{id}/link` body; a null id unlinks. */
@Serializable
internal data class LinkBody(val activity_id: String?)

@Serializable
private data class SetDto(
    val id: String? = null,
    val exercise_name: String,
    val weight_kg: Double = 0.0,
    val reps: Int = 0,
    val rpe: Double? = null,
    val is_warmup: Boolean = false,
    val is_amrap: Boolean = false,
    val notes: String? = null,
    val order_index: Int = 0
)

object LiftingJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(body: String): List<FinishedSession> =
        json.decodeFromString<List<SessionDto>>(body).mapNotNull { it.toFinished() }

    /** One set as the append endpoint returns it (a `LiftingSetRead`). */
    fun decodeSet(body: String, at: Long = System.currentTimeMillis()): LoggedSet? =
        runCatching { json.decodeFromString<SetDto>(body).toLoggedSet(at) }.getOrNull()

    /** `GET /sessions/{id}/linkable-activities` returns full `ActivityRead`s; a subset is enough. */
    fun decodeActivities(body: String): List<LinkedActivity> = runCatching {
        json.decodeFromString<List<ActivityDto>>(body).map {
            LinkedActivity(
                id = it.id,
                name = it.name.ifBlank { "Activity" },
                source = it.source,
                startAt = parseInstant(it.start_date) ?: 0L,
                durationSeconds = it.duration_seconds
            )
        }
    }.getOrDefault(emptyList())

    private fun SessionDto.toFinished(): FinishedSession? {
        val start = parseInstant(started_at) ?: parseDate(session_date) ?: return null
        val end = parseInstant(ended_at) ?: (start + (duration_seconds ?: 0) * 1000L)

        // Warm-ups are kept and flagged: the website shows them on the session,
        // and a client that silently dropped them would report a different
        // workout. Everything that *counts* filters on the flag instead.
        val ordered = sets.sortedBy { it.order_index }
        if (ordered.none { !it.is_warmup }) return null

        return FinishedSession(
            id = id,
            planTitle = focus?.trim()?.takeIf { it.isNotBlank() }
                ?: program_name?.trim()?.takeIf { it.isNotBlank() }
                ?: "Lifting",
            startedAt = start,
            endedAt = end,
            sets = ordered.map { set ->
                // The wire has no per-set timestamp; the session's own end is
                // the only honest value to hang a set on.
                set.toLoggedSet(at = end)
            },
            // It came from the server; pushing it back would be a loop.
            synced = true,
            note = notes?.takeIf { it.isNotBlank() },
            rpeSession = rpe_session,
            labels = SessionLabels(
                split = session_split?.takeIf { it.isNotBlank() },
                lift = session_lift?.takeIf { it.isNotBlank() },
                klass = session_class?.takeIf { it.isNotBlank() }
            ).takeIf { it.any },
            linkedActivity = linked_activity?.let {
                LinkedActivity(
                    id = it.id,
                    name = it.name.ifBlank { "Linked activity" },
                    source = it.source,
                    startAt = parseInstant(it.start_date) ?: 0L,
                    durationSeconds = it.duration_seconds
                )
            }
        )
    }

    private fun SetDto.toLoggedSet(at: Long) = LoggedSet(        // Trimmed at the boundary: the server has held "Legs " and
        // "Bench Press " (a trailing space survives the website's form), and an
        // untrimmed name silently splits a lift's history in two.
        exercise = exercise_name.trim(),
        weightKg = weight_kg,
        reps = reps,
        // Null stays null: the website shows an empty RPE, so inventing a 7 here
        // would make the two surfaces disagree.
        rpe = rpe,
        at = at,
        isWarmup = is_warmup,
        isAmrap = is_amrap,
        note = notes?.takeIf { it.isNotBlank() },
        serverId = id
    )

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

    /**
     * The cached AI analysis of a session, or null when none has been made.
     *
     * The POST variant generates one, which is a Gemini call: it can take tens
     * of seconds, so it uses a longer-timeout client rather than the 20 s one
     * the rest of the app uses.
     */
    suspend fun sessionAnalysis(token: String, sessionId: String): SessionAnalysis? =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId/ai-analysis")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not load the analysis (${response.code})")
                }
                AnalysisJson.decode(body)
            }
        }

    /** Ask the server to analyse the session; returns the fresh analysis. */
    suspend fun requestSessionAnalysis(token: String, sessionId: String): SessionAnalysis? =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId/ai-analysis")
                .header("Authorization", "Bearer $token")
                .post(ByteArray(0).toRequestBody(jsonMedia))
                .build()

            slowClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not analyse the session (${response.code})")
                }
                AnalysisJson.decode(body)
            }
        }

    /** Strava activities that could be the ride/class behind a session. */
    suspend fun linkableActivities(token: String, sessionId: String): List<LinkedActivity> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId/linkable-activities")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not load linkable activities (${response.code})")
                }
                LiftingJson.decodeActivities(body)
            }
        }

    /** Link the session to an activity, or unlink it with a null id. */
    suspend fun linkActivity(token: String, sessionId: String, activityId: String?) =
        withContext(Dispatchers.IO) {
            val payload = LiftingPatchJson.encodeToString(LinkBody(activityId))
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId/link")
                .header("Authorization", "Bearer $token")
                .put(payload.toRequestBody(jsonMedia))
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not update the link (${response.code})")
                }
            }
        }

    /** Save a ramp as a reusable template, so it is one tap next time. */
    suspend fun createWarmupTemplate(
        token: String,
        name: String,
        exercise: String?,
        steps: List<uk.oli.fittrack.domain.WarmupStep>
    ): uk.oli.fittrack.domain.WarmupTemplate? = withContext(Dispatchers.IO) {
        val payload = LiftingPatchJson.encodeToString(
            WarmupTemplateBody.serializer(),
            WarmupTemplateBody(
                name = name.trim(),
                exercise_name = exercise?.trim()?.takeIf { it.isNotBlank() },
                steps = steps.mapIndexed { index, step ->
                    WarmupStepBody(
                        step_number = index + 1,
                        weight_kg = step.weightKg,
                        reps = step.reps,
                        notes = step.note?.takeIf { it.isNotBlank() }
                    )
                }
            )
        )

        val request = Request.Builder()
            .url("$baseUrl/lifting/warmup-templates")
            .header("Authorization", "Bearer $token")
            .post(payload.toRequestBody(jsonMedia))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not save the template (${response.code})")
            }
            WarmupJson.decode("[$body]").firstOrNull()
        }
    }

    /** Remove a saved template. */
    suspend fun deleteWarmupTemplate(token: String, id: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/lifting/warmup-templates/$id")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not delete the template (${response.code})")
            }
        }
    }

    /** The saved warm-up templates (the website's Templates tab). */
    suspend fun warmupTemplates(token: String): List<uk.oli.fittrack.domain.WarmupTemplate> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/warmup-templates")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not load warm-up templates (${response.code})")
                }
                WarmupJson.decode(body)
            }
        }

    /**
     * Push one finished session. Returns the server's id.
     *
     * `live_key` carries the phone's own session id, so a retry after a lost
     * response resolves to the same row instead of creating a second copy.
     */
    suspend fun createSession(token: String, session: FinishedSession): String =
        withContext(Dispatchers.IO) {
            val payload = json.encodeToString(LiftingPush.body(session))
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions")
                .header("Authorization", "Bearer $token")
                .post(payload.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(
                        response.code,
                        "Could not save the session (${response.code})"
                    )
                }
                json.decodeFromString<CreatedSession>(body).id
            }
        }

    /**
     * Edit one set that already exists on the server.
     *
     * Every field is written, nulls included, because the edit form owns the
     * whole set: clearing the RPE has to send an explicit `null` or the server
     * keeps the old value (`exclude_unset` semantics).
     */
    suspend fun updateSet(token: String, setId: String, edit: SetEdit) =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sets/$setId")
                .header("Authorization", "Bearer $token")
                .patch(LiftingPatchJson.encodeToString(edit).toRequestBody(jsonMedia))
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not save the set (${response.code})")
                }
            }
        }

    suspend fun deleteSet(token: String, setId: String) =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sets/$setId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not delete the set (${response.code})")
                }
            }
        }

    suspend fun deleteSession(token: String, sessionId: String) =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId")
                .header("Authorization", "Bearer $token")
                .delete()
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not delete the session (${response.code})")
                }
            }
        }

    /** Edit the session's own fields. Only the scalars; sets have their own endpoints. */
    suspend fun updateSession(token: String, sessionId: String, patch: SessionPatch) =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId")
                .header("Authorization", "Bearer $token")
                .patch(LiftingPatchJson.encodeToString(patch).toRequestBody(jsonMedia))
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not save the session (${response.code})")
                }
            }
        }

    /** Append one set to a session that already exists. Returns the server's row. */
    suspend fun addSet(token: String, sessionId: String, body: NewSetBody): LoggedSet =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/sessions/$sessionId/sets")
                .header("Authorization", "Bearer $token")
                .post(LiftingPatchJson.encodeToString(body).toRequestBody(jsonMedia))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not add the set (${response.code})")
                }
                LiftingJson.decodeSet(responseBody)
                    ?: throw ApiException(response.code, "The server's set was unreadable.")
            }
        }

    private val json = Json { ignoreUnknownKeys = true }
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    /** For the one call that waits on a model rather than a query. */
    private val slowClient = OkHttpClient.Builder()
        .callTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()
}

/** A session's editable scalars, in the wire's names. */
@Serializable
data class SessionPatch(
    val session_date: String,
    val focus: String?,
    val notes: String?,
    val started_at: String,
    val ended_at: String,
    val duration_seconds: Int
)

/** A session's AI analysis, as `LlmAnalysisRead` returns it. */
data class SessionAnalysis(
    val text: String,
    val model: String,
    val createdAt: Long?
)

@Serializable
private data class AnalysisDto(
    val analysis_text: String = "",
    val model_used: String = "",
    val created_at: String? = null
)

object AnalysisJson {

    private val json = Json { ignoreUnknownKeys = true }

    /** The endpoint answers JSON `null` when no analysis exists yet. */
    fun decode(body: String): SessionAnalysis? {
        val trimmed = body.trim()
        if (trimmed.isEmpty() || trimmed == "null") return null
        return runCatching {
            json.decodeFromString<AnalysisDto>(trimmed)
        }.getOrNull()
            ?.let { dto ->
                val text = dto.analysis_text.trim()
                if (text.isEmpty()) return null
                SessionAnalysis(
                    text = text,
                    model = dto.model_used,
                    createdAt = dto.created_at?.let { raw ->
                        runCatching { java.time.OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
                            .getOrNull()
                    }
                )
            }
    }
}

/** A saved warm-up template, as `GET /lifting/warmup-templates` returns it. */
@Serializable
private data class WarmupTemplateDto(
    val id: String,
    val name: String = "",
    val exercise_name: String? = null,
    val steps: List<WarmupStepDto> = emptyList()
)

@Serializable
private data class WarmupStepDto(
    val step_number: Int = 0,
    val weight_kg: Double = 0.0,
    val reps: Int = 0,
    val notes: String? = null
)

/** `POST /lifting/warmup-templates` body (`WarmupTemplateCreate`). */
@Serializable
internal data class WarmupTemplateBody(
    val name: String,
    val exercise_name: String? = null,
    val steps: List<WarmupStepBody> = emptyList()
)

@Serializable
internal data class WarmupStepBody(
    val step_number: Int,
    val weight_kg: Double,
    val reps: Int,
    val notes: String? = null
)

object WarmupJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(body: String): List<uk.oli.fittrack.domain.WarmupTemplate> =
        runCatching {
            json.decodeFromString<List<WarmupTemplateDto>>(body).mapNotNull { dto ->
                val steps = dto.steps
                    .sortedBy { it.step_number }
                    .filter { it.reps > 0 && it.weight_kg >= 0.0 }
                    .map {
                        uk.oli.fittrack.domain.WarmupStep(
                            weightKg = it.weight_kg,
                            reps = it.reps,
                            note = it.notes?.takeIf { note -> note.isNotBlank() }
                        )
                    }
                // A template with no usable steps cannot be applied, so it is
                // not offered.
                if (steps.isEmpty()) return@mapNotNull null
                uk.oli.fittrack.domain.WarmupTemplate(
                    id = dto.id,
                    name = dto.name.trim().ifBlank { "Warm-up" },
                    exercise = dto.exercise_name?.trim()?.takeIf { it.isNotBlank() },
                    steps = steps
                )
            }
        }.getOrDefault(emptyList())
}
/** One set to append, in the wire's names. `order_index` is the server's to assign. */
@Serializable
data class NewSetBody(
    val exercise_name: String,
    val set_number: Int,
    val weight_kg: Double,
    val reps: Int,
    val rpe: Double?,
    val is_warmup: Boolean,
    val is_amrap: Boolean,
    val notes: String?,
    val client_id: String
)

/** Builds the session patch. Pure, so the date/time conventions are testable. */
object LiftingSessionPatch {

    /**
     * The date is the **device-local** calendar date, and the timestamps carry
     * the device's offset. Moving the session a day keeps its time of day and
     * its duration: `plusDays` on a zoned time survives a DST boundary.
     */
    fun of(session: FinishedSession, zone: ZoneId = ZoneId.systemDefault()): SessionPatch {
        val start = Instant.ofEpochMilli(session.startedAt).atZone(zone)
        val end = Instant.ofEpochMilli(session.endedAt).atZone(zone)
        return SessionPatch(
            session_date = start.toLocalDate().toString(),
            focus = session.planTitle.takeIf { it.isNotBlank() },
            notes = session.note,
            started_at = start.toOffsetDateTime().toString(),
            ended_at = end.toOffsetDateTime().toString(),
            duration_seconds = ((session.endedAt - session.startedAt) / 1000)
                .coerceAtLeast(0)
                .toInt()
        )
    }
}

/** The six fields a set edit owns, in the wire's names. */
@Serializable
data class SetEdit(
    val weight_kg: Double,
    val reps: Int,
    val rpe: Double?,
    val is_warmup: Boolean,
    val is_amrap: Boolean,
    val notes: String?
) {
    companion object {
        fun of(set: LoggedSet): SetEdit = SetEdit(
            weight_kg = set.weightKg,
            reps = set.reps,
            rpe = set.rpe,
            is_warmup = set.isWarmup,
            is_amrap = set.isAmrap,
            notes = set.note
        )
    }
}

/**
 * PATCH bodies must spell out their nulls: with the default `encodeDefaults =
 * false`, a null RPE would be omitted and the server would keep the old one.
 */
internal val LiftingPatchJson: Json = Json {
    encodeDefaults = true
    explicitNulls = true
    ignoreUnknownKeys = true
}

@Serializable
private data class CreatedSession(val id: String)

@Serializable
internal data class CreateSessionBody(
    val session_date: String,
    val focus: String? = null,
    val duration_seconds: Int,
    val live_key: String,
    val sets: List<CreateSetBody>
)

@Serializable
internal data class CreateSetBody(
    val exercise_name: String,
    val set_number: Int,
    val weight_kg: Double,
    val reps: Int,
    val rpe: Double?,
    val is_warmup: Boolean,
    val is_amrap: Boolean,
    val notes: String? = null,
    val order_index: Int,
    val client_id: String
)

/**
 * Builds the create payload. Pure and separately tested: `set_number` is
 * per-exercise (the backend's semantics) while `order_index` is global, and the
 * two are easy to swap by accident.
 */
internal object LiftingPush {

    fun body(session: FinishedSession, zone: ZoneId = ZoneId.systemDefault()): CreateSessionBody {
        val date = Instant.ofEpochMilli(session.startedAt).atZone(zone).toLocalDate().toString()
        val perExercise = mutableMapOf<String, Int>()

        val sets = session.sets.mapIndexed { index, set ->
            val number = (perExercise[set.exercise] ?: 0) + 1
            perExercise[set.exercise] = number
            CreateSetBody(
                exercise_name = set.exercise,
                set_number = number,
                weight_kg = set.weightKg,
                reps = set.reps,
                rpe = set.rpe,
                is_warmup = set.isWarmup,
                is_amrap = set.isAmrap,
                notes = set.note,
                order_index = index,
                // Stable across retries: derived from the session and position.
                client_id = "${session.id}:$index"
            )
        }

        return CreateSessionBody(
            session_date = date,
            focus = session.planTitle,
            duration_seconds = ((session.endedAt - session.startedAt) / 1000)
                .coerceAtLeast(0)
                .toInt(),
            live_key = session.id,
            sets = sets
        )
    }
}
