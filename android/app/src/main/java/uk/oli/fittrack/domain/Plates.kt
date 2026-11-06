package uk.oli.fittrack.domain

/**
 * What to put on each end of the bar.
 *
 * Pure arithmetic so it can be tested without a screen, and greedy on purpose:
 * a real lifter loads biggest plates first, and a calculator that "optimises"
 * into a different combination would not match the rack in front of you.
 */
object PlateMath {

    /** The plates a normal gym has, in the order you load them. */
    val PLATES_KG = listOf(25.0, 20.0, 15.0, 10.0, 5.0, 2.5, 1.25, 0.5)

    const val DEFAULT_BAR_KG = 20.0
    const val LIGHT_BAR_KG = 15.0

    data class Loadout(
        /** Biggest first, one side of the bar. */
        val perSide: List<Double>,
        /** Weight the plates cannot make up, in kg. Zero when the load is exact. */
        val shortfallKg: Double
    ) {
        val plateKg: Double get() = perSide.sum()

        fun describe(): String = when {
            perSide.isEmpty() && shortfallKg == 0.0 -> "empty bar"
            perSide.isEmpty() -> "short ${format(shortfallKg)} kg"
            else -> perSide.joinToString(" · ") { format(it) } +
                if (shortfallKg > 0.0) " (short ${format(shortfallKg)} kg)" else ""
        }

        private fun format(value: Double): String =
            if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()
    }

    /**
     * Plates for [totalKg] including [barKg]. A total under the bar is a
     * shortfall, not a negative plate.
     */
    fun loadout(
        totalKg: Double,
        barKg: Double = DEFAULT_BAR_KG,
        plates: List<Double> = PLATES_KG
    ): Loadout {
        val perSideTarget = (totalKg - barKg) / 2.0
        if (perSideTarget <= 0.0) {
            return Loadout(emptyList(), shortfallKg = if (perSideTarget < 0.0) -perSideTarget else 0.0)
        }

        var remaining = perSideTarget
        val chosen = mutableListOf<Double>()
        for (plate in plates.sortedDescending()) {
            // 0.01 kg tolerance: the totals are doubles, not exact decimals.
            while (remaining + 0.01 >= plate) {
                chosen.add(plate)
                remaining -= plate
            }
        }
        return Loadout(chosen, shortfallKg = if (remaining > 0.01) remaining else 0.0)
    }
}
