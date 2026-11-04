"""Contact sheet for the frontend P2 six-pose Google 3D QA."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"

ROWS = [
    (
        "Lake Geneva Loop — Google 3D",
        "frontend-p2-lake-",
        [
            ("overview", "1 · OVERVIEW"),
            ("lausanne", "2 · LAUSANNE"),
            ("montreux", "3 · MONTREUX"),
            ("climb", "4 · CLIMB"),
            ("summit", "5 · HIGH POINT"),
            ("close", "6 · CLOSE"),
        ],
    ),
    (
        "Arthur's Seat Lap — Google 3D",
        "frontend-p2-arthurs-",
        [
            ("overview", "1 · OVERVIEW"),
            ("start", "2 · START"),
            ("mid", "3 · MID"),
            ("climb", "4 · CLIMB"),
            ("summit", "5 · HIGH POINT"),
            ("close", "6 · CLOSE"),
        ],
    ),
]

TILE_W, TILE_H = 640, 360
LABEL_H = 30
GAP = 10
COLS = 3


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
    title_h = 62
    width = COLS * TILE_W + (COLS + 1) * GAP
    height = title_h + len(ROWS) * (2 * (TILE_H + LABEL_H) + GAP) + GAP
    sheet = Image.new("RGB", (width, height), "#0b1220")
    draw = ImageDraw.Draw(sheet)
    draw.text(
        (GAP, 12),
        "Frontend P2 — Google 3D six-pose QA",
        fill="#e8eef7",
        font=font(20),
    )
    draw.text(
        (GAP, 36),
        "Lake Geneva / Arthur's Seat · localhost:3000 · Google 3D · story + app cap",
        fill="#7f93ad",
        font=font(12),
    )

    y = title_h + GAP
    for title, prefix, poses in ROWS:
        draw.text((GAP, y), title, fill="#fbbf24", font=font(14))
        y += 20
        for i, (pose, label) in enumerate(poses):
            col = i % COLS
            row = i // COLS
            x = GAP + col * (TILE_W + GAP)
            tile_y = y + row * (TILE_H + LABEL_H + GAP)
            path = OUT / f"{prefix}{pose}.png"
            if path.exists():
                img = (
                    Image.open(path)
                    .convert("RGB")
                    .resize((TILE_W, TILE_H), Image.LANCZOS)
                )
            else:
                img = Image.new("RGB", (TILE_W, TILE_H), "#141d2c")
                placeholder = ImageDraw.Draw(img)
                placeholder.text(
                    (20, TILE_H // 2),
                    f"missing {path.name}",
                    fill="#ff8a8a",
                    font=font(14),
                )
            sheet.paste(img, (x, tile_y))
            draw.rectangle(
                [x, tile_y + TILE_H, x + TILE_W, tile_y + TILE_H + LABEL_H],
                fill="#111b2b",
            )
            draw.text(
                (x + 10, tile_y + TILE_H + 7),
                label,
                fill="#cfd9e6",
                font=font(13),
            )
        y += 2 * (TILE_H + LABEL_H + GAP)

    out = OUT / "contact-sheet-frontend-p2.png"
    sheet.save(out)
    print(f"wrote {out} ({width}x{height})")


if __name__ == "__main__":
    main()
