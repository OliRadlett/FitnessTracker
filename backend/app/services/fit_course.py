"""Minimal FIT course-file encoder.

Wahoo's route upload (``POST /v1/routes``) expects a base64-encoded **FIT**
course file. ``fitparse`` (an existing dependency) is read-only, so this module
hand-rolls the small subset of the FIT protocol needed for a course:

    file_id (global 0) -> course (global 31) -> record (global 20) x N

The encoding is deliberately little-endian and uses the Garmin reference
CRC-16 algorithm. Correctness is verified by round-tripping through
``fitparse`` in ``tests/test_fit_course.py``.
"""

from __future__ import annotations

import struct
from datetime import UTC, datetime

from app.services.polyline_utils import (
    decode_polyline,
    haversine_distance,
)

FIT_EPOCH = datetime(1989, 12, 31, tzinfo=UTC)
_FIT_HEADER_SIZE = 14
_PROTOCOL_VERSION = 0x20
_PROFILE_VERSION = 2140
_MAX_COURSE_POINTS = 10_000

# Base type bytes (high bit = "endian-able", relevant for multi-byte types).
_ENUM = 0x00
_STRING = 0x07
_UINT16 = 0x84
_SINT32 = 0x85
_UINT32 = 0x86
_UINT32Z = 0x8C

# Invalid values
_INVALID_SINT32 = 0x7FFFFFFF
_INVALID_UINT16 = 0xFFFF
_INVALID_UINT32 = 0xFFFFFFFF

# Garmin reference CRC-16 (poly 0xA001, reflected) nibble table.
_CRC_TABLE = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
]


def _crc16(data: bytes, crc: int = 0) -> int:
    for byte in data:
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ _CRC_TABLE[byte & 0xF]
        tmp = _CRC_TABLE[crc & 0xF]
        crc = (crc >> 4) & 0x0FFF
        crc ^= tmp ^ _CRC_TABLE[(byte >> 4) & 0xF]
    return crc & 0xFFFF


def _fit_timestamp(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int((dt - FIT_EPOCH).total_seconds())


def _definition_message(local: int, global_num: int, fields: list[tuple[int, int, int]]) -> bytes:
    """Build a definition message for ``fields`` = [(def_num, size, base_type)]."""
    out = bytearray()
    out.append(0x40 | (local & 0x0F))  # definition header
    out.append(0)  # reserved
    out.append(0)  # architecture: little endian
    out += struct.pack("<H", global_num)
    out.append(len(fields))
    for def_num, size, base_type in fields:
        out.append(def_num)
        out.append(size)
        out.append(base_type)
    return bytes(out)


def _semicircles(degrees: float) -> int:
    return int(round(degrees * (2**31 / 180.0)))


def _wrap_u32(value: int) -> int:
    """Wrap a value into the unsigned 32-bit range used by FIT uint32 fields."""
    return value & 0xFFFFFFFF


def _encode_altitude(alt_m: float | None) -> int:
    if alt_m is None:
        return _INVALID_UINT16
    encoded = int(round((alt_m + 500.0) * 5.0))
    if encoded < 0 or encoded >= _INVALID_UINT16:
        return _INVALID_UINT16
    return encoded


def _interp_elevation(profile: dict | None, distance_m: float) -> float | None:
    """Interpolate elevation at ``distance_m`` from a route elevation profile."""
    if not profile:
        return None
    dists = profile.get("distance") or []
    eles = profile.get("elevation") or []
    pairs = [(float(d), float(e)) for d, e in zip(dists, eles) if e is not None]
    if len(pairs) < 2:
        return pairs[0][1] if pairs else None

    if distance_m <= pairs[0][0]:
        return pairs[0][1]
    if distance_m >= pairs[-1][0]:
        return pairs[-1][1]

    lo, hi = 0, len(pairs) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if pairs[mid][0] <= distance_m:
            lo = mid
        else:
            hi = mid
    d0, e0 = pairs[lo]
    d1, e1 = pairs[hi]
    if d1 == d0:
        return e0
    frac = (distance_m - d0) / (d1 - d0)
    return e0 + frac * (e1 - e0)


def _decimate(points: list[tuple[float, float, float | None]]) -> list[tuple[float, float, float | None]]:
    if len(points) <= _MAX_COURSE_POINTS:
        return points
    # Always keep first + last; stride the middle.
    step = (len(points) - 1) / (_MAX_COURSE_POINTS - 1)
    sampled = [points[int(round(i * step))] for i in range(_MAX_COURSE_POINTS)]
    return sampled


def course_points_from_route(route) -> list[tuple[float, float, float | None]]:
    """Build (lat, lng, elevation|None) course points from a ``Route``.

    Elevation is interpolated from ``Route.elevation_profile`` when present.
    """
    coords = decode_polyline(route.encoded_polyline or "")
    if not coords:
        return []

    profile = route.elevation_profile
    points: list[tuple[float, float, float | None]] = []
    cumulative = 0.0
    for i, (lat, lng) in enumerate(coords):
        if i > 0:
            cumulative += haversine_distance(
                coords[i - 1][0], coords[i - 1][1], lat, lng
            )
        alt = _interp_elevation(profile, cumulative)
        points.append((lat, lng, alt))
    return _decimate(points)


def encode_course_fit(
    name: str,
    points: list[tuple[float, float, float | None]],
    *,
    created_at: datetime | None = None,
) -> bytes:
    """Encode course points into a FIT course file.

    ``points`` is an ordered list of ``(lat, lng, elevation_m|None)``. Raises
    ``ValueError`` when there are fewer than two points.
    """
    if len(points) < 2:
        raise ValueError("a FIT course needs at least two points")

    created = created_at or datetime.now(UTC)
    created_ts = _fit_timestamp(created)

    # Cumulative distances (meters) for the distance field.
    distances = [0.0]
    for i in range(1, len(points)):
        distances.append(
            distances[-1]
            + haversine_distance(
                points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]
            )
        )

    name_bytes = name.encode("utf-8")[:255]
    name_field_size = len(name_bytes) + 1  # null terminator

    body = bytearray()

    # file_id (local 0, global 0)
    body += _definition_message(
        0,
        0,
        [
            (0, 1, _ENUM),      # type
            (1, 2, _UINT16),    # manufacturer
            (2, 2, _UINT16),    # product
            (3, 4, _UINT32Z),   # serial_number
            (4, 4, _UINT32),    # time_created
        ],
    )
    body += bytes([0])
    body += struct.pack("<B", 6)        # file type = course
    body += struct.pack("<H", 255)      # manufacturer = development
    body += struct.pack("<H", 0)        # product
    body += struct.pack("<I", 0x12345678)  # serial
    body += struct.pack("<I", _wrap_u32(created_ts))

    # course (local 1, global 31)
    body += _definition_message(
        1,
        31,
        [
            (4, 1, _ENUM),                 # sport
            (5, name_field_size, _STRING),  # name
        ],
    )
    body += bytes([1])
    body += struct.pack("<B", 2)  # sport = cycling
    body += name_bytes + b"\x00"

    # record (local 2, global 20)
    body += _definition_message(
        2,
        20,
        [
            (253, 4, _UINT32),  # timestamp
            (0, 4, _SINT32),    # position_lat
            (1, 4, _SINT32),    # position_long
            (2, 2, _UINT16),    # altitude
            (5, 4, _UINT32),    # distance
        ],
    )

    for i, (lat, lng, alt) in enumerate(points):
        body += bytes([2])
        body += struct.pack("<I", _wrap_u32(created_ts + i))
        body += struct.pack("<i", _semicircles(lat))
        body += struct.pack("<i", _semicircles(lng))
        body += struct.pack("<H", _encode_altitude(alt))
        dist_enc = min(_INVALID_UINT32 - 1, int(round(distances[i] * 100.0)))
        body += struct.pack("<I", dist_enc)

    data = bytes(body)

    header = bytearray()
    header.append(_FIT_HEADER_SIZE)
    header.append(_PROTOCOL_VERSION)
    header += struct.pack("<H", _PROFILE_VERSION)
    header += struct.pack("<I", len(data))
    header += b".FIT"
    header += struct.pack("<H", _crc16(bytes(header)))  # header CRC (first 12 bytes)

    file_bytes = bytes(header) + data
    file_bytes += struct.pack("<H", _crc16(file_bytes))
    return file_bytes
