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
import uk.oli.fittrack.domain.Notification
import uk.oli.fittrack.ui.notifications.NotificationsScreen
import java.io.File

/** Notifications at 360×804: unread first, read them, clear them. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class NotificationsScreenTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val now = System.currentTimeMillis()

    private val items = listOf(
        Notification(
            id = "n1",
            type = "health_alert",
            title = "Resting HR is up",
            body = "+8 bpm over your baseline",
            severity = "warning",
            createdAt = now,
            read = false
        ),
        Notification(
            id = "n2",
            type = "pr",
            title = "Deadlift 190 kg",
            body = "",
            createdAt = now - 3_600_000,
            read = true
        )
    )

    @Test
    fun unreadComesFirstAndSaysHowMany() {
        compose.setContent {
            NotificationsScreen(
                items = items,
                onRead = {},
                onReadAll = {},
                onRefresh = {},
                onBack = {}
            )
        }
        compose.waitForIdle()
        save("notifications-1")

        compose.onNodeWithText("Notifications.").assertIsDisplayed()
        compose.onNodeWithText("1 unread").assertIsDisplayed()
        compose.onNodeWithText("Resting HR is up").assertIsDisplayed()
        compose.onNodeWithText("Health").assertIsDisplayed()
        compose.onNodeWithText("Deadlift 190 kg").assertIsDisplayed()
        compose.onNodeWithText("Mark all read").assertIsDisplayed()
    }

    @Test
    fun tappingOneMarksThatOne() {
        var read: String? = null
        compose.setContent {
            NotificationsScreen(
                items = items,
                onRead = { read = it },
                onReadAll = {},
                onRefresh = {},
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("Resting HR is up").performClick()
        compose.waitForIdle()

        assertTrue(read == "n1")
    }

    @Test
    fun theAllReadButtonBecomesRefreshWhenNothingIsUnread() {
        val allRead = items.map { it.copy(read = true) }
        compose.setContent {
            NotificationsScreen(
                items = allRead,
                onRead = {},
                onReadAll = {},
                onRefresh = {},
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("All read").assertIsDisplayed()
        compose.onNodeWithText("Refresh").assertIsDisplayed()
        compose.onNodeWithText("Mark all read").assertDoesNotExist()
    }

    @Test
    fun anEmptyListSaysWhatWouldLandHere() {
        compose.setContent {
            NotificationsScreen(
                items = emptyList(),
                onRead = {},
                onReadAll = {},
                onRefresh = {},
                onBack = {}
            )
        }
        compose.waitForIdle()

        compose.onNodeWithText("Nothing to tell you.").assertIsDisplayed()
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
