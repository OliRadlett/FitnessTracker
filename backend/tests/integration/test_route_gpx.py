"""Integration tests for GPX robustness and safe download headers.

Run with:  pytest tests/integration/test_route_gpx.py -m integration
"""

from __future__ import annotations

import pytest

from app.models.route import Route

pytestmark = pytest.mark.integration

ROUTES = "/api/v1/routes"


class TestGpxParseErrors:
    """Malformed GPX must return 400, not an unhandled 500."""

    async def test_create_route_with_malformed_xml_returns_400(self, client):
        resp = await client.post(
            f"{ROUTES}/", json={"name": "Bad", "gpx_data": "<gpx><broken"}
        )
        assert resp.status_code == 400

    async def test_create_route_with_no_points_returns_400(self, client):
        resp = await client.post(
            f"{ROUTES}/",
            json={
                "name": "Empty",
                "gpx_data": '<?xml version="1.0"?><gpx version="1.1"></gpx>',
            },
        )
        assert resp.status_code == 400

    async def test_create_route_with_non_numeric_coords_returns_400(self, client):
        gpx = (
            '<?xml version="1.0"?><gpx version="1.1">'
            '<trk><trkseg><trkpt lat="abc" lon="def"></trkpt></trkseg></trk></gpx>'
        )
        resp = await client.post(
            f"{ROUTES}/", json={"name": "Coords", "gpx_data": gpx}
        )
        assert resp.status_code == 400

    async def test_upload_gpx_with_malformed_file_returns_400(self, client):
        resp = await client.post(
            f"{ROUTES}/upload-gpx",
            files={"file": ("bad.gpx", b"<gpx><broken", "application/gpx+xml")},
        )
        assert resp.status_code == 400


class TestGpxContentDisposition:
    """User-derived route names must not corrupt/inject the header."""

    async def test_nasty_route_name_is_sanitised(self, client, db_session, test_user):
        route = Route(
            user_id=test_user.id,
            name='Evil "route"/x\r\nInjected: yes',
            sport_type="cycling",
            distance_meters=1000.0,
            encoded_polyline="o}~mH~}xMz@z@z@z@z@z@",
            start_lat=51.0,
            start_lng=0.0,
            end_lat=51.0,
            end_lng=0.0,
        )
        db_session.add(route)
        await db_session.flush()

        resp = await client.get(f"{ROUTES}/{route.id}/gpx")
        assert resp.status_code == 200

        cd = resp.headers["content-disposition"]
        assert "\r" not in cd and "\n" not in cd
        # Exactly the two quotes framing the ASCII fallback — no injected quotes.
        assert cd.count('"') == 2
        assert 'filename="Evil__route__x__Injected:_yes.gpx"' in cd
        assert "filename*=UTF-8''" in cd
