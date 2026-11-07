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
import uk.oli.fittrack.domain.Insight
import uk.oli.fittrack.ui.analytics.AnalyticsScreen
import java.io.File

/** Analytics at 360×804: what the nightly job concluded, and how sure it is. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class AnalyticsScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val insights = listOf(
        Insight(
            type = "sleep_performance",
            period = "28d",
            confidence = "high",
            sampleSize = 42,
            data = listOf(
                "correlation" to "0.62",
                "avg_sleep_hours" to "7.4",
                "note" to "stronger on good sleep"
            )
        ),
        Insight(type = "load_ramp", period = "14d", confidence = "low", sampleSize = 3, data = emptyList())
    )

    @Test
    fun insightsShowTheirEvidenceAndNumbers() {
        compose.setContent {
            AnalyticsScreen(insights = insights, busy = false, onRecompute = {}, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()
        save("analytics-1")

        compose.onNodeWithText("Analytics.").assertIsDisplayed()
        compose.onNodeWithText("Sleep and performance").assertIsDisplayed()
        compose.onNodeWithText("high confidence · 42 samples · over 28d").assertIsDisplayed()
        compose.onNodeWithText("Correlation").assertIsDisplayed()
        compose.onNodeWithText("0.62").assertIsDisplayed()
        // An insight with no data says so instead of showing an empty card.
        compose.onNodeWithText("Load ramp").assertIsDisplayed()
        compose.onNodeWithText("Not enough data to say anything yet.").assertIsDisplayed()
    }

    @Test
    fun recomputeAsksTheServer() {
        var asked = false
        compose.setContent {
            AnalyticsScreen(
                insights = insights,
                busy = false,
                onRecompute = { asked = true },
                onRefresh = {},
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("Recompute").performClick()
        compose.waitForIdle()

        assertTrue(asked)
    }

    @Test
    fun aRunningRecomputeSaysSo() {
        compose.setContent {
            AnalyticsScreen(insights = insights, busy = true, onRecompute = {}, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("Recomputing…").assertIsDisplayed()
    }

    @Test
    fun noInsightsExplainsWhenTheyAppear() {
        compose.setContent {
            AnalyticsScreen(insights = emptyList(), busy = false, onRecompute = {}, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("No insights yet.").assertIsDisplayed()
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
