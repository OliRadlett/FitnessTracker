package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.Ride
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/** One activity as `GET /activities` returns it (`ActivityRead`); a subset is enough. */
@Serializable
private data class RideActivityDto(
    val id: String = "",
    val name: String = "",
    val source: String = "",
    val sport_type: String = "",
    val start_date: String? = null,
    val duration_seconds: Int? = null,
    val distance_meters: Double? = null,
    val elevation_gain_meters: Double? = null,
    val average_heartrate: Double? = null,
    val average_power: Double? = null,
    val tss: Double? = null
)

internal object RideJson {

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    /** Strava's ride types, plus the generic word other providers use. */
    private val RIDE_TYPES = listOf("ride", "cycling", "bike", "virtual")

    fun isRide(sportType: String): Boolean =
        RIDE_TYPES.any { sportType.contains(it, ignoreCase = true) }

    fun decode(body: String, zone: ZoneId = ZoneId.systemDefault()): List<Ride> = runCatching {
        json.decodeFromString<List<RideActivityDto>>(body)
            .mapNotNull { dto ->
                if (dto.id.isBlank() || !isRide(dto.sport_type)) return@mapNotNull null
                val startedAt = dto.start_date?.let { raw ->
                    runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
                } ?: return@mapNotNull null
                Ride(
                    id = dto.id,
                    name = dto.name.ifBlank { "Ride" },
                    source = dto.source.ifBlank { "strava" },
                    sportType = dto.sport_type,
                    startedAt = startedAt,
                    durationSeconds = dto.duration_seconds ?: 0,
                    distanceMeters = dto.distance_meters ?: 0.0,
                    elevationGainMeters = dto.elevation_gain_meters ?: 0.0,
                    averageHeartRate = dto.average_heartrate,
                    averagePower = dto.average_power,
                    tss = dto.tss
                )
            }
            .sortedByDescending { it.startedAt }
    }.getOrDefault(emptyList())
}

/**
 * The cycling side of the log: rides from `GET /activities`.
 *
 * The list endpoint answers a bare array (with `X-Total-Count`) and is not
 * filtered by sport, so the app asks for a page and keeps the rides: a ride is
 * recognised by its `sport_type`, not by asking the server twice.
 */
class RidesApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun rides(
        token: String,
        limit: Int = 40,
        after: LocalDate? = null
    ): List<Ride> = withContext(Dispatchers.IO) {
        val afterParam = after?.let { "&start_date_after=${it}T00:00:00Z" } ?: ""
        val request = Request.Builder()
            .url("$baseUrl/activities?limit=$limit&sort_by=start_date$afterParam")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not load rides (${response.code})")
            }
            RideJson.decode(body)
        }
    }
}
