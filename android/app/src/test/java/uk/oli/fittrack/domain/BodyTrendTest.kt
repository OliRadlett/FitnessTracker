package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class BodyTrendTest {

    private val zone = ZoneId.of("Europe/London")
    private val today = LocalDate.parse("2026-11-06")

    private fun entry(date: String, kg: Double, source: String = "manual") =
        WeightEntry("id-$date", date, kg, source)

    private fun trend(vararg entries: WeightEntry) = BodyTrend(entries.toList())

    @Test
    fun `the latest weigh-in is the newest date, not the last row`() {
        val body = trend(entry("2026-11-04", 80.0), entry("2026-11-06", 79.4), entry("2026-11-02", 81.0))

        assertEquals("2026-11-06", body.latest?.date)
        assertEquals(79.4, body.latest!!.weightKg, 0.001)
    }

    @Test
    fun `change is measured against the last weigh-in at or before the cutoff`() {
        val body = trend(
            entry("2026-09-20", 84.0),
            entry("2026-10-01", 82.5),
            entry("2026-11-06", 79.5)
        )

        // 30 days before 6 Nov is 7 Oct, so the 1 Oct weigh-in is the reference.
        assertEquals(-3.0, body.changeKg(today, 30, zone)!!, 0.001)
    }

    @Test
    fun `a single weigh-in has no change to report`() {
        assertNull(trend(entry("2026-11-06", 80.0)).changeKg(today, 30, zone))
        assertNull(trend().changeKg(today, 30, zone))
    }

    @Test
    fun `the span counts between the first and last weigh-in`() {
        val body = trend(entry("2026-10-07", 82.0), entry("2026-11-06", 79.5))

        assertEquals(30, body.spanDays())
        assertEquals(0, trend(entry("2026-11-06", 80.0)).spanDays())
    }

    @Test
    fun `rolling points map dates to epoch millis, skipping bad dates`() {
        val body = BodyTrend(
            entries = listOf(entry("2026-11-06", 79.5)),
            rolling = listOf("2026-11-05" to 79.8, "not-a-date" to 80.0)
        )

        val points = body.rollingPoints(zone)

        assertEquals(1, points.size)
        assertTrue(points.first().first > 0L)
        assertEquals(79.8, points.first().second, 0.001)
    }

    @Test
    fun `a weight is guarded against fat fingers`() {
        assertTrue(plausibleWeight(79.4))
        assertTrue(plausibleWeight(20.0))
        assertTrue(!plausibleWeight(7.0))
        assertTrue(!plausibleWeight(700.0))
        assertTrue(!plausibleWeight(0.0))
    }

    @Test
    fun `a source is manual only when it says so`() {
        assertTrue(entry("2026-11-06", 80.0, "manual").isManual)
        assertTrue(!entry("2026-11-06", 80.0, "withings").isManual)
    }
}
