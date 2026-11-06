package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The plate arithmetic, tested without a screen: what goes on each end of the
 * bar is the one number a lifter checks against the rack in front of them.
 */
class PlateMathTest {

    @Test
    fun `100 kg on a 20 kg bar is 25 and 15 a side`() {
        val load = PlateMath.loadout(100.0, 20.0)

        assertEquals(listOf(25.0, 15.0), load.perSide)
        assertEquals(0.0, load.shortfallKg, 0.001)
        assertEquals("25 · 15", load.describe())
    }

    @Test
    fun `92 point 5 uses the small plates`() {
        val load = PlateMath.loadout(92.5, 20.0)

        assertEquals(listOf(25.0, 10.0, 1.25), load.perSide)
        assertEquals(0.0, load.shortfallKg, 0.001)
    }

    @Test
    fun `a 15 kg bar changes the loadout`() {
        val load = PlateMath.loadout(60.0, 15.0)

        assertEquals(listOf(20.0, 2.5), load.perSide)
        assertEquals("20 · 2.5", load.describe())
    }

    @Test
    fun `an empty bar has no plates`() {
        assertEquals("empty bar", PlateMath.loadout(20.0, 20.0).describe())
    }

    @Test
    fun `a total under the bar is a shortfall, not a negative plate`() {
        val load = PlateMath.loadout(17.5, 20.0)

        assertTrue(load.perSide.isEmpty())
        assertEquals(1.25, load.shortfallKg, 0.001)
        assertEquals("short 1.25 kg", load.describe())
    }

    @Test
    fun `an unmakeable total reports what is missing`() {
        // 40.125 kg a side: the smallest plate is 0.5, so 0.125 is unmakeable.
        val load = PlateMath.loadout(100.25, 20.0)

        assertEquals(listOf(25.0, 15.0), load.perSide)
        assertEquals(0.125, load.shortfallKg, 0.001)
        assertTrue(load.describe().endsWith("(short 0.125 kg)"))
    }

    @Test
    fun `plates are loaded biggest first regardless of the rack order`() {
        val load = PlateMath.loadout(100.0, 20.0, plates = listOf(2.5, 25.0, 15.0))

        assertEquals(listOf(25.0, 15.0), load.perSide)
    }
}
