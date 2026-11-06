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
import java.time.LocalDate
import java.util.concurrent.TimeUnit

class ActivitiesApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: ActivitiesApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = ActivitiesApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `the feed decodes its rows and skips ones with no start date`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"a1","name":"Coast ride","source":"strava","sport_type":"Ride",
                   "start_date":"2026-11-01T09:00:00+00:00","duration_seconds":11520,
                   "distance_meters":55600.0,"elevation_gain_meters":400.0,
                   "average_power":180.0,"average_heartrate":142.0,"tss":118.0,
                   "purpose":"endurance","ride_type":"threshold","route_name":"Coast loop",
                   "linked_lifting_session":null},
                  {"id":"a2","name":"No date","sport_type":"Ride"},
                  {"id":"a3","name":"Push day","sport_type":"WeightTraining",
                   "start_date":"2026-11-03T18:00:00+00:00","duration_seconds":3120,
                   "linked_lifting_session":{"id":"l1","focus":"Push","total_volume_kg":5326}}
                ]"""
            )
        )

        val feed = runBlocking { api.list("tok") }

        assertEquals("/activities?limit=50", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals(listOf("a1", "a3"), feed.map { it.id })
        assertEquals(55.6, feed.first().distanceKm, 0.001)
        assertEquals("endurance", feed.first().purpose)
        assertEquals("Coast loop", feed.first().routeName)
        assertEquals("Push", feed.last().linkedLift!!.focus)
        assertTrue(feed.last().isLift)
    }

    @Test
    fun `filters go into the query, and a search is URL-encoded`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))

        runBlocking {
            api.list(
                token = "tok",
                sport = "Ride",
                search = "coast loop",
                after = LocalDate.parse("2026-08-01"),
                limit = 20
            )
        }

        val path = server.takeRequest(5, TimeUnit.SECONDS)!!.path!!
        assertTrue(path.contains("limit=20"))
        assertTrue(path.contains("sport_type=Ride"))
        assertTrue(path.contains("q=coast+loop"))
        assertTrue(path.contains("start_date_after=2026-08-01T00:00:00Z"))
    }

    @Test
    fun `the detail decodes the shape and the streams flag`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"id":"a1","name":"Coast ride","sport_type":"Ride",
                    "start_date":"2026-11-01T09:00:00+00:00","duration_seconds":11520,
                    "distance_meters":55600.0,"has_streams":true,
                    "encoded_polyline":"_p~iF~ps|U_ulLnnqC_mqNvxq`@",
                    "notes":"Windy"}"""
            )
        )

        val detail = runBlocking { api.detail("tok", "a1") }!!

        assertEquals("/activities/a1", server.takeRequest(5, TimeUnit.SECONDS)!!.path)
        assertEquals(3, detail.shape.size)
        assertTrue(detail.canDraw)
        assertTrue(detail.hasStreams)
        assertEquals("Windy", detail.notes)
    }

    @Test
    fun `an activity with no polyline has no shape, and is still a detail`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """{"id":"a1","name":"Push day","sport_type":"WeightTraining",
                    "start_date":"2026-11-03T18:00:00+00:00"}"""
            )
        )

        val detail = runBlocking { api.detail("tok", "a1") }!!

        assertTrue(detail.shape.isEmpty())
        assertTrue(!detail.canDraw)
    }

    @Test
    fun `failures are empty and null rather than crashes`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))

        assertTrue(runBlocking { api.list("tok") }.isEmpty())
        assertNull(runBlocking { api.detail("tok", "a1") })
        assertTrue(runBlocking { api.list("tok") }.isEmpty())
    }
}
