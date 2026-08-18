# Audit Changelog — 2026-08-18

> Condensed reference for debugging the large audit changelist.
> 3 commits: `535d900` → `dd480db` → `8874e6e`

## New Files (quick reference)

### Backend — Models
| File | Purpose |
|------|---------|
| `backend/app/models/goal.py` | Goal model (ftp_target, weight_target, weekly_sessions, 1rm_target, distance_target) |
| `backend/app/models/training_plan.py` | TrainingPlan + TrainingPlanDay models |
| `backend/app/models/event.py` | Event model (race/ride/lift with taper calculation) |

### Backend — Services
| File | Purpose |
|------|---------|
| `backend/app/services/encryption.py` | Fernet token encryption + EncryptedString TypeDecorator |
| `backend/app/services/fit_parser.py` | FIT file parser using fitparse |
| `backend/app/services/pdf_report.py` | Weekly/monthly PDF report generation via reportlab |
| `backend/app/services/running.py` | *(not created — pace zones skipped as user only cycles)* |

### Backend — API
| File | Purpose |
|------|---------|
| `backend/app/api/goals.py` | CRUD for goals with auto-computed progress |
| `backend/app/api/training_plans.py` | CRUD + auto-generate from templates |
| `backend/app/api/events.py` | CRUD with countdown/taper enrichment |

### Backend — Infrastructure
| File | Purpose |
|------|---------|
| `backend/app/logging_config.py` | Structured JSON logging + correlation ID filter |
| `backend/app/integrations/retry.py` | Shared exponential backoff retry utility |
| `backend/alembic/versions/014_add_composite_indexes.py` | *(DUPLICATE — 014 already exists for surface_profile)* |
| `backend/alembic/versions/015_add_composite_indexes.py` | Composite indexes on activities, daily_metrics, lifting_sessions, personal_records, routes |
| `backend/alembic/versions/016_cleanup_self_heal.py` | Moves self-heal SQL from main.py to Alembic |
| `backend/alembic/versions/017_encrypt_oauth_tokens.py` | Encrypt existing plain-text OAuth tokens |
| `backend/alembic/versions/018_add_goals.py` | Goals table |
| `backend/alembic/versions/019_add_training_plans_events.py` | TrainingPlan, TrainingPlanDay, Event tables |

### Frontend — Components
| File | Purpose |
|------|---------|
| `frontend/src/components/ui/ErrorBoundary.tsx` | React error boundary with retry |
| `frontend/src/components/ui/Skeleton.tsx` | Skeleton loading primitives |
| `frontend/src/components/ui/EmptyState.tsx` | Empty state with icon/title/CTA |
| `frontend/src/components/ui/PRCelebration.tsx` | Animated PR celebration toast |
| `frontend/src/components/ui/GoalCard.tsx` | Goal card with progress bar + GoalForm |
| `frontend/src/components/cycling/HRZonesDisplay.tsx` | HR zone horizontal bar display |
| `frontend/src/components/training/PlanBuilder.tsx` | Weekly calendar training plan builder |

### Frontend — Pages
| File | Purpose |
|------|---------|
| `frontend/src/app/(app)/training/page.tsx` | Training plans page with events + periodization chart |

### Frontend — API Clients
| File | Purpose |
|------|---------|
| `frontend/src/lib/api/goals.ts` | Goals CRUD API client |
| `frontend/src/lib/api/trainingPlans.ts` | Training plans CRUD + generate API client |
| `frontend/src/lib/api/events.ts` | Events CRUD API client |

### CI/CD
| File | Purpose |
|------|---------|
| `.github/workflows/test.yml` | GitHub Actions: lint (ruff) + test (pytest with PG service) |

### Docs
| File | Purpose |
|------|---------|
| `docs/api-versioning.md` | API versioning strategy (URL path, deprecation, sunset headers) |

## Modified Files (key changes)

### Backend
| File | What changed |
|------|-------------|
| `config.py` | SECRET_KEY hard fail in non-debug; env validation; backup_dir; prometheus; garmin/tp/zwift config |
| `main.py` | CORS tightened; rate limiting (slowapi); health check verifies DB+Redis; Prometheus /metrics; correlation ID middleware; logging setup |
| `scheduler.py` | print()→logger; backup_database task; sync_whoop_data uses logging |
| `webhooks.py` | HMAC-SHA256 signature verification |
| `activities.py` | merge-analysis endpoint; GPX+FIT import endpoints; X-Total-Count already existed |
| `lifting.py` | X-Total-Count header added |
| `routes.py` | X-Total-Count header added |
| `cycling.py` | VO2max estimation; decoupling analysis; HR zones from LTHR; benchmark classifications; enhanced FTP with Riegel |
| `charts.py` | db_execute removed; power curve cached+optimized; weight trend; vo2max_trend; decoupling_trend; periodization; HR zones; reference areas |
| `dashboard.py` | streaks endpoint; monthly summary; yearly summary; rest day suggestions |
| `strava_client.py` | Retry logic via retry_request on all methods |
| `wahoo_client.py` | Retry logic via retry_request on all methods |
| `user.py` | EncryptedString for tokens; goals/training_plans/events relationships |
| `pyproject.toml` | +slowapi, python-json-logger, cryptography, fitparse, reportlab, prometheus-fastapi-instrumentator; pytest asyncio_mode=auto |

### Frontend
| File | What changed |
|------|-------------|
| `layout.tsx` | ErrorBoundary wrapping; responsive padding; SidebarProvider |
| `Sidebar.tsx` | Responsive mobile hamburger menu; Training nav link |
| `auth.ts` | Replaced `any` types with JWT/Session types |
| `types.ts` | +HealthAnalysisResult, Vo2max*, Decoupling*, TrainingStreaks, Goal*, TrainingPlan*, Event*, MonthlySummaryItem, YearlySummary, ReferenceArea |
| `fetch.ts` | +apiUpload + authUpload for file uploads; CSRF comment |
| `dashboard/page.tsx` | Streaks, goals, rest day suggestions, events, yearly summary, monthly summary, PDF download buttons |
| `cycling/page.tsx` | VO2max card, HR zones, decoupling chart, weight trend, benchmarks, power curve comparison |
| `activities/page.tsx` | GPX+FIT file upload import UI |
| `routes/page.tsx` | Ridden/unridden badges; surface breakdown fallback |
| `lifting/page.tsx` | PR celebration trigger |
| `settings/page.tsx` | Raw fetch comment for blob export |
| `Chart.tsx` | ReferenceArea support for zone coloring |

## Migration Chain
```
001 → 002 → 003 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012 → 013 → 014 (surface)
→ 015 (composite indexes) → 016 (self-heal cleanup) → 017 (encrypt tokens) → 018 (goals) → 019 (plans+events)
```
⚠️ `014_add_composite_indexes.py` is a stale duplicate — ignore it. The real composite indexes migration is `015`.

## Key Gotchas for Debugging

1. **EncryptedString TypeDecorator** — transparently encrypts/decrypts OAuth tokens. If you see garbled tokens in DB, this is expected. `decrypt_token()` falls back to returning raw value for non-Fernet ciphertext.

2. **Migration 014 collision** — Two files claim revision "014": `014_add_surface_profile.py` (real) and `014_add_composite_indexes.py` (stale duplicate from first pass). Delete the duplicate. The real chain goes 013→014(surface)→015(indexes).

3. **Rate limiting** — slowapi uses in-memory storage. Won't work across multiple workers. For production, configure Redis backend.

4. **Backup task** — runs inside Docker container. Backup dir must be a mounted volume for persistence. `pg_dump` must be available in the container image.

5. **fitparse dependency** — `pip install fitparse` required in backend container. Rebuild after adding to pyproject.toml.

6. **reportlab dependency** — `pip install reportlab` required. Rebuild backend.

7. **Prometheus** — `/metrics` endpoint exposed. Exclude from rate limiting if monitoring scrapes frequently.

8. **Training plans** — auto-generate creates 4-week blocks. Customize via the PlanBuilder UI.

9. **VO2max** — uses ACSM power formula and Uth HR formula. Best 5-min power used as proxy for VO2max power.

10. **Decoupling** — only computed for rides >60 min with both power and HR streams.
