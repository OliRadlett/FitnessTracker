package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.domain.PlanExercise
import uk.oli.fittrack.net.PlanDaySummary
import uk.oli.fittrack.ui.train.PlanDayEditScreen
import java.io.File

/** The one writing surface the phone has into a plan, at 360×804. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class PlanDayEditScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val day = PlanDaySummary(
        date = "2026-11-06",
        sport = "strength",
        focus = "Push day",
        status = "pending",
        exercises = listOf(
            PlanExercise("Bench Press", 4, 4, 90.0),
            PlanExercise("Overhead Press", 3, 8, 50.0)
        ),
        isToday = true,
        id = "d1",
        notes = "Shoulder felt fine"
    )

    @Test
    fun theDayOpensAsItWasWritten() {
        compose.setContent {
            PlanDayEditScreen(day = day, busy = false, error = null, onSave = { _, _, _, _ -> }, onBack = {})
        }
        compose.waitForIdle()
        save("plan-day-1-open")

        compose.onNodeWithText("Friday 6 November").assertIsDisplayed()
        compose.onNodeWithText("Push day").assertIsDisplayed()
        compose.onNodeWithText("Bench Press").assertIsDisplayed()
        compose.onNodeWithText("Shoulder felt fine").assertIsDisplayed()
        compose.onNodeWithText("Save day").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun savingSendsTheWholeDay() {
        var saved: Triple<String, String, List<PlanExercise>>? = null
        compose.setContent {
            PlanDayEditScreen(
                day = day,
                busy = false,
                error = null,
                onSave = { sport, focus, _, exercises -> saved = Triple(sport, focus, exercises) },
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("Save day").performScrollTo().performClick()
        compose.waitForIdle()

        assertTrue(saved?.first == "strength")
        assertTrue(saved?.second == "Push day")
        assertTrue(saved?.third?.size == 2)
    }

    @Test
    fun aRefusalIsShownWhereTheButtonWas() {
        compose.setContent {
            PlanDayEditScreen(
                day = day,
                busy = false,
                error = "A cycle session already exists on 2026-11-07",
                onSave = { _, _, _, _ -> },
                onBack = {}
            )
        }
        compose.waitForIdle()
        save("plan-day-2-error")

        compose.onNodeWithText("A cycle session already exists on 2026-11-07").assertIsDisplayed()
    }

    @Test
    fun aRestDayHidesTheExerciseList() {
        compose.setContent {
            PlanDayEditScreen(
                day = day.copy(sport = "rest", exercises = emptyList()),
                busy = false,
                error = null,
                onSave = { _, _, _, _ -> },
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("EXERCISES").assertDoesNotExist()
        compose.onNodeWithText("+ Add exercise").assertDoesNotExist()
    }

    @Test
    fun nothingToEditSaysSo() {
        compose.setContent {
            PlanDayEditScreen(day = null, busy = false, error = null, onSave = { _, _, _, _ -> }, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("Nothing to edit.").assertIsDisplayed()
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
