package uk.oli.fittrack.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class AnalysisTextTest {

    @Test
    fun `headings lose their hashes`() {
        val plain = AnalysisText.plain("### Volume & Intensity Assessment\ntext")

        assertEquals("Volume & Intensity Assessment\ntext", plain)
    }

    @Test
    fun `bold and italics lose their markers but keep the words`() {
        val plain = AnalysisText.plain("At **360 kg** this was an *outlier*.")

        assertEquals("At 360 kg this was an outlier.", plain)
    }

    @Test
    fun `bullets become dots a phone can read`() {
        val plain = AnalysisText.plain("* **Volume:** extreme\n- **Intensity:** moderate")

        assertEquals("· Volume: extreme\n· Intensity: moderate", plain)
    }

    @Test
    fun `backticks go and paragraph runs collapse`() {
        val plain = AnalysisText.plain("Use `RPE 8`.\n\n\n\nNext paragraph.")

        assertEquals("Use RPE 8.\n\nNext paragraph.", plain)
    }

    @Test
    fun `text with no markdown is returned sentence for sentence`() {
        val body = "Solid session.\nOne set, eight minutes."

        assertEquals(body, AnalysisText.plain(body))
    }

    @Test
    fun `an empty analysis stays empty rather than becoming a newline`() {
        assertEquals("", AnalysisText.plain("   \n\n  "))
    }
}
