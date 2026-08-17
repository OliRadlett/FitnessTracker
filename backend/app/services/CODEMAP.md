# Services CODEMAP

> Each service follows the signature `(db: AsyncSession, user_id: UUID, ...)`. Services don't use FastAPI DI.

| File | Responsibility | Key Functions |
|------|---------------|---------------|
| `auth.py` | JWT creation/validation, OAuth provider config | `create_access_token()`, `get_current_user()` |
| `strava.py` | Strava activity sync, webhook handling, activity↔lifting linking, route sync | `sync_activities()`, `handle_strava_event()`, `sync_strava_routes()`, `link_activity_to_lifting_sessions()` |
| `wahoo.py` | Wahoo activity + route sync | `sync_wahoo_activities()`, `sync_wahoo_routes()` |
| `komoot.py` | Komoot route sync | `sync_komoot_routes()` |
| `merge_service.py` | Activity dedup/merge engine, activity↔route linking | `find_duplicate_activity()`, `merge_activity()`, `link_activity_to_route()` |
| `route_service.py` | Route CRUD, dedup/merge (proximity + distance + name + shape scoring) | `create_or_merge_route()`, `get_routes()`, `delete_route()` |
| `lifting.py` | Session/set CRUD, PR detection (Brzycki), volume calculation, activity linking | `create_session()`, `add_set()`, `_check_and_record_pr()` |
| `exercise_db.py` | Built-in exercise database with aliases, normalisation, categorisation | `normalise_exercise_name()`, `search_exercises()` |
| `cycling.py` | TSS calc, CTL/ATL/TSB, power curve from streams, power zones, FTP estimation | `compute_training_load()`, `compute_power_curve_from_streams()`, `auto_compute_tss_for_activity()` |
| `charts.py` | Chart generation — queries DB, returns ChartData dataclasses | `ChartService` class with methods per chart type |
| `polyline_utils.py` | Polyline encode/decode, Haversine distance, provider conversions | `decode_polyline()`, `encode_polyline()` |
| `gpx.py` | GPX 1.1 generation and parsing | `generate_gpx()`, `parse_gpx()` |
