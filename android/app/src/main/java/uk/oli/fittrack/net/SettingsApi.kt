package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import uk.oli.fittrack.domain.Connection
import uk.oli.fittrack.domain.Preferences
import uk.oli.fittrack.domain.SettingsSnapshot
import java.time.OffsetDateTime
import java.util.concurrent.TimeUnit

@Serializable
private data class PreferencesDto(
    val unit_system: String = "metric",
    val locale: String = "en-GB",
    val time_format: String = "24h",
    val height_cm: Double? = null
)

@Serializable
private data class ConnectionDto(
    val id: String = "",
    val provider: String = "",
    val status: String = "active",
    val last_synced_at: String? = null,
    val last_error: String? = null,
    val consecutive_failures: Int = 0
)

internal object SettingsJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun preferences(body: String): Preferences? = runCatching {
        json.decodeFromString<PreferencesDto>(body)
    }.getOrNull()?.let {
        Preferences(
            unitSystem = it.unit_system.ifBlank { "metric" },
            locale = it.locale.ifBlank { "en-GB" },
            timeFormat = it.time_format.ifBlank { "24h" },
            heightCm = it.height_cm
        )
    }

    fun connections(body: String): List<Connection> = runCatching {
        json.decodeFromString<List<ConnectionDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        if (dto.provider.isBlank()) return@mapNotNull null
        Connection(
            id = dto.id,
            provider = dto.provider,
            status = dto.status.ifBlank { "active" },
            lastSyncedAt = dto.last_synced_at?.let { raw ->
                runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
            },
            lastError = dto.last_error?.takeIf { it.isNotBlank() },
            consecutiveFailures = dto.consecutive_failures
        )
    }

    fun patchBody(
        unitSystem: String?,
        timeFormat: String?,
        heightCm: Double?
    ): String = buildJsonObject {
        unitSystem?.let { put("unit_system", it) }
        timeFormat?.let { put("time_format", it) }
        heightCm?.let { put("height_cm", it) }
    }.toString()
}

/**
 * Settings: how the numbers are written, and whether the connections carrying
 * them are healthy.
 *
 * The phone can change the two preferences that change what it shows (units and
 * clock), and can see every connection's last sync and last error. It cannot
 * authorise a provider — that is an OAuth browser flow, and the website is where
 * it belongs.
 */
class SettingsApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    private fun builder(path: String, token: String) = Request.Builder()
        .url("$baseUrl$path")
        .header("Authorization", "Bearer $token")

    private fun execute(request: Request): String? =
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }

    suspend fun preferences(token: String): Preferences? = withContext(Dispatchers.IO) {
        execute(builder("/preferences", token).get().build())?.let(SettingsJson::preferences)
    }

    suspend fun connections(token: String): List<Connection> = withContext(Dispatchers.IO) {
        execute(builder("/connections/", token).get().build())
            ?.let(SettingsJson::connections).orEmpty()
    }

    suspend fun updatePreferences(
        token: String,
        unitSystem: String? = null,
        timeFormat: String? = null,
        heightCm: Double? = null
    ): Preferences? = withContext(Dispatchers.IO) {
        val body = SettingsJson.patchBody(unitSystem, timeFormat, heightCm)
            .toRequestBody(jsonType)
        execute(builder("/preferences", token).patch(body).build())
            ?.let(SettingsJson::preferences)
    }

    suspend fun snapshot(token: String): SettingsSnapshot = coroutineScope {
        val prefs = async { runCatching { preferences(token) }.getOrNull() }
        val conns = async { runCatching { connections(token) }.getOrNull().orEmpty() }
        SettingsSnapshot(preferences = prefs.await(), connections = conns.await())
    }
}
