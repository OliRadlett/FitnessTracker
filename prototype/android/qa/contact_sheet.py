"""Builds the flow contact sheet from the rendered frames.

    python qa/contact_sheet.py

Reads qa/out/1..5*.png and writes qa/out/contact-sheet-flow.png. Pure
presentation: no frame is altered, only scaled and captioned.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

LAB = Path(__file__).resolve().parent.parent
OUT = LAB / "qa" / "out"

FRAMES = [
    ("1-today.png", "1  Today", "One card, one action.\nThe session, not the dashboard."),
    ("2-live-set.png", "2  Live set", "Prefilled 90 × 4 @7.\nTwo taps from a cold open."),
    ("3-rest.png", "3  Rest", "Timer replaces the last-set card.\nThe set list never moves."),
    ("4-done.png", "4  Done", "5,326 kg, by exercise.\nNo invented comparison."),
    ("5-today-after.png", "5  Today, after", "Same screen, rows ticked,\nthird bar added."),
]

BG = (9, 14, 14)
CARD = (18, 24, 24)
FG = (230, 230, 230)
MUTED = (148, 163, 184)
ACCENT = (16, 185, 129)

SCALE = 0.42
GAP = 34
MARGIN = 56


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "seguisb.ttf" if bold else "segoeui.ttf"
    path = Path("C:/Windows/Fonts") / name
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = Image.new("RGBA", img.size)
    out.paste(img, (0, 0), mask)
    return out


def main() -> None:
    loaded = []
    for name, title, caption in FRAMES:
        path = OUT / name
        if not path.exists():
            raise SystemExit(f"missing frame: {path}")
        img = Image.open(path).convert("RGB")
        w = int(img.width * SCALE)
        h = int(img.height * SCALE)
        loaded.append((img.resize((w, h), Image.LANCZOS), title, caption))

    frame_w, frame_h = loaded[0][0].size
    cols = len(loaded)
    content_w = cols * frame_w + (cols - 1) * GAP
    width = content_w + MARGIN * 2
    header_h = 150
    caption_h = 120
    height = header_h + frame_h + caption_h + MARGIN

    sheet = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(sheet)

    draw.text((MARGIN, 46), "FitTrack Android — flow: bench day", font=font(40, bold=True), fill=FG)
    draw.text(
        (MARGIN, 100),
        "412 × 915 dp · Pixel 8 class · real 3 Nov 2026 session, via production screenshots"
        " · rendered 2026-11-05 · no device, no mock",
        font=font(20),
        fill=MUTED,
    )

    x = MARGIN
    for img, title, caption in loaded:
        sheet.paste(img, (x, header_h))
        draw.rectangle([x, header_h, x + frame_w - 1, header_h + frame_h - 1], outline=CARD, width=2)
        draw.text((x, header_h + frame_h + 18), title, font=font(22, bold=True), fill=FG)
        draw.multiline_text((x + 2, header_h + frame_h + 52), caption, font=font(17), fill=MUTED, spacing=6)
        x += frame_w + GAP

    out = OUT / "contact-sheet-flow.png"
    sheet.save(out)
    print(f"{out}  {sheet.width}x{sheet.height}")


if __name__ == "__main__":
    main()
