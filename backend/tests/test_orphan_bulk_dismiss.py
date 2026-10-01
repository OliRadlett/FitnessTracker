"""Bulk dismissal of quarantined routes, scoped to one review bucket.

28 of the queue's rows were badged "probably distinct", and dismissing them
one at a time is the difference between a decision and an afternoon. So the
queue needs a bulk action.

Two properties make this safe rather than merely convenient, and both are
asserted here:

1. **The count is verified before anything is written.** A bulk dismissal is
   durable and irreversible from the UI, so acting on a stale page would
   dismiss a set the user never saw. The caller passes the count it
   displayed; if the queue has moved on, the request is refused instead of
   silently hitting a different set of rows.

2. **It cannot touch a route that is not awaiting review.** The predicate is
   the same ``quarantined_at IS NOT NULL AND dismissed_at IS NULL`` the
   single-row dismiss uses, so bulk dismissal can never un-quarantine, and
   never re-stamps an already-dismissed row.

The service resolves bucket membership through the *same* scoring the list
endpoint uses, rather than trusting the caller's idea of what is in a
bucket — otherwise "dismiss the 28 distinct ones" could mean something
different at write time than it did on screen.
"""

from __future__ import annotations

import ast
from pathlib import Path

SERVICE_PY = Path(__file__).resolve().parents[1] / "app" / "services" / "route_quarantine.py"
API_PY = Path(__file__).resolve().parents[1] / "app" / "api" / "routes.py"
SCHEMAS_PY = Path(__file__).resolve().parents[1] / "app" / "schemas" / "route.py"

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _find(tree, name, within=None):
    scope = ast.walk(within) if within is not None else ast.walk(tree)
    return next(n for n in scope if isinstance(n, _FN) and n.name == name)


class TestBucketMembership:
    def test_service_exposes_a_bucket_dismiss(self):
        tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
        names = {n.name for n in ast.walk(tree) if isinstance(n, _FN)}
        assert "dismiss_bucket" in names, (
            f"expected dismiss_bucket, found {sorted(n for n in names if 'bucket' in n)}"
        )

    def test_membership_reuses_the_queue_not_a_second_scoring_rule(self):
        """One scoring rule, so the UI count and the write cannot diverge."""
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "dismiss_bucket")
        assert "list_review_queue" in ast.unparse(fn), (
            "bucket membership must come from list_review_queue; a second "
            "copy of the scoring rules is one more thing to drift out of sync "
            "with what the user was shown"
        )

    def test_unknown_buckets_are_rejected_rather_than_matching_nothing(self):
        """A typo'd bucket must fail loudly, not silently dismiss 0 rows."""
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "dismiss_bucket")
        assert "REVIEW_BUCKETS" in ast.unparse(fn), (
            "dismiss_bucket must validate the bucket against REVIEW_BUCKETS"
        )


class TestStaleCountIsRefused:
    def test_service_accepts_the_count_the_caller_displayed(self):
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "dismiss_bucket")
        assert "expected_count" in ast.unparse(fn)

    def test_a_mismatch_raises_rather_than_dismissing(self):
        tree = ast.parse(SERVICE_PY.read_text(encoding="utf-8"))
        fn = _find(tree, "dismiss_bucket")
        names = {n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
        assert "StaleReviewQueue" in names, (
            "a stale count must raise a dedicated error rather than dismiss "
            "whatever the queue holds now"
        )
        # The raise must precede the UPDATE.
        unparsed = ast.unparse(fn)
        assert unparsed.index("StaleReviewQueue") < unparsed.index("update("), (
            "the stale check must happen before any write, not after"
        )


class TestBulkDismissPredicate:
    def test_the_shared_predicate_is_quarantined_and_not_dismissed(self):
        """Asserted on the helper, since both callers defer to it."""
        fn = _find(
            ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "pending_review_clause"
        )
        unparsed = ast.unparse(fn)
        assert "quarantined_at.isnot(None)" in unparsed.replace(" ", "")
        assert "dismissed_at.is_(None)" in unparsed.replace(" ", "")

    def test_bulk_dismiss_uses_the_shared_predicate(self):
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "dismiss_bucket")
        assert "pending_review_clause" in ast.unparse(fn), (
            "bulk dismiss must carry the same pending-review predicate as the "
            "single-row dismiss"
        )

    def test_single_dismiss_uses_the_shared_predicate_too(self):
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "dismiss_route")
        assert "pending_review_clause" in ast.unparse(fn), (
            "if only one of the two callers uses the helper they will drift"
        )

    def test_bulk_dismiss_never_un_quarantines(self):
        fn = _find(ast.parse(SERVICE_PY.read_text(encoding="utf-8")), "dismiss_bucket")
        assert "quarantined_at=None" not in ast.unparse(fn), (
            "bulk dismiss must never un-quarantine anything"
        )


class TestBulkDismissApi:
    def test_endpoint_exists(self):
        src = API_PY.read_text(encoding="utf-8")
        assert '"/orphans/bulk-dismiss"' in src or '"/orphans/dismiss-bulk"' in src

    def test_endpoint_precedes_the_dynamic_route_id(self):
        """Pitfall #13, restated for the new static path.

        ``PATCH /{route_id}`` sits mid-file and will happily claim
        ``/orphans/bulk-dismiss``, 422-ing on UUID validation.
        """
        tree = ast.parse(API_PY.read_text(encoding="utf-8"))
        order: list[tuple[str, str]] = []
        for node in tree.body:
            if not isinstance(node, _FN):
                continue
            for dec in node.decorator_list:
                if (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and dec.func.attr in ("get", "post", "patch", "put", "delete")
                ):
                    order.append(
                        (dec.args[0].value if dec.args else "", dec.func.attr.upper())
                    )
        bulk = [i for i, (p, _) in enumerate(order) if "bulk" in p]
        dynamic = order.index(("/{route_id}", "PATCH"))
        assert bulk, "bulk-dismiss route not found in decorator order"
        assert min(bulk) < dynamic, (
            "the bulk-dismiss path is registered after PATCH /{route_id} and "
            "would be shadowed"
        )

    def test_request_schema_exists_and_carries_bucket_and_count(self):
        tree = ast.parse(SCHEMAS_PY.read_text(encoding="utf-8"))
        names = {n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
        assert any("Bulk" in n and "Dismiss" in n for n in names), (
            f"expected a bulk-dismiss request schema, found {sorted(names)}"
        )
