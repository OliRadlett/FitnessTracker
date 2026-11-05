"""Redirects must stay on the origin the browser is already using.

The regression this guards: FastAPI's slash redirect emitted an absolute
``http://localhost:8000/...`` Location behind the dev proxy, the browser
followed cross-origin, and fetch stripped the Authorization header — a 401 on
every page that read connections.
"""

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient

from app.http_redirects import RelativeRedirectMiddleware


def make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RelativeRedirectMiddleware)

    @app.get("/slash/")
    def slash():
        return {"ok": True}

    @app.get("/external")
    def external():
        return RedirectResponse("https://accounts.google.com/o/oauth2/auth")

    @app.get("/absolute")
    def absolute():
        return RedirectResponse("http://testserver/slash/")

    @app.get("/relative")
    def relative():
        return RedirectResponse("/slash/")

    return app


def test_slash_redirect_is_relative():
    client = TestClient(make_app())
    response = client.get("/slash", follow_redirects=False)
    assert response.status_code == 307
    assert response.headers["location"] == "/slash/"


def test_same_host_absolute_redirect_is_rewritten():
    client = TestClient(make_app())
    response = client.get("/absolute", follow_redirects=False)
    assert response.headers["location"] == "/slash/"


def test_relative_redirect_is_untouched():
    client = TestClient(make_app())
    response = client.get("/relative", follow_redirects=False)
    assert response.headers["location"] == "/slash/"


def test_external_redirect_is_untouched():
    client = TestClient(make_app())
    response = client.get("/external", follow_redirects=False)
    assert response.headers["location"].startswith("https://accounts.google.com/")
