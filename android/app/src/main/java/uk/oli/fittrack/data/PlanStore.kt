package uk.oli.fittrack.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import uk.oli.fittrack.domain.Plan
import java.io.File

/**
 * The plan the app prescribes. Editable on the phone until the training-plan API
 * is wired up, at which point this becomes the offline copy rather than the
 * source.
 */
class PlanStore(filesDir: File) {

    private val file = File(filesDir, "plan.json")
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun load(): Plan? = runCatching {
        if (!file.exists()) return null
        json.decodeFromString<Plan>(file.readText())
    }.getOrNull()

    fun save(plan: Plan) {
        runCatching { file.writeText(json.encodeToString(plan)) }
    }
}
