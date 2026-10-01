"""Guard: the Caddyfile production actually loads must keep its security headers.

The deploy workflow used to hand-maintain a *second* copy of the Caddyfile body
inline in ``.github/workflows/deploy.yml``.  When the security-headers block was
added to the committed ``infra/Caddyfile``, that inline copy was never updated,
so production ran for weeks with no ``X-Content-Type-Options`` / HSTS / etc.

``infra/Caddyfile`` is now the single source of truth: the deploy derives the
live file from it.  These tests fail if that regresses — either the headers are
dropped from the committed file, or an inline duplicate reappears in the
workflow (which is what let the two drift apart).
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CADDYFILE = REPO_ROOT / "infra" / "Caddyfile"
DEPLOY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy.yml"

# Directives the deployed site must send. ``-Server`` strips Caddy's own banner.
REQUIRED_HEADERS = [
    "X-Content-Type-Options nosniff",
    "X-Frame-Options DENY",
    "Referrer-Policy strict-origin-when-cross-origin",
    'Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    "X-Permitted-Cross-Domain-Policies none",
    "Permissions-Policy camera=(), microphone=(), geolocation=()",
    "-Server",
]


def test_committed_caddyfile_sets_security_headers() -> None:
    text = CADDYFILE.read_text(encoding="utf-8")
    missing = [h for h in REQUIRED_HEADERS if h not in text]
    assert not missing, (
        "infra/Caddyfile is the production config and is missing security "
        "header(s): " + ", ".join(missing)
    )


def test_deploy_derives_caddyfile_from_committed_file() -> None:
    """The workflow must transform ``infra/Caddyfile``, not re-declare its body.

    An inline copy is what silently diverged from the committed file and shipped
    without the security headers.
    """
    workflow = DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    assert "infra/Caddyfile" in workflow, (
        "deploy.yml no longer references infra/Caddyfile — production would not "
        "use the committed config."
    )
    assert "handle /fittrack*" not in workflow, (
        "deploy.yml declares a Caddyfile body inline again; that duplicate drifts "
        "from infra/Caddyfile (the security headers were lost that way once). "
        "Derive the deployed file from infra/Caddyfile instead."
    )
