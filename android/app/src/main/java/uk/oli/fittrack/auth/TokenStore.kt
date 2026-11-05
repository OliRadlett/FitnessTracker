package uk.oli.fittrack.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * The backend JWT, in Keystore-backed storage.
 *
 * It is the only secret the app holds: a 30-day bearer token. It is never
 * logged and never written to the session file.
 */
class TokenStore(context: Context) {

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "fittrack_auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun token(): String? = prefs.getString(KEY_TOKEN, null)

    fun email(): String? = prefs.getString(KEY_EMAIL, null)

    fun save(token: String, email: String?) {
        prefs.edit().putString(KEY_TOKEN, token).putString(KEY_EMAIL, email).apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_TOKEN = "backend_jwt"
        const val KEY_EMAIL = "email"
    }
}
