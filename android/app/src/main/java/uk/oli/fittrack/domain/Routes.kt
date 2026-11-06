package uk.oli.fittrack.domain

import java.util.Locale

/** A route, as the list gives it: enough to draw a silhouette and choose one. */
data class BikeRoute(
    val id: String,
    val name: String,
    val sportType: String,
    val distanceMeters: Double,
    val elevationMeters: Double = 0.0,
    val isLoop: Boolean = false,
    val isRidden: Boolean = false,
    val isFavourite: Boolean = false,
    val rideCount: Int = 0,
    val locality: String? = null,
    val country: String? = null,
    val terrain: String? = null,
    val surface: String? = null,
    val qualityScore: Double? = null,
    /** Decoded from `preview_polyline`; empty when the server sent no shape. */
    val shape: List<LatLng> = emptyList()
) {
    val distanceKm: Double get() = distanceMeters / 1000.0

    val where: String
        get() = listOfNotNull(locality, country).distinct().joinToString(", ")

    /** "Hilly · 20.1 km · 180 m" — the line under a route's name. */
    fun describe(): String = listOfNotNull(
        terrain?.replaceFirstChar { it.uppercase() },
        formatKm(distanceKm),
        elevationMeters.takeIf { it > 1.0 }?.let { "${it.toInt()} m" }
    ).joinToString(" · ")
}

fun formatKm(km: Double): String = String.format(Locale.UK, "%.1f km", km)

/** Which routes the list is showing. */
enum class RouteFilter(val label: String) {
    All("All"),
    Loops("Loops"),
    Unridden("Unridden"),
    Favourites("Favourites")
}

fun filterRoutes(routes: List<BikeRoute>, filter: RouteFilter): List<BikeRoute> =
    when (filter) {
        RouteFilter.All -> routes
        RouteFilter.Loops -> routes.filter { it.isLoop }
        RouteFilter.Unridden -> routes.filter { !it.isRidden }
        RouteFilter.Favourites -> routes.filter { it.isFavourite }
    }

/** Routes ordered by a simple, predictable key: distance, biggest first. */
fun orderRoutes(routes: List<BikeRoute>): List<BikeRoute> =
    routes.sortedWith(compareByDescending<BikeRoute> { it.isFavourite }.thenByDescending { it.distanceMeters })

/** "22.4 km · 3 rides · last 4 Nov", or the unridden version of the same. */
fun routeHistory(route: BikeRoute): String = when {
    route.rideCount == 0 -> "Never ridden"
    route.rideCount == 1 -> "Ridden once"
    else -> "Ridden ${route.rideCount} times"
}
