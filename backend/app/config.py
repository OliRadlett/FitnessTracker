import logging
import warnings

from pydantic_settings import BaseSettings
from functools import lru_cache

logger = logging.getLogger(__name__)

# Default values used to detect unconfigured settings
_DEFAULT_SECRET_KEY = "change-me-to-a-random-secret-key"
_DEFAULT_DATABASE_URL = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack"


class Settings(BaseSettings):
    # Database
    database_url: str = _DEFAULT_DATABASE_URL

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Backend
    secret_key: str = _DEFAULT_SECRET_KEY
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

    # Database backup
    backup_dir: str = "/backups"

    # Merge / dedup thresholds
    activity_merge_threshold: float = 0.60  # lowered from 0.65 to reduce false negatives
    activity_route_link_threshold: float = 0.70
    route_match_threshold: float = 0.60

    model_config = {"env_file": ".env", "extra": "ignore"}

    def model_post_init(self, __context) -> None:
        # Existing SECRET_KEY check
        if self.secret_key == _DEFAULT_SECRET_KEY:
            if not self.debug:
                raise ValueError(
                    "SECRET_KEY must be set to a non-default value when DEBUG is false. "
                    "Set SECRET_KEY in your .env file."
                )
            warnings.warn(
                "SECRET_KEY is using the default value. "
                "Set a random SECRET_KEY in your .env file for security.",
                stacklevel=2,
            )

        # Production-only validation of critical env vars
        if not self.debug:
            self._validate_required()
        self._warn_optional_integrations()

    def _validate_required(self) -> None:
        """Validate critical environment variables are set for production.

        Raises ValueError if any required variable is missing or still default.
        """
        errors: list[str] = []

        if self.secret_key == _DEFAULT_SECRET_KEY:
            errors.append("SECRET_KEY must be set to a non-default value")

        if self.database_url == _DEFAULT_DATABASE_URL:
            errors.append(
                "DATABASE_URL must be set (default localhost is not allowed in production)"
            )

        if not self.redis_url or self.redis_url.startswith("redis://localhost"):
            errors.append(
                "REDIS_URL must be set to a non-localhost value in production"
            )

        if errors:
            raise ValueError(
                "Missing required configuration for production:\n  - "
                + "\n  - ".join(errors)
            )

    def _warn_optional_integrations(self) -> None:
        """Log warnings for optional integrations that aren't configured."""
        optional_providers = {
            "Strava": (self.strava_client_id, self.strava_client_secret),
            "Whoop": (self.whoop_client_id, self.whoop_client_secret),
            "Wahoo": (self.wahoo_client_id, self.wahoo_client_secret),
            "Google OAuth": (self.google_client_id, self.google_client_secret),
            "GitHub OAuth": (self.github_client_id, self.github_client_secret),
            "Komoot": (self.komoot_email, self.komoot_password),
        }
        for name, (client_id, client_secret) in optional_providers.items():
            if not client_id or not client_secret:
                logger.info(
                    "Optional integration not configured: %s "
                    "(set credentials in .env to enable)",
                    name,
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()
