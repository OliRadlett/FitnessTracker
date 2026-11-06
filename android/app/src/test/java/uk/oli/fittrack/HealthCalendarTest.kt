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
import uk.oli.fittrack.domain.CalendarDay
import uk.oli.fittrack.domain.CalendarEntry
import uk.oli.fittrack.domain.HealthSnapshot
import uk.oli.fittrack.domain.Readiness
import uk.oli.fittrack.domain.RespiratoryRate
import uk.oli.fittrack.domain.SleepConsistency
import uk.oli.fittrack.domain.SleepDebt
import uk.oli.fittrack.ui.health.CalendarScreen
import uk.oli.fittrack.ui.health.HealthScreen
import java.io.File
import java.time.YearMonth

/** Health and the calendar at 360×804. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class HealthCalendarTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val health = HealthSnapshot(
        readiness = Readiness(score = 68.0, level = "yellow", hrvMs = 54.0, restingHr = 52.0),
        sleepDebt = SleepDebt(3.5, 7.4, 4, 8.0, 7),
        respiratoryRate = RespiratoryRate(
            current = 15.2,
            recentAverage = 14.9,
            baselineAverage = 14.8,
            trend = "up"
        ),
        sleepConsistency = SleepConsistency(
            score = 72.0,
            averageBedtime = "23:10",
            spreadMinutes = 34.0,
            daysAnalysed = 6,
            windowDays = 7
        )
    )

    private val month = YearMonth.of(2026, 11)

    private val days = mapOf(
        "2026-11-03" to CalendarDay(
            date = "2026-11-03",
            entries = listOf(
                CalendarEntry("a", "Push day", "WeightTraining", minutes = 52, tss = 40.0, focus = "Push day")
            ),
            recoveryScore = 82.0,
            sleepHours = 7.4
        ),
        "2026-11-05" to CalendarDay(
            date = "2026-11-05",
            entries = listOf(
                CalendarEntry("b", "Evening spin", "Ride", minutes = 62, distanceKm = 24.1, tss = 62.0)
            ),
            recoveryScore = 55.0
        )
    )

    @Test
    fun healthReadsAsFourAnswers() {
        compose.setContent {
            HealthScreen(health = health, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()
        save("health-1")

        compose.onNodeWithText("Health.").assertIsDisplayed()
        compose.onNodeWithText("Moderate").assertIsDisplayed()
        compose.onNodeWithText("Sleep debt 3.5h over 7 days").assertIsDisplayed()
        compose.onNodeWithText("±34 min · in bed around 23:10").assertIsDisplayed()
        compose.onNodeWithText("15.2 br/min · up from 14.8").assertIsDisplayed()
    }

    @Test
    fun healthWithoutADeviceSaysWhatsMissing() {
        compose.setContent {
            HealthScreen(health = HealthSnapshot(), onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("No health data yet.").assertIsDisplayed()
    }

    @Test
    fun theMonthDrawsItsDaysAndOpensOne() {
        compose.setContent {
            CalendarScreen(
                month = month,
                days = days,
                onMonth = {},
                onRefresh = {},
                onBack = {}
            )
        }
        compose.waitForIdle()
        save("calendar-1")

        compose.onNodeWithText("November 2026").assertIsDisplayed()
        compose.onNodeWithText("3").assertIsDisplayed()
        compose.onNodeWithText("5").assertIsDisplayed()

        compose.onNodeWithText("3").performClick()
        compose.waitForIdle()
        save("calendar-2-day")

        compose.onNodeWithText("Tuesday 3 November").assertIsDisplayed()
        compose.onNodeWithText("Push day").assertIsDisplayed()
        compose.onNodeWithText("Recovery 82% · Sleep 7.4h").assertIsDisplayed()
    }

    @Test
    fun aRideDaySaysRidden() {
        compose.setContent {
            CalendarScreen(month = month, days = days, onMonth = {}, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("5").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("1 ride · 24.1 km").assertIsDisplayed()
    }

    @Test
    fun anEmptyMonthSaysSo() {
        compose.setContent {
            CalendarScreen(month = month, days = emptyMap(), onMonth = {}, onRefresh = {}, onBack = {})
        }
        compose.waitForIdle()

        compose.onNodeWithText("Nothing logged this month.").assertIsDisplayed()
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
