package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.domain.CyclingSummary
import uk.oli.fittrack.domain.FtpPoint
import uk.oli.fittrack.domain.PowerCurvePoint
import uk.oli.fittrack.domain.PowerModel
import uk.oli.fittrack.domain.Ride
import uk.oli.fittrack.domain.Vo2maxEstimate
import uk.oli.fittrack.domain.ZoneShare
import uk.oli.fittrack.net.CyclingSnapshot
import uk.oli.fittrack.ui.ride.RideScreen
import java.io.File

/**
 * The cycling page at the phone's real width (360×804 dp), with a fabricated
 * snapshot: the real data needs a signed-in activity and a power meter.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class RideScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun at(date: String): Long =
        java.time.LocalDate.parse(date).atTime(18, 0)
            .atZone(java.time.ZoneId.of("Europe/London")).toInstant().toEpochMilli()

    private val snapshot = CyclingSnapshot(
        summary = CyclingSummary(
            tss = 210.0,
            rides = 2,
            distanceKm = 61.4,
            timeHours = 3.4,
            elevationM = 540.0,
            ftpWatts = 280.0,
            wattsPerKg = 3.1,
            tssDirection = "up",
            distanceDirection = "down"
        ),
        curve = listOf(
            PowerCurvePoint("5s", 5, 1100.0),
            PowerCurvePoint("1min", 60, 520.0),
            PowerCurvePoint("20min", 1200, 300.0)
        ),
        model = PowerModel(cp = 265.0, wPrime = 18000.0, pMax = 1150.0),
        zones = listOf(
            ZoneShare("Z2", "Endurance", 3600, 50.0),
            ZoneShare("Z4", "Threshold", 1800, 25.0)
        ),
        ftpHistory = listOf(
            FtpPoint(270.0, "2026-09-01", "manual"),
            FtpPoint(280.0, "2026-10-15", "estimated")
        ),
        vo2max = Vo2maxEstimate(52.4, "Good", "power_estimate", 0.8)
    )

    private val rides = listOf(
        Ride(
            id = "r1",
            name = "Evening spin",
            source = "strava",
            sportType = "Ride",
            startedAt = at("2026-11-05"),
            durationSeconds = 3720,
            distanceMeters = 24_100.0,
            elevationGainMeters = 180.0,
            averagePower = 210.0,
            tss = 62.0
        )
    )

    @Test
    fun theCyclingPageReadsAsAPage() {
        compose.setContent {
            RideScreen(
                rides = rides,
                cycling = snapshot,
                load = null,
                onRefresh = {},
                onTab = {}
            )
        }
        compose.waitForIdle()
        save("ride-1-page")

        compose.onNodeWithText("Riding.").assertIsDisplayed()
        compose.onNodeWithText("LAST 7 DAYS").assertIsDisplayed()
        compose.onNodeWithText("FTP 280 W · 3.1 W/kg").assertIsDisplayed()
        compose.onNodeWithText("TSS").assertIsDisplayed()
        compose.onNodeWithText("3.4h").assertIsDisplayed()
        // Trends are glyphs on the number they belong to.
        compose.onNodeWithText("↑").assertIsDisplayed()
        compose.onNodeWithText("POWER").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("CP 265 W · W' 18 kJ · Pmax 1150 W").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("TIME IN ZONES · 30 DAYS").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Z2 Endurance").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("FITNESS").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("+10 W").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("52.4").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Evening spin").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun anEmptySnapshotStillOffersTheRides() {
        compose.setContent {
            RideScreen(
                rides = rides,
                cycling = CyclingSnapshot(),
                load = null,
                onRefresh = {},
                onTab = {}
            )
        }
        compose.waitForIdle()
        save("ride-2-empty")

        // No summary card, no power card: nothing invented from no data.
        compose.onNodeWithText("LAST 7 DAYS").assertDoesNotExist()
        compose.onNodeWithText("POWER").assertDoesNotExist()
        compose.onNodeWithText("Evening spin").assertIsDisplayed()
    }

    @Test
    fun noRidesAtAllSaysSo() {
        compose.setContent {
            RideScreen(
                rides = emptyList(),
                cycling = CyclingSnapshot(),
                load = null,
                onRefresh = {},
                onTab = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("No rides yet.").assertIsDisplayed()
        compose.onNodeWithText("Refresh").assertIsDisplayed()
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
