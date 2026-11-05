package uk.oli.fittrack

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import uk.oli.fittrack.data.SeedPlan
import uk.oli.fittrack.data.SessionStore
import uk.oli.fittrack.data.emptySession
import uk.oli.fittrack.data.withSet
import uk.oli.fittrack.domain.LoggedSet
import uk.oli.fittrack.domain.REST_MILLIS
import uk.oli.fittrack.domain.SessionState

/**
 * One session at a time, owned by the activity and shared by every screen.
 *
 * The state is written to disk on every mutation, so process death mid-set is a
 * no-op rather than a lost workout — the one thing the web client cannot do.
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val store = SessionStore(app.filesDir)

    private val _session = MutableStateFlow(store.load())
    val session: StateFlow<SessionState?> = _session.asStateFlow()

    private val _restUntil = MutableStateFlow<Long?>(null)
    val restUntil: StateFlow<Long?> = _restUntil.asStateFlow()

    private val _now = MutableStateFlow(System.currentTimeMillis())
    val now: StateFlow<Long> = _now.asStateFlow()

    private var restJob: Job? = null

    fun startSession() {
        if (_session.value != null) return
        val fresh = emptySession(SeedPlan.pushDay)
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
                rpe = rpe,
                at = System.currentTimeMillis()
            )
        )
        _session.value = next
        store.save(next)
        startRest()
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

    /** Ends the session and forgets it; the summary is read before this is called. */
    fun finishSession() {
        restJob?.cancel()
        _restUntil.value = null
        _session.value = null
        store.clear()
    }
}
