"""Standardise bilateral weights to per-arm + merge duplicate exercise names.

Revision ID: 072
Revises: 071
Create Date: 2026-09-24

Production mixed two conventions for bilateral moves: sometimes one arm's
weight (per dumbbell/handle), sometimes both arms added together. The
standard going forward is PER-ARM (see PER_ARM_EXERCISES in
app/services/exercise_db.py).

This migration fixes history (audited 2026-09-24, single user):

1. Halve combined totals → per-arm for unambiguous bilateral exercises
   whose full history sits at ~2x plausible per-hand loads:
   - Hammer Curl 30-42 → 15-21, Lateral Raise 10/15/20 → 5/7.5/10,
     Rear Delt Fly 12/18 → 6/9, Cable Fly 79 → 39.5 (dual-stack total).
   Incline Dumbbell Press (24-26) was already per-arm — untouched.
2. Merge duplicate names: "Triceps Pushdown" → "Tricep Pushdown",
   "Chest Supported Ro" (truncated) → "Chest Supported Row".
3. Unit slip: Tricep Pushdown 130x12 x2 (2026-08-25) → 59.0 kg
   (130 lb = 59.0 kg, matches the surrounding 52-60 cluster).
4. Recompute session volumes + halve affected PRs (Brzycki is linear in
   weight, so halving preserves the best-set ordering).
5. Deactivate the duplicate "Triceps Pushdown" global library row.

Deliberately NOT touched (ambiguous — flagged for user review):
- Bicep Curl 20-30 (barbell vs dumbbell implement unknown),
- Tricep Pushdown 25 vs 52 (single-stack cable: variants, not bilateral),
- Seated Cable Row 59 vs 80 (likely lb/kg machine change),
- Shrug 24, Calf Raise 40/70, Chest Press 40/60 (machine progress).

Every touched row carries an audit tag in ``notes`` so downgrade reverses
exactly what upgrade did (tags are stripped last, so a later re-upgrade
re-applies cleanly). One deliberate exception: the PR dedupe DELETE (when
both duplicate names hold a PR, the inferior estimate is dropped) is one-way —
the surviving PR keeps the best estimate and the underlying sets are intact,
so ``cleanup_orphaned_prs`` can rebuild if ever needed.
"""

import sqlalchemy as sa

from alembic import op

revision = "072"
down_revision = "071"
branch_labels = None
depends_on = None

TAG_HALVE = "[std-perarm-072]"
TAG_RENAME = "[std-rename-072]"
TAG_UNIT = "[std-unit-072]"

# Exercise histories verified as uniformly combined totals (see docstring).
HALVE_EXERCISES = (
    "Hammer Curl",
    "Lateral Raise",
    "Rear Delt Fly",
    "Cable Fly",
)

RENAMES = {
    "Triceps Pushdown": "Tricep Pushdown",
    "Chest Supported Ro": "Chest Supported Row",
}


def _tag(col: str, tag: str) -> str:
    return (
        f"{col} = CASE WHEN {col} IS NULL OR {col} = '' "
        f"THEN '{tag}' ELSE {col} || ' {tag}' END"
    )


def upgrade() -> None:
    # 1. Merge duplicate names (sets, PRs, videos, warmup templates).
    for old, new in RENAMES.items():
        op.execute(
            sa.text(
                f"UPDATE lifting_sets SET exercise_name = :new, {_tag('notes', TAG_RENAME)} "
                f"WHERE exercise_name = :old "
                f"AND (notes IS NULL OR notes NOT LIKE '%{TAG_RENAME}%')"
            ).bindparams(old=old, new=new)
        )
        op.execute(
            sa.text(
                f"UPDATE personal_records SET exercise_name = :new, {_tag('notes', TAG_RENAME)} "
                f"WHERE exercise_name = :old "
                f"AND (notes IS NULL OR notes NOT LIKE '%{TAG_RENAME}%')"
            ).bindparams(old=old, new=new)
        )
        op.execute(
            sa.text(
                f"UPDATE lift_videos SET exercise_name = :new, {_tag('notes', TAG_RENAME)} "
                f"WHERE exercise_name = :old "
                f"AND (notes IS NULL OR notes NOT LIKE '%{TAG_RENAME}%')"
            ).bindparams(old=old, new=new)
        )
        op.execute(
            sa.text(
                "UPDATE warmup_templates SET exercise_name = :new "
                "WHERE exercise_name = :old"
            ).bindparams(old=old, new=new)
        )

    # De-dupe PRs if both names had one (keep the best estimate).
    for new in RENAMES.values():
        op.execute(
            sa.text(
                "DELETE FROM personal_records a USING personal_records b "
                "WHERE a.exercise_name = :new AND b.exercise_name = :new "
                "AND a.record_type = b.record_type AND a.user_id = b.user_id "
                "AND a.id != b.id "
                "AND (a.estimated_1rm IS NULL OR a.estimated_1rm < b.estimated_1rm)"
            ).bindparams(new=new)
        )

    # 2. Unit slip: 130 lb logged as kg → 59.0 kg (guarded to the exact rows).
    op.execute(
        sa.text(
            f"UPDATE lifting_sets SET weight_kg = 59.0, {_tag('notes', TAG_UNIT)} "
            f"WHERE exercise_name = 'Tricep Pushdown' AND weight_kg = 130 "
            f"AND (notes IS NULL OR notes NOT LIKE '%{TAG_UNIT}%')"
        )
    )

    # 3. Halve combined totals → per-arm (all sets incl. warmups, same convention).
    for name in HALVE_EXERCISES:
        op.execute(
            sa.text(
                f"UPDATE lifting_sets SET weight_kg = ROUND((weight_kg / 2)::numeric, 2), "
                f"{_tag('notes', TAG_HALVE)} "
                f"WHERE exercise_name = :name "
                f"AND (notes IS NULL OR notes NOT LIKE '%{TAG_HALVE}%')"
            ).bindparams(name=name)
        )
        op.execute(
            sa.text(
                f"UPDATE personal_records SET weight_kg = ROUND((weight_kg / 2)::numeric, 2), "
                f"estimated_1rm = ROUND((estimated_1rm / 2)::numeric, 2), "
                f"{_tag('notes', TAG_HALVE)} "
                f"WHERE exercise_name = :name AND record_type = '1rm' "
                f"AND (notes IS NULL OR notes NOT LIKE '%{TAG_HALVE}%')"
            ).bindparams(name=name)
        )

    # 4. Recompute session volumes for every touched session.
    op.execute(
        sa.text(
            "UPDATE lifting_sessions s SET total_volume_kg = sub.vol FROM ("
            "SELECT session_id, COALESCE(SUM(weight_kg * reps) "
            "FILTER (WHERE is_warmup = false), 0) AS vol "
            "FROM lifting_sets GROUP BY session_id) sub "
            "WHERE s.id = sub.session_id AND s.id IN "
            "(SELECT DISTINCT session_id FROM lifting_sets WHERE notes LIKE '%072%')"
        )
    )

    # 5. Deactivate the duplicate global library row (code alias now unifies).
    op.execute(
        sa.text(
            "UPDATE exercises SET is_active = false "
            "WHERE user_id IS NULL AND name = 'Triceps Pushdown'"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE exercises SET is_active = true "
            "WHERE user_id IS NULL AND name = 'Triceps Pushdown'"
        )
    )
    for name in HALVE_EXERCISES:
        op.execute(
            sa.text(
                f"UPDATE lifting_sets SET weight_kg = ROUND((weight_kg * 2)::numeric, 2) "
                f"WHERE exercise_name = :name AND notes LIKE '%{TAG_HALVE}%'"
            ).bindparams(name=name)
        )
        op.execute(
            sa.text(
                f"UPDATE personal_records SET weight_kg = ROUND((weight_kg * 2)::numeric, 2), "
                f"estimated_1rm = ROUND((estimated_1rm * 2)::numeric, 2) "
                f"WHERE exercise_name = :name AND notes LIKE '%{TAG_HALVE}%'"
            ).bindparams(name=name)
        )
    op.execute(
        sa.text(
            f"UPDATE lifting_sets SET weight_kg = 130 "
            f"WHERE exercise_name = 'Tricep Pushdown' AND notes LIKE '%{TAG_UNIT}%'"
        )
    )
    for old, new in RENAMES.items():
        op.execute(
            sa.text(
                f"UPDATE lifting_sets SET exercise_name = :old "
                f"WHERE exercise_name = :new AND notes LIKE '%{TAG_RENAME}%'"
            ).bindparams(old=old, new=new)
        )
        op.execute(
            sa.text(
                f"UPDATE personal_records SET exercise_name = :old "
                f"WHERE exercise_name = :new AND notes LIKE '%{TAG_RENAME}%'"
            ).bindparams(old=old, new=new)
        )
        op.execute(
            sa.text(
                f"UPDATE lift_videos SET exercise_name = :old "
                f"WHERE exercise_name = :new AND notes LIKE '%{TAG_RENAME}%'"
            ).bindparams(old=old, new=new)
        )
        op.execute(
            sa.text(
                "UPDATE warmup_templates SET exercise_name = :old "
                "WHERE exercise_name = :new"
            ).bindparams(old=old, new=new)
        )
    # Volumes: recompute again after the weight reversal.
    op.execute(
        sa.text(
            "UPDATE lifting_sessions s SET total_volume_kg = sub.vol FROM ("
            "SELECT session_id, COALESCE(SUM(weight_kg * reps) "
            "FILTER (WHERE is_warmup = false), 0) AS vol "
            "FROM lifting_sets GROUP BY session_id) sub "
            "WHERE s.id = sub.session_id AND s.id IN "
            "(SELECT DISTINCT session_id FROM lifting_sets WHERE notes LIKE '%072%')"
        )
    )
    # Strip audit tags last: a later re-upgrade must see untagged rows and
    # re-apply (otherwise down→up is a silent no-op). Runs after the volume
    # recompute above, which still needs the tags to find touched sessions.
    for table in ("lifting_sets", "personal_records", "lift_videos"):
        op.execute(
            sa.text(
                f"UPDATE {table} SET notes = NULLIF(TRIM(REPLACE(REPLACE(REPLACE("
                f"notes, '{TAG_HALVE}', ''), '{TAG_UNIT}', ''), '{TAG_RENAME}', '')), '') "
                f"WHERE notes LIKE '%072%'"
            )
        )
