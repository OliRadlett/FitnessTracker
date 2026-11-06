package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.Notification
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.OffsetDateTime
import java.util.concurrent.TimeUnit

@Serializable
private data class NotificationDto(
    val id: String = "",
    val type: String = "",
    val title: String = "",
    val body: String = "",
    val severity: String = "info",
    val link: String = "",
    val read: Boolean = false,
    val created_at: String? = null
)

@Serializable
private data class NotificationSummaryDto(val total: Int = 0, val unread: Int = 0)

internal object NotificationsJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun list(body: String): List<Notification> = runCatching {
        json.decodeFromString<List<NotificationDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        if (dto.id.isBlank() || dto.title.isBlank()) return@mapNotNull null
        Notification(
            id = dto.id,
            type = dto.type,
            title = dto.title,
            body = dto.body,
            severity = dto.severity.ifBlank { "info" },
            link = dto.link,
            read = dto.read,
            createdAt = dto.created_at?.let { raw ->
                runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
            }
        )
    }

    fun summary(body: String): Pair<Int, Int> = runCatching {
        json.decodeFromString<NotificationSummaryDto>(body)
    }.getOrDefault(NotificationSummaryDto()).let { it.total to it.unread }
}

/**
 * Notifications: what the server wants to tell you, and the two things you do
 * with one — read it, or mark everything read.
 */
class NotificationsApi(private val baseUrl: String) {

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

    suspend fun list(token: String, limit: Int = 60): List<Notification> =
        withContext(Dispatchers.IO) {
            execute(builder("/notifications?limit=$limit", token).get().build())
                ?.let(NotificationsJson::list).orEmpty()
        }

    suspend fun unreadCount(token: String): Int = withContext(Dispatchers.IO) {
        execute(builder("/notifications/summary", token).get().build())
            ?.let { NotificationsJson.summary(it).second } ?: 0
    }

    suspend fun markRead(token: String, id: String): Boolean = withContext(Dispatchers.IO) {
        val body = buildJsonObject { put("read", true) }
            .toString().toRequestBody(jsonType)
        execute(builder("/notifications/$id/read", token).patch(body).build()) != null
    }

    suspend fun markAllRead(token: String): Boolean = withContext(Dispatchers.IO) {
        execute(builder("/notifications/read-all", token).post("".toRequestBody(jsonType)).build()) != null
    }
}
