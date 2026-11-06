package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.domain.Connection
import uk.oli.fittrack.domain.Preferences
import uk.oli.fittrack.domain.SettingsSnapshot
import uk.oli.fittrack.ui.settings.SettingsScreen
import java.io.File
import java.util.concurrent.TimeUnit

/** Settings at 360×804: preferences that change, connections that report. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class SettingsScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val now = System.currentTimeMillis()

    private val snapshot = SettingsSnapshot(
        preferences = Preferences(unitSystem = "metric", timeFormat = "24h"),
        connections = listOf(
            Connection(
                id = "c1",
                provider = "strava",
                lastSyncedAt = now - TimeUnit.HOURS.toMillis(2)
            ),
            Connection(
                id = "c2",
                provider = "whoop",
                status = "needs_reauth",
                lastSyncedAt = now - TimeUnit.DAYS.toMillis(3),
                lastError = "token expired",
                consecutiveFailures = 3
            )
        )
    )

    @androidx.compose.runtime.Composable
    private fun screen(
        snapshot: SettingsSnapshot? = this.snapshot,
        onUnit: (String) -> Unit = {},
        onTime: (String) -> Unit = {}
    ) = SettingsScreen(
        snapshot = snapshot,
        email = "o.radlett@gmail.com",
        onUnit = onUnit,
        onTimeFormat = onTime,
        onRefresh = {},
        onBack = {}
    )

    @Test
    fun itShowsWhoYouAreAndHowTheNumbersAreWritten() {
        compose.setContent { screen() }
        compose.waitForIdle()
        save("settings-1")

        compose.onNodeWithText("Settings.").assertIsDisplayed()
        compose.onNodeWithText("o.radlett@gmail.com").assertIsDisplayed()
        compose.onNodeWithText("Metric · kg, km").assertIsDisplayed()
        compose.onNodeWithText("Imperial · lb, mi").assertIsDisplayed()
        compose.onNodeWithText("24-hour").assertIsDisplayed()
    }

    @Test
    fun connectionsReportTheirHealth() {
        compose.setContent { screen() }
        compose.waitForIdle()

        compose.onNodeWithText("Strava").assertIsDisplayed()
        compose.onNodeWithText("Synced 2h ago").assertIsDisplayed()
        compose.onNodeWithText("Whoop").assertIsDisplayed()
        compose.onNodeWithText("Needs re-auth").assertIsDisplayed()
        // One of the two needs attention, and the header says so.
        compose.onNodeWithText("2 connections · 1 needs attention").assertIsDisplayed()
    }

    @Test
    fun choosingImperialAsksForImperial() {
        var units: String? = null
        compose.setContent { screen(onUnit = { units = it }) }
        compose.waitForIdle()

        compose.onNodeWithText("Imperial · lb, mi").performClick()
        compose.waitForIdle()

        assertTrue(units == "imperial")
    }

    @Test
    fun choosingTwelveHourAsksForTwelveHour() {
        var clock: String? = null
        compose.setContent { screen(onTime = { clock = it }) }
        compose.waitForIdle()

        compose.onNodeWithText("12-hour").performClick()
        compose.waitForIdle()

        assertTrue(clock == "12h")
    }

    @Test
    fun noProvidersSaysWhereToConnectThem() {
        compose.setContent { screen(SettingsSnapshot(preferences = Preferences())) }
        compose.waitForIdle()

        compose.onNodeWithText("No providers connected.").assertIsDisplayed()
    }

    private fun save(name: String) {
        val view: View = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))

        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val distinct = pixels.toHashSet().size
        assertTrue("$name rendered only $distinct colours", distinct > 20)

        val out = File("build/shots/$name.png")
        out.parentFile?.mkdirs()
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SHOT ${out.absolutePath} ${bitmap.width}x${bitmap.height} colours=$distinct")
    }
}
