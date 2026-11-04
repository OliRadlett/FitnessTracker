"""Build one contact sheet of the P3/P4/P5 evidence for the Relive 3D build.

Run from prototype/relive: python qa/p34_contact_sheet.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("qa/out")

ROWS = [
    (
        "P3 — ghost racing (production, real backend)",
        [
            ("frontend-p3-production-overview.png", "overview + budget"),
            ("frontend-p3-production-ghost.png", "ghost selected (PB chip)"),
            ("frontend-p3-production-ghost-playing.png", "delta tracking"),
        ],
    ),
    (
        "P4 — mobile + static fallback",
        [
            ("frontend-p4-mobile-overview.png", "iPhone 13"),
            ("frontend-p4-mobile-ghost.png", "ghost row scrolls"),
            ("frontend-p4-fallback-poster.png", "3D blocked → poster"),
        ],
    ),
    (
        "P5 — rollout from the classic list",
        [
            ("frontend-p5-replay-list.png", "/replay links to new viewer"),
            ("frontend-p5-from-list.png", "opened from the list"),
            ("frontend-p3-dev-ghost.png", "dev harness ghost"),
        ],
    ),
]

THUMB_W = 620
PAD = 16
HEADER = 34
LABEL = 22


def thumb(path: Path) -> Image.Image | None:
    if not path.exists():
        return None
    image = Image.open(path).convert("RGB")
    height = round(image.height * THUMB_W / image.width)
    return image.resize((THUMB_W, height), Image.LANCZOS)


def main() -> None:
    tiles: list[tuple[str, list[tuple[Image.Image | None, str]]]] = []
    for title, entries in ROWS:
        row = [(thumb(OUT / name), label) for name, label in entries]
        tiles.append((title, row))

    row_heights = [
        max((image.height if image else 200) for image, _ in row) for _, row in tiles
    ]
    width = PAD + 3 * (THUMB_W + PAD)
    height = PAD + sum(HEADER + row_heights[i] + LABEL + PAD for i in range(len(tiles)))

    sheet = Image.new("RGB", (width, height), (7, 17, 29))
    draw = ImageDraw.Draw(sheet)

    y = PAD
    for index, (title, row) in enumerate(tiles):
        draw.text((PAD, y + 8), title, fill=(245, 158, 11))
        y += HEADER
        x = PAD
        for image, label in row:
            if image is not None:
                sheet.paste(image, (x, y))
            draw.text((x, y + row_heights[index] + 4), label, fill=(147, 164, 187))
            x += THUMB_W + PAD
        y += row_heights[index] + LABEL + PAD

    out = OUT / "contact-sheet-p3-p5.png"
    sheet.save(out)
    print(f"wrote {out.resolve()} ({sheet.width}x{sheet.height})")


if __name__ == "__main__":
    main()
