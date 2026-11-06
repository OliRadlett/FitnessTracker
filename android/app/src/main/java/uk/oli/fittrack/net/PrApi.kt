package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import uk.oli.fittrack.domain.PersonalRecord
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/** A record as the API holds it (`PersonalRecordRead`). */
@Serializable
private data class PrDto(
    val id: String,
    val exercise_name: String = "",
    val record_type: String = "1rm",
    val weight_kg: Double = 0.0,
    val reps: Int = 0,
    val estimated_1rm: Double? = null,
    val achieved_date: String? = null,
    val session_id: String? = null,
    val notes: String? = null
)

/** `POST /lifting/prs` body (`PersonalRecordCreate`). */
@Serializable
internal data class NewPrBody(
    val exercise_name: String,
    val record_type: String = "1rm",
    val weight_kg: Double,
    val reps: Int,
    val achieved_date: String,
    val notes: String? = null
)

internal object PrJson {

    private val json = LiftingPatchJson

    fun decode(body: String): List<PersonalRecord> = runCatching {
        json.decodeFromString<List<PrDto>>(body).mapNotNull { dto ->
            val exercise = dto.exercise_name.trim()
            // A record with no lift is not a record.
            if (dto.id.isBlank() || exercise.isEmpty() || dto.weight_kg <= 0.0 || dto.reps <= 0) {
                return@mapNotNull null
            }
            PersonalRecord(
                id = dto.id,
                exercise = exercise,
                weightKg = dto.weight_kg,
                reps = dto.reps,
                // The server's own e1RM wins when it has one; otherwise it is
                // derived from the lift, as everywhere else in the app.
                e1rm = dto.estimated_1rm
                    ?: uk.oli.fittrack.domain.ProgressEngine.estimated1rm(dto.weight_kg, dto.reps),
                achievedDate = dto.achieved_date,
                // A PR with no session behind it was typed in by hand.
                manual = dto.session_id == null,
                note = dto.notes?.takeIf { it.isNotBlank() },
                recordType = dto.record_type
            )
        }
    }.getOrDefault(emptyList())
}

/**
 * The server's personal records — including the manual ones, which have no
 * session behind them and so cannot be derived from the phone's own history.
 */
class PrApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun prs(token: String, limit: Int = 50): List<PersonalRecord> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/lifting/prs?limit=$limit")
                .header("Authorization", "Bearer $token")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw ApiException(response.code, "Could not load records (${response.code})")
                }
                PrJson.decode(body)
            }
        }

    /** Type in a record for a session the app never saw. Returns null on a bad answer. */
    suspend fun addPr(
        token: String,
        exercise: String,
        weightKg: Double,
        reps: Int,
        achievedDate: LocalDate,
        note: String?
    ): PersonalRecord? = withContext(Dispatchers.IO) {
        val payload = LiftingPatchJson.encodeToString(
            NewPrBody.serializer(),
            NewPrBody(
                exercise_name = exercise.trim(),
                weight_kg = weightKg,
                reps = reps,
                achieved_date = achievedDate.toString(),
                notes = note?.trim()?.takeIf { it.isNotEmpty() }
            )
        )
        val request = Request.Builder()
            .url("$baseUrl/lifting/prs")
            .header("Authorization", "Bearer $token")
            .post(payload.toRequestBody(jsonMedia))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not save the record (${response.code})")
            }
            PrJson.decode("[$body]").firstOrNull()
        }
    }
}
