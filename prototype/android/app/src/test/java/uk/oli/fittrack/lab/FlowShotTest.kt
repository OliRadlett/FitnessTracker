package uk.oli.fittrack.lab

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.lab.ui.LiveSetScreen
import uk.oli.fittrack.lab.ui.SessionDoneScreen
import uk.oli.fittrack.lab.ui.TodayScreen
import java.io.File

/**
 * Renders the five frames on the JVM. No emulator, no device: Robolectric's
 * native graphics backend draws the real Compose tree at the exact qualifier
 * metrics, so the contact sheet is the production layout, not a mock.
 *
 * `captureToImage()` is not used: under Robolectric it waits on a window redraw
 * that never arrives. Drawing the decor view is the same pixels without the wait.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi")
class FlowShotTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun frame1Today() {
        compose.setContent { TodayScreen(done = false) }
        compose.waitForIdle()
        save("1-today")
        assertPrimaryInThumbZone("1-today")
    }

    @Test
    fun frame2LiveSet() {
        compose.setContent { LiveSetScreen() }
        compose.waitForIdle()
        save("2-live-set")
        assertPrimaryInThumbZone("2-live-set")
    }

    @Test
    fun frame3Resting() {
        compose.setContent { LiveSetScreen(resting = true) }
        compose.waitForIdle()
        save("3-rest")
        assertPrimaryInThumbZone("3-rest")
    }

    @Test
    fun frame4Done() {
        compose.setContent { SessionDoneScreen() }
        compose.waitForIdle()
        save("4-done")
        assertPrimaryInThumbZone("4-done")
    }

    @Test
    fun frame5TodayAfter() {
        compose.setContent { TodayScreen(done = true) }
        compose.waitForIdle()
        save("5-today-after")
        assertPrimaryInThumbZone("5-today-after")
    }

    /**
     * G5: the primary action is at least 48dp tall and its centre sits in the
     * bottom 35% of the screen, where a thumb actually is.
     */
    private fun assertPrimaryInThumbZone(frame: String) {
        val rootPx = compose.onRoot().fetchSemanticsNode().size.height
        val rootDp = rootPx / compose.density.density
        val bounds = compose.onNodeWithTag("primary").getUnclippedBoundsInRoot()
        val heightDp = (bounds.bottom - bounds.top).value
        val centreFraction = ((bounds.top + bounds.bottom).value / 2f) / rootDp
        println(
            "GATE $frame primary height=%.1fdp centre=%.0f%% of screen"
                .format(heightDp, centreFraction * 100)
        )
        assertTrue("$frame primary is ${heightDp}dp tall, below the 48dp floor", heightDp >= 48f)
        assertTrue(
            "$frame primary centre at ${(centreFraction * 100).toInt()}% — outside the bottom 35%",
            centreFraction >= 0.65f
        )
    }

    private fun save(name: String) {
        val view: View = compose.activity.window.decorView
        if (view.width == 0 || view.height == 0) {
            view.measure(
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
            )
            view.layout(0, 0, view.measuredWidth, view.measuredHeight)
        }
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))

        // A blank frame is not a frame. Fail loudly rather than shipping black.
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val distinct = pixels.toHashSet().size
        assertTrue("$name rendered only $distinct distinct colours — capture is blank", distinct > 20)

        val out = File("build/shots/$name.png")
        out.parentFile?.mkdirs()
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SHOT ${out.absolutePath} ${bitmap.width}x${bitmap.height} colours=$distinct")
    }
}
