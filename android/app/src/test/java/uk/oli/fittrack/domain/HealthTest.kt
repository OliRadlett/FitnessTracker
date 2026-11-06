package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.YearMonth

class HealthTest {

    @Test
    fun `breathing describes the change, not just the number`() {
        assertEquals(
            "15.2 br/min · up from 14.8",
            RespiratoryRate(current = 15.2, baselineAverage = 14.8).describe()
        )
        assertEquals(
            "14.1 br/min · down from 14.8",
            RespiratoryRate(current = 14.1, baselineAverage = 14.8).describe()
        )
        assertEquals(
            "14.8 br/min · steady",
            RespiratoryRate(current = 14.8, baselineAverage = 14.81).describe()
        )
        assertEquals("14.8 br/min", RespiratoryRate(current = 14.8).describe())
        assertEquals("No reading", RespiratoryRate(current = null).describe())
    }

    @Test
    fun `a breathing reading exists when either end does`() {
        assertTrue(RespiratoryRate(current = 15.0).hasData)
        assertTrue(RespiratoryRate(current = null, recentAverage = 15.0).hasData)
        assertTrue(!RespiratoryRate(current = null).hasData)
    }

    @Test
    fun `sleep consistency reads as a band`() {
        assertEquals("Very consistent", SleepConsistency(score = 88.0).label)
        assertEquals("Fairly consistent", SleepConsistency(score = 65.0).label)
        assertEquals("Variable", SleepConsistency(score = 45.0).label)
        assertEquals("Irregular", SleepConsistency(score = 20.0).label)
        assertEquals("Unknown", SleepConsistency(score = null).label)
    }

    @Test
    fun `sleep consistency describes its spread and bedtime`() {
        val sleep = SleepConsistency(
            score = 72.0,
            averageBedtime = "23:10",
            spreadMinutes = 34.0
        )

        assertEquals("±34 min · in bed around 23:10", sleep.describe())
        assertEquals("±34 min", SleepConsistency(score = 1.0, spreadMinutes = 34.0).describe())
        assertEquals("", SleepConsistency(score = 1.0).describe())
    }

    @Test
    fun `a health snapshot is empty only when everything is`() {
        assertTrue(HealthSnapshot().isEmpty)
        assertTrue(!HealthSnapshot(readiness = Readiness(score = 70.0, level = "green")).isEmpty)
        assertTrue(!HealthSnapshot(sleepDebt = SleepDebt(1.0, 7.0, 3, 8.0, 7)).isEmpty)
        assertTrue(!HealthSnapshot(respiratoryRate = RespiratoryRate(current = 15.0)).isEmpty)
    }

    @Test
    fun `recovery bands are the three the calendar tints`() {
        assertEquals(RecoveryBand.Green, CalendarDay("2026-11-06", recoveryScore = 82.0).recoveryBand)
        assertEquals(RecoveryBand.Amber, CalendarDay("2026-11-06", recoveryScore = 55.0).recoveryBand)
        assertEquals(RecoveryBand.Red, CalendarDay("2026-11-06", recoveryScore = 22.0).recoveryBand)
        assertNull(CalendarDay("2026-11-06").recoveryBand)
    }

    @Test
    fun `a day says what happened on it`() {
        val lift = CalendarEntry("a", "Push day", "WeightTraining", minutes = 52, tss = 40.0)
        val ride = CalendarEntry("b", "Evening spin", "Ride", minutes = 60, distanceKm = 41.2)
        val day = CalendarDay("2026-11-06", entries = listOf(lift, ride))

        assertTrue(day.hasLift)
        assertTrue(day.hasRide)
        assertEquals("1 lift · 1 ride · 41.2 km", day.describe())
        assertTrue(!day.isEmpty)
    }

    @Test
    fun `a day with only health data is not empty`() {
        val day = CalendarDay("2026-11-06", recoveryScore = 68.0, sleepHours = 7.4)

        assertTrue(!day.isEmpty)
        assertEquals("", day.describe())
    }

    @Test
    fun `a strength entry is recognised by its focus even with a generic sport type`() {
        val session = CalendarEntry("a", "Session", "Workout", focus = "Legs")

        assertTrue(session.isLift)
    }

    @Test
    fun `the month grid starts on the right weekday`() {
        // 1 November 2026 is a Sunday, so a Monday-first grid needs six blanks.
        val (first, blanks) = monthStart(YearMonth.of(2026, 11))
        assertEquals("2026-11-01", first.toString())
        assertEquals(6, blanks)

        // 1 November 2027 is a Monday.
        assertEquals(0, monthStart(YearMonth.of(2027, 11)).second)
    }

    @Test
    fun `a month knows its own days`() {
        assertEquals(30, monthDays(YearMonth.of(2026, 11)).size)
        assertEquals(28, monthDays(YearMonth.of(2027, 2)).size)
        assertEquals("2026-11-30", monthDays(YearMonth.of(2026, 11)).last().toString())
    }
}
