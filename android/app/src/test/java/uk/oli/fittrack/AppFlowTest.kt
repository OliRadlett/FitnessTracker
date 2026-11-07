package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
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

        // A warm-up is a real set with its own flag: log one at 85, and the plan
        // must not advance, the volume must not move, and no rest starts.
        compose.onNodeWithText("Warm-up").performClick()
        compose.onAllNodesWithText("−").onFirst().performClick()
        compose.onAllNodesWithText("−").onFirst().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Log warm-up").performClick()
        compose.waitForIdle()
        save("app-3-warmup")
        compose.onNodeWithText("warm-up").assertExists()
        compose.onNodeWithText("set 1 of 4", substring = true).assertExists()
        compose.onNodeWithText("RESTING").assertDoesNotExist()

        // Then an AMRAP working set: it counts, so the plan advances.
        compose.onNodeWithText("Warm-up").performClick()
        compose.onNodeWithText("AMRAP").performClick()
        compose.onAllNodesWithText("+").onFirst().performClick()
        compose.onAllNodesWithText("+").onFirst().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Log set").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("RESTING").assertExists()
        compose.onNodeWithText("set 2 of 4", substring = true).assertExists()
        compose.onAllNodesWithText("AMRAP").onFirst().assertExists()
        compose.onNodeWithText("Log set 2").assertExists()

        // Rest is adjustable mid-rest, and the target says so.
        compose.onNodeWithText("target 2:30").assertExists()
        compose.onNodeWithText("+30s").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("target 3:00").assertExists()
        save("app-4-rest-adjusted")

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

        // The finish captures the session's own effort and note, as the website
        // does — they are about the hour, not about a set.
        compose.onNodeWithText("8").performClick()
        compose.onNodeWithTag("session-note").performTextInput("felt strong")
        compose.waitForIdle()
        save("app-6b-done-note")

        // Committing the summary turns it into history and returns to Today.
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
        save("app-7-today-after")

        compose.onNodeWithText("LAST 7 DAYS").assertExists()
        compose.onNodeWithText("Last time").assertExists()

        // The log is readable, not just written — under Train now, where
        // sessions, progress and the plan live together.
        compose.onNodeWithText("Train").performClick()
        compose.waitForIdle()
        save("app-8-log")
        compose.onNodeWithText("1 session").assertExists()

        // The log filters on what the website filters on: free text first, with
        // the chip filters behind one tap.
        compose.onNodeWithTag("log-search").performTextInput("zzz")
        compose.waitForIdle()
        compose.onNodeWithText("No sessions match.").assertExists()
        compose.onNodeWithText("0 of 1 session").assertExists()
        save("app-8c-log-filter")
        compose.onNodeWithText("Clear").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("1 session").assertExists()

        // Progress is computed from the same sets: a PR, a rep-range strip and
        // an estimated-1RM line, with no network in the path.
        compose.onNodeWithText("Progress").performClick()
        compose.waitForIdle()
        save("app-8b-progress")
        compose.onNodeWithText("PERSONAL BESTS").assertExists()
        compose.onNodeWithText("BEST BY REP RANGE").assertExists()
        compose.onAllNodesWithText("Bench Press").onFirst().assertExists()
        compose.onNodeWithText("ESTIMATED 1RM").assertExists()
        compose.onNodeWithText("Two sessions of an exercise and the line appears.").assertExists()

        // The Today tab returns to Today, not to a "not built yet" placeholder.
        // Found on device: routing Today through the tab/{name} route showed the
        // placeholder, and only a pass that left Today and came back saw it.
        compose.onNodeWithText("Train").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Today").performClick()
        compose.waitForIdle()
        save("app-8e-back-to-today")
        compose.onNodeWithText("LAST 7 DAYS").assertExists()
        compose.onNodeWithText("NOT BUILT YET").assertDoesNotExist()

        compose.onNodeWithText("Train").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Progress").performClick()
        compose.waitForIdle()

        // Analytics, from the same history: volume by week, balance by focus,
        // and the lifts trained most.
        compose.onNodeWithText("VOLUME · 8 WEEKS").performScrollTo().assertExists()
        compose.onNodeWithText("BALANCE").performScrollTo().assertExists()
        compose.onNodeWithText("MOST TRAINED").performScrollTo().assertExists()

        // The week is a network read: signed out it says so rather than
        // pretending the plan is empty.
        compose.onNodeWithText("Week").performScrollTo().performClick()
        compose.waitForIdle()
        save("app-8d-week")
        compose.onNodeWithText("No plan loaded.").assertExists()

        compose.onNodeWithText("Sessions").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Push day").performClick()
        compose.waitForIdle()
        save("app-9-session-detail")
        compose.onNodeWithText("TOP SET").assertExists()
        // The flags travelled with the sets, so the session reads the same here
        // as it will on the website.
        compose.onNodeWithText("AMRAP").assertExists()
        compose.onAllNodesWithText("warm-up", substring = true).onFirst().assertExists()
        // The finish note survived the round trip into history.
        compose.onNodeWithText("felt strong").assertExists()

        // A logged set is editable after the fact: tap the row, bump the load,
        // save. The row and the session's volume must both move.
        compose.onNodeWithText("90 kg × 4").performClick()
        compose.waitForIdle()
        save("app-10-set-editor")
        compose.onNodeWithText("Delete set").assertExists()

        compose.onAllNodesWithText("+").onFirst().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Save").performScrollTo().performClick()
        compose.waitForIdle()
        save("app-11-set-edited")
        compose.onNodeWithText("92.5 kg × 4").assertExists()

        // The session's own fields: move it a day and rename it. Both must be
        // visible immediately, because the header is the only confirmation.
        compose.onNodeWithText("Edit").performClick()
        compose.waitForIdle()
        save("app-12-session-editor")
        compose.onNodeWithTag("focus-field").performTextReplacement("Legs")
        compose.onAllNodesWithText("+").onFirst().performClick()
        compose.waitForIdle()
        // The session editor sits above the scrolling list, so it needs no scroll.
        compose.onNodeWithText("Save").performClick()
        compose.waitForIdle()
        save("app-13-session-edited")
        compose.onNodeWithText("Legs").assertExists()
        // Month-level on purpose: the session is stamped when it is created, so
        // a run that crosses midnight legitimately shows yesterday. A literal
        // day is a test that fails the morning after it was written.
        compose.onNodeWithText("Nov 2026", substring = true).assertExists()

        // A missed set: add one to the exercise it belongs to.
        compose.onNodeWithText("+ Set").performClick()
        compose.waitForIdle()
        save("app-14-add-set")
        compose.onNodeWithText("Add").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onAllNodesWithText("92.5 kg × 4").assertCountEquals(2)

        // A missed exercise, added in one go.
        compose.onNodeWithText("+ Add exercise").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("exercise-name").performTextInput("Leg Press")
        compose.onNodeWithText("Add").performScrollTo().performClick()
        compose.waitForIdle()
        save("app-15-add-exercise")
        compose.onNodeWithText("Leg Press").assertExists()

        // Repeat it: today's session comes back with the same exercises and the
        // same working-set counts, starting at the first one.
        compose.onNodeWithText("Repeat this session").performScrollTo().performClick()
        compose.waitForIdle()
        save("app-16-repeat")
        compose.onNodeWithText("Bench Press").assertExists()
        compose.onNodeWithText("set 1 of 2", substring = true).assertExists()
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
