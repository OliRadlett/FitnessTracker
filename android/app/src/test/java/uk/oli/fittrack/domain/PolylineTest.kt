package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PolylineTest {

    @Test
    fun `the reference example decodes to the reference points`() {
        // Google's own documented sample.
        val points = Polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@")

        assertEquals(3, points.size)
        assertEquals(38.5, points[0].lat, 1e-5)
        assertEquals(-120.2, points[0].lng, 1e-5)
        assertEquals(40.7, points[1].lat, 1e-5)
        assertEquals(-120.95, points[1].lng, 1e-5)
        assertEquals(43.252, points[2].lat, 1e-5)
        assertEquals(-126.453, points[2].lng, 1e-5)
    }

    @Test
    fun `an empty or blank shape is no points`() {
        assertTrue(Polyline.decode(null).isEmpty())
        assertTrue(Polyline.decode("").isEmpty())
        assertTrue(Polyline.decode("   ").isEmpty())
    }

    @Test
    fun `a truncated shape keeps the points it did get`() {
        // Cut the reference string mid-way: the first point survives.
        val points = Polyline.decode("_p~iF~ps|U_ulLnnqC")

        assertEquals(2, points.size)
        assertEquals(38.5, points[0].lat, 1e-5)
    }

    @Test
    fun `a character below the offset is not a point`() {
        assertTrue(Polyline.decode("!!").isEmpty())
    }

    @Test
    fun `normalising fills the box and keeps the aspect`() {
        val shape = listOf(
            LatLng(0.0, 0.0),
            LatLng(0.0, 0.01),
            LatLng(0.01, 0.01)
        )

        val points = normalise(shape)

        assertEquals(3, points.size)
        // x spans 0..1, y spans 0..1, and the corner lands top-right.
        assertEquals(0f, points[0].first, 1e-4f)
        assertEquals(0f, points[0].second, 1e-4f)
        assertEquals(1f, points.last().first, 1e-4f)
        assertEquals(1f, points.last().second, 1e-4f)
    }

    @Test
    fun `a degenerate shape does not divide by zero`() {
        val points = normalise(listOf(LatLng(51.5, -0.1), LatLng(51.5, -0.1)))

        assertEquals(2, points.size)
        assertTrue(points.all { it.first.isFinite() && it.second.isFinite() })
    }

    @Test
    fun `an empty shape normalises to nothing`() {
        assertTrue(normalise(emptyList()).isEmpty())
    }
}
