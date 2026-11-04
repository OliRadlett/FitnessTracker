"""Compose the old Replay3D vs new Google 3D comparison sheet.

Run from `prototype/relive` after `qa/old-viewer.mjs` and the Google3D shots:
    python qa/compare_sheet.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"

TILES = [
    ("old-orbit.png", "OLD · orbit — floating terrain slab"),
    ("old-chase.png", "OLD · chase — dark plane, tiny bike"),
    ("old-drone.png", "OLD · drone — ribbon + floating route"),
    ("google3d-overview.png", "NEW · overview — lake + full route"),
    ("google3d-lausanne.png", "NEW · Lausanne — photoreal shore"),
    ("google3d-climb.png", "NEW · climb — road, lake, mountains"),
]

TILE_W, TILE_H = 640, 360
LABEL_H = 30
GAP = 10
COLS = 3
ROWS = 2
TITLE = "Same ride, two implementations — Lake Geneva, 174.8 km"
SUBTITLE = (
    "OLD: Replay3D with the real fixture, normalized daylight, full-quality harness "
    "· NEW: Google 3D Maps JS API, same ride"
)


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
    title_h = 54
    width = COLS * TILE_W + (COLS + 1) * GAP
    height = title_h + ROWS * (TILE_H + LABEL_H) + (ROWS + 1) * GAP
    sheet = Image.new("RGB", (width, height), "#0b1220")
    draw = ImageDraw.Draw(sheet)
    draw.text((GAP, 10), TITLE, fill="#e8eef7", font=font(20))
    draw.text((GAP, 34), SUBTITLE, fill="#7f93ad", font=font(11))

    for i, (name, label) in enumerate(TILES):
        col = i % COLS
        row = i // COLS
        x = GAP + col * (TILE_W + GAP)
        y = title_h + GAP + row * (TILE_H + LABEL_H + GAP)
        path = OUT / name
        if path.exists():
            img = Image.open(path).convert("RGB").resize((TILE_W, TILE_H), Image.LANCZOS)
        else:
            img = Image.new("RGB", (TILE_W, TILE_H), "#141d2c")
            ImageDraw.Draw(img).text((20, 20), f"missing: {name}", fill="#ff8a8a", font=font(14))
        sheet.paste(img, (x, y))
        draw.rectangle([x, y + TILE_H, x + TILE_W, y + TILE_H + LABEL_H], fill="#111b2b")
        draw.text((x + 10, y + TILE_H + 7), label, fill="#cfd9e6", font=font(13))

    out = OUT / "compare-old-vs-new.png"
    sheet.save(out)
    print(f"wrote {out} ({width}x{height})")


if __name__ == "__main__":
    main()
