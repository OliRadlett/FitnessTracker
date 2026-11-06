package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.ActivityDetail
import uk.oli.fittrack.domain.ActivitySummary
import uk.oli.fittrack.domain.LatLng
import uk.oli.fittrack.domain.Polyline
import java.time.LocalDate
import java.time.OffsetDateTime
import java.util.concurrent.TimeUnit

@Serializable
private data class FeedActivityDto(
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
    val tss: Double? = null,
    val purpose: String? = null,
    val ride_type: String? = null,
    val route_name: String? = null,
    val encoded_polyline: String? = null,
    val has_streams: Boolean = false,
    val linked_lifting_session: LinkedLiftDto? = null,
    val notes: String? = null
)

@Serializable
private data class LinkedLiftDto(
    val id: String = "",
    val focus: String? = null,
    val total_volume_kg: Double? = null
)

internal object ActivitiesJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun list(body: String): List<ActivitySummary> = runCatching {
        json.decodeFromString<List<FeedActivityDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { it.toSummary() }

    fun detail(body: String): ActivityDetail? {
        val dto = runCatching { json.decodeFromString<FeedActivityDto>(body) }.getOrNull()
            ?: return null
        val summary = dto.toSummary() ?: return null
        return ActivityDetail(
            summary = summary,
            shape = Polyline.decode(dto.encoded_polyline),
            hasStreams = dto.has_streams,
            notes = dto.notes?.takeIf { it.isNotBlank() }
        )
    }

    private fun FeedActivityDto.toSummary(): ActivitySummary? {
        if (id.isBlank()) return null
        val startedAt = start_date?.let { raw ->
            runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
        } ?: return null
        return ActivitySummary(
            id = id,
            name = name.ifBlank { "Activity" },
            source = source.ifBlank { "strava" },
            sportType = sport_type.ifBlank { "Workout" },
            startedAt = startedAt,
            durationSeconds = duration_seconds ?: 0,
            distanceMeters = distance_meters ?: 0.0,
            elevationMeters = elevation_gain_meters ?: 0.0,
            averageHeartRate = average_heartrate,
            averagePower = average_power,
            tss = tss,
            purpose = purpose?.takeIf { it.isNotBlank() },
            rideType = ride_type?.takeIf { it.isNotBlank() },
            routeName = route_name?.takeIf { it.isNotBlank() },
            linkedLift = linked_lifting_session?.let { lift ->
                ActivitySummary.LinkedLift(
                    id = lift.id,
                    focus = lift.focus?.takeIf { it.isNotBlank() },
                    volumeKg = lift.total_volume_kg
                )
            }
        )
    }

    /** The query for the list: sport, search, window, sort. */
    fun query(
        sport: String?,
        search: String?,
        after: LocalDate?,
        limit: Int
    ): String = buildString {
        append("/activities?limit=$limit")
        if (!sport.isNullOrBlank()) append("&sport_type=$sport")
        if (!search.isNullOrBlank()) append("&q=${java.net.URLEncoder.encode(search, "UTF-8")}")
        if (after != null) append("&start_date_after=${after}T00:00:00Z")
    }
}

/**
 * The activities feed: everything Strava/Komoot/Wahoo ever sent, and one
 * activity in detail.
 *
 * The website's `/activities` is 1310 lines of list, filters, comparison and a
 * replay theatre. The phone gets the part a phone is for: find a ride, see what
 * it was, look at its shape.
 */
class ActivitiesApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(25, TimeUnit.SECONDS)
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

    suspend fun list(
        token: String,
        sport: String? = null,
        search: String? = null,
        after: LocalDate? = null,
        limit: Int = 50
    ): List<ActivitySummary> = withContext(Dispatchers.IO) {
        val path = ActivitiesJson.query(sport, search, after, limit)
        get(path, token)?.let(ActivitiesJson::list).orEmpty()
    }

    suspend fun detail(token: String, id: String): ActivityDetail? =
        withContext(Dispatchers.IO) {
            get("/activities/$id", token)?.let(ActivitiesJson::detail)
        }
}

/** A decoded shape is only worth drawing above three points. */
fun List<LatLng>.drawable(): Boolean = size >= 3
