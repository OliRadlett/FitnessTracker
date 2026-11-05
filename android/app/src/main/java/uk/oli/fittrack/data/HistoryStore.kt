package uk.oli.fittrack.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import uk.oli.fittrack.domain.FinishedSession
import java.io.File

/**
 * Finished sessions, newest first, capped.
 *
 * Same seam as SessionStore: a file until the log needs queries, at which point
 * this class is what changes, not the screens.
 */
class HistoryStore(filesDir: File) {

    private val file = File(filesDir, "history.json")
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun load(): List<FinishedSession> = runCatching {
        if (!file.exists()) return emptyList()
        json.decodeFromString<List<FinishedSession>>(file.readText())
    }.getOrDefault(emptyList())

    fun save(sessions: List<FinishedSession>) {
        runCatching { file.writeText(json.encodeToString(sessions.take(MAX))) }
    }

    companion object {
        const val MAX = 200
    }
}
