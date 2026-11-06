package uk.oli.fittrack.domain

/** A point on a route, in degrees. */
data class LatLng(val lat: Double, val lng: Double)

/**
 * Decodes Google's encoded-polyline format.
 *
 * The routes list carries a ~90-point `preview_polyline` for silhouettes; the
 * phone draws those shapes itself rather than asking for map tiles it may not
 * have. Returns an empty list for anything malformed — a broken shape is not a
 * reason to lose the route.
 */
object Polyline {

    fun decode(encoded: String?): List<LatLng> {
        if (encoded.isNullOrBlank()) return emptyList()
        val points = mutableListOf<LatLng>()
        var index = 0
        var lat = 0
        var lng = 0

        while (index < encoded.length) {
            val latResult = readValue(encoded, index) ?: return points
            index = latResult.second
            lat += latResult.first
            val lngResult = readValue(encoded, index) ?: return points
            index = lngResult.second
            lng += lngResult.first
            points.add(LatLng(lat / 1e5, lng / 1e5))
        }
        return points
    }

    /** One varint plus its position after it; null when the string runs out. */
    private fun readValue(encoded: String, start: Int): Pair<Int, Int>? {
        var index = start
        var shift = 0
        var result = 0
        while (true) {
            if (index >= encoded.length) return null
            val b = encoded[index].code - 63
            if (b < 0) return null
            index += 1
            result = result or ((b and 0x1f) shl shift)
            shift += 5
            if (b < 0x20) break
            if (shift > 30) return null
        }
        // The low bit is the sign; the rest is the magnitude, two's complement.
        val value = if (result and 1 != 0) (result shr 1).inv() else result shr 1
        return value to index
    }
}

/** Normalises a shape into 0..1 for drawing, keeping its aspect ratio. */
fun normalise(points: List<LatLng>): List<Pair<Float, Float>> {
    if (points.isEmpty()) return emptyList()
    val minLat = points.minOf { it.lat }
    val maxLat = points.maxOf { it.lat }
    val minLng = points.minOf { it.lng }
    val maxLng = points.maxOf { it.lng }
    val spanLat = (maxLat - minLat).takeIf { it > 0.0 } ?: 1.0
    val spanLng = (maxLng - minLng).takeIf { it > 0.0 } ?: 1.0
    // Longitude at ±lat degrees is shorter on the ground; correct the x axis so
    // a route is not stretched sideways.
    val midLat = ((minLat + maxLat) / 2) * Math.PI / 180.0
    val lngScale = kotlin.math.cos(midLat).coerceAtLeast(0.2)

    val raw = points.map {
        ((it.lng - minLng) / spanLng * lngScale).toFloat() to
            ((it.lat - minLat) / spanLat).toFloat()
    }
    // Centre the corrected shape in its box.
    val maxX = raw.maxOf { it.first }.takeIf { it > 0f } ?: 1f
    return raw.map { (x, y) -> (x / maxX) to y }
}
