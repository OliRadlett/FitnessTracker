# Agent foundations implementation

- [x] Phase A: Frame
- [x] Define the done predicate and scope.
- [x] Phase B: Design the workflow
- [x] Sequence verification before policy and documentation changes.
- [x] Phase C: Run the loop
- [x] Add the verification entrypoint and project manifest.
- [x] Add agent-map validation against CODEMAP anchors.
- [x] Make application migration failure fatal.
- [x] Add migration and OpenAPI contract checks to CI.
- [x] Make the existing CI E2E lane blocking.
- [x] Correct the agent test and migration commands.
- [x] Normalize OAuth email identity (delivery-order finding #2) + regression test.
- [x] Phase D: Keep the audit trail
- [x] Log each verified unit in `.audit/agent-foundations-2026-10-23.tsv`.
- [x] Phase E: Verify and hand back
- [x] Run focused checks and report any unavailable checks.

Open follow-ups: add a real frontend-to-backend E2E lane, expand CODEMAP
content checks beyond path existence, add scientific golden-data fixtures.
Address remaining audit findings: XSS sink in route-map popups, taper
idempotency, orphan quarantine producer, Wahoo merge accounting, Whoop
timezone dates, route-grid latitude scaling.
