package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CyclingTest {

    private fun point(label: String, watts: Double) = PowerCurvePoint(label, 0, watts)

    @Test
    fun `trend directions become glyphs, and stable is a dash`() {
        assertEquals("↑", trendGlyph("up"))
        assertEquals("↓", trendGlyph("down"))
        assertEquals("–", trendGlyph("stable"))
        assertEquals("–", trendGlyph("anything else"))
    }

    @Test
    fun `the headline curve picks the durations a rider reads`() {
        val curve = listOf(
            point("5s", 1100.0),
            point("1min", 520.0),
            point("20min", 300.0)
        )

        val headline = headlineCurve(curve, listOf("5s", "1min", "5min", "20min"))

        // 5min has no point, so it is absent rather than zero.
        assertEquals(listOf("5s", "1min", "20min"), headline.map { it.label })
    }

    @Test
    fun `label matching is case-insensitive`() {
        val curve = listOf(point("1MIN", 500.0))

        assertEquals(listOf("1MIN"), headlineCurve(curve, listOf("1min")).map { it.label })
    }

    @Test
    fun `zones below half a percent are noise and are dropped`() {
        val zones = listOf(
            ZoneShare("Z1", "Active Recovery", 60, 1.0),
            ZoneShare("Z2", "Endurance", 3000, 50.0),
            ZoneShare("Z7", "Neuromuscular", 1, 0.01),
            ZoneShare("Z4", "Threshold", 900, 15.0)
        )

        // Zone order, not input order: the bars read bottom-light to top-hard.
        assertEquals(listOf("Z1", "Z2", "Z4"), meaningfulZones(zones).map { it.zone })
    }

    @Test
    fun `zone time reads in hours and minutes`() {
        assertEquals("50m", formatZoneTime(3000))
        assertEquals("1h 0m", formatZoneTime(3600))
        assertEquals("2h 5m", formatZoneTime(7500))
        assertEquals("0m", formatZoneTime(20))
    }

    @Test
    fun `average speed needs both a distance and a time`() {
        assertEquals(20.0, averageSpeed(20.0, 3600)!!, 0.001)
        assertNull(averageSpeed(0.0, 3600))
        assertNull(averageSpeed(20.0, 0))
    }

    @Test
    fun `the ftp change is first to last, and absent without two points`() {
        assertNull(ftpChange(emptyList()))
        assertNull(ftpChange(listOf(FtpPoint(280.0, "2026-10-01", "manual"))))

        val change = ftpChange(
            listOf(
                FtpPoint(270.0, "2026-09-01", "manual"),
                FtpPoint(280.0, "2026-10-15", "estimated")
            )
        )
        assertEquals(10.0, change!!, 0.001)
    }

    @Test
    fun `a fit is a model only when it has something to say`() {
        assertTrue(!PowerModel().hasFit)
        assertTrue(PowerModel(cp = 265.0).hasFit)
        assertTrue(PowerModel(pMax = 1150.0).hasFit)
        assertTrue(!PowerModel(rSquared = 0.94).hasFit)
    }

    @Test
    fun `an empty week is empty and one ride is not`() {
        assertTrue(CyclingSummary().isEmpty)
        assertTrue(!CyclingSummary(rides = 1).isEmpty)
        assertTrue(!CyclingSummary(distanceKm = 40.0).isEmpty)
    }
}
