"""Unit tests for the Wahoo zone-sync read path and its pure helpers.

No database and no network: the service's two DB reads are monkeypatched, and the
Wahoo client is a stub. The interesting assertions are about what we *refuse* to do
(touch an unattributable set, refresh a token speculatively) and about the traps
that only bite outside the happy path (string decimals, JSONB `null`).
"""

from types import SimpleNamespace

import httpx
import pytest

from app.models.wahoo_zones import WahooZoneSet
from app.services import wahoo_zones as wz


def _profile(*, ftp=200.0, lthr=200.0, opt_in=False):
    return SimpleNamespace(
        ftp_watts=ftp, lactate_threshold_hr=lthr, push_wahoo_zones=opt_in
    )


def _connection(*, status="active", token="tok"):
    return SimpleNamespace(status=status, access_token=token, id="conn-1")


def _http_status_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://api.wahooligan.com/v1/power_zones")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError(f"HTTP {status}", request=request, response=response)


# ── as_float / as_int ────────────────────────────────────────────────────────


class TestAsFloat:
    def test_reads_string_decimals(self):
        # Wahoo's docs are explicit that decimals come back as strings.
        assert wz.as_float("400.50") == 400.5

    def test_rejects_bools(self):
        # float(True) == 1.0 would turn a stray flag into a zone boundary.
        assert wz.as_float(True) is None
        assert wz.as_float(False) is None

    @pytest.mark.parametrize("value", [None, "", "abc", [], {}])
    def test_rejects_unparseable(self, value):
        assert wz.as_float(value) is None

    def test_as_int_truncates(self):
        assert wz.as_int("7.9") == 7


# ── zone_values / anchor ─────────────────────────────────────────────────────


class TestZoneValues:
    def test_reads_in_order(self):
        raw = {f"zone_{i}": i * 100 for i in range(1, 8)}
        assert wz.zone_values(raw) == [100.0, 200.0, 300.0, 400.0, 500.0, 600.0, 700.0]

    def test_skips_absent_slots_rather_than_zero_filling(self):
        assert wz.zone_values({"zone_1": 100, "zone_3": 140}) == [100.0, 140.0]

    def test_empty_set(self):
        assert wz.zone_values({}) == []


class TestAnchor:
    def test_power_reads_ftp(self):
        assert wz.anchor_from_zone_set({"ftp": "268"}, "power") == 268.0

    def test_heart_rate_reads_thr(self):
        assert (
            wz.anchor_from_zone_set({"thr": 172, "ftp": 250}, "heart_rate") == 172.0
        )

    def test_missing_anchor(self):
        assert wz.anchor_from_zone_set({}, "power") is None


class TestThirdPartyOwnership:
    def test_wahoo_app_set(self):
        # < 1000 = created by a Wahoo application.
        assert wz.is_third_party_zone_set({"fitness_app_id": 6}) is False

    def test_third_party_set(self):
        assert wz.is_third_party_zone_set({"fitness_app_id": 1002}) is True

    def test_unknown_is_not_false(self):
        # "Cannot tell" must not collapse into "ours" — a write policy that
        # conflates them overwrites sets it could not identify.
        assert wz.is_third_party_zone_set({}) is None


# ── local zone models ───────────────────────────────────────────────────────


class TestLocalZoneSets:
    def test_power_boundaries_from_ftp(self):
        sets = wz.local_zone_sets(_profile(ftp=200.0))
        power = next(s for s in sets if s.zone_kind == "power")
        assert power.anchor_kind == "ftp"
        assert [(z.zone, z.lower, z.upper) for z in power.zones] == [
            ("Z1", 0, 110),
            ("Z2", 110, 150),
            ("Z3", 150, 180),
            ("Z4", 180, 210),
            ("Z5", 210, 240),
            ("Z6", 240, 300),
            # Top zone is open-ended: the model's 5.0 upper bound is a sentinel, not
            # a ceiling, and rendering it would read "300–1000 W".
            ("Z7", 300, None),
        ]

    def test_heart_rate_boundaries_from_lthr(self):
        sets = wz.local_zone_sets(_profile(lthr=200.0))
        hr = next(s for s in sets if s.zone_kind == "heart_rate")
        assert hr.anchor_kind == "lthr"
        assert [(z.zone, z.lower, z.upper) for z in hr.zones] == [
            ("Z1", 0, 160),
            ("Z2", 160, 178),
            ("Z3", 178, 190),
            ("Z4", 190, 210),
            ("Z5", 210, None),
        ]

    def test_missing_anchor_yields_empty_zones_not_missing_entry(self):
        sets = wz.local_zone_sets(_profile(ftp=None, lthr=None))
        assert [s.zone_kind for s in sets] == ["power", "heart_rate"]
        assert all(s.zones == [] for s in sets)

    def test_no_profile_at_all(self):
        sets = wz.local_zone_sets(None)
        assert all(s.anchor_value is None for s in sets)


class TestDrift:
    def test_signed_not_absolute(self):
        # Direction is the actionable part: "device is behind" vs "ahead".
        assert wz.compute_drift(268.0, 250.0) == -18.0
        assert wz.compute_drift(250.0, 268.0) == 18.0

    @pytest.mark.parametrize("pair", [(None, 250.0), (250.0, None), (None, None)])
    def test_unknown_side_is_none(self, pair):
        assert wz.compute_drift(*pair) is None


# ── describe_zone_sets ──────────────────────────────────────────────────────


class TestDescribeZoneSets:
    def test_normalises_wahoo_payload(self):
        described = wz.describe_zone_sets(
            [
                {
                    "id": 56519,
                    "zone_1": "100",
                    "zone_2": 120,
                    "zone_count": 8,
                    "ftp": "400",
                    "workout_type_family_id": 0,
                    "workout_type_location_id": 1,
                    "fitness_app_id": 1002,
                    "originator_type": 0,
                }
            ]
        )
        assert len(described) == 1
        zone_set = described[0]
        assert zone_set.id == 56519
        assert zone_set.ftp == 400.0
        assert zone_set.zones == [100.0, 120.0]
        assert zone_set.third_party is True

    def test_skips_set_without_id(self):
        # An id-less set cannot be addressed, so surfacing it would invite the UI to
        # offer an action that cannot work.
        assert wz.describe_zone_sets([{"ftp": 250}]) == []


class TestDriftRows:
    def test_other_sport_power_sets_do_not_produce_drift(self):
        # A running power set has its own FTP; comparing it with the athlete's
        # cycling FTP would invent a drift that does not exist.
        state = wz.local_zone_sets(_profile(ftp=200.0))
        rows = wz._drift_rows(
            state,
            [
                wz.WahooPowerZoneSet(id=1, workout_type_family_id=0, ftp=250.0),
                wz.WahooPowerZoneSet(id=2, workout_type_family_id=1, ftp=300.0),
                # Unattributed sets are kept: the field is always present in the
                # documented payload, so a missing one is odd, not evidence.
                wz.WahooPowerZoneSet(id=3, ftp=180.0),
            ],
        )
        assert [row.wahoo_zone_set_id for row in rows] == [1, 3]
        assert rows[0].delta == 50.0
        assert rows[1].delta == -20.0


# ── read_wahoo_zones degradation ────────────────────────────────────────────


@pytest.fixture
def stub_wahoo(monkeypatch):
    """Patch the two DB reads and the Wahoo client; record what was called."""

    def _install(*, profile=None, connection=None, zones=None, error=None):
        calls = {"refresh": 0, "get_zones": 0}

        async def _load_profile(db, user_id):
            return profile

        async def _load_tracked(db, user_id):
            return []

        async def _get_connection(db, user_id):
            return connection

        async def _refresh(db, conn):
            if isinstance(error, Exception) and type(error).__name__ in {
                "PermanentAuthError",
                "TransientSyncError",
            }:
                calls["refresh"] += 1
                raise error
            calls["refresh"] += 1
            return conn

        async def _get_power_zones(token):
            calls["get_zones"] += 1
            if isinstance(error, httpx.HTTPStatusError):
                raise error
            if isinstance(error, Exception) and type(error).__name__ == "RuntimeError":
                raise error
            return zones if zones is not None else []

        monkeypatch.setattr(wz, "_load_profile", _load_profile)
        monkeypatch.setattr(wz, "_load_tracked", _load_tracked)
        monkeypatch.setattr(wz, "get_wahoo_connection", _get_connection)
        monkeypatch.setattr(wz, "refresh_if_needed", _refresh)
        monkeypatch.setattr(wz.wahoo_client, "get_power_zones", _get_power_zones)
        return calls

    return _install


class TestReadWahooZonesDegradation:
    async def test_no_connection_still_returns_local_zones(self, stub_wahoo):
        stub_wahoo(profile=_profile(ftp=200.0), connection=None)
        status = await wz.read_wahoo_zones(db=None, user_id="u1")

        assert status.connected is False
        assert status.error_code == "no_connection"
        assert status.local_sets[0].anchor_value == 200.0
        assert status.wahoo_sets == []

    async def test_needs_reauth_short_circuits_before_any_api_call(self, stub_wahoo):
        calls = stub_wahoo(
            profile=_profile(), connection=_connection(status="needs_reauth")
        )
        status = await wz.read_wahoo_zones(db=None, user_id="u1")

        assert status.error_code == "needs_reauth"
        # The point of the assertion: an auth-dead connection must not refresh, or
        # a reauth loop burns Wahoo's 10-unrevoked-token cap.
        assert calls["refresh"] == 0
        assert calls["get_zones"] == 0

    async def test_403_reports_missing_scope(self, stub_wahoo):
        stub_wahoo(
            profile=_profile(),
            connection=_connection(),
            error=_http_status_error(403),
        )
        status = await wz.read_wahoo_zones(db=None, user_id="u1")

        assert status.error_code == "missing_scopes"
        assert status.connected is True

    async def test_other_http_error_reports_status(self, stub_wahoo):
        stub_wahoo(
            profile=_profile(),
            connection=_connection(),
            error=_http_status_error(500),
        )
        status = await wz.read_wahoo_zones(db=None, user_id="u1")

        assert status.error_code == "http_error"
        assert "500" in (status.error or "")

    async def test_refresh_happens_only_on_the_path_that_calls_the_api(
        self, stub_wahoo
    ):
        calls = stub_wahoo(
            profile=_profile(ftp=200.0),
            connection=_connection(),
            zones=[{"id": 5, "ftp": "250", "workout_type_family_id": 0}],
        )
        status = await wz.read_wahoo_zones(db=None, user_id="u1")

        assert calls["refresh"] == 1
        assert calls["get_zones"] == 1
        assert status.error_code is None
        assert status.wahoo_sets[0].id == 5
        assert status.drift[0].delta == 50.0

    async def test_can_write_is_false_while_the_write_path_is_unbuilt(
        self, stub_wahoo
    ):
        # Opted in, connected, FTP present — and still false, because the API must
        # not advertise an action with nothing behind it (plan Phase 1).
        assert wz.WRITE_PATH_IMPLEMENTED is False
        stub_wahoo(profile=_profile(ftp=200.0, opt_in=True), connection=_connection())
        status = await wz.read_wahoo_zones(db=None, user_id="u1")

        assert status.opt_in is True
        assert status.connected is True
        assert status.can_write is False


# ── model-level traps ───────────────────────────────────────────────────────


class TestModelTraps:
    def test_snapshot_columns_write_sql_null_not_json_null(self):
        # Revert *clears* `prior`; without none_as_null the cleared value is the
        # JSON literal null, `IS NOT NULL` still matches, and "has a snapshot"
        # stays true forever (AGENTS.md pitfall 28).
        assert WahooZoneSet.__table__.c.prior.type.none_as_null is True
        assert WahooZoneSet.__table__.c.boundaries.type.none_as_null is True

    def test_one_row_per_kind_family_location(self):
        names = {c.name for c in WahooZoneSet.__table__.constraints}
        assert "uq_wahoo_zone_sets_user_kind_set" in names
