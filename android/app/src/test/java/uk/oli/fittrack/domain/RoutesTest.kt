package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutesTest {

    private fun route(
        id: String = "r1",
        km: Double = 40.0,
        loop: Boolean = false,
        ridden: Boolean = false,
        favourite: Boolean = false,
        terrain: String? = null,
        elevation: Double = 0.0,
        rideCount: Int = 0,
        locality: String? = null,
        country: String? = null
    ) = BikeRoute(
        id = id,
        name = "Route $id",
        sportType = "Ride",
        distanceMeters = km * 1000,
        elevationMeters = elevation,
        isLoop = loop,
        isRidden = ridden,
        isFavourite = favourite,
        rideCount = rideCount,
        locality = locality,
        country = country,
        terrain = terrain
    )

    @Test
    fun `the line under a name carries terrain, distance and climb`() {
        assertEquals("Hilly · 40.0 km · 540 m", route(terrain = "hilly", elevation = 540.0).describe())
        // No terrain and no climb: no stray separators.
        assertEquals("12.0 km", route(km = 12.0).describe())
    }

    @Test
    fun `where drops a duplicate locality and country`() {
        assertEquals("Brighton, GB", route(locality = "Brighton", country = "GB").where)
        assertEquals("", route().where)
    }

    @Test
    fun `filters are what they say`() {
        val routes = listOf(
            route(id = "a", loop = true, ridden = true),
            route(id = "b", loop = false, ridden = false),
            route(id = "c", favourite = true, ridden = true)
        )

        assertEquals(listOf("a", "b", "c"), filterRoutes(routes, RouteFilter.All).map { it.id })
        assertEquals(listOf("a"), filterRoutes(routes, RouteFilter.Loops).map { it.id })
        assertEquals(listOf("b"), filterRoutes(routes, RouteFilter.Unridden).map { it.id })
        assertEquals(listOf("c"), filterRoutes(routes, RouteFilter.Favourites).map { it.id })
    }

    @Test
    fun `favourites come first, then the longest`() {
        val routes = listOf(
            route(id = "short", km = 10.0),
            route(id = "long", km = 80.0),
            route(id = "starred", km = 20.0, favourite = true)
        )

        assertEquals(listOf("starred", "long", "short"), orderRoutes(routes).map { it.id })
    }

    @Test
    fun `ride history reads as words`() {
        assertEquals("Never ridden", routeHistory(route(rideCount = 0)))
        assertEquals("Ridden once", routeHistory(route(rideCount = 1)))
        assertEquals("Ridden 7 times", routeHistory(route(rideCount = 7)))
    }

    @Test
    fun `a route with one point still describes itself`() {
        val thin = route().copy(shape = listOf(LatLng(51.5, -0.1)))

        assertTrue(thin.describe().isNotEmpty())
        assertEquals(40.0, thin.distanceKm, 0.001)
    }
}
