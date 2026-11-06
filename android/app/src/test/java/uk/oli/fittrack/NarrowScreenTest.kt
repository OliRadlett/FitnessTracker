package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
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
 * The narrowest common phone: 360x804dp (a OnePlus 11 at 480dpi).
 *
 * Every other screenshot is 412x915dp, which is roomy enough to hide layout
 * faults. The real device exposed one: the "Not signed in" row sat ~4dp below
 * the fold, so the only prompt to sign in was invisible without scrolling.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class NarrowScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun signInPromptIsVisibleWithoutScrolling() {
        compose.waitForIdle()
        save("narrow-1-today")

        compose.onNodeWithText("Sign in →").assertIsDisplayed()
        compose.onNodeWithTag("primary").assertIsDisplayed()
    }

    @Test
    fun theInstrumentFitsWithoutScrolling() {
        compose.onNodeWithTag("primary").performClick()
        compose.waitForIdle()
        save("narrow-2-live")

        // The whole point of the Live screen: the commit button, the flags and
        // the current RPE are all reachable without scrolling at 360dp. The RPE
        // grid expands on tap, so it is collapsed by default.
        compose.onNodeWithText("Log set").assertIsDisplayed()
        compose.onNodeWithTag("rpe-pill").assertIsDisplayed()
        compose.onNodeWithText("Warm-up").assertIsDisplayed()
        compose.onNodeWithText("AMRAP").assertIsDisplayed()
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
