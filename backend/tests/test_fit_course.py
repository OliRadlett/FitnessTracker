"""Unit tests for the FIT course encoder.

Correctness is checked with ``fitparse`` (already a dependency) when available;
otherwise a small built-in FIT reader is used so the tests still run without
the package installed (e.g. a bare host Python). The writer uses semicircle
lat/lng and the (altitude + 500) * 5 encoding from the FIT spec.
"""

import struct

import pytest

from app.services.fit_course import (
    FIT_EPOCH,
    _crc16,
    _interp_elevation,
    course_points_from_route,
    encode_course_fit,
)

_POINTS = [
    (51.5000, -0.1000, 10.0),
    (51.5001, -0.1001, 12.0),
    (51.5002, -0.1002, 15.0),
]

# fitparse's own semicircle/altitude/unix transforms
_SEMI = 2**31 / 180.0
_FIT_UNIX_DELTA = int(FIT_EPOCH.timestamp())

try:
    import fitparse

    _HAS_FITPARSE = True
except ImportError:  # pragma: no cover - depends on environment
    _HAS_FITPARSE = False


def _parse(fit_bytes: bytes) -> list[dict]:
    """Minimal definition-aware FIT reader → list of decoded record dicts."""
    header_size = fit_bytes[0]
    data_size = struct.unpack_from("<I", fit_bytes, 4)[0]
    data = fit_bytes[header_size : header_size + data_size]

    base = {
        0: "B", 1: "b", 2: "B", 3: "h", 4: "H", 5: "i", 6: "I",
        7: "s", 8: "f", 9: "d", 10: "B", 11: "H", 12: "I", 13: "B",
    }

    defs: dict[int, tuple[int, int, list]] = {}
    records: list[dict] = []
    i = 0
    while i < len(data):
        header = data[i]
        if header & 0x40:  # definition
            local = header & 0x0F
            arch = data[i + 2]
            global_num = struct.unpack_from("<H", data, i + 3)[0]
            count = data[i + 5]
            fields, p = [], i + 6
            for _ in range(count):
                fields.append((data[p], data[p + 1], data[p + 2]))
                p += 3
            defs[local] = (global_num, arch, fields)
            i = p
        else:  # data
            local = header & 0x0F
            global_num, arch, fields = defs[local]
            p, values = i + 1, {}
            for def_num, size, bt in fields:
                raw = data[p : p + size]
                p += size
                basetype = bt & 0x1F
                if basetype == 7:
                    values[def_num] = raw.split(b"\x00")[0].decode("utf-8", "replace")
                else:
                    endian = "<" if arch == 0 else ">"
                    values[def_num] = struct.unpack(endian + base[basetype], raw)[0]
            records.append({"global": global_num, "values": values})
            i = p
    return records


def _read_messages(fit_bytes: bytes, name: str) -> list:
    if _HAS_FITPARSE:
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".fit", delete=False) as fh:
            fh.write(fit_bytes)
            path = fh.name
        return [m for m in fitparse.FitFile(path).get_messages() if m.name == name]
    # Fallback: filter the generic reader by global message number.
    globals_by_name = {"file_id": 0, "course": 31, "record": 20}
    return [r["values"] for r in _parse(fit_bytes) if r["global"] == globals_by_name[name]]


def test_crc_is_deterministic_and_valid():
    assert _crc16(b"") == 0
    # Both CRCs in the file must validate against the byte streams they cover.
    fit = encode_course_fit("Ride", _POINTS)
    header_size = fit[0]
    data_size = struct.unpack_from("<I", fit, 4)[0]
    assert struct.unpack_from("<H", fit, 12)[0] == _crc16(fit[:12])
    assert struct.unpack_from("<H", fit, header_size + data_size)[0] == _crc16(
        fit[: header_size + data_size]
    )


def test_file_id_is_course():
    fit = encode_course_fit("Ride", _POINTS)
    if _HAS_FITPARSE:
        file_ids = _read_messages(fit, "file_id")
        assert len(file_ids) == 1
        assert file_ids[0].get_value("type") == "course"
    else:
        file_ids = _read_messages(fit, "file_id")
        assert len(file_ids) == 1
        assert file_ids[0][0] == 6  # file type enum: course


def test_course_name_and_sport():
    fit = encode_course_fit("Test Loop", _POINTS)
    courses = _read_messages(fit, "course")
    assert len(courses) == 1
    if _HAS_FITPARSE:
        assert courses[0].get_value("name") == "Test Loop"
        assert courses[0].get_value("sport") == "cycling"
    else:
        assert courses[0][5] == "Test Loop"
        assert courses[0][4] == 2  # sport enum: cycling


def test_record_coordinates_round_trip():
    fit = encode_course_fit("Ride", _POINTS)
    records = _read_messages(fit, "record")
    assert len(records) == len(_POINTS)

    for msg, (lat, lng, alt) in zip(records, _POINTS):
        if _HAS_FITPARSE:
            got = (
                msg.get_value("position_lat"),
                msg.get_value("position_long"),
                msg.get_value("altitude"),
            )
        else:
            got = (msg[0] / _SEMI, msg[1] / _SEMI, msg[2] / 5.0 - 500.0)
        assert got[0] == pytest.approx(lat, abs=1e-6)
        assert got[1] == pytest.approx(lng, abs=1e-6)
        assert got[2] == pytest.approx(alt, abs=0.3)


def test_requires_two_points():
    with pytest.raises(ValueError):
        encode_course_fit("Ride", [(51.5, -0.1, 0.0)])


def test_interp_elevation():
    profile = {"distance": [0.0, 100.0, 200.0], "elevation": [10.0, 20.0, None]}
    assert _interp_elevation(profile, 0.0) == 10.0
    assert _interp_elevation(profile, 50.0) == pytest.approx(15.0)
    assert _interp_elevation(profile, 500.0) == 20.0
    assert _interp_elevation(None, 10.0) is None


def test_course_points_from_route_without_elevation():
    class FakeRoute:
        encoded_polyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
        elevation_profile = None

    points = course_points_from_route(FakeRoute())
    assert len(points) >= 2
    assert all(ele is None for _lat, _lng, ele in points)


def test_course_points_interpolate_elevation():
    class FakeRoute:
        encoded_polyline = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"

        def __init__(self):
            self.elevation_profile = {
                "distance": [0.0, 5_000_000.0],
                "elevation": [100.0, 200.0],
            }

    points = course_points_from_route(FakeRoute())
    elevations = [ele for _lat, _lng, ele in points]
    assert all(ele is not None for ele in elevations)
    assert elevations[0] == pytest.approx(100.0, abs=1.0)
    assert elevations[-1] >= elevations[0]
