package uk.oli.fittrack

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import uk.oli.fittrack.domain.GoalProgress
import uk.oli.fittrack.domain.LoadPoint
import uk.oli.fittrack.domain.Readiness
import uk.oli.fittrack.domain.SleepDebt
import uk.oli.fittrack.domain.TodayDone
import uk.oli.fittrack.domain.TrainingLoad
import uk.oli.fittrack.domain.WeekSummary
import uk.oli.fittrack.ui.theme.Tokens
import uk.oli.fittrack.ui.today.DashboardPlaceholder
import uk.oli.fittrack.ui.today.GoalsCard
import uk.oli.fittrack.ui.today.LoadCard
import uk.oli.fittrack.ui.today.ReadinessCard
import uk.oli.fittrack.ui.today.TodayDoneCard
import uk.oli.fittrack.ui.today.WeekCard
import uk.oli.fittrack.ui.today.RecentCard
import java.io.File

/**
 * The dashboard's cards, at the phone's real width (360×804 dp).
 *
 * These render the cards directly rather than through the app: the data comes
 * from four endpoints, and a Robolectric activity cannot be signed in.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h804dp-xxhdpi")
class DashboardCardsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun points(count: Int = 42): List<LoadPoint> = (1..count).map { day ->
        LoadPoint(
            date = "2026-10-%02d".format(day.coerceAtMost(28)),
            tss = if (day % 3 == 0) 60.0 else 0.0,
            ctl = 40.0 + day / 4.0,
            atl = 38.0 + day / 3.0,
            tsb = day - 20.0
        )
    }

    @Test
    fun loadCardSaysWhatTheNumbersMean() {
        compose.setContent {
            Column(Modifier.padding(16.dp)) {
                LoadCard(
                    TrainingLoad(
                        ctl = 43.4,
                        atl = 40.2,
                        tsb = -12.0,
                        points = points()
                    )
                )
            }
        }
        compose.waitForIdle()
        save("dash-1-load")

        compose.onNodeWithText("FITNESS · FATIGUE · FORM").assertIsDisplayed()
        compose.onNodeWithText("CTL").assertIsDisplayed()
        compose.onNodeWithText("TSB").assertIsDisplayed()
        // -12 is productive work, not damage.
        compose.onNodeWithText("Productive").assertIsDisplayed()
    }

    @Test
    fun todaySoFarShowsWhatHasBeenDone() {
        compose.setContent {
            Column(Modifier.padding(16.dp)) {
                TodayDoneCard(
                    TodayDone(
                        tss = 62.0,
                        volumeKg = 5326.0,
                        distanceMeters = 24100.0,
                        durationSeconds = 4320,
                        activities = 1,
                        sessions = 1
                    )
                )
            }
        }
        compose.waitForIdle()
        save("dash-2-done")

        compose.onNodeWithText("TODAY SO FAR").assertIsDisplayed()
        compose.onNodeWithText("TSS").assertIsDisplayed()
        compose.onNodeWithText("1 session · 1 activity").assertIsDisplayed()
    }

    @Test
    fun readinessWithoutWhoopIsHonest() {
        compose.setContent {
            Column(Modifier.padding(16.dp)) {
                ReadinessCard(
                    Readiness(
                        score = null,
                        level = "unknown",
                        message = "No recovery data available. Connect Whoop to get readiness scores."
                    ),
                    sleep = SleepDebt(
                        debtHours = 3.5,
                        averageHours = 7.4,
                        daysBelowTarget = 4,
                        targetHours = 8.0,
                        windowDays = 7
                    )
                )
            }
        }
        compose.waitForIdle()
        save("dash-3-readiness-empty")

        compose.onNodeWithText("READINESS").assertIsDisplayed()
        compose.onNodeWithText("Unknown").assertIsDisplayed()
        compose.onNodeWithText(
            "No recovery data available. Connect Whoop to get readiness scores."
        ).assertIsDisplayed()
        // The sleep line still works without a recovery score.
        compose.onNodeWithText("Sleep debt 3.5h over 7 days (avg 7.4h)").assertIsDisplayed()
    }

    @Test
    fun readinessWithDataShowsTheNumbers() {
        compose.setContent {
            Column(Modifier.padding(16.dp)) {
                ReadinessCard(
                    Readiness(score = 68.0, level = "yellow", hrvMs = 54.0, restingHr = 52.0),
                    sleep = null
                )
            }
        }
        compose.waitForIdle()
        save("dash-4-readiness")

        compose.onNodeWithText("Moderate").assertIsDisplayed()
        compose.onNodeWithText("RECOVERY").assertIsDisplayed()
        compose.onNodeWithText("HRV").assertIsDisplayed()
    }

    @Test
    fun goalsShowProgressFromTheStartValue() {
        compose.setContent {
            Column(Modifier.padding(16.dp)) {
                GoalsCard(
                    listOf(
                        GoalProgress(
                            id = "g1",
                            metric = "weight_kg",
                            target = 80.0,
                            current = 88.9,
                            starting = 92.0,
                            targetDate = "2026-12-31"
                        ),
                        GoalProgress(
                            id = "g2",
                            metric = "fitness_ctl",
                            target = 60.0,
                            current = 45.0
                        )
                    )
                )
            }
        }
        compose.waitForIdle()
        save("dash-5-goals")

        compose.onNodeWithText("GOALS").assertIsDisplayed()
        compose.onNodeWithText("weight_kg").assertIsDisplayed()
        compose.onNodeWithText("88.9 → 80").assertIsDisplayed()
    }

    @Test
    fun theWeekCountsBothSports() {
        compose.setContent {
            Column(Modifier.padding(16.dp)) {
                WeekCard(
                    WeekSummary(
                        sessions = 3,
                        rides = 2,
                        volumeKg = 15500.0,
                        distanceKm = 61.4,
                        tss = 210.0,
                        daysTrained = 5
                    )
                )
            }
        }
        compose.waitForIdle()
        save("dash-6-week")

        compose.onNodeWithText("THIS WEEK").assertIsDisplayed()
        compose.onNodeWithText("5 days trained").assertIsDisplayed()
        compose.onNodeWithText("RIDES").assertIsDisplayed()
        compose.onNodeWithText("61.4").assertIsDisplayed()
        compose.onNodeWithText("210").assertIsDisplayed()
    }

    @Test
    fun thePlaceholderSaysItIsLoading() {
        compose.setContent { DashboardPlaceholder("Loading your dashboard…") }
        compose.waitForIdle()

        compose.onNodeWithText("Loading your dashboard…").assertIsDisplayed()
    }

    @Test
    fun recentMergesLiftsAndRidesNewestFirst() {
        val history = listOf(
            uk.oli.fittrack.domain.FinishedSession(
                id = "s1",
                planTitle = "Push day",
                startedAt = at("2026-11-05"),
                endedAt = at("2026-11-05"),
                sets = listOf(
                    uk.oli.fittrack.domain.LoggedSet(
                        "Bench Press", 100.0, 5, null, at("2026-11-05")
                    )
                )
            )
        )
        val rides = listOf(
            uk.oli.fittrack.domain.Ride(
                id = "r1",
                name = "Evening spin",
                source = "strava",
                sportType = "Ride",
                startedAt = at("2026-11-06"),
                durationSeconds = 3600,
                distanceMeters = 24_100.0,
                elevationGainMeters = 100.0
            )
        )

        compose.setContent {
            Column(Modifier.padding(16.dp)) { RecentCard(history, rides) }
        }
        compose.waitForIdle()
        save("dash-7-recent")

        compose.onNodeWithText("RECENT").assertIsDisplayed()
        compose.onNodeWithText("Evening spin").assertIsDisplayed()
        compose.onNodeWithText("Push day").assertIsDisplayed()
        compose.onNodeWithText("24.1 km · 1h 0m").assertIsDisplayed()
    }

    private fun at(date: String): Long =
        java.time.LocalDate.parse(date).atTime(18, 0)
            .atZone(java.time.ZoneId.of("Europe/London")).toInstant().toEpochMilli()

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
