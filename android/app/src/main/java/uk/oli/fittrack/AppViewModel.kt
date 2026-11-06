package uk.oli.fittrack

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import uk.oli.fittrack.auth.GoogleSignIn
import uk.oli.fittrack.auth.TokenStore
import uk.oli.fittrack.data.HistoryStore
import uk.oli.fittrack.data.PlanStore
import uk.oli.fittrack.data.SeedPlan
import uk.oli.fittrack.data.SessionStore
import uk.oli.fittrack.data.emptySession
import uk.oli.fittrack.data.withSet
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.HistoryEngine
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.REST_MILLIS
import uk.oli.fittrack.domain.SessionState
import uk.oli.fittrack.net.ApiException
import uk.oli.fittrack.net.AuthApi
import uk.oli.fittrack.net.LiftingApi
import uk.oli.fittrack.net.SetEdit

data class AuthUiState(
    val token: String? = null,
    val email: String? = null,
    val signingIn: Boolean = false,
    val error: String? = null
) {
    val signedIn: Boolean get() = token != null
}

/**
 * One session at a time, owned by the activity and shared by every screen.
 *
 * The state is written to disk on every mutation, so process death mid-set is a
 * no-op rather than a lost workout — the one thing the web client cannot do.
 *
 * Sign-in is separate from the log on purpose: the gym flow works before you
 * have ever authenticated.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val store = SessionStore(app.filesDir)
    private val historyStore = HistoryStore(app.filesDir)
    private val planStore = PlanStore(app.filesDir)

    // Keystore-backed storage can fail on a damaged keystore (or under a test
    // runner that has none). That must not stop the gym flow from working, so
    // auth degrades to "signed out" and says why.
    private val tokenStore: TokenStore? = runCatching { TokenStore(app) }.getOrNull()
    private val authApi = AuthApi(BuildConfig.API_BASE_URL)
    private val liftingApi = LiftingApi(BuildConfig.API_BASE_URL)

    private val _auth = MutableStateFlow(
        AuthUiState(token = tokenStore?.token(), email = tokenStore?.email())
    )
    val auth: StateFlow<AuthUiState> = _auth.asStateFlow()

    private val _session = MutableStateFlow(store.load())
    val session: StateFlow<SessionState?> = _session.asStateFlow()

    /** Finished sessions, newest first. Drives "last time" and the week strip. */
    private val _history = MutableStateFlow(HistoryEngine.newestFirst(historyStore.load()))
    val history: StateFlow<List<FinishedSession>> = _history.asStateFlow()

    private val _restUntil = MutableStateFlow<Long?>(null)
    val restUntil: StateFlow<Long?> = _restUntil.asStateFlow()

    private val _now = MutableStateFlow(System.currentTimeMillis())
    val now: StateFlow<Long> = _now.asStateFlow()

    /** When history last came back from the server, and why it did not. */
    private val _syncedAt = MutableStateFlow<Long?>(null)
    val syncedAt: StateFlow<Long?> = _syncedAt.asStateFlow()

    private val _syncError = MutableStateFlow<String?>(null)
    val syncError: StateFlow<String?> = _syncError.asStateFlow()

    private var restJob: Job? = null
    private var syncing = false

    /**
     * Sync in both directions: push sessions that only exist on this phone, then
     * pull the rest.
     *
     * Fail-open on purpose: sync is an enhancement, and a phone with no signal
     * must still be able to train. Failures surface in You, not as a blocker.
     */
    fun syncHistory() {
        val token = _auth.value.token ?: return
        if (syncing) return
        syncing = true
        viewModelScope.launch {
            try {
                pushPending(token)
                val remote = liftingApi.sessions(token)
                if (remote.isNotEmpty()) {
                    val merged = HistoryEngine
                        .newestFirst((_history.value + remote).distinctBy { it.id })
                        .take(HistoryStore.MAX)
                    _history.value = merged
                    historyStore.save(merged)
                }
                _syncError.value = null
                _syncedAt.value = System.currentTimeMillis()
            } catch (e: Exception) {
                _syncError.value = e.message ?: "Sync failed."
            } finally {
                syncing = false
            }
        }
    }

    /**
     * Upload every session the server has not seen. `live_key` makes this safe to
     * repeat: a retry after a lost response finds the existing row rather than
     * creating a second copy, and the id is rewritten to the server's.
     */
    private suspend fun pushPending(token: String) {
        for (pending in _history.value.filterNot { it.synced }) {
            val serverId = try {
                liftingApi.createSession(token, pending)
            } catch (e: Exception) {
                _syncError.value = e.message ?: "Could not save the session."
                return
            }
            val updated = HistoryEngine
                .newestFirst(
                    _history.value.map {
                        if (it.id == pending.id) it.copy(id = serverId, synced = true) else it
                    }.distinctBy { it.id }
                )
                .take(HistoryStore.MAX)
            _history.value = updated
            historyStore.save(updated)
        }
    }

    // ── auth ─────────────────────────────────────────────────────────────────

    fun signIn(activity: Activity) {
        if (_auth.value.signingIn) return
        val store = tokenStore
        if (store == null) {
            _auth.update { it.copy(error = "Secure storage is unavailable on this device.") }
            return
        }
        val clientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (clientId.isBlank()) {
            _auth.update { it.copy(error = "This build has no Google client id configured.") }
            return
        }

        _auth.update { it.copy(signingIn = true, error = null) }
        viewModelScope.launch {
            try {
                val idToken = GoogleSignIn.requestIdToken(activity, clientId)
                val session = authApi.exchangeGoogleIdToken(idToken)
                store.save(session.token, session.email)
                _auth.value = AuthUiState(token = session.token, email = session.email)
            } catch (e: ApiException) {
                _auth.update { it.copy(signingIn = false, error = e.message) }
            } catch (e: Exception) {
                _auth.update { it.copy(signingIn = false, error = e.message ?: "Sign-in failed.") }
            }
        }
    }

    fun signOut() {
        val token = _auth.value.token
        tokenStore?.clear()
        _auth.value = AuthUiState()
        // Tell the server too: the JWT is valid for 30 days otherwise.
        if (token != null) {
            viewModelScope.launch { authApi.logout(token) }
        }
    }

    // ── session ──────────────────────────────────────────────────────────────

    /**
     * The plan the app prescribes: the one edited on the phone, or the seeded
     * starter. Editable until the training-plan API is wired up, at which point
     * this becomes the offline copy rather than the source.
     */
    private val _plan = MutableStateFlow(planStore.load() ?: SeedPlan.pushDay)
    val plan: StateFlow<uk.oli.fittrack.domain.Plan> = _plan.asStateFlow()

    fun updatePlan(newPlan: uk.oli.fittrack.domain.Plan) {
        _plan.value = newPlan
        planStore.save(newPlan)
    }

    fun startSession() {
        if (_session.value != null) return
        val fresh = emptySession(_plan.value)
        _session.value = fresh
        store.save(fresh)
    }

    fun logSet(weightKg: Double, reps: Int, rpe: Int) {
        val current = _session.value ?: return
        val next = current.withSet(
            LoggedSet(
                exercise = current.plan.exercises
                    .first { it.name == currentExerciseName(current) }
                    .name,
                weightKg = weightKg,
                reps = reps,
                rpe = rpe.toDouble(),
                at = System.currentTimeMillis()
            )
        )
        _session.value = next
        store.save(next)
        startRest()
    }

    /**
     * Drop the last logged set. A mis-tap at the gym has to be recoverable, and
     * the rest timer belongs to the set that just went away.
     */
    fun undoLastSet() {
        val current = _session.value ?: return
        if (current.sets.isEmpty()) return
        val next = current.copy(sets = current.sets.dropLast(1))
        _session.value = next
        store.save(next)
        restJob?.cancel()
        _restUntil.value = null
    }

    // ── editing finished sessions ────────────────────────────────────────────
    //
    // A session that is already on the server is a *remote* edit: the optimistic
    // local copy is what you see, and a failure puts it back with a reason. A
    // session that has never been pushed has nothing to tell, so it just edits.

    private val writeLock = kotlinx.coroutines.sync.Mutex()

    fun editSet(sessionId: String, index: Int, edit: SetEdit) {
        val session = _history.value.firstOrNull { it.id == sessionId } ?: return
        val old = session.sets.getOrNull(index) ?: return
        val updated = old.copy(
            weightKg = edit.weight_kg,
            reps = edit.reps,
            rpe = edit.rpe,
            isWarmup = edit.is_warmup,
            isAmrap = edit.is_amrap,
            note = edit.notes?.takeIf { it.isNotBlank() }
        )
        replaceSet(sessionId, index, updated)

        val setId = old.serverId
        if (!session.synced || setId == null) return
        val token = _auth.value.token
        if (token == null) {
            replaceSet(sessionId, index, old)
            _syncError.value = "Sign in to edit a session that is on the server."
            return
        }
        viewModelScope.launch {
            writeLock.withLock {
                try {
                    liftingApi.updateSet(token, setId, edit)
                    _syncError.value = null
                } catch (e: Exception) {
                    replaceSet(sessionId, index, old)
                    _syncError.value = e.message ?: "Could not save the set."
                }
            }
        }
    }

    fun deleteSet(sessionId: String, index: Int) {
        val session = _history.value.firstOrNull { it.id == sessionId } ?: return
        val old = session.sets.getOrNull(index) ?: return
        removeSet(sessionId, index)

        val setId = old.serverId
        if (!session.synced || setId == null) return
        val token = _auth.value.token
        if (token == null) {
            replaceSet(sessionId, index, old)
            _syncError.value = "Sign in to delete a set that is on the server."
            return
        }
        viewModelScope.launch {
            writeLock.withLock {
                try {
                    liftingApi.deleteSet(token, setId)
                    _syncError.value = null
                } catch (e: Exception) {
                    replaceSet(sessionId, index, old)
                    _syncError.value = e.message ?: "Could not delete the set."
                }
            }
        }
    }

    fun deleteSession(sessionId: String) {
        val snapshot = _history.value
        val session = snapshot.firstOrNull { it.id == sessionId } ?: return
        _history.value = HistoryEngine.newestFirst(snapshot.filterNot { it.id == sessionId })
        historyStore.save(_history.value)

        if (!session.synced) return
        val token = _auth.value.token
        if (token == null) {
            _history.value = snapshot
            historyStore.save(snapshot)
            _syncError.value = "Sign in to delete a session that is on the server."
            return
        }
        viewModelScope.launch {
            writeLock.withLock {
                try {
                    liftingApi.deleteSession(token, sessionId)
                    _syncError.value = null
                } catch (e: Exception) {
                    _history.value = snapshot
                    historyStore.save(snapshot)
                    _syncError.value = e.message ?: "Could not delete the session."
                }
            }
        }
    }

    private fun replaceSet(sessionId: String, index: Int, set: uk.oli.fittrack.domain.LoggedSet) {
        mutateSession(sessionId) { session ->
            session.copy(
                sets = session.sets.mapIndexed { i, existing -> if (i == index) set else existing }
            )
        }
    }

    private fun removeSet(sessionId: String, index: Int) {
        mutateSession(sessionId) { session ->
            session.copy(sets = session.sets.filterIndexed { i, _ -> i != index })
        }
    }

    private fun mutateSession(
        sessionId: String,
        transform: (FinishedSession) -> FinishedSession
    ) {
        val updated = _history.value.map { if (it.id == sessionId) transform(it) else it }
        _history.value = HistoryEngine.newestFirst(updated)
        historyStore.save(_history.value)
    }

    private fun currentExerciseName(state: SessionState): String =
        uk.oli.fittrack.domain.SessionEngine.currentExercise(state)?.name
            ?: state.plan.exercises.last().name
    private fun startRest() {
        restJob?.cancel()
        val until = System.currentTimeMillis() + REST_MILLIS
        _restUntil.value = until
        _now.value = System.currentTimeMillis()
        restJob = viewModelScope.launch {
            while (isActive) {
                _now.value = System.currentTimeMillis()
                if (_now.value >= until) {
                    _restUntil.value = null
                    break
                }
                delay(200)
            }
        }
    }

    /**
     * Ends the session: what you logged becomes history (so the next session can
     * prefill from it), then the in-progress state is cleared. A session with no
     * sets is discarded rather than written as an empty entry.
     */
    fun finishSession() {
        val current = _session.value
        var justFinished = false
        if (current != null && current.sets.isNotEmpty()) {
            val entry = FinishedSession(
                id = current.id,
                planTitle = current.plan.title,
                startedAt = current.startedAt,
                endedAt = current.sets.maxOf { it.at },
                sets = current.sets
            )
            val updated = HistoryEngine.newestFirst(_history.value + entry).take(HistoryStore.MAX)
            _history.value = updated
            historyStore.save(updated)
            justFinished = true
        }
        restJob?.cancel()
        _restUntil.value = null
        _session.value = null
        store.clear()

        // Upload in the background: finishing must not wait on the network, and
        // an offline session simply stays pending until the next sync.
        val token = _auth.value.token
        if (justFinished && token != null) {
            viewModelScope.launch {
                try {
                    pushPending(token)
                    _syncError.value = null
                    _syncedAt.value = System.currentTimeMillis()
                } catch (e: Exception) {
                    _syncError.value = e.message ?: "Could not save the session."
                }
            }
        }
    }
}
