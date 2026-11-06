package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

class SettingsTest {

    private val now = 1_760_000_000_000L

    private fun connection(
        provider: String = "strava",
        status: String = "active",
        syncedHoursAgo: Long? = 2,
        error: String? = null,
        failures: Int = 0
    ) = Connection(
        id = "c-$provider",
        provider = provider,
        status = status,
        lastSyncedAt = syncedHoursAgo?.let { now - TimeUnit.HOURS.toMillis(it) },
        lastError = error,
        consecutiveFailures = failures
    )

    @Test
    fun `preferences describe themselves in the units they use`() {
        assertEquals("Metric · kg, km · 24h", Preferences().describe())
        assertEquals(
            "Imperial · lb, mi · 12h",
            Preferences(unitSystem = "imperial", timeFormat = "12h").describe()
        )
        assertTrue(Preferences().isMetric)
        assertFalse(Preferences(unitSystem = "imperial").isMetric)
    }

    @Test
    fun `a connection's health reads as time, an error or a re-auth`() {
        assertEquals("Synced just now", connection(syncedHoursAgo = 0).health(now))
        assertEquals("Synced 2h ago", connection(syncedHoursAgo = 2).health(now))
        assertEquals("Synced yesterday", connection(syncedHoursAgo = 30).health(now))
        assertEquals("Synced 3 days ago", connection(syncedHoursAgo = 80).health(now))
        assertEquals("Never synced", connection(syncedHoursAgo = null).health(now))
        assertEquals("Needs re-auth", connection(status = "needs_reauth").health(now))
        assertEquals(
            "Last error: token expired",
            connection(error = "token expired").health(now)
        )
    }

    @Test
    fun `broken means not active, failing twice, or carrying an error`() {
        assertFalse(connection().isBroken)
        assertTrue(connection(status = "needs_reauth").isBroken)
        assertTrue(connection(failures = 2).isBroken)
        assertTrue(connection(error = "boom").isBroken)
    }

    @Test
    fun `stale is a full two days without a sync`() {
        assertFalse(connection(syncedHoursAgo = 47).isStale(now))
        assertTrue(connection(syncedHoursAgo = 49).isStale(now))
        assertTrue(connection(syncedHoursAgo = null).isStale(now))
    }

    @Test
    fun `connections order by provider, unknown ones last`() {
        val items = listOf(
            connection(provider = "withings"),
            connection(provider = "strava"),
            connection(provider = "zwift"),
            connection(provider = "whoop")
        )

        assertEquals(
            listOf("strava", "whoop", "withings", "zwift"),
            orderConnections(items).map { it.provider }
        )
    }

    @Test
    fun `the connections label counts what needs attention`() {
        assertEquals("1 connection", connectionsLabel(listOf(connection())))
        assertEquals("2 connections", connectionsLabel(listOf(connection(), connection("whoop"))))
        assertEquals(
            "2 connections · 1 needs attention",
            connectionsLabel(
                listOf(connection(), connection(provider = "whoop", status = "needs_reauth"))
            )
        )
    }

    @Test
    fun `a snapshot knows which connections are broken`() {
        val snapshot = SettingsSnapshot(
            preferences = Preferences(),
            connections = listOf(
                connection(),
                connection(provider = "whoop", error = "token expired")
            )
        )

        assertEquals(1, snapshot.broken.size)
        assertEquals("Whoop", snapshot.broken.first().name)
    }

    @Test
    fun `a never-synced connection has no date to show`() {
        assertEquals("Never", syncedDate(null))
    }
}
