package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class InsightsTest {

    private fun insight(
        type: String = "sleep_performance",
        confidence: String = "high",
        samples: Int = 42,
        period: String = "28d",
        data: List<Pair<String, String>> = listOf("correlation" to "0.62")
    ) = Insight(type, period, confidence, samples, data)

    @Test
    fun `types read as headings`() {
        assertEquals("Sleep and performance", insight().title)
        assertEquals("Load ramp", insight(type = "load_ramp").title)
        assertEquals("Body composition", insight(type = "body_composition").title)
        assertEquals("Something new", insight(type = "something_new").title)
    }

    @Test
    fun `meta says what the evidence is`() {
        assertEquals("high confidence · 42 samples · over 28d", insight().meta())
        assertEquals(
            "high confidence",
            insight(samples = 0, period = "").meta()
        )
        // With no confidence, the evidence it does have is still worth saying.
        assertEquals("42 samples · over 28d", insight(confidence = "").meta())
    }

    @Test
    fun `confidence levels map to a band`() {
        assertEquals(Confidence.High, insight(confidence = "high").confidenceLevel)
        assertEquals(Confidence.Medium, insight(confidence = "medium").confidenceLevel)
        assertEquals(Confidence.Medium, insight(confidence = "moderate").confidenceLevel)
        assertEquals(Confidence.Low, insight(confidence = "low").confidenceLevel)
        assertEquals(Confidence.Unknown, insight(confidence = "").confidenceLevel)
    }

    @Test
    fun `data keys read as labels`() {
        assertEquals("Correlation", dataLabel("correlation"))
        assertEquals("Avg sleep hours", dataLabel("avg_sleep_hours"))
    }

    @Test
    fun `insights with data come first, then by title`() {
        val items = listOf(
            insight(type = "load_ramp", data = emptyList()),
            insight(type = "sleep_performance"),
            insight(type = "consistency", data = listOf("weeks" to "13"))
        )

        assertEquals(
            listOf("Consistency", "Sleep and performance", "Load ramp"),
            orderInsights(items).map { it.title }
        )
    }

    @Test
    fun `an insight with no data says nothing rather than showing nothing`() {
        assertTrue(!insight(data = emptyList()).hasData)
        assertTrue(insight().hasData)
    }
}
