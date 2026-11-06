package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class HealthApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: HealthApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = HealthApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `breathing decodes with its baseline`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"current_rr":15.2,"recent_avg_rr":14.9,"baseline_avg_rr":14.8,
                    "trend":"up","date":"2026-11-06"}"""
            )
        )

        val rr = runBlocking { api.respiratoryRate("tok") }!!

        assertEquals("/metrics/respiratory-rate", server.takeRequest().path)
        assertEquals(15.2, rr.current!!, 0.001)
        assertEquals(14.8, rr.baselineAverage!!, 0.001)
        assertEquals("up", rr.trend)
        assertEquals("15.2 br/min · up from 14.8", rr.describe())
    }

    @Test
    fun `a breathing payload with no numbers is no reading`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""{"date":"2026-11-06"}"""))

        assertNull(runBlocking { api.respiratoryRate("tok") })
    }

    @Test
    fun `sleep consistency decodes`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"consistency_score":72,"avg_bedtime":"23:10","std_minutes":34,
                    "days_analyzed":6,"window_days":7}"""
            )
        )

        val sleep = runBlocking { api.sleepConsistency("tok") }!!

        assertEquals("/metrics/sleep-consistency?days=7", server.takeRequest().path)
        assertEquals(72.0, sleep.score!!, 0.001)
        assertEquals("23:10", sleep.averageBedtime)
        assertEquals(6, sleep.daysAnalysed)
    }

    @Test
    fun `the calendar groups activities and metrics by date`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{
                  "activities":[
                    {"id":"a1","date":"2026-11-03","sport_type":"WeightTraining",
                     "name":"Push day","duration_seconds":3120,"focus":"Push day","tss":40.0},
                    {"id":"a2","date":"2026-11-05","sport_type":"Ride","name":"Evening spin",
                     "duration_seconds":3720,"distance_meters":24100.0,"tss":62.0}
                  ],
                  "daily_metrics":[
                    {"date":"2026-11-03","recovery_score":82,"hrv_ms":60.0,"resting_hr":50,
                     "sleep_duration_minutes":444},
                    {"date":"2026-11-04","recovery_score":55,"hrv_ms":48.0}
                  ]
                }"""
            )
        )

        val days = runBlocking { api.calendar("tok", "2026-11-01", "2026-11-30") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals(
            "/activities/calendar?start_date=2026-11-01&end_date=2026-11-30",
            request.path
        )

        assertEquals(3, days.size)
        val third = days["2026-11-03"]!!
        assertEquals(1, third.entries.size)
        assertTrue(third.hasLift)
        assertEquals(52, third.entries.first().minutes)
        assertEquals(82.0, third.recoveryScore!!, 0.001)
        assertEquals(7.4, third.sleepHours!!, 0.001)
        // A day with only recovery data still exists in the month.
        assertEquals(55.0, days["2026-11-04"]!!.recoveryScore!!, 0.001)
        assertTrue(days["2026-11-04"]!!.entries.isEmpty())
        // A ride is not a lift.
        assertTrue(days["2026-11-05"]!!.hasRide)
        assertTrue(!days["2026-11-05"]!!.hasLift)
        assertEquals(24.1, days["2026-11-05"]!!.entries.first().distanceKm, 0.001)
    }

    @Test
    fun `a failed calendar is an empty month rather than a crash`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        assertTrue(runBlocking { api.calendar("tok", "2026-11-01", "2026-11-30") }.isEmpty())
    }

    @Test
    fun `a malformed calendar is an empty month`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))

        assertTrue(runBlocking { api.calendar("tok", "2026-11-01", "2026-11-30") }.isEmpty())
    }

    @Test
    fun `the health snapshot keeps the dashboard's readiness and sleep debt`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"current_rr":15.2,"recent_avg_rr":14.9,"baseline_avg_rr":14.8,"trend":"up"}"""
            )
        )
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"consistency_score":72,"avg_bedtime":"23:10","std_minutes":34,
                    "days_analyzed":6,"window_days":7}"""
            )
        )

        val readiness = uk.oli.fittrack.domain.Readiness(score = 68.0, level = "yellow")
        val debt = uk.oli.fittrack.domain.SleepDebt(3.5, 7.4, 4, 8.0, 7)

        val snapshot = runBlocking { api.snapshot("tok", readiness, debt) }

        assertEquals(68.0, snapshot.readiness!!.score!!, 0.001)
        assertEquals(3.5, snapshot.sleepDebt!!.debtHours, 0.001)
        assertEquals(15.2, snapshot.respiratoryRate!!.current!!, 0.001)
        assertEquals(72.0, snapshot.sleepConsistency!!.score!!, 0.001)
        assertTrue(!snapshot.isEmpty)
    }
}
