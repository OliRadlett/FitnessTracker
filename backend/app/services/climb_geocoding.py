"""Best-effort OSM area lookup for climb groups (Nominatim).

The page needs a place name to make a card identifiable. Route ``locality`` is
null on this account, and the generated name for a generic route is only
"Climb 3"; the area is the cheapest honest context. One reverse lookup per
climb, cached on the group, 1 req/s per Nominatim's usage policy, ODbL
attribution in the page footer.

This is deliberately a backfill/script, not a read path: a page request must
never depend on a third-party geocoder.
"""

from __future__ import annotations

import asyncio
import uuid

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.segment import Segment, SegmentGroup
from app.services.segment_groups import KIND_CLIMB

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "FitTrack personal climb atlas (one-off; 1 req/s)"
DELAY_SECONDS = 1.1
_EUROPE = "Europe/London"


def area_from_address(address: dict) -> tuple[str | None, str | None, str | None]:
    """``(area, region, country)`` from a Nominatim address.

    Area is the most specific human place (suburb/village/town), region is the
    county, country the country. ``City of Edinburgh`` is normalised because it
    reads as a council area, not a place a rider says.
    """
    def norm(value: str | None) -> str | None:
        return "Edinburgh" if value == "City of Edinburgh" else value

    suburb = address.get("suburb") or address.get("neighbourhood")
    village = address.get("village") or address.get("hamlet")
    town = address.get("town") or address.get("city")
    county = address.get("county") or address.get("state_district")
    area = norm(suburb or village or town or county)
    region = norm(county) or (norm(town) if town else None)
    country = address.get("country")
    return area, region, country


async def geocode_missing_areas(
    db: AsyncSession, user_id: uuid.UUID, *, limit: int | None = None
) -> dict[str, int]:
    """Fill ``area/region/country`` for groups that do not have one yet."""
    query = (
        select(SegmentGroup)
        .where(
            SegmentGroup.user_id == user_id,
            SegmentGroup.kind == KIND_CLIMB,
            SegmentGroup.area.is_(None),
            SegmentGroup.centroid_lat.isnot(None),
            SegmentGroup.centroid_lng.isnot(None),
        )
        .options(selectinload(SegmentGroup.segments).selectinload(Segment.route))
    )
    if limit:
        query = query.limit(limit)
    groups = list((await db.execute(query)).scalars().all())
    if not groups:
        return {"geocoded": 0, "failed": 0, "total": 0}

    geocoded = failed = 0
    async with httpx.AsyncClient(
        timeout=15,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        for group in groups:
            try:
                resp = await client.get(
                    NOMINATIM_URL,
                    params={
                        "format": "jsonv2",
                        "lat": group.centroid_lat,
                        "lon": group.centroid_lng,
                        "zoom": 16,
                        "addressdetails": 1,
                    },
                )
                resp.raise_for_status()
                address = (resp.json() or {}).get("address") or {}
                area, region, country = area_from_address(address)
                if area:
                    group.area = area
                    group.region = region
                    group.country = country
                    geocoded += 1
                else:
                    failed += 1
            except Exception:
                failed += 1
            if (geocoded + failed) % 10 == 0:
                await db.commit()
            await asyncio.sleep(DELAY_SECONDS)

    await db.commit()
    return {"geocoded": geocoded, "failed": failed, "total": len(groups)}
