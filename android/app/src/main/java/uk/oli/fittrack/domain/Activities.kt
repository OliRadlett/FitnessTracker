package uk.oli.fittrack.domain

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** One row of the activities feed. */
data class ActivitySummary(
    val id: String,
    val name: String,
    val source: String,
    val sportType: String,
    val startedAt: Long,
    val durationSeconds: Int = 0,
    val distanceMeters: Double = 0.0,
    val elevationMeters: Double = 0.0,
    val averageHeartRate: Double? = null,
    val averagePower: Double? = null,
    val tss: Double? = null,
    /** Jev's semantic tag: training, endurance, commute, recovery, race, social. */
    val purpose: String? = null,
    /** Deterministic energy-system type from the ride's power, when it has any. */
    val rideType: String? = null,
    val routeName: String? = null,
    val linkedLift: LinkedLift? = null
) {
    data class LinkedLift(val id: String, val focus: String?, val volumeKg: Double?)

    val distanceKm: Double get() = distanceMeters / 1000.0

    val isLift: Boolean
        get() = sportType.equals("WeightTraining", true) ||
            sportType.equals("Workout", true) ||
            sportType.equals("strength", true) ||
            linkedLift != null

    val isRide: Boolean
        get() = sportType.contains("ride", true) || sportType.contains("cycling", true)

    fun localDate(zone: ZoneId = ZoneId.systemDefault()): LocalDate =
        Instant.ofEpochMilli(startedAt).atZone(zone).toLocalDate()

    /** "Sat 1 Nov · 55.6 km · 3h 12m · TSS 118" — the line under a name. */
    fun describe(): String = listOfNotNull(
        distanceKm.takeIf { it > 0.05 }?.let { formatKm(it) },
        durationSeconds.takeIf { it > 0 }?.let { formatRideDuration(it) },
        elevationMeters.takeIf { it > 1.0 }?.let { "${it.toInt()} m" },
        tss?.let { "TSS ${it.toInt()}" }
    ).joinToString(" · ")

    /** "Endurance · Threshold", the two label axes, when the server has them. */
    fun labels(): String = listOfNotNull(
        purpose?.replaceFirstChar { it.uppercase() },
        rideType?.replaceFirstChar { it.uppercase() }
    ).joinToString(" · ")

    /** What the sport is called on a phone. */
    val sportLabel: String
        get() = when {
            isLift -> linkedLift?.focus?.replaceFirstChar { it.uppercase() } ?: "Lift"
            sportType.contains("ebike", true) -> "E-bike"
            sportType.contains("virtual", true) -> "Virtual ride"
            isRide -> "Ride"
            sportType.equals("Run", true) || sportType.contains("run", true) -> "Run"
            sportType.equals("Walk", true) || sportType.equals("Hike", true) -> "Walk"
            sportType.equals("Swim", true) -> "Swim"
            else -> sportType.ifBlank { "Activity" }
        }

    /** Speed in km/h, when it means anything. */
    val averageSpeedKph: Double?
        get() = if (durationSeconds <= 0 || distanceKm <= 0.0) null
        else distanceKm / (durationSeconds / 3600.0)
}

/** One activity, with its shape and whatever else the detail endpoint adds. */
data class ActivityDetail(
    val summary: ActivitySummary,
    val shape: List<LatLng> = emptyList(),
    val hasStreams: Boolean = false,
    val notes: String? = null
) {
    val canDraw: Boolean get() = shape.size >= 3
}

/** What the feed is filtered to. */
enum class ActivityWindow(val label: String, val days: Long?) {
    Month("30d", 30),
    Quarter("90d", 90),
    Year("1y", 365),
    All("All", null)
}

fun filterActivities(
    activities: List<ActivitySummary>,
    sport: String?,
    window: ActivityWindow,
    today: LocalDate = LocalDate.now(),
    zone: ZoneId = ZoneId.systemDefault()
): List<ActivitySummary> = activities.filter { activity ->
    val date = activity.localDate(zone)
    val inWindow = window.days?.let { !date.isBefore(today.minusDays(it)) } ?: true
    val sportOk = when (sport) {
        null -> true
        "lift" -> activity.isLift
        "ride" -> activity.isRide
        "other" -> !activity.isLift && !activity.isRide
        else -> activity.sportType.equals(sport, true)
    }
    inWindow && sportOk
}

/** "3 hours ago", "Yesterday", "Sat 1 Nov" — as a feed reads. */
fun feedDate(at: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String {
    val date = Instant.ofEpochMilli(at).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    return when {
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.isAfter(today.minusDays(7)) ->
            date.format(java.time.format.DateTimeFormatter.ofPattern("EEE", Locale.UK))
        else -> date.format(java.time.format.DateTimeFormatter.ofPattern("d MMM", Locale.UK))
    }
}
