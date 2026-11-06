package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import uk.oli.fittrack.domain.BodyTrend
import uk.oli.fittrack.domain.WeightEntry
import java.time.LocalDate
import java.util.concurrent.TimeUnit

@Serializable
private data class WeightEntryDto(
    val id: String,
    val date: String,
    val weight_kg: Double = 0.0,
    val source: String = "manual",
    val body_fat_percent: Double? = null
)

@Serializable
private data class RollingDto(val date: String = "", val weight_kg: Double = 0.0)

@Serializable
private data class WeightHistoryDto(
    val entries: List<WeightEntryDto> = emptyList(),
    val rolling_avg: List<RollingDto> = emptyList()
)

/** `POST /metrics/weight` body (`WeightEntryCreate`). */
@Serializable
internal data class NewWeightBody(val date: String, val weight_kg: Double)

internal object BodyJson {

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    fun decode(body: String): BodyTrend? = runCatching {
        json.decodeFromString<WeightHistoryDto>(body)
    }.getOrNull()?.let { dto ->
        val entries = dto.entries.mapNotNull { entry ->
            // A weigh-in with no number is not a weigh-in.
            if (entry.id.isBlank() || entry.date.isBlank() || entry.weight_kg <= 0.0) {
                return@mapNotNull null
            }
            WeightEntry(
                id = entry.id,
                date = entry.date,
                weightKg = entry.weight_kg,
                source = entry.source,
                bodyFatPercent = entry.body_fat_percent
            )
        }.sortedBy { it.date }

        val rolling = dto.rolling_avg
            .filter { it.date.isNotBlank() && it.weight_kg > 0.0 }
            .map { it.date to it.weight_kg }

        // No entries and no average is an empty history, not a broken one.
        BodyTrend(entries = entries, rolling = rolling)
    }

    /** The POST answer is a single entry (or `{"entry": …}`); accept either. */
    fun decodeEntry(body: String): WeightEntry? {
        val trimmed = body.trim()
        if (trimmed.isEmpty() || trimmed == "null") return null
        val direct = runCatching {
            kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
                .decodeFromString<WeightEntryDto>(trimmed)
        }.getOrNull()
        if (direct != null && direct.id.isNotBlank() && direct.weight_kg > 0.0) {
            return WeightEntry(
                id = direct.id,
                date = direct.date,
                weightKg = direct.weight_kg,
                source = direct.source,
                bodyFatPercent = direct.body_fat_percent
            )
        }
        // Fall back to a wrapped `{"entry": {...}}` shape rather than guessing.
        return decode("""{"entries":[$trimmed]}""")?.entries?.firstOrNull()
    }
}

/** Bodyweight history and weigh-ins, from `/metrics/weight`. */
class BodyApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun weight(token: String, days: Int = 90): BodyTrend = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/metrics/weight?days=$days")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not load your weight (${response.code})")
            }
            BodyJson.decode(body) ?: BodyTrend(emptyList())
        }
    }

    /** Record a weight. The API upserts on (user, date, source), so a second
     *  weigh-in on the same day replaces the first rather than duplicating it. */
    suspend fun addWeight(
        token: String,
        weightKg: Double,
        date: LocalDate = LocalDate.now()
    ): WeightEntry? = withContext(Dispatchers.IO) {
        val payload = LiftingPatchJson.encodeToString(
            NewWeightBody.serializer(),
            NewWeightBody(date = date.toString(), weight_kg = weightKg)
        )
        val request = Request.Builder()
            .url("$baseUrl/metrics/weight")
            .header("Authorization", "Bearer $token")
            .post(payload.toRequestBody(jsonMedia))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not save the weight (${response.code})")
            }
            BodyJson.decodeEntry(body)
        }
    }

    /** Delete a manual weigh-in. Entries from a scale are not ours to delete. */
    suspend fun deleteWeight(token: String, id: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/metrics/weight/$id")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not delete the weight (${response.code})")
            }
        }
    }
}
