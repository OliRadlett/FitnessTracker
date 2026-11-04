"""Compose the six pose screenshots into a contact sheet.

Run after `npm run qa:shots`:
    python qa/contact_sheet.py
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
PREFIX = os.environ.get("RELIVE_PREFIX", "")
TITLE = os.environ.get("RELIVE_TITLE", "Lake Geneva Loop — free-explore world bake-off")
SUBTITLE = os.environ.get(
    "RELIVE_SUBTITLE",
    "MapLibre GL · OpenFreeMap Liberty · AWS terrarium terrain · 6 fixed camera poses",
)
POSES = ["overview", "lausanne", "montreux", "climb", "summit", "close"]
LABELS = {
    "overview": "1 · OVERVIEW — lake + full route",
    "lausanne": "2 · LAUSANNE — north shore",
    "montreux": "3 · MONTREUX — east end",
    "climb": "4 · CLIMB — 7.4% / 1 km + rider marker",
    "summit": "5 · HIGH POINT — 467 m",
    "close": "6 · CLOSE — road detail (rider model pending)",
}

TILE_W, TILE_H = 640, 360
LABEL_H = 30
GAP = 10
COLS = 3
ROWS = 2


def font(size: int) -> ImageFont.ImageFont:
    for path in (
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main() -> None:
    missing = [p for p in POSES if not (OUT / f"{PREFIX}{p}.png").exists()]
    if missing:
        print(f"missing screenshots (placeholder used): {missing}")

    title_h = 54
    width = COLS * TILE_W + (COLS + 1) * GAP
    height = title_h + ROWS * (TILE_H + LABEL_H) + (ROWS + 1) * GAP
    sheet = Image.new("RGB", (width, height), "#0b1220")
    draw = ImageDraw.Draw(sheet)

    draw.text((GAP, 12), TITLE, fill="#e8eef7", font=font(20))
    draw.text((GAP, 36), SUBTITLE, fill="#7f93ad", font=font(12))

    for i, pose in enumerate(POSES):
        col = i % COLS
        row = i // COLS
        x = GAP + col * (TILE_W + GAP)
        y = title_h + GAP + row * (TILE_H + LABEL_H + GAP)
        if (OUT / f"{PREFIX}{pose}.png").exists():
            img = Image.open(OUT / f"{PREFIX}{pose}.png").convert("RGB").resize((TILE_W, TILE_H), Image.LANCZOS)
        else:
            img = Image.new("RGB", (TILE_W, TILE_H), "#141d2c")
            placeholder = ImageDraw.Draw(img)
            placeholder.text(
                (TILE_W // 2 - 110, TILE_H // 2 - 8),
                "close pose — tile load timeout",
                fill="#ff8a8a",
                font=font(14),
            )
        sheet.paste(img, (x, y))
        draw.rectangle([x, y + TILE_H, x + TILE_W, y + TILE_H + LABEL_H], fill="#111b2b")
        draw.text((x + 10, y + TILE_H + 7), LABELS[pose], fill="#cfd9e6", font=font(13))

    suffix = PREFIX.rstrip("-")
    out = OUT / (f"contact-sheet-{suffix}.png" if suffix else "contact-sheet.png")
    sheet.save(out)
    print(f"wrote {out} ({width}x{height})")


if __name__ == "__main__":
    main()
