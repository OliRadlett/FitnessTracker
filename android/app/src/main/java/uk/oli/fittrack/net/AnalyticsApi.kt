package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.Insight
import java.util.concurrent.TimeUnit

internal object AnalyticsJson {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Insights carry an open `data` object whose keys differ per insight type, so
     * it is flattened to strings here rather than modelled per type: a phone
     * shows "the five numbers this insight is about", whatever they are.
     */
    fun insights(body: String): List<Insight> = runCatching {
        val array = json.parseToJsonElement(body)
            .let { element ->
                element as? kotlinx.serialization.json.JsonArray ?: return emptyList()
            }
        array.mapNotNull { row ->
            val obj = row as? JsonObject ?: return@mapNotNull null
            val type = (obj["insight_type"] as? JsonPrimitive)?.content?.trim().orEmpty()
            if (type.isEmpty()) return@mapNotNull null
            Insight(
                type = type,
                period = (obj["period"] as? JsonPrimitive)?.content.orEmpty(),
                confidence = (obj["confidence"] as? JsonPrimitive)?.content.orEmpty(),
                sampleSize = (obj["sample_size"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0,
                data = flatten(obj["data"] as? JsonObject)
            )
        }
    }.getOrDefault(emptyList())

    /** Only the scalars inside `data`, in the order the server wrote them. */
    private fun flatten(data: JsonObject?): List<Pair<String, String>> {
        if (data == null) return emptyList()
        return data.entries.mapNotNull { (key, value) ->
            val primitive = value as? JsonPrimitive ?: return@mapNotNull null
            if (!primitive.isString && primitive.content == "null") return@mapNotNull null
            key to primitive.content
        }.take(6)
    }
}

/**
 * Analytics: the computed athlete insights, and a way to ask for fresh ones.
 *
 * The website's page also carries season and load tabs; the phone shows the load
 * on Today and the Ride tab, so what is new here is the insight list itself —
 * "sleep and performance", "load ramp", and the confidence behind each.
 */
class AnalyticsApi(private val baseUrl: String) {

    // A recompute reads history and fits models; 20 s would be a guess.
    private val client = OkHttpClient.Builder()
        .callTimeout(90, TimeUnit.SECONDS)
        .build()

    private fun execute(request: Request): String? =
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }

    suspend fun insights(token: String): List<Insight> = withContext(Dispatchers.IO) {
        execute(
            Request.Builder()
                .url("$baseUrl/analytics/insights")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        )?.let(AnalyticsJson::insights).orEmpty()
    }

    suspend fun recompute(token: String): List<Insight> = withContext(Dispatchers.IO) {
        execute(
            Request.Builder()
                .url("$baseUrl/analytics/recompute")
                .header("Authorization", "Bearer $token")
                .post(okhttp3.RequestBody.create(null, ByteArray(0)))
                .build()
        )?.let(AnalyticsJson::insights).orEmpty()
    }
}
