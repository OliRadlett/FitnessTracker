"""Exercise database — canonical names, aliases, normalisation, and categorisation.

Provides a built-in database of powerlifting and strength training exercises with:
- Canonical names (title-cased, singular)
- Aliases for fuzzy matching (lowercase)
- Categories (big3, compound, accessory)
- A normalisation function that maps user input to canonical names
"""

from __future__ import annotations

# ── Big 3 (primary powerlifts) ───────────────────────────────────────────────

BIG_3_ORDER = ["Back Squat", "Bench Press", "Deadlift"]

# ── Exercise database by category ────────────────────────────────────────────

EXERCISE_DB: dict[str, list[str]] = {
    "big3": [
        "Back Squat",
        "Bench Press",
        "Deadlift",
    ],
    "compound": [
        "Front Squat",
        "Overhead Press",
        "Barbell Row",
        "Pendlay Row",
        "Romanian Deadlift",
        "Sumo Deadlift",
        "Incline Bench Press",
        "Close Grip Bench Press",
        "Pause Bench Press",
        "Pause Squat",
        "Tempo Squat",
        "Deficit Deadlift",
        "Block Pull",
        "Rack Pull",
        "Pull Up",
        "Chin Up",
        "Dip",
        "Clean and Jerk",
        "Snatch",
        "Clean",
        "Power Clean",
        "Push Press",
        "Log Press",
        "Leg Press",
        "Hack Squat",
        "Bulgarian Split Squat",
        "Walking Lunge",
        "Barbell Hip Thrust",
        "T Bar Row",
        "Seal Row",
        "Dumbbell Bench Press",
        "Dumbbell Row",
        "Dumbbell Shoulder Press",
        "Weighted Pull Up",
        "Weighted Dip",
    ],
    "accessory": [
        # Legs
        "Leg Curl",
        "Leg Extension",
        "Calf Raise",
        "Seated Calf Raise",
        "Goblet Squat",
        "Lateral Lunge",
        "Step Up",
        "Nordic Hamstring Curl",
        "Glute Ham Raise",
        # Chest
        "Cable Fly",
        "Dumbbell Fly",
        "Pec Deck",
        "Chest Press Machine",
        "Push Up",
        # Back
        "Lat Pulldown",
        "Cable Row",
        "Seated Cable Row",
        "Face Pull",
        "Straight Arm Pulldown",
        "Rear Delt Fly",
        "Shrug",
        # Shoulders
        "Lateral Raise",
        "Front Raise",
        "Rear Delt Row",
        "Arnold Press",
        "Cable Lateral Raise",
        "Upright Row",
        # Arms
        "Bicep Curl",
        "Barbell Curl",
        "Dumbbell Curl",
        "Hammer Curl",
        "Preacher Curl",
        "Concentration Curl",
        "Cable Curl",
        "Tricep Pushdown",
        "Tricep Extension",
        "Skull Crusher",
        "Overhead Tricep Extension",
        "Close Grip Push Up",
        # Core
        "Plank",
        "Ab Wheel Rollout",
        "Cable Crunch",
        "Hanging Leg Raise",
        "Russian Twist",
        "Side Plank",
        "Dead Bug",
        "Pallof Press",
        # Other
        "Farmer Walk",
        "Sled Push",
        "Sled Pull",
        "Battle Ropes",
        "Kettlebell Swing",
    ],
}


# ── Alias mapping (lowercase → canonical) ────────────────────────────────────

_ALIASES: dict[str, str] = {
    # Big 3
    "squat": "Back Squat",
    "squats": "Back Squat",
    "back squat": "Back Squat",
    "back squats": "Back Squat",
    "low bar squat": "Back Squat",
    "high bar squat": "Back Squat",
    "bench": "Bench Press",
    "bench press": "Bench Press",
    "flat bench": "Bench Press",
    "flat bench press": "Bench Press",
    "bp": "Bench Press",
    "deadlift": "Deadlift",
    "deadlifts": "Deadlift",
    "conv": "Deadlift",
    "conventional": "Deadlift",
    "conventional deadlift": "Deadlift",
    # Compounds
    "front squat": "Front Squat",
    "front squats": "Front Squat",
    "fsq": "Front Squat",
    "ohp": "Overhead Press",
    "overhead press": "Overhead Press",
    "shoulder press": "Overhead Press",
    "military press": "Overhead Press",
    "standing press": "Overhead Press",
    "barbell row": "Barbell Row",
    "bent over row": "Barbell Row",
    "bb row": "Barbell Row",
    "pendlay": "Pendlay Row",
    "pendlay row": "Pendlay Row",
    "rdl": "Romanian Deadlift",
    "romanian deadlift": "Romanian Deadlift",
    "romanian deadlifts": "Romanian Deadlift",
    "sumo": "Sumo Deadlift",
    "sumo deadlift": "Sumo Deadlift",
    "sumo deadlifts": "Sumo Deadlift",
    "sumo dl": "Sumo Deadlift",
    "incline bench": "Incline Bench Press",
    "incline bench press": "Incline Bench Press",
    "incline bp": "Incline Bench Press",
    "cgbp": "Close Grip Bench Press",
    "close grip bench": "Close Grip Bench Press",
    "close grip bench press": "Close Grip Bench Press",
    "close grip": "Close Grip Bench Press",
    "pause bench": "Pause Bench Press",
    "pause bench press": "Pause Bench Press",
    "pause squat": "Pause Squat",
    "tempo squat": "Tempo Squat",
    "deficit deadlift": "Deficit Deadlift",
    "deficit dl": "Deficit Deadlift",
    "deficit": "Deficit Deadlift",
    "block pull": "Block Pull",
    "rack pull": "Rack Pull",
    "pull up": "Pull Up",
    "pullup": "Pull Up",
    "pull-ups": "Pull Up",
    "chin up": "Chin Up",
    "chinup": "Chin Up",
    "chin-ups": "Chin Up",
    "dip": "Dip",
    "dips": "Dip",
    "clean and jerk": "Clean and Jerk",
    "c&j": "Clean and Jerk",
    "snatch": "Snatch",
    "power clean": "Power Clean",
    "push press": "Push Press",
    "log press": "Log Press",
    "leg press": "Leg Press",
    "hack squat": "Hack Squat",
    "bulgarian split squat": "Bulgarian Split Squat",
    "bss": "Bulgarian Split Squat",
    "split squat": "Bulgarian Split Squat",
    "walking lunge": "Walking Lunge",
    "lunges": "Walking Lunge",
    "hip thrust": "Barbell Hip Thrust",
    "barbell hip thrust": "Barbell Hip Thrust",
    "t bar row": "T Bar Row",
    "t-bar row": "T Bar Row",
    "seal row": "Seal Row",
    "db bench": "Dumbbell Bench Press",
    "dumbbell bench": "Dumbbell Bench Press",
    "dumbbell bench press": "Dumbbell Bench Press",
    "db row": "Dumbbell Row",
    "dumbbell row": "Dumbbell Row",
    "db shoulder press": "Dumbbell Shoulder Press",
    "dumbbell shoulder press": "Dumbbell Shoulder Press",
    "weighted pull up": "Weighted Pull Up",
    "weighted pullup": "Weighted Pull Up",
    "weighted dip": "Weighted Dip",
    # Accessories
    "leg curl": "Leg Curl",
    "hamstring curl": "Leg Curl",
    "lying leg curl": "Leg Curl",
    "seated leg curl": "Leg Curl",
    "leg extension": "Leg Extension",
    "leg ext": "Leg Extension",
    "calf raise": "Calf Raise",
    "calf raises": "Calf Raise",
    "standing calf raise": "Calf Raise",
    "seated calf raise": "Seated Calf Raise",
    "goblet squat": "Goblet Squat",
    "lateral lunge": "Lateral Lunge",
    "step up": "Step Up",
    "nordic hamstring curl": "Nordic Hamstring Curl",
    "nordic curl": "Nordic Hamstring Curl",
    "nordics": "Nordic Hamstring Curl",
    "glute ham raise": "Glute Ham Raise",
    "ghr": "Glute Ham Raise",
    "cable fly": "Cable Fly",
    "cable flye": "Cable Fly",
    "cable flies": "Cable Fly",
    "dumbbell fly": "Dumbbell Fly",
    "dumbbell flye": "Dumbbell Fly",
    "pec deck": "Pec Deck",
    "push up": "Push Up",
    "pushup": "Push Up",
    "push ups": "Push Up",
    "pushups": "Push Up",
    "lat pulldown": "Lat Pulldown",
    "lat pull down": "Lat Pulldown",
    "lats": "Lat Pulldown",
    "cable row": "Cable Row",
    "seated cable row": "Seated Cable Row",
    "face pull": "Face Pull",
    "face pulls": "Face Pull",
    "straight arm pulldown": "Straight Arm Pulldown",
    "rear delt fly": "Rear Delt Fly",
    "rear delt flye": "Rear Delt Fly",
    "rear delt": "Rear Delt Fly",
    "shrug": "Shrug",
    "shrugs": "Shrug",
    "barbell shrug": "Shrug",
    "lateral raise": "Lateral Raise",
    "lateral raises": "Lateral Raise",
    "lat raise": "Lateral Raise",
    "side lateral": "Lateral Raise",
    "front raise": "Front Raise",
    "rear delt row": "Rear Delt Row",
    "arnold press": "Arnold Press",
    "cable lateral raise": "Cable Lateral Raise",
    "upright row": "Upright Row",
    "bicep curl": "Bicep Curl",
    "barbell curl": "Barbell Curl",
    "dumbbell curl": "Dumbbell Curl",
    "hammer curl": "Hammer Curl",
    "hammer curls": "Hammer Curl",
    "preacher curl": "Preacher Curl",
    "concentration curl": "Concentration Curl",
    "cable curl": "Cable Curl",
    "tricep pushdown": "Tricep Pushdown",
    "tricep extension": "Tricep Extension",
    "skull crusher": "Skull Crusher",
    "skull crushers": "Skull Crusher",
    "overhead tricep extension": "Overhead Tricep Extension",
    "oh tricep ext": "Overhead Tricep Extension",
    "close grip push up": "Close Grip Push Up",
    "plank": "Plank",
    "ab wheel": "Ab Wheel Rollout",
    "ab wheel rollout": "Ab Wheel Rollout",
    "cable crunch": "Cable Crunch",
    "hanging leg raise": "Hanging Leg Raise",
    "russian twist": "Russian Twist",
    "side plank": "Side Plank",
    "dead bug": "Dead Bug",
    "pallof press": "Pallof Press",
    "farmer walk": "Farmer Walk",
    "farmer carry": "Farmer Walk",
    "farmer's walk": "Farmer Walk",
    "sled push": "Sled Push",
    "sled pull": "Sled Pull",
    "battle ropes": "Battle Ropes",
    "kettlebell swing": "Kettlebell Swing",
    "kb swing": "Kettlebell Swing",
}


# ── Reverse lookup: canonical name → category ───────────────────────────────

_CATEGORY_MAP: dict[str, str] = {}
for _cat, _exercises in EXERCISE_DB.items():
    for _ex in _exercises:
        _CATEGORY_MAP[_ex] = _cat


def normalise_exercise_name(raw: str) -> str:
    """Normalise a user-provided exercise name to its canonical form.

    Steps:
    1. Strip whitespace and title-case
    2. Check alias map (case-insensitive)
    3. Check if title-cased form matches a canonical name exactly
    4. Return the best match or the title-cased input as-is
    """
    raw_stripped = raw.strip()
    if not raw_stripped:
        return raw_stripped

    # Check alias map first (case-insensitive)
    alias_match = _ALIASES.get(raw_stripped.lower())
    if alias_match:
        return alias_match

    # Check if title-cased form matches a canonical name
    title_cased = raw_stripped.title()
    if title_cased in _CATEGORY_MAP:
        return title_cased

    # Fuzzy check: see if any canonical name matches when lowered
    raw_lower = raw_stripped.lower()
    for canonical in _CATEGORY_MAP:
        if canonical.lower() == raw_lower:
            return canonical

    # No match found — return title-cased as best effort
    return title_cased


def get_category(exercise_name: str) -> str:
    """Return the category ('big3', 'compound', 'accessory') for an exercise name."""
    # Check canonical name first
    cat = _CATEGORY_MAP.get(exercise_name)
    if cat:
        return cat
    # Try normalised name
    normalised = normalise_exercise_name(exercise_name)
    return _CATEGORY_MAP.get(normalised, "accessory")


def search_exercises(query: str, limit: int = 10) -> list[dict[str, str]]:
    """Search exercises by name (case-insensitive substring match).

    Returns a list of {name, category} dicts, ordered: Big 3 first, then
    compounds, then accessories, with relevance (starts-with > contains).
    """
    query_lower = query.strip().lower()
    if not query_lower:
        # Return all exercises in default order
        results: list[dict[str, str]] = []
        for cat in ("big3", "compound", "accessory"):
            for name in EXERCISE_DB.get(cat, []):
                results.append({"name": name, "category": cat})
        return results[:limit]

    exact: list[dict[str, str]] = []
    starts_with: list[dict[str, str]] = []
    contains: list[dict[str, str]] = []

    for cat in ("big3", "compound", "accessory"):
        for name in EXERCISE_DB.get(cat, []):
            name_lower = name.lower()
            if name_lower == query_lower:
                exact.append({"name": name, "category": cat})
            elif name_lower.startswith(query_lower):
                starts_with.append({"name": name, "category": cat})
            elif query_lower in name_lower:
                contains.append({"name": name, "category": cat})

    # Also check aliases for matches
    for alias, canonical in _ALIASES.items():
        if query_lower in alias and canonical not in [e["name"] for e in exact + starts_with + contains]:
            cat = get_category(canonical)
            contains.append({"name": canonical, "category": cat})

    results = exact + starts_with + contains
    return results[:limit]


def get_all_exercises() -> list[dict[str, str]]:
    """Return all exercises in default display order."""
    return search_exercises("", limit=999)
