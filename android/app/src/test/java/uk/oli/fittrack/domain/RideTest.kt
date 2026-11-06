package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class RideTest {

    private val zone = ZoneId.of("Europe/London")
    private val today = LocalDate.parse("2026-11-06")

    private fun at(date: String): Long =
        LocalDate.parse(date).atTime(9, 0).atZone(zone).toInstant().toEpochMilli()

    private fun ride(
        date: String,
        km: Double,
        seconds: Int = 3600,
        tss: Double? = null
    ) = Ride(
        id = "r-$date-$km",
        name = "Ride $date",
        source = "strava",
        sportType = "Ride",
        startedAt = at(date),
        durationSeconds = seconds,
        distanceMeters = km * 1000,
        elevationGainMeters = 100.0,
        tss = tss
    )

    @Test
    fun `the window keeps the last seven days and drops older rides`() {
        val rides = listOf(
            ride("2026-11-06", 30.0),
            ride("2026-11-01", 20.0),
            ride("2026-10-29", 99.0), // before the window
            ride("2026-11-07", 5.0)   // in the future, so not this week's training
        )

        val window = ridesInWindow(rides, today, 7, zone)

        assertEquals(2, window.count)
        assertEquals(50.0, window.distanceKm, 0.001)
    }

    @Test
    fun `a ride without a TSS contributes nothing to the total`() {
        val window = ridesInWindow(
            listOf(ride("2026-11-05", 20.0, tss = 55.0), ride("2026-11-04", 20.0)),
            today, 7, zone
        )

        assertEquals(55.0, window.tss, 0.001)
        assertTrue(window.hasTss)
        assertFalse(ridesInWindow(listOf(ride("2026-11-04", 20.0)), today, 7, zone).hasTss)
    }

    @Test
    fun `duration sums and the longest ride is the biggest distance`() {
        val window = ridesInWindow(
            listOf(
                ride("2026-11-05", 20.0, seconds = 3600),
                ride("2026-11-03", 60.0, seconds = 7200)
            ),
            today, 7, zone
        )

        assertEquals(10800, window.durationSeconds)
        assertEquals("60.0 km", formatDistanceKm(window.longest!!.distanceKm))
    }

    @Test
    fun `speed is distance over time, and zero when there is no time`() {
        assertEquals(20.0, ride("2026-11-05", 20.0, seconds = 3600).averageSpeedKph, 0.001)
        assertEquals(0.0, ride("2026-11-05", 20.0, seconds = 0).averageSpeedKph, 0.001)
    }

    @Test
    fun `durations read as a person would say them`() {
        assertEquals("48m", formatRideDuration(2880))
        assertEquals("1h 12m", formatRideDuration(4320))
        assertEquals("2h 0m", formatRideDuration(7200))
        assertEquals("0m", formatRideDuration(30))
    }

    @Test
    fun `a ride with no distance is not a division by zero`() {
        val free = ride("2026-11-05", 0.0, seconds = 600)

        assertEquals(0.0, free.distanceKm, 0.001)
        assertEquals(0.0, free.averageSpeedKph, 0.001)
    }
}
