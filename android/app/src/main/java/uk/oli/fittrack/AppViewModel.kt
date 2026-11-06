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
import uk.oli.fittrack.domain.SessionState
import uk.oli.fittrack.net.ApiException
import uk.oli.fittrack.net.AuthApi
import uk.oli.fittrack.net.LiftingApi
import uk.oli.fittrack.net.LiftingSessionPatch
import uk.oli.fittrack.net.NewSetBody
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
    private val planApi = uk.oli.fittrack.net.PlanApi(BuildConfig.API_BASE_URL)

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
                loadTodayPlan(token)
                loadWarmupTemplates(token)
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
        // The server plan is not ours to keep once the token is gone.
        _plan.value = planStore.load() ?: SeedPlan.pushDay
        _planFromServer.value = false
        _plannedPlanName.value = null
        _restDay.value = false
        // Tell the server too: the JWT is valid for 30 days otherwise.
        if (token != null) {
            viewModelScope.launch { authApi.logout(token) }
        }
    }

    // ── session ──────────────────────────────────────────────────────────────

    /**
     * The plan the app prescribes: the one edited on the phone, or the seeded
     * starter. When the training-plan API answers, today's planned session
     * replaces both — that is the website's "today's session" card.
     */
    private val _plan = MutableStateFlow(planStore.load() ?: SeedPlan.pushDay)
    val plan: StateFlow<uk.oli.fittrack.domain.Plan> = _plan.asStateFlow()

    /** True once the plan on screen came from the server, so it is not editable here. */
    private val _planFromServer = MutableStateFlow(false)
    val planFromServer: StateFlow<Boolean> = _planFromServer.asStateFlow()

    private val _plannedPlanName = MutableStateFlow<String?>(null)
    val plannedPlanName: StateFlow<String?> = _plannedPlanName.asStateFlow()

    /**
     * True when the plan covers today but today is not a training day. The app
     * then says so instead of prescribing the seeded push day — a rest day the
     * plan asked for is training, not a gap to fill.
     */
    private val _restDay = MutableStateFlow(false)
    val restDay: StateFlow<Boolean> = _restDay.asStateFlow()

    /** Saved warm-up templates, offered on the Live screen. */
    private val _warmupTemplates = MutableStateFlow<List<uk.oli.fittrack.domain.WarmupTemplate>>(emptyList())
    val warmupTemplates: StateFlow<List<uk.oli.fittrack.domain.WarmupTemplate>> =
        _warmupTemplates.asStateFlow()

    /** Activities the open session could be linked to (only fetched on demand). */
    private val _linkCandidates = MutableStateFlow<List<uk.oli.fittrack.domain.LinkedActivity>>(emptyList())
    val linkCandidates: StateFlow<List<uk.oli.fittrack.domain.LinkedActivity>> =
        _linkCandidates.asStateFlow()

    fun loadLinkableActivities(sessionId: String) {
        val token = _auth.value.token ?: run {
            _syncError.value = "Sign in to link an activity."
            return
        }
        viewModelScope.launch {
            try {
                _linkCandidates.value = liftingApi.linkableActivities(token, sessionId)
                if (_linkCandidates.value.isEmpty()) {
                    _syncError.value = "No Strava activities to link."
                }
            } catch (e: Exception) {
                _syncError.value = e.message ?: "Could not load activities."
            }
        }
    }

    fun clearLinkCandidates() {
        _linkCandidates.value = emptyList()
    }

    /** Link (or unlink, with a null [activity]) and put it back if the server refuses. */
    fun linkActivity(sessionId: String, activity: uk.oli.fittrack.domain.LinkedActivity?) {
        val session = _history.value.firstOrNull { it.id == sessionId } ?: return
        val old = session.linkedActivity
        if (old == activity) return
        replaceSession(session, session.copy(linkedActivity = activity))
        _linkCandidates.value = emptyList()

        if (!session.synced) return
        val token = _auth.value.token
        if (token == null) {
            replaceSession(session.copy(linkedActivity = activity), session)
            _syncError.value = "Sign in to change the link."
            return
        }
        viewModelScope.launch {
            writeLock.withLock {
                try {
                    liftingApi.linkActivity(token, sessionId, activity?.id)
                    _syncError.value = null
                } catch (e: Exception) {
                    replaceSession(session.copy(linkedActivity = activity), session)
                    _syncError.value = e.message ?: "Could not change the link."
                }
            }
        }
    }

    private suspend fun loadWarmupTemplates(token: String) {
        runCatching { liftingApi.warmupTemplates(token) }
            .getOrNull()
            ?.let { _warmupTemplates.value = it }
    }

    /**
     * Log a template's steps as warm-ups for the current exercise. Local-only by
     * design: the session is not on the server until it is finished, so this
     * works with no signal at all.
     */
    fun applyWarmupTemplate(template: uk.oli.fittrack.domain.WarmupTemplate) {
        val current = _session.value ?: return
        val exercise = template.exercise ?: currentExerciseName(current)
        val updated = uk.oli.fittrack.domain.SessionEngine.addWarmups(
            current,
            exercise,
            template.steps,
            System.currentTimeMillis()
        )
        if (updated === current) return
        _session.value = updated
        store.save(updated)
    }

    fun updatePlan(newPlan: uk.oli.fittrack.domain.Plan) {
        _plan.value = newPlan
        _planFromServer.value = false
        _plannedPlanName.value = null
        _restDay.value = false
        planStore.save(newPlan)
    }

    /**
     * Ask the training plan what today is. Best-effort in every direction; a
     * failed request leaves the current plan alone rather than showing a rest
     * day the plan never asked for.
     */
    private suspend fun loadTodayPlan(token: String) {
        when (val lookup = planApi.todayPlan(token, java.time.LocalDate.now(), _history.value)) {
            is uk.oli.fittrack.net.PlanLookup.Planned -> {
                _plan.value = uk.oli.fittrack.net.PlanJson.toPlan(lookup.day)
                _plannedPlanName.value = lookup.day.planName.takeIf { it.isNotBlank() }
                _restDay.value = false
                _planFromServer.value = true
            }
            is uk.oli.fittrack.net.PlanLookup.NoneToday -> {
                _plannedPlanName.value = lookup.planName.takeIf { it.isNotBlank() }
                _restDay.value = true
                _planFromServer.value = true
            }
            uk.oli.fittrack.net.PlanLookup.Unavailable -> Unit
        }
    }

    fun startSession() {
        if (_session.value != null) return
        val fresh = emptySession(_plan.value)
        _session.value = fresh
        store.save(fresh)
    }

    /**
     * Start today from a session that already happened: same exercises, same
     * working-set count, last time's load and reps as the target.
     *
     * Refuses while another session is in progress — a repeat must never throw
     * away sets you have already logged — and returns whether it started.
     */
    fun repeatSession(sessionId: String): Boolean {
        if (_session.value != null) return false
        val source = _history.value.firstOrNull { it.id == sessionId } ?: return false
        val plan = uk.oli.fittrack.domain.SessionEngine.planFrom(source)
        if (plan.exercises.isEmpty()) return false
        val fresh = emptySession(plan)
        _session.value = fresh
        store.save(fresh)
        return true
    }

    fun logSet(entry: uk.oli.fittrack.domain.SetEntry) {
        val current = _session.value ?: return
        val next = current.withSet(
            LoggedSet(
                exercise = current.plan.exercises
                    .first { it.name == currentExerciseName(current) }
                    .name,
                weightKg = entry.weightKg,
                reps = entry.reps,
                rpe = entry.rpe,
                at = System.currentTimeMillis(),
                isWarmup = entry.isWarmup,
                isAmrap = entry.isAmrap
            )
        )
        _session.value = next
        store.save(next)
        // A ramp-up is not a working set: the full rest belongs to the work.
        if (!entry.isWarmup) startRest()
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

    /**
     * Edit the session's own fields: its date (by whole days), its focus and its
     * note. Optimistic like a set edit, and reverted the same way.
     */
    fun editSession(sessionId: String, dayDelta: Long, focus: String?, note: String?) {
        val old = _history.value.firstOrNull { it.id == sessionId } ?: return
        val title = focus?.trim()?.takeIf { it.isNotEmpty() } ?: "Lifting"
        val updated = HistoryEngine.shifted(old, dayDelta).copy(
            planTitle = title,
            note = note?.trim()?.takeIf { it.isNotEmpty() }
        )
        if (updated == old) return
        replaceSession(old, updated)

        if (!old.synced) return
        val token = _auth.value.token
        if (token == null) {
            replaceSession(updated, old)
            _syncError.value = "Sign in to edit a session that is on the server."
            return
        }
        viewModelScope.launch {
            writeLock.withLock {
                try {
                    liftingApi.updateSession(token, sessionId, LiftingSessionPatch.of(updated))
                    _syncError.value = null
                } catch (e: Exception) {
                    replaceSession(updated, old)
                    _syncError.value = e.message ?: "Could not save the session."
                }
            }
        }
    }

    /**
     * Append sets to a finished session — a missed set, or a whole exercise you
     * forgot to log. Local rows appear immediately; a synced session posts each
     * set and swaps the row for the server's, which carries the id an edit
     * needs later.
     */
    fun addSets(sessionId: String, exercise: String, specs: List<SetEdit>) {
        if (specs.isEmpty()) return
        val session = _history.value.firstOrNull { it.id == sessionId } ?: return
        val name = exercise.trim().ifBlank { return }
        val now = System.currentTimeMillis()
        val local = specs.map { spec ->
            LoggedSet(
                exercise = name,
                weightKg = spec.weight_kg,
                reps = spec.reps,
                rpe = spec.rpe,
                at = now,
                isWarmup = spec.is_warmup,
                isAmrap = spec.is_amrap,
                note = spec.notes?.takeIf { it.isNotBlank() },
                clientId = "$sessionId:add:${java.util.UUID.randomUUID()}"
            )
        }
        mutateSession(sessionId) { it.copy(sets = it.sets + local) }

        if (!session.synced) return
        val token = _auth.value.token
        if (token == null) {
            removeByClientIds(sessionId, local.mapNotNull { it.clientId })
            _syncError.value = "Sign in to add a set to a session that is on the server."
            return
        }
        viewModelScope.launch {
            writeLock.withLock {
                var added = 0
                for (set in local) {
                    val number = session.sets.count { it.exercise == set.exercise } + added + 1
                    try {
                        val created = liftingApi.addSet(
                            token,
                            sessionId,
                            NewSetBody(
                                exercise_name = set.exercise,
                                set_number = number,
                                weight_kg = set.weightKg,
                                reps = set.reps,
                                rpe = set.rpe,
                                is_warmup = set.isWarmup,
                                is_amrap = set.isAmrap,
                                notes = set.note,
                                client_id = set.clientId ?: "$sessionId:add:$number"
                            )
                        )
                        replaceByClientId(sessionId, set.clientId, created.copy(at = set.at))
                        added++
                    } catch (e: Exception) {
                        removeByClientIds(sessionId, listOfNotNull(set.clientId))
                        val kept = if (added == 0) "" else " — $added of ${local.size} were saved"
                        _syncError.value = (e.message ?: "Could not add the set.") + kept
                        return@withLock
                    }
                }
                _syncError.value = null
            }
        }
    }

    private fun replaceSession(old: FinishedSession, new: FinishedSession) {
        val updated = _history.value.map { if (it.id == old.id) new else it }
        _history.value = HistoryEngine.newestFirst(updated)
        historyStore.save(_history.value)
    }

    private fun replaceByClientId(
        sessionId: String,
        clientId: String?,
        replacement: uk.oli.fittrack.domain.LoggedSet
    ) {
        if (clientId == null) return
        mutateSession(sessionId) { session ->
            session.copy(
                sets = session.sets.map { if (it.clientId == clientId) replacement else it }
            )
        }
    }

    private fun removeByClientIds(sessionId: String, clientIds: List<String>) {
        if (clientIds.isEmpty()) return
        mutateSession(sessionId) { session ->
            session.copy(sets = session.sets.filterNot { it.clientId in clientIds })
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
    /**
     * Change the rest target. A running rest restarts with the new length, so
     * "I need another minute" is one tap rather than finish-and-re-log.
     */
    fun adjustRest(deltaSeconds: Int) {
        val current = _session.value ?: return
        val next = uk.oli.fittrack.domain.SessionEngine.restTarget(current.restSeconds, deltaSeconds)
        if (next == current.restSeconds) return
        val updated = current.copy(restSeconds = next)
        _session.value = updated
        store.save(updated)
        if (_restUntil.value != null) startRest()
    }

    private fun startRest() {
        restJob?.cancel()
        val seconds = _session.value?.restSeconds ?: uk.oli.fittrack.domain.DEFAULT_REST_SECONDS
        val until = System.currentTimeMillis() + seconds * 1000L
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
    fun finishSession(note: String? = null, rpeSession: Double? = null) {
        val current = _session.value
        var justFinished = false
        if (current != null && current.sets.isNotEmpty()) {
            val entry = uk.oli.fittrack.domain.SessionEngine.finished(current, note, rpeSession)
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
