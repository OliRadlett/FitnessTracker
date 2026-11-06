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
import uk.oli.fittrack.domain.ActivityDetail
import uk.oli.fittrack.domain.ActivitySummary
import uk.oli.fittrack.domain.Polyline
import uk.oli.fittrack.ui.activities.ActivitiesScreen
import java.io.File

/** The activities feed and one activity, at 360×804. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class ActivitiesScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val now = System.currentTimeMillis()

    private val feed = listOf(
        ActivitySummary(
            id = "a1",
            name = "Coast ride",
            source = "strava",
            sportType = "Ride",
            startedAt = now,
            durationSeconds = 11520,
            distanceMeters = 55_600.0,
            elevationMeters = 400.0,
            averagePower = 180.0,
            tss = 118.0,
            purpose = "endurance",
            rideType = "threshold",
            routeName = "Coast loop"
        ),
        ActivitySummary(
            id = "a2",
            name = "Push day",
            source = "manual",
            sportType = "WeightTraining",
            startedAt = now - 86_400_000,
            durationSeconds = 3120,
            linkedLift = ActivitySummary.LinkedLift("l1", "Push", 5326.0)
        )
    )

    @androidx.compose.runtime.Composable
    private fun screen(detail: ActivityDetail? = null) = ActivitiesScreen(
        activities = feed,
        detail = detail,
        loadingDetail = false,
        onWindow = {},
        onSport = {},
        onOpen = {},
        onClose = {},
        onBack = {}
    )

    @Test
    fun theFeedReadsAsRidesAndLifts() {
        compose.setContent { screen() }
        compose.waitForIdle()
        save("activities-1-feed")

        compose.onNodeWithText("Activities.").assertIsDisplayed()
        compose.onNodeWithText("Coast ride").assertIsDisplayed()
        // The distance lives in the subtitle, once — the right-hand copy
        // collided with it on a 360dp screen.
        compose.onNodeWithText("Today · Ride · 55.6 km · 3h 12m · 400 m · TSS 118").assertIsDisplayed()
        compose.onNodeWithText("Endurance · Threshold").assertIsDisplayed()
        compose.onNodeWithText("Push day").assertIsDisplayed()
        compose.onNodeWithText("Yesterday · Push · 52m").assertIsDisplayed()
    }

    @Test
    fun theDetailShowsTheShapeAndTheNumbers() {
        val detail = ActivityDetail(
            summary = feed.first(),
            shape = Polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@"),
            hasStreams = true
        )
        compose.setContent { screen(detail) }
        compose.waitForIdle()
        save("activities-2-detail")

        compose.onNodeWithText("Coast ride").assertIsDisplayed()
        compose.onNodeWithText("‹ Activities").assertIsDisplayed()
        compose.onNodeWithText("DISTANCE").assertIsDisplayed()
        compose.onNodeWithText("POWER").assertIsDisplayed()
        compose.onNodeWithText("Route: Coast loop").assertIsDisplayed()
        compose.onNodeWithText("Streams recorded — the website shows the full replay.")
            .assertIsDisplayed()
    }

    @Test
    fun closingTheDetailGoesBackToTheFeed() {
        var closed = false
        compose.setContent {
            ActivitiesScreen(
                activities = feed,
                detail = ActivityDetail(feed.first()),
                loadingDetail = false,
                onWindow = {},
                onSport = {},
                onOpen = {},
                onClose = { closed = true },
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("‹ Activities").performClick()
        compose.waitForIdle()

        assertTrue(closed)
    }

    @Test
    fun anEmptyFeedSaysSo() {
        compose.setContent {
            ActivitiesScreen(
                activities = emptyList(),
                detail = null,
                loadingDetail = false,
                onWindow = {},
                onSport = {},
                onOpen = {},
                onClose = {},
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("Nothing in this window.").assertIsDisplayed()
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
