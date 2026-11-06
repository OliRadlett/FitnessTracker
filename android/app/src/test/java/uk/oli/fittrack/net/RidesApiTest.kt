package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * `GET /activities` answers a bare array of `ActivityRead`s with an
 * `X-Total-Count`, unfiltered by sport — the app keeps the rides.
 */
class RidesApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: RidesApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = RidesApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `rides are kept and everything else dropped`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"a1","name":"Evening spin","source":"strava","sport_type":"Ride",
                   "start_date":"2026-11-05T18:00:00+00:00","duration_seconds":3720,
                   "distance_meters":24100.0,"elevation_gain_meters":180.0,
                   "average_power":210.0,"tss":62.0},
                  {"id":"a2","name":"Lunch run","source":"strava","sport_type":"Run",
                   "start_date":"2026-11-04T12:00:00+00:00","duration_seconds":1800},
                  {"id":"a3","name":"Trainer","source":"wahoo","sport_type":"VirtualRide",
                   "start_date":"2026-11-03T07:00:00+00:00","duration_seconds":3600,
                   "distance_meters":30000.0},
                  {"id":"a4","name":"No date","source":"strava","sport_type":"Ride"}
                ]"""
            )
        )

        val rides = runBlocking { api.rides("tok") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/activities?limit=40&sort_by=start_date", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))

        assertEquals(listOf("a1", "a3"), rides.map { it.id })
        assertEquals(24.1, rides[0].distanceKm, 0.001)
        assertEquals(210.0, rides[0].averagePower!!, 0.001)
        assertEquals(62.0, rides[0].tss!!, 0.001)
        // A ride with no start date cannot be placed in time, so it is dropped.
        assertTrue(rides.none { it.id == "a4" })
    }

    @Test
    fun `rides come back newest first even if the server does not sort`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"old","sport_type":"Ride","start_date":"2026-10-01T09:00:00+00:00"},
                  {"id":"new","sport_type":"Ride","start_date":"2026-11-01T09:00:00+00:00"}
                ]"""
            )
        )

        assertEquals(listOf("new", "old"), runBlocking { api.rides("tok") }.map { it.id })
    }

    @Test
    fun `the window filter is sent as an ISO instant`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))

        runBlocking { api.rides("tok", limit = 10, after = LocalDate.parse("2026-10-30")) }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertTrue(request.path!!.contains("limit=10"))
        assertTrue(request.path!!.contains("start_date_after=2026-10-30T00:00:00Z"))
    }

    @Test
    fun `an empty list is no rides, not an error`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("[]"))

        assertTrue(runBlocking { api.rides("tok") }.isEmpty())
    }

    @Test
    fun `a failed request throws so the screen can fall back`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        val error = runCatching { runBlocking { api.rides("tok") } }.exceptionOrNull()

        assertTrue(error is ApiException)
        assertEquals(500, (error as ApiException).status)
    }

    @Test
    fun `a sport type is a ride by its words, not an exact match`() {
        assertTrue(RideJson.isRide("Ride"))
        assertTrue(RideJson.isRide("VirtualRide"))
        assertTrue(RideJson.isRide("EBikeRide"))
        assertTrue(RideJson.isRide("cycling"))
        assertTrue(!RideJson.isRide("Run"))
        assertTrue(!RideJson.isRide("WeightTraining"))
    }
}
