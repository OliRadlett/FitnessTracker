package uk.oli.fittrack.domain

/** The last seven days on the bike, with the server's trend arrows. */
data class CyclingSummary(
    val tss: Double = 0.0,
    val rides: Int = 0,
    val distanceKm: Double = 0.0,
    val timeHours: Double = 0.0,
    val elevationM: Double = 0.0,
    val ftpWatts: Double? = null,
    val wattsPerKg: Double? = null,
    val tssDirection: String = "stable",
    val ridesDirection: String = "stable",
    val distanceDirection: String = "stable",
    val timeDirection: String = "stable",
    val elevationDirection: String = "stable"
) {
    val isEmpty: Boolean get() = rides == 0 && tss <= 0.0 && distanceKm <= 0.0
}

/** One point of the power curve: the best power held for a duration. */
data class PowerCurvePoint(val label: String, val seconds: Int, val watts: Double)

/** The critical-power model: sustainable power, the work above it, the sprint. */
data class PowerModel(
    val cp: Double? = null,
    val wPrime: Double? = null,
    val pMax: Double? = null,
    val rSquared: Double? = null,
    val ftpWatts: Double? = null
) {
    val hasFit: Boolean get() = cp != null || pMax != null
}

/** Time spent in one Coggan zone. */
data class ZoneShare(val zone: String, val name: String, val seconds: Int, val percentage: Double)

/** One FTP entry: what was set, when, and where it came from. */
data class FtpPoint(val watts: Double, val date: String, val source: String)

/** A VO2max estimate with its method and confidence. */
data class Vo2maxEstimate(
    val value: Double,
    val classification: String,
    val method: String,
    val confidence: Double
)

/** "↑", "↓" or "–": the server's trend direction, as a glyph. */
fun trendGlyph(direction: String): String = when (direction) {
    "up" -> "↑"
    "down" -> "↓"
    else -> "–"
}

/** The curve's headline points, in the order a rider reads them. */
fun headlineCurve(curve: List<PowerCurvePoint>, labels: List<String>): List<PowerCurvePoint> =
    labels.mapNotNull { wanted ->
        curve.firstOrNull { it.label.equals(wanted, ignoreCase = true) }
    }

/**
 * Zones worth printing: the ones with any time, in order. A zone with no time
 * is a zero bar nobody needs, but the total is what makes a percentage honest,
 * so it comes along.
 */
fun meaningfulZones(zones: List<ZoneShare>): List<ZoneShare> =
    zones.filter { it.percentage >= 0.5 }.sortedBy { it.zone }

/** e.g. "1h 12m" for a zone's time. */
fun formatZoneTime(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    return if (hours > 0) "${hours}h ${minutes}m" else "${minutes}m"
}

/** "20.4 km/h" from a distance and a duration in seconds; null when unknown. */
fun averageSpeed(distanceKm: Double, seconds: Int): Double? =
    if (distanceKm <= 0.0 || seconds <= 0) null else distanceKm / (seconds / 3600.0)

/** FTP change across the history, in watts; null without two points. */
fun ftpChange(history: List<FtpPoint>): Double? {
    if (history.size < 2) return null
    return history.last().watts - history.first().watts
}
