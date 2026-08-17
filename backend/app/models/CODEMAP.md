# Models CODEMAP

> All models use UUID PKs (`uuid.uuid4()`), `Mapped` type annotations, inherit from `Base`. JSONB for flexible data.

| File | Models | Key Relationships |
|------|--------|-------------------|
| `user.py` | `User`, `OAuthConnection` | User has many OAuthConnections |
| `activity.py` | `Activity`, `ActivitySource`, `ActivityStream` | Activity has many Sources/Streams; optionally links to LiftingSession + Route |
| `lifting.py` | `LiftingSession`, `LiftingSet`, `PersonalRecord`, `WarmupTemplate`, `WarmupTemplateStep` | Session has many Sets; Template has many Steps |
| `route.py` | `Route`, `RouteSource` | Route has many Sources; has many Activities (via route_id) |
| `cycling.py` | `CyclingProfile`, `FtpHistory` | One profile per user; FTP changes tracked over time |
| `daily_metric.py` | `DailyMetric` | Recovery, HRV, strain per day per source |
| `sleep.py` | `SleepLog` | Sleep stages, efficiency |
| `health_alert.py` | `HealthAlert` | Overtraining/illness/injury with JSONB evidence |
