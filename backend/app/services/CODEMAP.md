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
| `lifting.py` | Session/set CRUD, PR detection (Brzycki), volume calculation, activity linking, live-session support (`get_active_session()` = latest `started_at IS NOT NULL AND ended_at IS NULL`) | `create_session()`, `get_active_session()`, `add_set()`, `_check_and_record_pr()` |
| `whoop.py` | Whoop sync — cycles/recovery, sleep, weight, workout enrichment. Strength workouts with no Strava match are attached to live-tracked LiftingSessions by time overlap (`match_whoop_workout_to_lifting_session()`, ≥50% of shorter window; dedup via `whoop_workout_id`); used by both `sync_whoop_workouts()` and backfill | `sync_whoop_cycles()`, `sync_whoop_sleep()`, `sync_whoop_workouts()`, `match_whoop_workout_to_lifting_session()`, `backfill_whoop_data()` |
| `exercise_db.py` | Built-in exercise database with aliases, normalisation, categorisation | `normalise_exercise_name()`, `search_exercises()` |
| `cycling.py` | TSS calc, CTL/ATL/TSB, power curve from streams, power zones, FTP estimation | `compute_training_load()`, `compute_power_curve_from_streams()`, `auto_compute_tss_for_activity()` |
| `charts.py` | Chart generation — queries DB, returns ChartData dataclasses | `ChartService` class with methods per chart type |
| `polyline_utils.py` | Polyline encode/decode, Haversine distance, provider conversions | `decode_polyline()`, `encode_polyline()` |
| `gpx.py` | GPX 1.1 generation and parsing | `generate_gpx()`, `parse_gpx()` |
| `workout_planner.py` | Workout zone computation, target planning, route matching | `compute_workout_zones()`, `plan_workout()`, `find_matching_routes()` |
| `session_analysis.py` | Post-session ride and lifting analysis | `analyze_lifting_session()`, `analyze_ride()` |
| `deficiency.py` | Weakness/deficiency analysis — strength standards, Big-3 ratios, push/pull balance, VO2max/FTP mismatch, decoupling, zone distribution | `analyze_deficiencies()`, `level_for_ratio()`, `evaluate_big3_ratios()`, `classify_push_pull()`, `evaluate_push_pull_ratio()` |
| `nutrition.py` | Ride fuel planning — carb/hydration/sodium targets by duration×IF, timed schedule generation, plan CRUD | `generate_fuel_plan()`, `compute_fuel_targets()`, `estimate_intensity_factor()`, `_build_during_ride_schedule()`, `update_fuel_plan_actuals()` |
| `llm_analysis.py` | LLM-powered analysis via Gemini (cycling, activity, lifting, health, event) | `compile_cycling_stats()`, `analyze_with_gemini()`, `run_llm_analysis()`, `compile_activity_context()`, `analyze_activity_with_gemini()`, `run_activity_ai_analysis()`, `compile_lifting_session_context()`, `analyze_lifting_session_with_gemini()`, `run_lifting_session_ai_analysis()`, `compile_health_stats()`, `analyze_health_with_gemini()`, `run_health_ai_analysis()`, `compile_event_stats()`, `analyze_event_with_gemini()`, `run_event_ai_analysis()` |
| `weather.py` | Open-Meteo weather (no API key) — cached current/forecast/historical fetches, WMO mapping, bad-weather checks, activity weather tagging | `get_current()`, `get_forecast()`, `get_historical()`, `tag_activity()`, `tag_recent_activities()`, `resolve_user_coords()`, `_wmo_code_to_conditions()`, `degrees_to_compass()`, `is_bad_weather()`, `cache_coords()` |
