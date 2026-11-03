from app.services.big3 import canonical_big3_bucket, canonical_big3_total


def test_canonical_lifts_map():
    assert canonical_big3_bucket("Back Squat") == "Squat"
    assert canonical_big3_bucket("bench press") == "Bench Press"
    assert canonical_big3_bucket("  Deadlift ") == "Deadlift"


def test_squat_variants_are_not_big3():
    for name in (
        "Belt Squat",
        "Box Squat",
        "Front Squat",
        "Hack Squat",
        "Pause Squat",
        "Safety Bar Squat",
    ):
        assert canonical_big3_bucket(name) is None, name


def test_other_accessories_are_not_big3():
    for name in ("Close Grip Bench Press", "Incline Bench Press", "Romanian Deadlift"):
        assert canonical_big3_bucket(name) is None, name


def test_total_ignores_gaps_and_variants():
    values = {"Squat": 145.2, "Bench Press": 112.5, "Deadlift": None}
    assert canonical_big3_total(values) == 257.7
    assert canonical_big3_total({"Squat": None, "Bench Press": None, "Deadlift": None}) == 0.0
