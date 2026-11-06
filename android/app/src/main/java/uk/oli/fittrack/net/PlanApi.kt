package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import uk.oli.fittrack.domain.FinishedSession
import uk.oli.fittrack.domain.HistoryEngine
import uk.oli.fittrack.domain.Plan
import uk.oli.fittrack.domain.PlanExercise
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * The training plan, as far as the gym needs it: today's strength session.
 *
 * Shapes come from `backend/app/schemas/training_plan.py` (`TrainingPlanSummary`,
 * `TrainingPlanRead`, `TrainingPlanDayRead`, and `planned_exercises`' required
 * keys `exercise`/`sets`/`reps`). A planned exercise carries no weight — the
 * %1RM and RPE keys are hints, not a load — so the load comes from what you
 * actually lifted last time, falling back to zero and letting you type it in.
 */
@Serializable
internal data class PlanSummaryDto(
    val id: String,
    val name: String = "",
    val start_date: String? = null,
    val end_date: String? = null
)

@Serializable
internal data class PlanReadDto(
    val id: String,
    val name: String = "",
    val days: List<PlanDayDto> = emptyList()
)

@Serializable
internal data class PlanDayDto(
    val day_date: String? = null,
    val sport: String? = null,
    val planned_focus: String? = null,
    val planned_exercises: List<PlannedExerciseDto>? = null
)

@Serializable
internal data class PlannedExerciseDto(
    val exercise: String = "",
    val sets: Int = 0,
    val reps: Int = 0,
    val rpe: Double? = null
)

/** One planned strength session, in the app's own terms. */
data class PlannedDay(
    val focus: String,
    val planName: String,
    val planExerciseCount: Int,
    val exercises: List<PlanExercise>
)

internal object PlanJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun plans(body: String): List<PlanSummaryDto> =
        runCatching { json.decodeFromString<List<PlanSummaryDto>>(body) }.getOrDefault(emptyList())

    fun plan(body: String): PlanReadDto? =
        runCatching { json.decodeFromString<PlanReadDto>(body) }.getOrNull()

    /**
     * The plan that should describe today: one whose dates bracket [today],
     * preferring the most recently started.
     */
    fun activePlan(plans: List<PlanSummaryDto>, today: LocalDate): PlanSummaryDto? =
        plans.filter { plan ->
            val start = plan.start_date?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            val end = plan.end_date?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            start != null && end != null && !today.isBefore(start) && !today.isAfter(end)
        }.maxByOrNull { it.start_date ?: "" }

    /**
     * Today's strength session from a full plan, or null when today is a rest
     * day, a ride, or has no exercises written for it.
     */
    fun today(
        plan: PlanReadDto,
        today: LocalDate,
        history: List<FinishedSession> = emptyList()
    ): PlannedDay? {
        // A date can hold more than one row (a lift and a ride); the strength one
        // with exercises is the one the gym flow can use.
        val candidates = plan.days.filter {
            it.day_date == today.toString() && it.sport in setOf("strength", null)
        }

        return candidates.firstNotNullOfOrNull { day ->
            val planned = day.planned_exercises.orEmpty()
            val exercises = planned.mapNotNull { entry ->
                val name = entry.exercise.trim()
                if (name.isEmpty() || entry.sets <= 0 || entry.reps <= 0) return@mapNotNull null
                PlanExercise(
                    name = name,
                    sets = entry.sets,
                    reps = entry.reps,
                    // A planned entry carries no load; last time is the honest guess
                    // and the Live screen prefills from history anyway.
                    weightKg = HistoryEngine.lastSetFor(history, name)?.weightKg ?: 0.0
                )
            }
            if (exercises.isEmpty()) return@firstNotNullOfOrNull null

            val focus = day.planned_focus?.trim()?.takeIf { it.isNotBlank() }
            PlannedDay(
                focus = focus?.replaceFirstChar { it.uppercase() } ?: "Planned session",
                planName = plan.name,
                planExerciseCount = planned.size,
                exercises = exercises
            )
        }
    }

    fun toPlan(day: PlannedDay): Plan = Plan(title = day.focus, exercises = day.exercises)
}

/** What the training plan has to say about today. */
sealed interface PlanLookup {
    /** A planned strength session, ready to become the app's plan. */
    data class Planned(val day: PlannedDay) : PlanLookup

    /** A plan covers today, but today is a rest day, a ride, or unwritten. */
    data class NoneToday(val planName: String) : PlanLookup

    /** No plan, no signal, or nothing readable — keep whatever the app has. */
    data object Unavailable : PlanLookup
}

class PlanApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * What today looks like in the training plan. Fail-open: a failed request
     * says [PlanLookup.Unavailable] rather than pretending it is a rest day.
     */
    suspend fun todayPlan(
        token: String,
        today: LocalDate,
        history: List<FinishedSession>
    ): PlanLookup = withContext(Dispatchers.IO) {
        // The router is mounted at /api/v1/training-plans (backend/app/main.py).
        val plansBody = runCatching { get("$baseUrl/training-plans", token) }.getOrNull()
            ?: return@withContext PlanLookup.Unavailable
        val active = PlanJson.activePlan(PlanJson.plans(plansBody), today)
            ?: return@withContext PlanLookup.Unavailable

        val planBody = runCatching { get("$baseUrl/training-plans/${active.id}", token) }.getOrNull()
            ?: return@withContext PlanLookup.Unavailable
        val plan = PlanJson.plan(planBody) ?: return@withContext PlanLookup.Unavailable

        PlanJson.today(plan, today, history)
            ?.let { PlanLookup.Planned(it) }
            ?: PlanLookup.NoneToday(plan.name.ifBlank { active.name })
    }

    private fun get(url: String, token: String): String {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, "Could not load the training plan (${response.code})")
            }
            return body
        }
    }
}
