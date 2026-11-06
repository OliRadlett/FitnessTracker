package uk.oli.fittrack.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** A ride, as the activity list gives it. */
data class Ride(
    val id: String,
    val name: String,
    val source: String,
    val sportType: String,
    val startedAt: Long,
    val durationSeconds: Int,
    val distanceMeters: Double,
    val elevationGainMeters: Double,
    val averageHeartRate: Double? = null,
    val averagePower: Double? = null,
    val tss: Double? = null
) {
    val distanceKm: Double get() = distanceMeters / 1000.0

    /** Kilometres per hour; 0 for a ride with no distance or time. */
    val averageSpeedKph: Double
        get() = if (durationSeconds <= 0) 0.0 else distanceKm / (durationSeconds / 3600.0)

    fun localDate(zone: ZoneId = ZoneId.systemDefault()): LocalDate =
        Instant.ofEpochMilli(startedAt).atZone(zone).toLocalDate()
}

/**
 * A window of rides, summarised. The phone computes this from the page it
 * already has rather than asking for a second endpoint: the numbers then always
 * match the list underneath them.
 */
data class RideWindow(
    val rides: List<Ride>,
    val since: LocalDate,
    val until: LocalDate
) {
    val count: Int get() = rides.size
    val distanceKm: Double get() = rides.sumOf { it.distanceKm }
    val durationSeconds: Int get() = rides.sumOf { it.durationSeconds }
    val elevationMeters: Double get() = rides.sumOf { it.elevationGainMeters }
    /** Sum of the rides that carry a TSS; a ride without one contributes nothing. */
    val tss: Double get() = rides.sumOf { it.tss ?: 0.0 }
    val hasTss: Boolean get() = rides.any { it.tss != null }

    /** The longest ride in the window, for a "big day" line. */
    val longest: Ride? get() = rides.maxByOrNull { it.distanceMeters }
}

/** Rides inside the last [days] days, newest first. */
fun ridesInWindow(
    rides: List<Ride>,
    today: LocalDate,
    days: Long = 7,
    zone: ZoneId = ZoneId.systemDefault()
): RideWindow {
    val since = today.minusDays(days)
    val inside = rides.filter { ride ->
        val date = ride.localDate(zone)
        !date.isBefore(since) && !date.isAfter(today)
    }
    return RideWindow(rides = inside, since = since, until = today)
}

/** "1h 12m", "48m", "0m" — a ride's length without seconds. */
fun formatRideDuration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
}

/** "42.3 km", "8.0 km" — one decimal, because a ride is not measured to the metre. */
fun formatDistanceKm(km: Double): String =
    String.format(java.util.Locale.UK, "%.1f km", km)

/** Total time in a window, as hours and minutes. */
fun formatWindowDuration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
}
