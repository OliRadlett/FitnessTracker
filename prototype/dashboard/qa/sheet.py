"""Build the dashboard artifact sheets from qa/out/.

Run: python qa/sheet.py
Writes qa/out/contact-sheet.png and qa/out/compare-today.png.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
OUT = HERE / "out"
BEFORE = HERE / "before"
BG = (10, 14, 20)
INK = (233, 236, 240)
SUB = (150, 165, 185)
RULE = (40, 46, 56)
PAD = 26
GAP = 18


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    p = Path(r"C:\Windows\Fonts") / name
    return ImageFont.truetype(str(p), size) if p.exists() else ImageFont.load_default()


def load(name: str, folder: Path = OUT) -> Image.Image:
    return Image.open(folder / name).convert("RGB")


def scale(im: Image.Image, width: int) -> Image.Image:
    return im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)


def crop_bottom(im: Image.Image, height: int) -> Image.Image:
    return im.crop((0, 0, im.width, min(height, im.height)))


def grid(frames: list[tuple[str, str, Image.Image]], cols: int, width: int, path: Path, title: str) -> None:
    """frames: (caption, note, image)."""
    tiles = [(c, n, scale(im, width)) for c, n, im in frames]
    rows = (len(tiles) + cols - 1) // cols
    row_h = [max(t[2].height for t in tiles[r * cols : (r + 1) * cols]) for r in range(rows)]

    head = 74
    W = cols * width + (cols - 1) * GAP + PAD * 2
    H = head + sum(row_h) + (rows - 1) * (GAP + 30) + PAD
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)

    d.text((PAD, 18), title, fill=INK, font=font(21, bold=True))
    d.line((PAD, head - 12, W - PAD, head - 12), fill=RULE)

    y = head
    for r in range(rows):
        x = PAD
        for tile in tiles[r * cols : (r + 1) * cols]:
            cap, note, im = tile
            d.text((x, y), cap, fill=INK, font=font(13, bold=True))
            d.text((x, y + 17), note, fill=SUB, font=font(12))
            canvas.paste(im, (x, y + 34))
            x += width + GAP
        y += row_h[r] + GAP + 30

    canvas.save(path)
    print(f"{path.relative_to(HERE)}  {canvas.width}x{canvas.height}")


def band(entries: list[tuple[str, str, Image.Image]], width: int, path: Path, title: str) -> None:
    tiles = [(c, n, scale(im, width)) for c, n, im in entries]
    head = 74
    h = max(t[2].height for t in tiles) + head + 46
    W = len(tiles) * width + (len(tiles) - 1) * GAP + PAD * 2
    canvas = Image.new("RGB", (W, h), BG)
    d = ImageDraw.Draw(canvas)
    d.text((PAD, 18), title, fill=INK, font=font(21, bold=True))
    d.line((PAD, head - 12, W - PAD, head - 12), fill=RULE)
    x = PAD
    for cap, note, im in tiles:
        d.text((x, head), cap, fill=INK, font=font(13, bold=True))
        d.text((x, head + 17), note, fill=SUB, font=font(12))
        canvas.paste(im, (x, head + 38))
        x += width + GAP
    canvas.save(path)
    print(f"{path.relative_to(HERE)}  {canvas.width}x{canvas.height}")


def main() -> None:
    # 1 — before vs both candidates, the same day, the same data.
    band(
        [
            (
                "BEFORE — /dashboard Today",
                "3.1 screens · 30 API calls · four empty cards · 2 of 6 signals hidden",
                crop_bottom(load("desktop-today-full.png", BEFORE), 2400),
            ),
            (
                "A — The Answer",
                "1.2 screens · the decision first, its evidence beside it",
                load("01-a-today-now--fold.png"),
            ),
            (
                "B — The Console",
                "1.3 screens · the record first, the decision inside it",
                load("06-b-today-now--fold.png"),
            ),
        ],
        width=700,
        path=OUT / "compare-today.png",
        title="Today, before and after — same fixture, same day, 1440×900",
    )

    # 2 — the full artifact: every fixed state.
    grid(
        [
            ("01 · A Today", "rest day · 2026-11-04 · 1.2 screens", load("01-a-today-now.png")),
            ("02 · A Today", "lift day · 2026-11-03", load("02-a-today-lift.png")),
            ("03 · A Today", "ride day · 2026-10-27 · form +0.7, 128 TSS", load("03-a-today-ride.png")),
            ("06 · B Today", "rest day · instruments first", load("06-b-today-now.png")),
            ("04 · A Trends", "one range · 3 charts · 1.5 screens", load("04-a-trends.png")),
            ("05 · A History", "the record as a table", load("05-a-history.png")),
            ("04b · A Trends", "analysis expanded · markdown rendered, age stated", crop_bottom(load("04b-a-trends-analysis.png"), 2400)),
            ("08 · B Trends", "same zone, candidate B", crop_bottom(load("08-b-trends.png"), 2400)),
        ],
        cols=4,
        width=430,
        path=OUT / "contact-sheet-desktop.png",
        title="Artifact — desktop, 1440×900, every fixed state",
    )

    # 3 — mobile.
    grid(
        [
            ("09 · A Today", "390×844 · 2.0 screens", load("09-a-today-now-390.png")),
            ("10 · A Today", "ride day · the same layout at the busiest state", load("10-a-today-ride-390.png")),
            ("12 · B Today", "390×844 · 2.2 screens", load("12-b-today-now-390.png")),
            ("11 · A Trends", "390×844 · 2.4 screens", load("11-a-trends-390.png")),
        ],
        cols=4,
        width=330,
        path=OUT / "contact-sheet-mobile.png",
        title="Artifact — mobile, 390×844",
    )


if __name__ == "__main__":
    main()
