package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
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
 * The plan is editable on the phone, and an edit has to reach Today. This drives
 * that path for real: open the editor, add a set to the first exercise, save.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w412dp-h915dp-xxhdpi")
class PlanEditorFlowTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun editingThePlanChangesToday() {
        compose.waitForIdle()
        save("plan-1-today")

        compose.onNodeWithText("Edit").performClick()
        compose.waitForIdle()
        save("plan-2-editor")

        // Select the first exercise, then add a set to it.
        compose.onNodeWithText("Bench Press").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("sets-plus").performClick()
        compose.waitForIdle()
        save("plan-3-expanded")

        compose.onNodeWithText("Save plan").performClick()
        compose.waitForIdle()
        save("plan-4-after")

        // Today must show the edited scheme, not the seeded one.
        compose.onNodeWithText("5 × 4").assertExists()
        compose.onNodeWithText("17 SETS", substring = true).assertExists()
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
