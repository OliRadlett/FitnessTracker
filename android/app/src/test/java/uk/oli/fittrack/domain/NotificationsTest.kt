package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationsTest {

    private fun note(
        id: String = "n1",
        type: String = "health_alert",
        severity: String = "info",
        read: Boolean = false,
        at: Long? = null
    ) = Notification(
        id = id,
        type = type,
        title = "Title $id",
        body = "Body",
        severity = severity,
        read = read,
        createdAt = at
    )

    @Test
    fun `types read as words`() {
        assertEquals("Health", note(type = "health_alert").typeLabel)
        assertEquals("Record", note(type = "pr").typeLabel)
        assertEquals("Connection", note(type = "connection_reauth").typeLabel)
        assertEquals("Something else", note(type = "something_else").typeLabel)
    }

    @Test
    fun `only a warning or worse is urgent`() {
        assertTrue(note(severity = "warning").isUrgent)
        assertTrue(note(severity = "critical").isUrgent)
        assertFalse(note(severity = "info").isUrgent)
    }

    @Test
    fun `unread come first, then newest`() {
        val items = listOf(
            note(id = "read-new", read = true, at = 300),
            note(id = "unread-old", read = false, at = 100),
            note(id = "unread-new", read = false, at = 200)
        )

        assertEquals(
            listOf("unread-new", "unread-old", "read-new"),
            orderNotifications(items).map { it.id }
        )
    }

    @Test
    fun `the unread label says what it means`() {
        assertEquals("All read", unreadLabel(listOf(note(read = true))))
        assertEquals("1 unread", unreadLabel(listOf(note(read = false), note(id = "n2", read = true))))
        assertEquals("2 unread", unreadLabel(listOf(note(), note(id = "n2"))))
        assertEquals("All read", unreadLabel(emptyList()))
    }

    @Test
    fun `age is a clock time today, then words, then a date`() {
        val zone = java.time.ZoneId.of("Europe/London")
        val now = java.time.LocalDate.parse("2026-11-06").atTime(18, 0).atZone(zone)
            .toInstant().toEpochMilli()
        fun at(date: String, hour: Int, minute: Int): Long =
            java.time.LocalDate.parse(date).atTime(hour, minute).atZone(zone)
                .toInstant().toEpochMilli()

        assertEquals("09:30", note(at = at("2026-11-06", 9, 30)).age(now, zone))
        assertEquals("Yesterday", note(at = at("2026-11-05", 9, 30)).age(now, zone))
        assertEquals("Mon", note(at = at("2026-11-02", 9, 30)).age(now, zone))
        assertEquals("1 Oct", note(at = at("2026-10-01", 9, 30)).age(now, zone))
        // A notification with no timestamp says nothing rather than "1970".
        assertEquals("", note(at = null).age(now, zone))
    }
}
