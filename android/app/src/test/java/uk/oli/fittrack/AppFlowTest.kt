package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Drives the real app: launches MainActivity, taps Start, taps Log set, and
 * photographs each state. This is the honest proof that navigation, the
 * ViewModel, the store and the rest timer all work together — a compile is not.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi")
class AppFlowTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun startAndLogASet() {
        compose.waitForIdle()
        save("app-1-today")

        // Start the session: Today -> Live.
        compose.onNodeWithTag("primary").performClick()
        compose.waitForIdle()
        save("app-2-live")

        // Log the first set: Live -> resting.
        compose.onNodeWithTag("primary").performClick()
        compose.waitForIdle()
        save("app-3-rest")

        compose.onNodeWithText("RESTING").assertExists()
        compose.onNodeWithText("set 2 of 4", substring = true).assertExists()
        compose.onNodeWithText("Log set 2").assertExists()

        // Bump the weight on the stepper, then log again. The row must show what
        // was logged (92.5), not what the plan asked for (90).
        compose.onAllNodesWithText("+").onFirst().performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("primary").performClick()
        compose.waitForIdle()
        save("app-4-second-set")
        compose.onNodeWithText("92.5 × 4").assertExists()

        // A mis-tap has to be recoverable: undo drops the set and re-arms set 2.
        compose.onNodeWithText("Undo").performClick()
        compose.waitForIdle()
        save("app-5-undo")
        compose.onNodeWithText("92.5 × 4").assertDoesNotExist()
        compose.onNodeWithText("set 2 of 4", substring = true).assertExists()

        // Finishing early is allowed: the plan is a target, not a cage.
        compose.onNodeWithText("Finish").performClick()
        compose.waitForIdle()
        save("app-6-done")
        // Behaviour, not machine state: the summary is what must render here.
        compose.onNodeWithText("Session done.").assertExists()

        // Committing the summary turns it into history and returns to Today.
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
        save("app-7-today-after")

        compose.onNodeWithText("LAST 7 DAYS").assertExists()
        compose.onNodeWithText("Last time").assertExists()

        // The log is readable, not just written.
        compose.onNodeWithText("Log").performClick()
        compose.waitForIdle()
        save("app-8-log")
        compose.onNodeWithText("1 session").assertExists()

        compose.onNodeWithText("Push day").performClick()
        compose.waitForIdle()
        save("app-9-session-detail")
        compose.onNodeWithText("TOP SET").assertExists()

        // A logged set is editable after the fact: tap the row, bump the load,
        // save. The row and the session's volume must both move.
        compose.onNodeWithText("90 kg × 4").performClick()
        compose.waitForIdle()
        save("app-10-set-editor")
        compose.onNodeWithText("Delete set").assertExists()

        compose.onAllNodesWithText("+").onFirst().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Save").performClick()
        compose.waitForIdle()
        save("app-11-set-edited")
        compose.onNodeWithText("92.5 kg × 4").assertExists()
    }

    private fun save(name: String) {
        val view: View = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))

        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val distinct = pixels.toHashSet().size
        assertTrue("$name rendered only $distinct colours — blank capture", distinct > 20)

        val out = File("build/shots/$name.png")
        out.parentFile?.mkdirs()
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SHOT ${out.absolutePath} ${bitmap.width}x${bitmap.height} colours=$distinct")
    }
}
