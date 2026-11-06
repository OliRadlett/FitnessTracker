package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.CyclingSummary
import uk.oli.fittrack.domain.FtpPoint
import uk.oli.fittrack.domain.PowerCurvePoint
import uk.oli.fittrack.domain.Vo2maxEstimate
import uk.oli.fittrack.domain.ZoneShare
import java.util.concurrent.TimeUnit

@Serializable
private data class TrendDto(
    val current_value: Double? = null,
    val baseline_value: Double? = null,
    val direction: String = "stable"
)

@Serializable
private data class SummaryDto(
    val recent_tss: Double = 0.0,
    val recent_distance_km: Double = 0.0,
    val recent_time_hours: Double = 0.0,
    val recent_elevation_m: Double = 0.0,
    val recent_rides: Int = 0,
    val ftp_watts: Double? = null,
    val power_to_weight: Double? = null,
    val tss_trend: TrendDto? = null,
    val rides_trend: TrendDto? = null,
    val distance_trend: TrendDto? = null,
    val time_trend: TrendDto? = null,
    val elevation_trend: TrendDto? = null
)

@Serializable
private data class CurvePointDto(
    val duration_label: String = "",
    val duration_seconds: Int = 0,
    val best_power_watts: Double? = null
)

@Serializable
private data class CurveDto(
    val data: List<CurvePointDto> = emptyList(),
    val ftp_watts: Double? = null,
    val cp: Double? = null,
    val w_prime: Double? = null,
    val p_max: Double? = null,
    val model_r_squared: Double? = null
)

@Serializable
private data class ZoneDto(
    val zone: String = "",
    val zone_name: String = "",
    val time_seconds: Int = 0,
    val percentage: Double = 0.0
)

@Serializable
private data class ZonesDto(
    val ftp_watts: Double? = null,
    val zones: List<ZoneDto> = emptyList(),
    val total_time_seconds: Int = 0
)

@Serializable
private data class FtpDto(
    val ftp_watts: Double = 0.0,
    val effective_date: String = "",
    val source: String = ""
)

@Serializable
private data class Vo2maxDto(
    val vo2max: Double = 0.0,
    val confidence: Double = 0.0,
    val method: String = "",
    val classification: String = ""
)

internal object CyclingJson {

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    fun summary(body: String): CyclingSummary? = runCatching {
        json.decodeFromString<SummaryDto>(body)
    }.getOrNull()?.let { dto ->
        CyclingSummary(
            tss = dto.recent_tss,
            rides = dto.recent_rides,
            distanceKm = dto.recent_distance_km,
            timeHours = dto.recent_time_hours,
            elevationM = dto.recent_elevation_m,
            ftpWatts = dto.ftp_watts,
            wattsPerKg = dto.power_to_weight,
            tssDirection = dto.tss_trend?.direction ?: "stable",
            ridesDirection = dto.rides_trend?.direction ?: "stable",
            distanceDirection = dto.distance_trend?.direction ?: "stable",
            timeDirection = dto.time_trend?.direction ?: "stable",
            elevationDirection = dto.elevation_trend?.direction ?: "stable"
        )
    }

    fun powerCurve(body: String): List<PowerCurvePoint> = runCatching {
        json.decodeFromString<CurveDto>(body)
    }.getOrDefault(CurveDto()).let { dto ->
        dto.data.mapNotNull { point ->
            val watts = point.best_power_watts ?: return@mapNotNull null
            if (point.duration_label.isBlank() || watts <= 0.0) return@mapNotNull null
            PowerCurvePoint(
                label = point.duration_label,
                seconds = point.duration_seconds,
                watts = watts
            )
        }
    }

    fun model(body: String): uk.oli.fittrack.domain.PowerModel? = runCatching {
        json.decodeFromString<CurveDto>(body)
    }.getOrNull()?.let { dto ->
        if (dto.cp == null && dto.w_prime == null && dto.p_max == null) return null
        uk.oli.fittrack.domain.PowerModel(
            cp = dto.cp,
            wPrime = dto.w_prime,
            pMax = dto.p_max,
            rSquared = dto.model_r_squared,
            ftpWatts = dto.ftp_watts
        )
    }

    fun zones(body: String): List<ZoneShare> = runCatching {
        json.decodeFromString<ZonesDto>(body)
    }.getOrDefault(ZonesDto()).zones.mapNotNull { zone ->
        if (zone.zone.isBlank() || zone.percentage <= 0.0) return@mapNotNull null
        ZoneShare(
            zone = zone.zone,
            name = zone.zone_name.ifBlank { zone.zone },
            seconds = zone.time_seconds,
            percentage = zone.percentage
        )
    }

    fun ftpHistory(body: String): List<FtpPoint> = runCatching {
        json.decodeFromString<List<FtpDto>>(body)
    }.getOrDefault(emptyList()).mapNotNull { dto ->
        if (dto.ftp_watts <= 0.0 || dto.effective_date.isBlank()) return@mapNotNull null
        FtpPoint(watts = dto.ftp_watts, date = dto.effective_date, source = dto.source)
    }.sortedBy { it.date }

    fun vo2max(body: String): Vo2maxEstimate? = runCatching {
        json.decodeFromString<Vo2maxDto>(body)
    }.getOrNull()?.let { dto ->
        if (dto.vo2max <= 0.0) return null
        Vo2maxEstimate(
            value = dto.vo2max,
            classification = dto.classification,
            method = dto.method,
            confidence = dto.confidence
        )
    }
}

/**
 * The cycling page's numbers, from `/api/v1/cycling`.
 *
 * Five independent fetches, each fail-open: a rider with no power meter still
 * gets the summary and the rides, and a rider with no FTP still gets the tiles.
 */
class CyclingApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private fun get(path: String, token: String): String? =
        client.newCall(
            Request.Builder()
                .url("$baseUrl$path")
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        ).execute().use { response ->
            if (!response.isSuccessful) return null
            response.body?.string()
        }

    suspend fun summary(token: String): CyclingSummary? = withContext(Dispatchers.IO) {
        get("/cycling/metrics-summary", token)?.let(CyclingJson::summary)
    }

    suspend fun powerCurve(token: String): List<PowerCurvePoint> = withContext(Dispatchers.IO) {
        get("/cycling/power-curve", token)?.let(CyclingJson::powerCurve).orEmpty()
    }

    suspend fun powerModel(token: String): uk.oli.fittrack.domain.PowerModel? =
        withContext(Dispatchers.IO) {
            get("/cycling/power-model", token)?.let(CyclingJson::model)
        }

    suspend fun powerZones(token: String, days: Int = 30): List<ZoneShare> =
        withContext(Dispatchers.IO) {
            get("/cycling/power-zones?days=$days", token)?.let(CyclingJson::zones).orEmpty()
        }

    suspend fun ftpHistory(token: String): List<FtpPoint> = withContext(Dispatchers.IO) {
        get("/cycling/ftp-history", token)?.let(CyclingJson::ftpHistory).orEmpty()
    }

    suspend fun vo2max(token: String): Vo2maxEstimate? = withContext(Dispatchers.IO) {
        get("/cycling/vo2max", token)?.let(CyclingJson::vo2max)
    }

    /** Everything the Ride page needs, fetched together and independently. */
    suspend fun snapshot(token: String): CyclingSnapshot = coroutineScope {
        val summary = async { runCatching { summary(token) }.getOrNull() }
        val curve = async { runCatching { powerCurve(token) }.getOrNull().orEmpty() }
        val model = async { runCatching { powerModel(token) }.getOrNull() }
        val zones = async { runCatching { powerZones(token) }.getOrNull().orEmpty() }
        val ftp = async { runCatching { ftpHistory(token) }.getOrNull().orEmpty() }
        val vo2max = async { runCatching { vo2max(token) }.getOrNull() }
        CyclingSnapshot(
            summary = summary.await(),
            curve = curve.await(),
            model = model.await(),
            zones = zones.await(),
            ftpHistory = ftp.await(),
            vo2max = vo2max.await()
        )
    }
}

/** One cycling page's worth of server data; any field may be empty. */
data class CyclingSnapshot(
    val summary: CyclingSummary? = null,
    val curve: List<PowerCurvePoint> = emptyList(),
    val model: uk.oli.fittrack.domain.PowerModel? = null,
    val zones: List<ZoneShare> = emptyList(),
    val ftpHistory: List<FtpPoint> = emptyList(),
    val vo2max: Vo2maxEstimate? = null
) {
    val isEmpty: Boolean
        get() = summary == null && curve.isEmpty() && zones.isEmpty() &&
            ftpHistory.isEmpty() && vo2max == null
}
