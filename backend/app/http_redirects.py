"""Keep same-host redirects relative.

FastAPI/Starlette build a slash-normalisation redirect from the request URL, so
behind a reverse proxy the ``Location`` header names the *upstream* host
(``http://backend:8000/...`` or ``http://localhost:8000/...``). A browser that
follows that cross-origin redirect drops the ``Authorization`` header, so a
harmless trailing-slash redirect becomes a 401 on the page.

A relative ``Location`` keeps the browser on the origin it is already talking
to. External redirects (OAuth providers) are left untouched.
"""

from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

REDIRECT_STATUS_CODES = {301, 302, 303, 307, 308}


class RelativeRedirectMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if response.status_code in REDIRECT_STATUS_CODES:
            location = response.headers.get("location")
            if location:
                parts = urlsplit(location)
                same_host = not parts.netloc or parts.netloc == request.url.netloc
                if same_host and (parts.scheme or parts.netloc):
                    response.headers["location"] = parts.path + (
                        f"?{parts.query}" if parts.query else ""
                    )
        return response
