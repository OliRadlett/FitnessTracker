package uk.oli.fittrack.net

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

class RoutesApiTest {

    private lateinit var server: MockWebServer
    private lateinit var api: RoutesApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = RoutesApi(server.url("/").toString().trimEnd('/'))
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `routes decode with their shape and stats`() {
        server.enqueue(
            MockResponse().setResponseCode(200).setBody(
                """[
                  {"id":"r1","name":"Coast loop","sport_type":"Ride","distance_meters":41200,
                   "elevation_gain_meters":540,"is_loop":true,"is_favorite":true,
                   "is_ridden":true,"ride_count":3,"locality":"Brighton","country":"GB",
                   "quality_score":78.4,
                   "terrain_classification":{"terrain":"hilly"},
                   "surface_profile":{"dominant":"tarmac"},
                   "preview_polyline":"_p~iF~ps|U_ulLnnqC_mqNvxq`@"},
                  {"id":"r2","name":"No shape","distance_meters":10000}
                ]"""
            )
        )

        val routes = runBlocking { api.routes("tok") }

        val request = server.takeRequest(5, TimeUnit.SECONDS)!!
        assertEquals("/routes?limit=100&sort_by=distance", request.path)
        assertEquals("Bearer tok", request.getHeader("Authorization"))

        assertEquals(2, routes.size)
        val loop = routes.first()
        assertEquals("Coast loop", loop.name)
        assertEquals(41.2, loop.distanceKm, 0.001)
        assertTrue(loop.isLoop && loop.isFavourite && loop.isRidden)
        assertEquals(3, loop.rideCount)
        assertEquals("Brighton, GB", loop.where)
        assertEquals("hilly", loop.terrain)
        assertEquals("tarmac", loop.surface)
        // The shape is decoded, not carried as a string.
        assertEquals(3, loop.shape.size)
        assertEquals(38.5, loop.shape.first().lat, 1e-5)
        // A route with no shape is still a route.
        assertTrue(routes[1].shape.isEmpty())
    }

    @Test
    fun `a failed request is no routes rather than a crash`() {
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))

        assertTrue(runBlocking { api.routes("tok") }.isEmpty())
    }

    @Test
    fun `a malformed body is no routes`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("not json"))

        assertTrue(runBlocking { api.routes("tok") }.isEmpty())
    }

    @Test
    fun `a route with no id is dropped`() {
        server.enqueue(MockResponse().setResponseCode(200).setBody("""[{"name":"Nameless"}]"""))

        assertTrue(runBlocking { api.routes("tok") }.isEmpty())
    }
}
