package uk.oli.fittrack.domain

import java.util.Locale

/**
 * One computed insight.
 *
 * `data` is whatever the server put in it for this insight type — different keys
 * per type — so it stays an ordered list of scalars rather than a modelled
 * shape. The phone shows them; it does not interpret them.
 */
data class Insight(
    val type: String,
    val period: String = "",
    val confidence: String = "",
    val sampleSize: Int = 0,
    val data: List<Pair<String, String>> = emptyList()
) {
    /** "Sleep performance", "Load ramp" — the type as a heading. */
    val title: String
        get() = when (type) {
            "sleep_performance" -> "Sleep and performance"
            "load_ramp" -> "Load ramp"
            "deload_effect" -> "Deload effect"
            "cross_sport" -> "Cross-sport transfer"
            "consistency" -> "Consistency"
            "recovery_trend" -> "Recovery trend"
            "body_composition" -> "Body composition"
            else -> type.replace('_', ' ').replaceFirstChar { it.uppercase(Locale.UK) }
        }

    val hasData: Boolean get() = data.isNotEmpty()

    /** "high confidence · 42 samples", or whichever half exists. */
    fun meta(): String = listOfNotNull(
        confidence.takeIf { it.isNotBlank() }?.let { "$it confidence" },
        sampleSize.takeIf { it > 0 }?.let { "$it samples" },
        period.takeIf { it.isNotBlank() }?.let { "over $it" }
    ).joinToString(" · ")

    /** Colour band for the confidence chip. */
    val confidenceLevel: Confidence
        get() = when (confidence.lowercase(Locale.UK)) {
            "high" -> Confidence.High
            "medium", "moderate" -> Confidence.Medium
            "low" -> Confidence.Low
            else -> Confidence.Unknown
        }
}

enum class Confidence { High, Medium, Low, Unknown }

/** "sleep_performance" → "Sleep performance" for a key inside `data`. */
fun dataLabel(key: String): String =
    key.replace('_', ' ').replaceFirstChar { it.uppercase(Locale.UK) }

/** Insights with data first, then by title — an empty one teaches nothing. */
fun orderInsights(items: List<Insight>): List<Insight> =
    items.sortedWith(compareByDescending<Insight> { it.hasData }.thenBy { it.title })
