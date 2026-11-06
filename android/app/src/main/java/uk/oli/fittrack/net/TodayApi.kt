package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** One engine's vote on the day, as `/today` returns it. */
data class EngineVote(val engine: String, val stance: String?, val note: String?)

/**
 * The day's brief: the unified verdict plus the numbers behind it.
 *
 * `headline` follows the strongest rest signal rather than an average, so the
 * app shows the server's sentence rather than composing its own.
 */
data class TodayBrief(
    val headline: String,
    val shouldRest: Boolean,
    val reasons: List<String>,
    val consensus: List<EngineVote>,
    val tsb: Double?,
    val recovery: Double?,
    val volumeKg: Double
)

@Serializable
private data class TodayDto(
    val today_volume_kg: Double = 0.0,
    val current_tsb: Double? = null,
    val latest_recovery: Double? = null,
    val verdict: VerdictDto? = null
)

@Serializable
private data class VerdictDto(
    val should_rest: Boolean = false,
    val headline: String = "",
    val reasons: List<String> = emptyList(),
    val consensus: List<ConsensusDto> = emptyList()
)

@Serializable
private data class ConsensusDto(
    val engine: String = "",
    val stance: String? = null,
    val available: Boolean = true,
    val note: String? = null
)

object TodayJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(body: String): TodayBrief? = runCatching {
        json.decodeFromString<TodayDto>(body)
    }.getOrNull()?.let { dto ->
        val verdict = dto.verdict ?: return null
        val headline = verdict.headline.trim()
        // A verdict with nothing to say is not a brief.
        if (headline.isEmpty()) return null
        TodayBrief(
            headline = headline,
            shouldRest = verdict.should_rest,
            reasons = verdict.reasons.filter { it.isNotBlank() }.take(3),
            consensus = verdict.consensus
                // An engine that stayed silent is reported as such, not dropped:
                // a list that omits it reads as agreement.
                .filter { it.engine.isNotBlank() }
                .map {
                    EngineVote(
                        engine = it.engine,
                        stance = if (it.available) it.stance else "unavailable",
                        note = it.note
                    )
                },
            tsb = dto.current_tsb,
            recovery = dto.latest_recovery,
            volumeKg = dto.today_volume_kg
        )
    }
}

/** The dashboard's daily verdict, used for the Today header. */
class TodayApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    suspend fun brief(token: String): TodayBrief? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/dashboard/today")
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not load today's brief (${response.code})")
            }
            TodayJson.decode(body)
        }
    }
}
