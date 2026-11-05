"""Surface vocabulary shared by Komoot, OSM map-matching and quality.

Pure stdlib so the Modal worker side can import it without dragging in app
config (pitfall 16).
"""

from __future__ import annotations

SURFACE_ALIASES = {
    "asphalt": "paved",
    "paved": "paved",
    "sealed": "paved",
    "concrete": "paved",
    "concrete_plates": "paved",
    "compacted": "compacted_gravel",
    "compacted_gravel": "compacted_gravel",
    "fine_gravel": "gravel",
    "gravel": "gravel",
    "dirt": "dirt",
    "earth": "dirt",
    "ground": "dirt",
    "grass": "grass",
    "grass_paver": "grass",
    "singletrack": "singletrack",
    "trail": "trail",
    "path": "trail",
    "cobblestone": "cobblestone",
    "cobbles": "cobblestone",
    "sett": "cobblestone",
    "stone": "cobblestone",
    "unhewn_cobblestone": "cobblestone",
    "paving_stones": "paved",
    "brick": "paved",
    "brick_paving": "paved",
    "flexipave": "paved",
    "sand": "sand",
}


def clean_surface_type(raw: object) -> str | None:
    """``sb#asphalt`` -> ``paved``; ``sf#unknown``/``wt#*`` -> None.

    Strips Komoot prefixes (``wt#`` is a way type, not a surface) and maps
    OSM/Komoot names onto the app vocabulary. Unknown names are lowercased and
    kept — losing a real surface is worse than showing one the UI has no colour
    for.
    """
    text = str(raw)
    if "#" in text:
        prefix, name = text.split("#", 1)
        if prefix.strip().lower() == "wt":
            return None
        text = name
    name = text.strip().lower()
    if not name or name == "unknown":
        return None
    return SURFACE_ALIASES.get(name, name)


def surface_mix_to_profile(mix: dict[str, float] | None) -> dict[str, float] | None:
    """Normalise ``{raw_surface: weight}`` onto ``{app_surface: fraction}``."""
    if not mix:
        return None
    cleaned: dict[str, float] = {}
    for raw, value in mix.items():
        if not isinstance(value, (int, float)) or value <= 0:
            continue
        name = clean_surface_type(raw)
        if name:
            cleaned[name] = cleaned.get(name, 0.0) + float(value)
    total = sum(cleaned.values())
    if total <= 0:
        return None
    return {name: round(value / total, 4) for name, value in cleaned.items() if value > 0}
