package uk.oli.fittrack.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.LoggedSet
import java.time.LocalDate
import java.time.ZoneId

class LiftingPushTest {

    private val zone = ZoneId.of("Europe/London")

    private fun at(date: String, hour: Int): Long =
        LocalDate.parse(date).atTime(hour, 0).atZone(zone).toInstant().toEpochMilli()

    private fun session() = FinishedSession(
        id = "phone-session-1",
        planTitle = "Push day",
        startedAt = at("2026-11-05", 18),
        endedAt = at("2026-11-05", 19),
        sets = listOf(
            LoggedSet("Bench Press", 90.0, 4, 7, 0),
            LoggedSet("Close Grip Bench Press", 70.0, 12, 7, 0),
            LoggedSet("Bench Press", 92.5, 4, 8, 0)
        )
    )

    @Test
    fun `set numbers restart per exercise while order stays global`() {
        val body = LiftingPush.body(session(), zone)

        assertEquals(listOf(1, 1, 2), body.sets.map { it.set_number })
        assertEquals(listOf(0, 1, 2), body.sets.map { it.order_index })
    }

    @Test
    fun `live key is the phone session id so retries are idempotent`() {
        val body = LiftingPush.body(session(), zone)

        assertEquals("phone-session-1", body.live_key)
    }

    @Test
    fun `client ids are stable for the same session`() {
        val first = LiftingPush.body(session(), zone).sets.map { it.client_id }
        val second = LiftingPush.body(session(), zone).sets.map { it.client_id }

        assertEquals(first, second)
        assertEquals(listOf("phone-session-1:0", "phone-session-1:1", "phone-session-1:2"), first)
    }

    @Test
    fun `date and duration come from the session, not from now`() {
        val body = LiftingPush.body(session(), zone)

        assertEquals("2026-11-05", body.session_date)
        assertEquals(3600, body.duration_seconds)
    }

    @Test
    fun `weights and rpe survive the round trip`() {
        val body = LiftingPush.body(session(), zone)

        assertEquals(listOf(90.0, 70.0, 92.5), body.sets.map { it.weight_kg })
        assertEquals(listOf(7, 7, 8), body.sets.map { it.rpe })
        assertTrue(body.sets.all { it.reps > 0 })
    }
}
