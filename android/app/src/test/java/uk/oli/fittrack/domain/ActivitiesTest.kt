package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ActivitiesTest {

    private val zone = ZoneId.of("Europe/London")
    private val today = LocalDate.parse("2026-11-06")

    private fun at(date: String): Long =
        LocalDate.parse(date).atTime(18, 0).atZone(zone).toInstant().toEpochMilli()

    private fun ride(
        id: String = "a1",
        date: String = "2026-11-06",
        km: Double = 55.6,
        seconds: Int = 11520,
        sport: String = "Ride",
        purpose: String? = null,
        rideType: String? = null,
        tss: Double? = null
    ) = ActivitySummary(
        id = id,
        name = "Activity $id",
        source = "strava",
        sportType = sport,
        startedAt = at(date),
        durationSeconds = seconds,
        distanceMeters = km * 1000,
        elevationMeters = 400.0,
        tss = tss,
        purpose = purpose,
        rideType = rideType
    )

    @Test
    fun `a ride describes itself with distance, time, climb and TSS`() {
        assertEquals("55.6 km · 3h 12m · 400 m · TSS 118", ride(tss = 118.0).describe())
        assertEquals("55.6 km · 3h 12m · 400 m", ride().describe())
    }

    @Test
    fun `sport is recognised by its words, not an exact match`() {
        assertTrue(ride(sport = "Ride").isRide)
        assertTrue(ride(sport = "VirtualRide").isRide)
        assertTrue(ride(sport = "WeightTraining").isLift)
        assertTrue(!ride(sport = "Run").isRide)
        assertTrue(!ride(sport = "Run").isLift)
        // A linked lifting session makes an activity a lift even with a generic type.
        assertTrue(ride(sport = "Workout").copy(linkedLift = ActivitySummary.LinkedLift("l1", "Legs", 9000.0)).isLift)
    }

    @Test
    fun `labels read as two axes, and empty when there are none`() {
        assertEquals("Endurance · Threshold", ride(purpose = "endurance", rideType = "threshold").labels())
        assertEquals("Commute", ride(purpose = "commute").labels())
        assertEquals("", ride().labels())
    }

    @Test
    fun `sport labels are human, and a lift borrows its focus`() {
        assertEquals("Ride", ride().sportLabel)
        assertEquals("E-bike", ride(sport = "EBikeRide").sportLabel)
        assertEquals("Virtual ride", ride(sport = "VirtualRide").sportLabel)
        assertEquals("Run", ride(sport = "Run").sportLabel)
        assertEquals("Walk", ride(sport = "Hike").sportLabel)
        assertEquals(
            "Legs",
            ride(sport = "Workout").copy(linkedLift = ActivitySummary.LinkedLift("l", "legs", null)).sportLabel
        )
    }

    @Test
    fun `speed is null when it would be meaningless`() {
        assertEquals(17.4, ride(km = 55.6, seconds = 11520).averageSpeedKph!!, 0.1)
        assertNull(ride(km = 0.0).averageSpeedKph)
        assertNull(ride(seconds = 0).averageSpeedKph)
    }

    @Test
    fun `the feed filter uses the window and the sport`() {
        val feed = listOf(
            ride(id = "todays", date = "2026-11-06"),
            // Inside the 90-day window but outside the 30-day one.
            ride(id = "lastmonth", date = "2026-09-10"),
            ride(id = "longago", date = "2025-01-01"),
            ride(id = "lift", date = "2026-11-05", sport = "WeightTraining", km = 0.0)
        )

        assertEquals(
            listOf("lift", "todays"),
            filterActivities(feed, null, ActivityWindow.Month, today, zone).map { it.id }.sorted()
        )
        assertEquals(
            listOf("lastmonth", "lift", "todays"),
            filterActivities(feed, null, ActivityWindow.Quarter, today, zone).map { it.id }.sorted()
        )
        assertEquals(4, filterActivities(feed, null, ActivityWindow.All, today, zone).size)
        assertEquals(listOf("lift"), filterActivities(feed, "lift", ActivityWindow.All, today, zone).map { it.id })
        assertEquals(
            listOf("lastmonth", "longago", "todays"),
            filterActivities(feed, "ride", ActivityWindow.All, today, zone).map { it.id }.sorted()
        )
    }

    @Test
    fun `the feed date says today, yesterday or a date`() {
        val now = at("2026-11-06")
        assertEquals("Today", feedDate(now, now, zone))
        assertEquals("Yesterday", feedDate(at("2026-11-05"), now, zone))
        assertEquals("Mon", feedDate(at("2026-11-02"), now, zone))
        assertEquals("1 Oct", feedDate(at("2026-10-01"), now, zone))
    }

    @Test
    fun `a shape needs three points to be worth drawing`() {
        val thin = ActivityDetail(ride(), shape = listOf(LatLng(51.0, -0.1), LatLng(51.1, -0.2)))
        val full = ActivityDetail(
            ride(),
            shape = listOf(LatLng(51.0, -0.1), LatLng(51.1, -0.2), LatLng(51.2, -0.3))
        )

        assertTrue(!thin.canDraw)
        assertTrue(full.canDraw)
    }
}
