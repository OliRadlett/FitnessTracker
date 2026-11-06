package uk.oli.fittrack.domain

/**
 * The AI analysis comes back as markdown — `### Volume`, `**Volume:**`, `* …` —
 * and the app renders plain text, so the markers would be shown literally.
 *
 * This is deliberately not a markdown renderer: the screen needs readable
 * paragraphs, not bold headings. Anything it does not understand is left alone
 * rather than being swallowed, because a missing sentence is worse than a stray
 * character.
 */
object AnalysisText {

    fun plain(markdown: String): String {
        val out = StringBuilder()
        markdown.lines().forEach { rawLine ->
            var line = rawLine.trimEnd()
            // Headings: "### Volume" → "Volume" on its own line.
            line = line.replace(Regex("^#{1,6}\\s*"), "")
            // Bullets: "* thing" / "- thing" → "· thing".
            line = line.replace(Regex("^\\s*[*-]\\s+"), "· ")
            // Emphasis: **bold** / __bold__ / *italic* → the words alone.
            line = line.replace("**", "").replace("__", "")
            line = line.replace(Regex("(?<!\\*)\\*(?!\\*)"), "")
            // Inline code ticks read as noise on a phone.
            line = line.replace("`", "")
            out.append(line).append('\n')
        }
        // Collapse the blank-line runs markdown loves but a phone does not need.
        return out.toString()
            .replace(Regex("\n{3,}"), "\n\n")
            .trim()
    }
}
