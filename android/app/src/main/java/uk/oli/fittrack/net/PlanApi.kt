package uk.oli.fittrack.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
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
    val weight_kg: Double? = null,
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

/**
 * Week arithmetic for the plan's `/week/{n}`, which counts Monday-based weeks
 * from the plan's own start rather than from the calendar year.
 */
internal object PlanWeeks {

    private fun mondayOf(date: LocalDate): LocalDate =
        date.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY))

    /** 1 for the week the plan starts in, 2 for the next, and so on. */
    fun weekNumber(start: LocalDate, date: LocalDate): Int =
        (java.time.temporal.ChronoUnit.WEEKS.between(mondayOf(start), mondayOf(date)) + 1)
            .toInt()
            .coerceAtLeast(1)

    /** How many weeks the plan spans, inclusive of the partial first and last. */
    fun totalWeeks(start: LocalDate, end: LocalDate): Int =
        weekNumber(start, end).coerceAtLeast(1)

    /** Keep a paged week inside the plan, so an arrow never asks for week 0. */
    fun clamp(weekNumber: Int, total: Int): Int = weekNumber.coerceIn(1, total.coerceAtLeast(1))
}

/** One day of the plan's week, as the Train tab lists it. */
data class PlanDaySummary(
    val date: String,
    val sport: String,
    val focus: String?,
    val status: String,
    /** The day's prescription, ready to become a session (empty on a rest day). */
    val exercises: List<PlanExercise>,
    val isToday: Boolean,
    /** The server's day id; null when the week did not carry one, so no edit. */
    val id: String? = null,
    val notes: String? = null
) {
    val canStart: Boolean get() = sport == "strength" && exercises.isNotEmpty()
    val canEdit: Boolean get() = id != null
}

/** The week around today, from the active plan. */
data class PlanWeek(
    val planName: String,
    val weekNumber: Int,
    val weekStart: String,
    val weekEnd: String,
    val days: List<PlanDaySummary>,
    /** The week containing today, so a pager can tell how far it has moved. */
    val thisWeekNumber: Int = weekNumber,
    /** The plan's last week; paging past it would ask for a week that is not there. */
    val totalWeeks: Int = weekNumber,
    /** The plan's id, so a day can be edited back to the server. */
    val planId: String? = null
) {
    val canPageBack: Boolean get() = weekNumber > 1
    val canPageForward: Boolean get() = weekNumber < totalWeeks
}

@Serializable
private data class WeekDto(
    val plan_id: String? = null,
    val week_number: Int = 0,
    val week_start: String? = null,
    val week_end: String? = null,
    val days: List<WeekDayDto> = emptyList()
)

@Serializable
private data class WeekDayDto(
    val id: String? = null,
    val day_date: String? = null,
    val sport: String? = null,
    val planned_focus: String? = null,
    val day_status: String = "pending",
    val planned_exercises: List<PlannedExerciseDto>? = null,
    val notes: String? = null,
    val completed: Boolean = false
)

object WeekJson {

    private val json = Json { ignoreUnknownKeys = true }

    fun decode(body: String, planName: String, today: LocalDate): PlanWeek? {
        val week = runCatching { json.decodeFromString<WeekDto>(body) }.getOrNull() ?: return null
        val days = week.days.mapNotNull { day ->
            val date = day.day_date ?: return@mapNotNull null
            // A planned entry carries no load, so the weight starts at zero and
            // the view model fills it in from what you lifted last time.
            val exercises = day.planned_exercises.orEmpty().mapNotNull { planned ->
                val name = planned.exercise.trim()
                if (name.isEmpty() || planned.sets <= 0 || planned.reps <= 0) {
                    return@mapNotNull null
                }
                PlanExercise(
                    name = name,
                    sets = planned.sets,
                    reps = planned.reps,
                    weightKg = planned.weight_kg ?: 0.0
                )
            }
            PlanDaySummary(
                date = date,
                sport = day.sport ?: "rest",
                focus = day.planned_focus?.trim()?.takeIf { it.isNotBlank() },
                status = if (day.completed) "completed" else day.day_status,
                exercises = exercises,
                isToday = date == today.toString(),
                id = day.id,
                notes = day.notes?.takeIf { it.isNotBlank() }
            )
        }
        if (days.isEmpty()) return null
        return PlanWeek(
            planName = planName,
            weekNumber = week.week_number,
            weekStart = week.week_start ?: days.first().date,
            weekEnd = week.week_end ?: days.last().date,
            days = days,
            planId = week.plan_id
        )
    }
}

class PlanApi(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * The active plan's week around [today], or null when there is no plan or
     * no signal. Weeks are Monday-based, as the API's `/week/{n}` is.
     */
    /**
     * The active plan's week [weekOffset] weeks from today's (0 = this week),
     * or null when there is no plan or no signal. Weeks are Monday-based, as
     * the API's `/week/{n}` is, and the number is clamped to the plan's extent
     * so paging past either end stays on a real week.
     */
    suspend fun weekPlan(
        token: String,
        today: LocalDate,
        weekOffset: Int = 0
    ): PlanWeek? = withContext(Dispatchers.IO) {
        val plansBody = runCatching { get("$baseUrl/training-plans", token) }.getOrNull()
            ?: return@withContext null
        val active = PlanJson.activePlan(PlanJson.plans(plansBody), today) ?: return@withContext null

        val start = active.start_date?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: return@withContext null
        val end = active.end_date?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val thisWeek = PlanWeeks.weekNumber(start, today)
        val total = end?.let { PlanWeeks.totalWeeks(start, it) } ?: thisWeek
        val weekNumber = PlanWeeks.clamp(thisWeek + weekOffset, total)

        val body = runCatching { get("$baseUrl/training-plans/${active.id}/week/$weekNumber", token) }
            .getOrNull() ?: return@withContext null
        WeekJson.decode(body, active.name, today)
            ?.copy(thisWeekNumber = thisWeek, totalWeeks = total)
    }

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

    /**
     * Writes a day back. Only the fields in [edit] are sent, so a focus change
     * cannot overwrite the prescription and vice versa.
     */
    suspend fun saveDay(
        token: String,
        planId: String,
        dayId: String,
        edit: PlanDayEdit
    ): PlanDaySave = withContext(Dispatchers.IO) {
        val payload = buildJsonObject {
            edit.sport?.let { put("sport", it) }
            edit.focus?.let { put("planned_focus", it) }
            edit.notes?.let { put("notes", it) }
            edit.exercises?.let { exercises ->
                put(
                    "planned_exercises",
                    buildJsonArray {
                        exercises.forEach { exercise ->
                            add(
                                buildJsonObject {
                                    put("exercise", exercise.name)
                                    put("sets", exercise.sets)
                                    put("reps", exercise.reps)
                                    if (exercise.weightKg > 0.0) {
                                        put("weight_kg", exercise.weightKg)
                                    }
                                }
                            )
                        }
                    }
                )
            }
        }

        val request = Request.Builder()
            .url("$baseUrl/training-plans/$planId/days/$dayId")
            .header("Authorization", "Bearer $token")
            .patch(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) return@withContext PlanDaySave.Saved
            // A 409 means the date already holds another session of that sport:
            // the server's sentence explains it better than a code would.
            val detail = runCatching {
                json.parseToJsonElement(body).jsonObject["detail"]?.jsonPrimitive?.content
            }.getOrNull()
            PlanDaySave.Refused(detail ?: "The plan refused that change (${response.code}).")
        }
    }
}

/** What a day edit can change; every field is optional and only one may be set. */
data class PlanDayEdit(
    val sport: String? = null,
    val focus: String? = null,
    val notes: String? = null,
    val exercises: List<PlanExercise>? = null
)

sealed interface PlanDaySave {
    data object Saved : PlanDaySave
    data class Refused(val message: String) : PlanDaySave
}
