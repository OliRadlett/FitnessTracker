package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.domain.BikeRoute
import uk.oli.fittrack.domain.LatLng
import uk.oli.fittrack.domain.Polyline
import uk.oli.fittrack.ui.routes.RoutesScreen
import java.io.File

/** The routes atlas at 360×804, drawn from real encoded polylines. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class RoutesScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun shape(offset: Double): List<LatLng> =
        Polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@").map {
            LatLng(it.lat + offset, it.lng)
        }

    private val routes = listOf(
        BikeRoute(
            id = "r1",
            name = "Coast loop",
            sportType = "Ride",
            distanceMeters = 41_200.0,
            elevationMeters = 540.0,
            isLoop = true,
            isRidden = true,
            isFavourite = true,
            rideCount = 3,
            locality = "Brighton",
            country = "GB",
            terrain = "hilly",
            surface = "tarmac",
            qualityScore = 78.4,
            shape = shape(0.0)
        ),
        BikeRoute(
            id = "r2",
            name = "Unridden gravel",
            sportType = "Ride",
            distanceMeters = 22_000.0,
            isLoop = false,
            isRidden = false,
            shape = shape(0.2)
        ),
        BikeRoute(
            id = "r3",
            name = "No shape at all",
            sportType = "Ride",
            distanceMeters = 5_000.0
        )
    )

    @Test
    fun theAtlasListsRoutesShapeFirst() {
        compose.setContent {
            RoutesScreen(routes = routes, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()
        save("routes-1-list")

        compose.onNodeWithText("Routes.").assertIsDisplayed()
        compose.onNodeWithText("3 in the library").assertIsDisplayed()
        compose.onNodeWithText("Coast loop").assertIsDisplayed()
        compose.onNodeWithText("Hilly · 41.2 km · 540 m").assertIsDisplayed()
        compose.onNodeWithText("Ridden 3 times").assertIsDisplayed()
        // Two routes have never been ridden, so match the first of them.
        compose.onAllNodesWithText("Never ridden").onFirst().assertIsDisplayed()
    }

    @Test
    fun openingARouteSaysMore() {
        compose.setContent {
            RoutesScreen(routes = routes, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("Coast loop").performClick()
        compose.waitForIdle()
        save("routes-2-open")

        compose.onNodeWithText("Brighton, GB · Loop · Surface: tarmac · Quality 78 · Favourite")
            .assertIsDisplayed()
    }

    @Test
    fun theFiltersNarrowTheList() {
        compose.setContent {
            RoutesScreen(routes = routes, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("Loops").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Coast loop").assertIsDisplayed()
        compose.onNodeWithText("Unridden gravel").assertDoesNotExist()

        compose.onNodeWithText("Unridden").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Unridden gravel").assertIsDisplayed()
        compose.onNodeWithText("Coast loop").assertDoesNotExist()
    }

    @Test
    fun aRouteWithoutAShapeStillAppears() {
        compose.setContent {
            RoutesScreen(routes = listOf(routes.last()), onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()
        save("routes-3-noshape")

        compose.onNodeWithText("No shape at all").assertIsDisplayed()
    }

    @Test
    fun anEmptyLibrarySaysWhatIsMissing() {
        compose.setContent {
            RoutesScreen(routes = emptyList(), onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("No routes yet.").assertIsDisplayed()
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
