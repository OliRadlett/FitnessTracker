"""Unit tests for the Wahoo zone-sync read path and its pure helpers.

No database and no network: the service's two DB reads are monkeypatched, and the
Wahoo client is a stub. The interesting assertions are about what we *refuse* to do
(touch an unattributable set, refresh a token speculatively) and about the traps
that only bite outside the happy path (string decimals, JSONB `null`).
"""

import itertools
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

    async def test_can_write_tracks_opt_in_and_connection(self, stub_wahoo):
        # Opted out: nothing to advertise, even though everything else is ready.
        stub_wahoo(profile=_profile(ftp=200.0, opt_in=False), connection=_connection())
        status = await wz.read_wahoo_zones(db=None, user_id="u1")
        assert status.can_write is False

        # Opted in with a connection and an FTP: the write path exists, so the API
        # may advertise it.
        stub_wahoo(profile=_profile(ftp=200.0, opt_in=True), connection=_connection())
        status = await wz.read_wahoo_zones(db=None, user_id="u1")
        assert status.can_write is True

    async def test_can_write_false_without_ftp(self, stub_wahoo):
        stub_wahoo(profile=_profile(ftp=None, opt_in=True), connection=_connection())
        status = await wz.read_wahoo_zones(db=None, user_id="u1")
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


# ── write path: pure helpers ────────────────────────────────────────────────


class TestWritableSets:
    def test_zero_family_is_writable_and_indoor_default_is_not_assumed(self):
        sets = [
            wz.WahooPowerZoneSet(id=1, workout_type_family_id=0, third_party=False),
            wz.WahooPowerZoneSet(id=2, workout_type_family_id=1, third_party=False),
        ]
        writable, foreign = wz.writable_cycling_sets(sets, tracked_ids=set())
        assert [s.id for s in writable] == [1]
        assert foreign == []

    def test_unattributed_family_is_not_written(self):
        # A wrong guess on a write lands on another sport's zones — worse than
        # showing one drift figure too many, so writes are strict where drift is not.
        sets = [wz.WahooPowerZoneSet(id=1, third_party=False)]
        writable, _ = wz.writable_cycling_sets(sets, tracked_ids=set())
        assert writable == []

    def test_other_apps_set_is_left_alone(self):
        sets = [wz.WahooPowerZoneSet(id=1, workout_type_family_id=0, third_party=True)]
        writable, foreign = wz.writable_cycling_sets(sets, tracked_ids=set())
        assert writable == []
        assert [s.id for s in foreign] == [1]

    def test_our_own_third_party_set_is_writable_when_tracked(self):
        sets = [wz.WahooPowerZoneSet(id=1, workout_type_family_id=0, third_party=True)]
        writable, foreign = wz.writable_cycling_sets(sets, tracked_ids={1})
        assert [s.id for s in writable] == [1]
        assert foreign == []

    def test_wahoo_app_set_is_writable(self):
        # The set the head unit actually colours against. Refusing to touch it would
        # make the feature a no-op for most athletes (plan D3).
        sets = [wz.WahooPowerZoneSet(id=1, workout_type_family_id=0, third_party=False)]
        writable, _ = wz.writable_cycling_sets(sets, tracked_ids=set())
        assert [s.id for s in writable] == [1]


class TestRescaledBoundaries:
    def test_preserves_the_sets_own_shape(self):
        # 200 → 250 W scales every boundary by 1.25; the athlete's relative zone
        # shape is untouched, which is the whole reason this is convention-agnostic.
        assert wz.rescaled_boundaries(
            [110.0, 150.0, 200.0], old_anchor=200.0, new_anchor=250.0
        ) == [138, 188, 250]

    def test_is_convention_agnostic(self):
        # Whatever zone_N means, the ratio between consecutive boundaries survives.
        lower = wz.rescaled_boundaries([100.0, 200.0], old_anchor=200.0, new_anchor=100.0)
        assert lower == [50, 100]

    def test_rounding_must_not_collapse_two_zones(self):
        # At a small anchor, rounding can push two boundaries onto the same watt; a
        # set whose boundaries are not strictly increasing is not a zone set.
        scaled = wz.rescaled_boundaries(
            [100.0, 101.0, 102.0], old_anchor=1000.0, new_anchor=10.0
        )
        assert scaled == sorted(set(scaled))
        assert all(b > a for a, b in itertools.pairwise(scaled))

    @pytest.mark.parametrize(
        "boundaries,old_anchor",
        [([], 200.0), ([100.0], None), ([100.0], 0.0), ([100.0], -5.0)],
    )
    def test_unscalable_returns_empty(self, boundaries, old_anchor):
        assert (
            wz.rescaled_boundaries(boundaries, old_anchor=old_anchor, new_anchor=250.0)
            == []
        )

    def test_zero_new_anchor(self):
        assert (
            wz.rescaled_boundaries([100.0], old_anchor=200.0, new_anchor=0.0) == []
        )


class TestPowerZonePayload:
    def test_never_sends_critical_power(self):
        # We hold a Morton CP; Wahoo documents the field as "MMP/Best average power".
        # Writing into a field whose meaning is unconfirmed is how a sync corrupts
        # data it was meant to tidy (plan §8).
        payload = wz.power_zone_payload(ftp=250.4, boundaries=[100])
        assert "critical_power" not in payload
        assert payload == {"ftp": 250, "zone_1": 100}

    def test_identity_only_on_create(self):
        update = wz.power_zone_payload(ftp=250, boundaries=[100])
        create = wz.power_zone_payload(ftp=250, boundaries=[], include_identity=True)
        assert "workout_type_family_id" not in update
        assert create["workout_type_family_id"] == wz.WAHOO_FAMILY_BIKING
        assert create["workout_type_location_id"] == 0

    def test_caps_boundaries_at_wahoos_slots(self):
        payload = wz.power_zone_payload(ftp=250, boundaries=list(range(1, 12)))
        assert [k for k in payload if k.startswith("zone_")] == [
            f"zone_{i}" for i in range(1, 8)
        ]


class TestSnapshotRoundTrip:
    def test_snapshot_restores_anchor_boundaries_and_count(self):
        zone_set = wz.WahooPowerZoneSet(
            id=7, ftp=200.0, zone_count=7, zones=[110.0, 150.0]
        )
        snapshot = wz.prior_snapshot(zone_set)
        assert wz.payload_from_snapshot(snapshot) == {
            "ftp": 200,
            "zone_1": 110,
            "zone_2": 150,
            "zone_count": 7,
        }

    def test_snapshot_is_json_native(self):
        # The snapshot goes into JSONB, and a non-native value survives in-process
        # then fails at flush, after the operation has already run (pitfall 40).
        snapshot = wz.prior_snapshot(
            wz.WahooPowerZoneSet(id=7, ftp=200.0, zone_count=None, zones=[])
        )
        wz.json_safe(snapshot, label="snapshot")

    def test_json_safe_rejects_non_native_payload(self):
        import uuid as _uuid

        with pytest.raises(wz.WahooZoneError) as excinfo:
            wz.json_safe({"id": _uuid.uuid4()}, label="snapshot")
        assert excinfo.value.code == "bad_snapshot"

    def test_payload_from_empty_snapshot_is_empty(self):
        assert wz.payload_from_snapshot({}) == {}


# ── write path: push / revert ───────────────────────────────────────────────


class FakeDB:
    """Just enough session for the write path: add + awaitable flush/commit."""

    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        return None

    async def commit(self):
        self.commits += 1


def _raw_set(*, set_id=7, ftp="200", zones=(110, 150), family=0, location=1, app=6):
    raw = {
        "id": set_id,
        "ftp": ftp,
        "zone_count": 7,
        "workout_type_family_id": family,
        "workout_type_location_id": location,
        "fitness_app_id": app,
        "originator_type": 0,
    }
    for index, value in enumerate(zones, start=1):
        raw[f"zone_{index}"] = value
    return raw


@pytest.fixture
def push_stub(monkeypatch):
    """Patch every collaborator the write path touches, recording calls."""

    def _install(*, profile=None, connection=None, raw=None, rows=None, fail=None,
                 create_returns=None):
        calls = {"refresh": 0, "get": 0, "update": [], "create": [], "notify": []}
        state = {"rows": list(rows or [])}

        class FakeWahooClient:
            async def get_power_zones(self, token):
                calls["get"] += 1
                return raw or []

            async def update_power_zone(self, token, zone_id, payload):
                calls["update"].append((zone_id, payload))
                if fail and zone_id in fail:
                    raise fail[zone_id]
                return {"id": zone_id}

            async def create_power_zone(self, token, payload):
                calls["create"].append(payload)
                return {"id": create_returns or 99}

        async def _load_profile(db, user_id):
            return profile

        async def _load_rows(db, user_id):
            return state["rows"]

        async def _get_connection(db, user_id):
            return connection

        async def _refresh(db, conn):
            calls["refresh"] += 1
            return conn

        monkeypatch.setattr(wz, "_load_profile", _load_profile)
        monkeypatch.setattr(wz, "_load_rows", _load_rows)
        monkeypatch.setattr(wz, "get_wahoo_connection", _get_connection)
        monkeypatch.setattr(wz, "refresh_if_needed", _refresh)
        monkeypatch.setattr(wz, "wahoo_client", FakeWahooClient())
        return calls, state

    return _install


def _tracked_row(*, set_id=7, anchor=250.0, prior=None, location=1, family=0):
    return WahooZoneSet(
        user_id="u1",
        zone_kind=wz.ZONE_KIND_POWER,
        workout_type_family_id=family,
        workout_type_location_id=location,
        wahoo_zone_set_id=set_id,
        anchor_value=anchor,
        prior=prior,
    )


class TestPushPowerZones:
    async def test_guards_before_touching_wahoo(self, push_stub):
        db = FakeDB()
        push_stub(profile=_profile(ftp=None), connection=_connection())
        with pytest.raises(wz.WahooZoneError) as excinfo:
            await wz.push_power_zones(db, "u1")
        assert excinfo.value.code == "no_ftp"

        push_stub(profile=_profile(ftp=200.0), connection=None)
        with pytest.raises(wz.WahooZoneError) as excinfo:
            await wz.push_power_zones(db, "u1")
        assert excinfo.value.code == "no_connection"

    async def test_opt_out_means_no_api_call_at_all(self, push_stub):
        # `require_opt_in` is re-checked in the worker, not only at the enqueue
        # site: a job queued just before the athlete switched the toggle off must
        # not still write to their account.
        calls, _ = push_stub(
            profile=_profile(ftp=200.0, opt_in=False), connection=_connection()
        )
        result = await wz.push_power_zones(FakeDB(), "u1", require_opt_in=True)

        assert result["reason"] == "not_opted_in"
        assert calls["get"] == 0
        assert calls["update"] == []

    async def test_updates_in_place_and_snapshots_the_before_state(self, push_stub):
        calls, state = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            raw=[_raw_set()],
        )
        result = await wz.push_power_zones(FakeDB(), "u1")

        assert result["updated"] == [7]
        assert calls["update"] == [
            (7, {"ftp": 250, "zone_1": 138, "zone_2": 188, "zone_count": 7})
        ]
        row = state["rows"][0]
        # The snapshot is of the state *before* our write — 200, not 250.
        assert row.prior == {"ftp": 200.0, "zone_count": 7, "zones": [110.0, 150.0]}
        assert row.boundaries == {"ftp": 250, "zones": [138, 188], "zone_count": 7}
        assert row.anchor_value == 250.0

    async def test_skips_when_already_current_unless_forced(self, push_stub):
        calls, _ = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            raw=[_raw_set()],
            rows=[_tracked_row(anchor=250.0)],
        )
        result = await wz.push_power_zones(FakeDB(), "u1")
        assert result["updated"] == []
        assert result["skipped"] == [{"id": 7, "reason": "already_current"}]
        assert calls["update"] == []

        # The manual button forces: the athlete may have edited zones in the Wahoo
        # app since our last look.
        calls, _ = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            raw=[_raw_set()],
            rows=[_tracked_row(anchor=250.0)],
        )
        result = await wz.push_power_zones(FakeDB(), "u1", force=True)
        assert result["updated"] == [7]

    async def test_skips_set_with_boundaries_but_no_readable_anchor(self, push_stub):
        # Rescaling needs the old anchor; writing the anchor alone would leave the
        # boundaries consistent with the *previous* FTP.
        calls, _ = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            raw=[_raw_set(ftp=None)],
        )
        result = await wz.push_power_zones(FakeDB(), "u1")

        assert result["skipped"] == [{"id": 7, "reason": "no_anchor"}]
        assert calls["update"] == []

    async def test_one_bad_set_does_not_abandon_the_others(self, push_stub):
        error = httpx.HTTPStatusError(
            "boom",
            request=httpx.Request("PUT", "https://api.wahooligan.com/v1/power_zones/7"),
            response=httpx.Response(500, request=httpx.Request("PUT", "https://x")),
        )
        calls, state = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            raw=[_raw_set(set_id=7, location=1), _raw_set(set_id=8, location=0)],
            rows=[_tracked_row(set_id=7, anchor=200.0)],
            fail={7: error},
        )
        result = await wz.push_power_zones(FakeDB(), "u1")

        assert [entry["id"] for entry in result["skipped"]] == [7]
        assert result["skipped"][0]["reason"] == "rejected"
        assert result["updated"] == [8]
        # The failure is recorded on the row the athlete will see, not swallowed.
        assert state["rows"][0].last_error

    async def test_creates_a_set_when_there_is_nothing_to_update(self, push_stub):
        # The GET endpoint may return only our app's sets; a fresh connection would
        # otherwise have nothing to update and the feature would do nothing.
        calls, state = push_stub(
            profile=_profile(ftp=250.0), connection=_connection(), raw=[]
        )
        result = await wz.push_power_zones(FakeDB(), "u1")

        assert result["created"] == [99]
        assert calls["create"] == [
            {
                "ftp": 250,
                "workout_type_family_id": wz.WAHOO_FAMILY_BIKING,
                "workout_type_location_id": 0,
            }
        ]
        assert state["rows"][0].anchor_value == 250.0

    async def test_other_apps_set_is_reported_not_written(self, push_stub):
        calls, _ = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            raw=[_raw_set(set_id=7, app=1002)],
        )
        result = await wz.push_power_zones(FakeDB(), "u1")

        assert result["foreign"] == [7]
        assert result["created"] == []
        # No creating our own set on top of a deliberate delegation to another app.
        assert calls["update"] == []
        assert calls["create"] == []


class TestRevertWahooZones:
    async def test_restores_snapshot_and_clears_it(self, push_stub):
        prior = {"ftp": 200.0, "zone_count": 7, "zones": [110.0, 150.0]}
        calls, state = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            rows=[_tracked_row(anchor=250.0, prior=prior)],
        )
        result = await wz.revert_wahoo_zones(FakeDB(), "u1")

        assert result["reverted"] == [7]
        assert result["anchor_value"] == 200.0
        assert calls["update"] == [
            (7, {"ftp": 200, "zone_1": 110, "zone_2": 150, "zone_count": 7})
        ]
        row = state["rows"][0]
        # Cleared, so "has a snapshot" cannot stay true forever (none_as_null).
        assert row.prior is None
        assert row.boundaries is None
        assert row.anchor_value == 200.0

    async def test_nothing_to_restore_is_a_typed_error(self, push_stub):
        push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            rows=[_tracked_row(anchor=250.0, prior=None)],
        )
        with pytest.raises(wz.WahooZoneError) as excinfo:
            await wz.revert_wahoo_zones(FakeDB(), "u1")
        assert excinfo.value.code == "no_snapshot"

    async def test_set_deleted_on_wahoos_side_drops_the_snapshot(self, push_stub):
        prior = {"ftp": 200.0, "zone_count": 7, "zones": []}
        error = httpx.HTTPStatusError(
            "gone",
            request=httpx.Request("PUT", "https://api.wahooligan.com/v1/power_zones/7"),
            response=httpx.Response(404, request=httpx.Request("PUT", "https://x")),
        )
        _calls, state = push_stub(
            profile=_profile(ftp=250.0),
            connection=_connection(),
            rows=[_tracked_row(anchor=250.0, prior=prior)],
            fail={7: error},
        )
        result = await wz.revert_wahoo_zones(FakeDB(), "u1")

        assert result["missing"] == [7]
        assert result["reverted"] == []
        # Otherwise the revert would fail forever on a set that no longer exists.
        assert state["rows"][0].prior is None


class TestEnqueueHelpers:
    def test_opted_out_enqueues_nothing(self):
        assert wz.enqueue_zone_push_if_opted_in("u1", _profile(opt_in=False)) is False
        assert wz.enqueue_zone_push_if_opted_in("u1", None) is False

    def test_queue_failure_does_not_raise_into_the_caller(self, monkeypatch):
        # A queue that is down must not fail an FTP edit that already succeeded.
        import sys
        import types

        class Boom:
            def delay(self, *_args, **_kwargs):
                raise RuntimeError("broker down")

        fake = types.ModuleType("app.tasks.scheduler")
        fake.push_wahoo_zones_for_user = Boom()
        monkeypatch.setitem(sys.modules, "app.tasks.scheduler", fake)

        assert wz.enqueue_zone_push_if_opted_in("u1", _profile(opt_in=True)) is False

    async def test_commit_before_enqueue(self, monkeypatch):
        # Order is load-bearing: a worker that reads the profile before our commit
        # sees the previous FTP and pushes a stale anchor — silently.
        order: list[str] = []
        db = FakeDB()

        async def _commit():
            order.append("commit")

        db.commit = _commit
        monkeypatch.setattr(
            wz,
            "enqueue_zone_push_if_opted_in",
            lambda user_id, profile: order.append("enqueue") or True,
        )
        queued = await wz.commit_and_enqueue_zone_push(
            db, "u1", _profile(opt_in=True)
        )

        assert queued is True
        assert order == ["commit", "enqueue"]

    async def test_commit_skipped_when_opted_out(self):
        db = FakeDB()
        queued = await wz.commit_and_enqueue_zone_push(db, "u1", _profile(opt_in=False))
        assert queued is False
        assert db.commits == 0
