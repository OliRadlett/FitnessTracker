from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Backend
    secret_key: str = "change-me-to-a-random-secret-key"
    debug: bool = True
    allowed_origins: str = "http://localhost:3000,https://localhost"
    public_url: str = "https://localhost"

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # GitHub OAuth
    github_client_id: str = ""
    github_client_secret: str = ""

    # Strava OAuth
    strava_client_id: str = ""
    strava_client_secret: str = ""

    # Whoop OAuth
    whoop_client_id: str = ""
    whoop_client_secret: str = ""

    # Wahoo OAuth
    wahoo_client_id: str = ""
    wahoo_client_secret: str = ""

    # Komoot Basic Auth
    komoot_email: str = ""
    komoot_password: str = ""
    komoot_user_id: str = ""  # Numeric Komoot user ID (auto-detected if not set)

    # Strava Webhook
    strava_verify_token: str = "fittrack_strava_webhook"

    # Merge / dedup thresholds
    activity_merge_threshold: float = 0.60  # lowered from 0.65 to reduce false negatives
    activity_route_link_threshold: float = 0.70
    route_match_threshold: float = 0.60

    model_config = {"env_file": ".env", "extra": "ignore"}

    def model_post_init(self, __context) -> None:
        if self.secret_key == "change-me-to-a-random-secret-key":
            import warnings
            warnings.warn(
                "SECRET_KEY is using the default value. "
                "Set a random SECRET_KEY in your .env file for security.",
                stacklevel=2,
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
