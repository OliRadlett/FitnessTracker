package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

@Serializable
private data class ExchangeRequest(val id_token: String)

@Serializable
private data class ExchangeUser(val email: String, val name: String? = null)

@Serializable
private data class ExchangeResponse(
    val access_token: String,
    val user: ExchangeUser,
    val token_type: String = "bearer"
)

data class AuthSession(val token: String, val email: String)

class ApiException(val status: Int, override val message: String) : IOException(message)

/**
 * The one authenticated call the app makes today: exchange a Google ID token
 * for a FitTrack JWT. Everything else will hang off the same OkHttp client.
 */
class AuthApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun exchangeGoogleIdToken(idToken: String): AuthSession = withContext(Dispatchers.IO) {
        val payload = json.encodeToString(ExchangeRequest(idToken))
        val request = Request.Builder()
            .url("$baseUrl/auth/mobile/google")
            .post(payload.toRequestBody(mediaType))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, detailFrom(body) ?: "Sign-in failed (${response.code})")
            }
            val parsed = json.decodeFromString<ExchangeResponse>(body)
            AuthSession(token = parsed.access_token, email = parsed.user.email)
        }
    }

    /** The API reports problems as {"detail": "..."} — surface that, not the JSON. */
    private fun detailFrom(body: String): String? = runCatching {
        json.parseToJsonElement(body).let { element ->
            element as? kotlinx.serialization.json.JsonObject
        }?.get("detail")?.toString()?.trim('"')
    }.getOrNull()

    /**
     * Revoke the JWT server-side. Best-effort: signing out locally must work even
     * with no network, but a token left valid for 30 days is a real risk.
     */
    suspend fun logout(token: String) = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl/auth/logout")
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody(mediaType))
            .build()
        runCatching { client.newCall(request).execute().close() }
        Unit
    }
}
