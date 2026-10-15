"""Jev (TypeSafe) strength-session classification.

Assigns every lifting session three typed labels derived from its **sets** plus
metadata and note (not the note alone — unlike ``jev_tagging``, which only fires
on a non-empty note):

* ``session_split`` — push | pull | legs | upper | lower | full_body
* ``session_lift``  — squat | bench | deadlift | overhead_press | accessory | none
* ``session_class`` — max_strength | volume_hypertrophy | speed_power | technique |
  accessory_conditioning | deload | test

Design (see plans/jev-strength-session-classification.md):

* **Best-effort and additive.** No-op when Jev is unset, never raises, never
  blocks a write. A session write commits regardless.
* **Deterministic numbers stay deterministic.** Tonnage, %e1RM etc. are sent as
  *state* so Jev is not misled, but are never asked as questions.
* **Rule fallback + cross-check.** A small pure rule engine (``rule_labels``)
  produces a baseline that is stored in ``ai_classification["rule"]``; where it
  disagrees with Jev the payload is flagged ``disagreement`` (it never silently
  overrides Jev). Consumers that need a label while Jev is unset compute it with
  ``rule_labels`` on demand — we deliberately do **not** write rule labels when
  Jev is unset, so an unconfigured deployment is byte-for-byte unchanged.
* **Staleness key.** ``content_hash`` covers the sets + metadata + taxonomy
  version, so editing a set re-classifies (unlike ``jev_tagging``'s note hash).

The split/lift vocabularies are aligned to ``TrainingPlanDay.planned_focus`` on
purpose, so a label compares directly against a planned day.
"""

from __future__ import annotations

import hashlib
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.integrations import jev_client
from app.models.lifting import LiftingSession

logger = logging.getLogger(__name__)

# Bump when the label vocabularies change — a re-tag event, not a migration.
TAXONOMY_VERSION = "v0"

# Confidence floors (mirrors jev_tagging.CHOICE_MIN_CONFIDENCE).
CHOICE_MIN_CONFIDENCE = 0.60  # store + surface the label
PROVISIONAL_MIN_CONFIDENCE = 0.40  # store as provisional only, never assert

MAX_SETS = 40  # cap what is sent
MAX_WARMUPS = 3
NOTE_CAP = 2000

AXES = ("session_split", "session_lift", "session_class")

SPLIT_LABELS = ("push", "pull", "legs", "upper", "lower", "full_body")
LIFT_LABELS = ("squat", "bench", "deadlift", "overhead_press", "accessory", "none")
INTENT_LABELS = (
    "max_strength",
    "volume_hypertrophy",
    "speed_power",
    "technique",
    "accessory_conditioning",
    "deload",
    "test",
)


# ── Question builders ────────────────────────────────────────────────────────


def _questions() -> dict:
    return {
        "session_split": jev_client.choice(
            "Which training split does this session best represent? "
            "Answer for the session as a whole, not one exercise.",
            {
                "push": "Chest, shoulders and triceps dominant (bench, press, dip, fly)",
                "pull": "Back, biceps, rear delts and hinge-dominant (row, pull-up, deadlift, curl)",
                "legs": "Quad, hamstring and glute dominant (squat, lunge, leg press)",
                "upper": "Mixed upper body with no clear push or pull dominance",
                "lower": "Mixed lower body with no clear quad/hamstring or hinge dominance",
                "full_body": "Whole body across several patterns in one session",
            },
        ),
        "session_lift": jev_client.choice(
            "Which competition lift, if any, is the focus of this session?",
            {
                "squat": "A squat variation is the main lift",
                "bench": "A bench press variation is the main lift",
                "deadlift": "A deadlift/hinge variation is the main lift",
                "overhead_press": "An overhead/military press is the main lift",
                "accessory": "No single competition lift dominates; accessory or GPP work",
                "none": "No clear focus / cannot tell",
            },
        ),
        "session_class": jev_client.choice(
            "What best describes the training intent/quality of this session?",
            {
                "max_strength": "Heavy, low-rep competition-lift work at high intensity",
                "volume_hypertrophy": "Moderate loads, higher reps — building volume or muscle",
                "speed_power": "Dynamic effort: fast submaximal reps, jumps or throws",
                "technique": "Submaximal drilling, technique/form focus, low fatigue",
                "accessory_conditioning": "Accessory, carry, sled, circuit or conditioning work",
                "deload": "Intentionally light/reduced volume, recovery session",
                "test": "Max attempts, 1RM test, competition or mock meet",
            },
        ),
    }


# ── State ────────────────────────────────────────────────────────────────────


def _selected_sets(session: LiftingSession) -> list:
    """Working sets plus at most ``MAX_WARMUPS`` warmups, capped at ``MAX_SETS``.

    ``session.sets`` is ordered by the relationship (order_index, created_at,
    id), so this selection is deterministic for the same content.
    """
    sets = list(session.sets)
    warmups = [s for s in sets if s.is_warmup][:MAX_WARMUPS]
    working = [s for s in sets if not s.is_warmup]
    return (warmups + working)[:MAX_SETS]


def _build_state(session: LiftingSession) -> dict:
    return {
        "focus": session.focus,
        "program_name": session.program_name,
        "duration_seconds": session.duration_seconds,
        "rpe_session": session.rpe_session,
        "total_volume_kg": session.total_volume_kg,
        "estimated_tss": session.estimated_tss,
        "notes": (session.notes or "")[:NOTE_CAP],
        "sets": [
            {
                "exercise": s.exercise_name,
                "weight_kg": s.weight_kg,
                "reps": s.reps,
                "rpe": s.rpe,
                "is_warmup": bool(s.is_warmup),
                "is_amrap": bool(s.is_amrap),
            }
            for s in _selected_sets(session)
        ],
    }


def content_hash(session: LiftingSession) -> str:
    """Stable hash of everything the classification depends on.

    Sets lead, so a set edit (the common post-log change) invalidates the hash
    and forces a re-classification.
    """
    parts: list[str] = [
        TAXONOMY_VERSION,
        session.focus or "",
        session.program_name or "",
        str(session.duration_seconds or ""),
        str(session.rpe_session or ""),
        str(session.total_volume_kg or ""),
        (session.notes or "")[:NOTE_CAP],
    ]
    for s in session.sets:
        parts.append(
            f"{s.exercise_name}|{s.weight_kg}|{s.reps}|{s.rpe}|"
            f"{int(bool(s.is_warmup))}|{int(bool(s.is_amrap))}"
        )
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


# ── Deterministic rule engine (fallback + cross-check) ───────────────────────

# Checked legs → pull → push so compound names resolve sensibly ("leg press"
# is legs, not push). Kept coarse on purpose: this is a cross-check, not the
# classifier.
_LEG_KEYWORDS = (
    "squat", "lunge", "leg press", "leg extension", "leg curl", "calf",
    "hip thrust", "glute", "step-up", "step up", "hack", "split squat",
)
_PULL_KEYWORDS = (
    "row", "pull-up", "pullup", "pull up", "chin", "curl", "face pull",
    "lat pulldown", "lat pull", "deadlift", "rdl", "romanian", "stiff leg",
    "shrug", "rear delt", "high pull", "good morning", "t-bar",
)
_PUSH_KEYWORDS = (
    "bench", "chest", "incline press", "decline press", "shoulder press",
    "overhead press", "military press", "ohp", "dip", "fly", "flye",
    "push-up", "pushup", "pushdown", "triceps", "lateral raise", "pec",
    "front raise", "skullcrusher",
)
_LIFT_KEYWORDS = {
    "squat": ("squat",),
    "bench": ("bench",),
    "deadlift": ("deadlift", "romanian", "rdl", "sumo"),
    "overhead_press": (
        "overhead press", "ohp", "military press", "strict press",
        "push press", "shoulder press", "standing press",
    ),
}


def _match_split(names: list[str]) -> str | None:
    counts = {"push": 0, "pull": 0, "legs": 0}
    for name in names:
        nl = name.lower()
        if any(k in nl for k in _LEG_KEYWORDS):
            counts["legs"] += 1
        elif any(k in nl for k in _PULL_KEYWORDS):
            counts["pull"] += 1
        elif any(k in nl for k in _PUSH_KEYWORDS):
            counts["push"] += 1
    total = sum(counts.values())
    if total == 0:
        return None
    dominant = max(counts, key=lambda k: counts[k])
    if counts[dominant] / total >= 0.6:
        return dominant  # legs|push|pull map 1:1 to the split label
    active = {k for k, v in counts.items() if v > 0}
    if len(active) == 3:
        return "full_body"
    if len(active) == 2:
        return "lower" if "legs" in active else "upper"
    return dominant


def _match_lift(names: list[str]) -> str | None:
    if not names:
        return None
    for lift, keywords in _LIFT_KEYWORDS.items():
        if any(any(k in n.lower() for k in keywords) for n in names):
            return lift
    return "accessory"


def _match_intent(session: LiftingSession) -> str | None:
    working = [s for s in session.sets if not s.is_warmup and s.reps]
    if not working:
        return None
    avg_reps = sum(s.reps for s in working) / len(working)
    if avg_reps <= 5:
        return "max_strength"
    if avg_reps <= 15:
        return "volume_hypertrophy"
    return "accessory_conditioning"


def rule_labels(session: LiftingSession) -> dict:
    """Deterministic provisional labels — the fallback and the cross-check.

    Public so a consumer that needs a split/lift/intent while Jev is unset (or
    on a row Jev has not reached) can compute one without a Jev call. Never
    writes anything.
    """
    names = [s.exercise_name for s in session.sets if s.exercise_name]
    return {
        "session_split": _match_split(names),
        "session_lift": _match_lift(names),
        "session_class": _match_intent(session),
    }


# ── Payload ──────────────────────────────────────────────────────────────────


def build_classification(
    result: jev_client.JevResult, hash_: str, model: str, rule: dict
) -> dict:
    """Map a ``JevResult`` to the stored ``ai_classification`` payload.

    Each axis is stored assertively (``label``) only at/above
    ``CHOICE_MIN_CONFIDENCE``; between the provisional and assertive floors it
    is stored as ``provisional`` and never asserted in a typed column.
    """
    payload: dict = {
        "source": "jev",
        "model": model,
        "resolved_model": result.model,
        "taxonomy_version": TAXONOMY_VERSION,
        "content_hash": hash_,
        "computed_at": result.computed_at,
        "rule": rule,
    }
    disagreements: list[str] = []
    for axis in AXES:
        ans = result.answers.get(axis)
        if ans is None or not ans.choice:
            continue
        confidence = ans.confidence or 0.0
        if confidence >= CHOICE_MIN_CONFIDENCE:
            entry: dict = {"label": ans.choice, "confidence": round(confidence, 3)}
            if ans.probabilities:
                entry["probabilities"] = ans.probabilities
            payload[axis] = entry
            rule_label = rule.get(axis)
            if rule_label and rule_label != ans.choice:
                disagreements.append(axis)
        elif confidence >= PROVISIONAL_MIN_CONFIDENCE:
            payload[axis] = {
                "label": None,
                "provisional": ans.choice,
                "confidence": round(confidence, 3),
            }
    payload["disagreement"] = bool(disagreements)
    if disagreements:
        payload["disagreement_axes"] = disagreements
    return payload


def _label(payload: dict, axis: str) -> str | None:
    entry = payload.get(axis) or {}
    return entry.get("label")


# ── Classification ───────────────────────────────────────────────────────────


async def classify_lifting_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    session: LiftingSession,
) -> bool:
    """Classify one session. Returns True when the labels changed.

    Never raises. No-op when Jev is unset, the session has no sets, or the
    stored classification is already current for this content + model +
    taxonomy version. ``session.sets`` must be loadable (already loaded, or the
    caller used ``selectinload``).
    """
    if not jev_client.is_configured():
        return False
    if not session.sets:
        return False

    hash_ = content_hash(session)
    existing = session.ai_classification or {}
    if (
        existing.get("content_hash") == hash_
        and existing.get("model") == get_settings().jev_model
        and existing.get("taxonomy_version") == TAXONOMY_VERSION
    ):
        return False

    rule = rule_labels(session)
    try:
        result = await jev_client.decide(
            _build_state(session), _questions(), user_id=user_id
        )
    except Exception as e:  # decide() shouldn't raise; belt-and-braces
        logger.warning("Jev classification failed for session %s: %s", session.id, e)
        return False

    if result is None:
        return False

    payload = build_classification(result, hash_, get_settings().jev_model, rule)
    session.ai_classification = payload
    session.session_split = _label(payload, "session_split")
    session.session_lift = _label(payload, "session_lift")
    session.session_class = _label(payload, "session_class")
    return True


async def classify_lifting_session_by_id(
    session_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    """Background entry point: open a session, classify, commit. Never raises."""
    from app.database import async_session_factory

    try:
        async with async_session_factory() as db:
            stmt = (
                select(LiftingSession)
                .options(selectinload(LiftingSession.sets))
                .where(LiftingSession.id == session_id)
            )
            session = (await db.execute(stmt)).scalar_one_or_none()
            if session is None or session.user_id != user_id:
                return
            if await classify_lifting_session(db, user_id, session):
                await db.commit()
    except Exception as e:
        logger.warning(
            "Jev background classification failed for session %s: %s", session_id, e
        )


async def backfill_session_classifications(
    db: AsyncSession, user_id: uuid.UUID
) -> int:
    """Classify all of a user's sessions that have sets. Idempotent.

    No-op when Jev is unset.
    """
    if not jev_client.is_configured():
        return 0

    tagged = 0
    stmt = (
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets))
        .where(LiftingSession.user_id == user_id)
    )
    for session in (await db.execute(stmt)).scalars():
        if not session.sets:
            continue
        if await classify_lifting_session(db, user_id, session):
            tagged += 1
    return tagged
