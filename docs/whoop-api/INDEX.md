# WHOOP Developer API Documentation (Offline Reference)

Downloaded from https://developer.whoop.com on 2026-08-17.

This directory contains the full Whoop Developer Platform documentation
converted to agent-readable Markdown format.

**Original sources:**
- Docs: https://developer.whoop.com
- OpenAPI Spec: https://api.prod.whoop.com/developer/doc/openapi.json

---

## API Reference

- [WHOOP API — OpenAPI Reference](api-reference.md) — Structured endpoint reference from the OpenAPI spec (20 endpoints, 31 schemas)
- [openapi-spec.json](openapi-spec.json) — Raw OpenAPI 3.x JSON spec (machine-readable)
## API Changelog

- [API Changelog](docs-api-changelog.md)
## Developer Guide

- [API Rate Limiting](docs-developing-rate-limiting.md)
- [App Approval](docs-developing-app-approval.md)
- [Cycle](docs-developing-user-data-cycle.md)
- [Design Guidelines](docs-developing-design-guidelines.md)
- [Getting Started](docs-developing-getting-started.md)
- [OAuth 2.0](docs-developing-oauth.md)
- [Overview](docs-developing-overview.md)
- [Pagination](docs-developing-pagination.md)
- [Recovery](docs-developing-user-data-recovery.md)
- [Sleep](docs-developing-user-data-sleep.md)
- [Support](docs-developing-support.md)
- [User](docs-developing-user-data-user.md)
- [Webhooks](docs-developing-webhooks.md)
- [Workout](docs-developing-user-data-workout.md)
- [v1 to v2 Migration Guide](docs-developing-v1-v2-migration.md)
## Getting Started

- [WHOOP Developer Platform](docs-introduction.md)
## Partner Integration

- [API Overview](docs-partner-overview.md)
- [Authentication](docs-partner-authentication.md)
- [Complete a Service Request](docs-partner-tutorials-complete-a-service-request.md)
- [Handle Partner Webhooks](docs-partner-tutorials-handle-webhooks.md)
- [Lab Requisitions](docs-partner-lab-requisitions.md)
- [Service Requests](docs-partner-service-requests.md)
- [Submit Diagnostic Results](docs-partner-tutorials-submit-diagnostic-results.md)
## Tutorials

- [Authenticating with WHOOP](docs-tutorials-access-token-postman.md)
- [Authenticating with WHOOP (with Passport)](docs-tutorials-access-token-passport.md)
- [Get Current Recovery Score](docs-tutorials-get-current-recovery-score.md)
- [Refreshing Access Tokens](docs-tutorials-refresh-token-javascript.md)
- [Refreshing Access Tokens](docs-tutorials-refresh-token-postman.md)
- [Tutorials](docs-tutorials.md)
## Whoop-101

- [WHOOP 101](docs-whoop-101.md)

---

## Quick Reference

**Base URL:** `https://api.prod.whoop.com`

**Authentication:** OAuth 2.0 Bearer tokens

**Scopes:** `read:recovery`, `read:sleep`, `read:workout`, `read:cycles`, `read:profile`, `read:body_measurement`

**Pagination:** Cursor-based via `next_token` parameter (max 25 records per page)

**Rate Limiting:** See [rate-limiting](docs-developing-rate-limiting.md)

**Webhooks:** See [webhooks](docs-developing-webhooks.md)

**OAuth Flow:** Authorization code grant with PKCE support. See [OAuth 2.0](docs-developing-oauth.md).

**Trusted Partner Flow:** Client credentials for partner integrations. See [partner authentication](docs-partner-authentication.md).

