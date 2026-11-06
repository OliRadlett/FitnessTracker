package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.BikeRoute
import uk.oli.fittrack.domain.Polyline
import java.util.concurrent.TimeUnit

@Serializable
private data class RouteSourceDto(val provider: String = "")

@Serializable
private data class RouteSummaryDto(
    val id: String = "",
    val name: String = "",
    val sport_type: String = "",
    val distance_meters: Double = 0.0,
    val elevation_gain_meters: Double? = null,
    val country: String? = null,
    val locality: String? = null,
    val is_loop: Boolean = false,
    val is_favorite: Boolean = false,
    val is_ridden: Boolean = false,
    val ride_count: Int = 0,
    val quality_score: Double? = null,
    val terrain_classification: TerrainDto? = null,
    val surface_profile: SurfaceDto? = null,
    val preview_polyline: String? = null,
    val sources: List<RouteSourceDto> = emptyList()
)

@Serializable
private data class TerrainDto(
    val terrain: String? = null,
    val terrain_type: String? = null
)

@Serializable
private data class SurfaceDto(val dominant: String? = null, val surface: String? = null)

internal object RoutesJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun routes(body: String): List<BikeRoute> = runCatching {
        json.decodeFromString<List<RouteSummaryDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        if (dto.id.isBlank()) return@mapNotNull null
        BikeRoute(
            id = dto.id,
            name = dto.name.ifBlank { "Route" },
            sportType = dto.sport_type.ifBlank { "Ride" },
            distanceMeters = dto.distance_meters,
            elevationMeters = dto.elevation_gain_meters ?: 0.0,
            isLoop = dto.is_loop,
            isRidden = dto.is_ridden,
            isFavourite = dto.is_favorite,
            rideCount = dto.ride_count,
            locality = dto.locality?.takeIf { it.isNotBlank() },
            country = dto.country?.takeIf { it.isNotBlank() },
            terrain = dto.terrain_classification?.terrain
                ?: dto.terrain_classification?.terrain_type,
            surface = dto.surface_profile?.dominant ?: dto.surface_profile?.surface,
            qualityScore = dto.quality_score,
            shape = Polyline.decode(dto.preview_polyline)
        )
    }
}

/**
 * Routes: the atlas, shape-first.
 *
 * The phone draws each route's `preview_polyline` itself instead of mounting a
 * map — a shape is what tells one route from another, and it needs no tiles,
 * no key and no signal.
 */
class RoutesApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun routes(token: String, limit: Int = 100): List<BikeRoute> =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/routes?limit=$limit&sort_by=distance")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext emptyList()
                val body = response.body?.string().orEmpty()
                RoutesJson.routes(body)
            }
        }
}
