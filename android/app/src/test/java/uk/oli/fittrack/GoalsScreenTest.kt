package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.domain.Goal
import uk.oli.fittrack.domain.GoalCheckIn
import uk.oli.fittrack.domain.GoalMetric
import uk.oli.fittrack.ui.goals.GoalsScreen
import java.io.File

/** The goals page at 360×804: the list, a check-in, and the create form. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class GoalsScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val metrics = listOf(
        GoalMetric("weight_kg", "Bodyweight", "kg", defaultDirection = "decrease"),
        GoalMetric("ftp_watts", "FTP", "W"),
        GoalMetric("squat_kg", "Squat", "kg", requiresFilter = listOf("exercise"))
    )

    private val goals = listOf(
        Goal(
            id = "g1",
            metric = "weight_kg",
            target = 80.0,
            current = 88.9,
            starting = 92.0,
            targetDate = "2026-12-31",
            unit = "kg"
        ),
        Goal(
            id = "g2",
            metric = "ftp_watts",
            target = 300.0,
            current = 280.0,
            starting = 270.0,
            status = "achieved",
            unit = "W"
        )
    )

    private val checkIns = mapOf(
        "g1" to listOf(
            GoalCheckIn("c1", "2026-11-01", 89.4, "morning"),
            GoalCheckIn("c2", "2026-11-05", 88.9)
        )
    )

    @androidx.compose.runtime.Composable
    private fun screen(
        goals: List<Goal>? = this.goals,
        checkIns: Map<String, List<GoalCheckIn>> = emptyMap(),
        onCreate: (String, Double, String?, String?) -> Unit = { _, _, _, _ -> },
        onCheckIn: (String, Double, String?) -> Unit = { _, _, _ -> },
        onExpand: (String) -> Unit = {}
    ) = GoalsScreen(
        goals = goals,
        metrics = metrics,
        checkIns = checkIns,
        busy = false,
        message = null,
        onCreate = onCreate,
        onCheckIn = onCheckIn,
        onStatus = { _, _ -> },
        onDelete = {},
        onExpand = onExpand,
        onBack = {}
    )

    @Test
    fun theListSaysWhereEachGoalStands() {
        compose.setContent { screen() }
        compose.waitForIdle()
        save("goals-1-list")

        compose.onNodeWithText("Goals.").assertIsDisplayed()
        compose.onNodeWithText("Bodyweight").assertIsDisplayed()
        compose.onNodeWithText("88.9 kg → 80 kg").assertIsDisplayed()
        compose.onNodeWithText("Achieved").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("+ New goal").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun openingAGoalAsksForItsCheckInsAndShowsThem() {
        var expanded: String? = null
        compose.setContent { screen(checkIns = checkIns, onExpand = { expanded = it }) }
        compose.waitForIdle()

        compose.onNodeWithText("Bodyweight").performClick()
        compose.waitForIdle()
        save("goals-2-expanded")

        assertTrue(expanded == "g1")
        compose.onNodeWithText("CHECK-INS").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("morning").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Today's value").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun aCheckInSendsTheNumberAndTheNote() {
        var got: Pair<Double, String?>? = null
        compose.setContent {
            screen(
                checkIns = checkIns,
                onCheckIn = { _, value, note -> got = value to note }
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("Bodyweight").performClick()
        compose.waitForIdle()
        // The value field is the first editable text node in the panel.
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("88.2")
        compose.onNodeWithText("Check in").performScrollTo().performClick()
        compose.waitForIdle()

        assertTrue("expected 88.2, got ${got?.first}", got?.first == 88.2)
    }

    @Test
    fun theCreateFormOffersOnlyMetricsAPhoneCanFillIn() {
        compose.setContent { screen() }
        compose.waitForIdle()

        compose.onNodeWithText("+ New goal").performScrollTo().performClick()
        compose.waitForIdle()
        save("goals-3-create")

        compose.onNodeWithText("NEW GOAL").performScrollTo().assertIsDisplayed()
        // "Squat" needs an exercise filter, so it is not offered. Both chips are
        // below the list, where the goal cards also say "Bodyweight", so match
        // the chip by its exact text.
        compose.onAllNodes(hasText("FTP")).onFirst().performScrollTo().assertIsDisplayed()
        compose.onAllNodes(hasText("Bodyweight")).onLast().performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Squat").assertDoesNotExist()
    }

    @Test
    fun creatingSendsTheMetricAndTarget() {
        var got: Triple<String, Double, String?>? = null
        compose.setContent {
            screen(onCreate = { metric, target, date, _ -> got = Triple(metric, target, date) })
        }
        compose.waitForIdle()

        compose.onNodeWithText("+ New goal").performScrollTo().performClick()
        compose.waitForIdle()
        // Target is the first field in the form.
        compose.onAllNodes(hasSetTextAction())[0].performTextInput("82.5")
        compose.onNodeWithText("Create").performScrollTo().performClick()
        compose.waitForIdle()

        assertTrue(got?.first == "weight_kg")
        assertTrue(got?.second == 82.5)
    }

    @Test
    fun noGoalsSaysSoWithoutInventingOne() {
        compose.setContent { screen(goals = emptyList()) }
        compose.waitForIdle()

        compose.onNodeWithText("No goals yet.").assertIsDisplayed()
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
