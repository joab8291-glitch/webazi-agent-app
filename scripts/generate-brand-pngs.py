#!/usr/bin/env python3
"""Generate PNG brand assets from the Webazi design system."""
from pathlib import Path
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("Install Pillow: pip install Pillow")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "brand"
IMG = ROOT / "assets" / "images"
OUT.mkdir(parents=True, exist_ok=True)
IMG.mkdir(parents=True, exist_ok=True)

GREEN = (0, 168, 107)
DARK = (11, 31, 23)
LIGHT = (232, 245, 238)
WHITE = (255, 255, 255)
ACCENT = (45, 212, 160)

def font(size, bold=True):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for p in paths:
        if Path(p).exists():
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def make_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = int(size * 0.06)
    r = int(size * 0.18)
    d.rounded_rectangle([m, m, size - m, size - m], radius=r, fill=GREEN)
    cx = cy = size // 2
    for rad in (int(size * 0.09), int(size * 0.15), int(size * 0.21)):
        d.arc([cx - rad, cy - rad - int(size * 0.02), cx + rad, cy + rad - int(size * 0.02)], 210, 330, fill=WHITE, width=max(2, size // 36))
    nr = max(4, size // 25)
    d.ellipse([cx - nr, cy - nr, cx + nr, cy + nr], fill=WHITE)
    bw, bh = int(size * 0.2), max(3, size // 48)
    d.rounded_rectangle([cx - bw, int(size * 0.68), cx + bw, int(size * 0.68) + bh], radius=bh // 2, fill=WHITE)
    return img

icon = make_icon(1024)
for s in (1024, 512, 192, 48):
    icon.resize((s, s), Image.LANCZOS).save(OUT / f"icon-{s}.png")
icon.save(IMG / "icon.png")
icon.resize((200, 200), Image.LANCZOS).save(IMG / "splash-icon.png")
icon.resize((48, 48), Image.LANCZOS).save(IMG / "favicon.png")
icon.save(IMG / "android-icon-foreground.png")
Image.new("RGB", (1024, 1024), GREEN).save(IMG / "android-icon-background.png")
make_icon(1024).save(IMG / "android-icon-monochrome.png")

def wordmark(text_color, line_color, sub_color, name):
    img = Image.new("RGBA", (1200, 400), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    mark = make_icon(200)
    img.paste(mark, (40, 100), mark)
    d.text((280, 130), "Webazi", font=font(140), fill=text_color)
    d.rounded_rectangle([280, 290, 780, 304], radius=6, fill=line_color)
    d.text((280, 320), "USSD Data Delivery", font=font(36, bold=False), fill=sub_color)
    img.save(OUT / name)
    return img

wordmark(DARK, GREEN, (90, 107, 99), "logo-wordmark.png").save(IMG / "logo.png")
wordmark(WHITE, ACCENT, (154, 171, 163), "logo-wordmark-white.png").save(IMG / "logo-white.png")

og = Image.new("RGB", (1200, 630), DARK)
d = ImageDraw.Draw(og)
for i in range(630):
    t = i / 630
    d.line([(0, i), (1200, i)], fill=(
        int(DARK[0] * (1 - t * 0.2)),
        int(DARK[1] + (GREEN[1] - DARK[1]) * t * 0.2),
        int(DARK[2] + 10 * t),
    ))
mark = make_icon(72)
og.paste(mark, (72, 200), mark)
d.text((164, 210), "Webazi", font=font(64), fill=WHITE)
d.rounded_rectangle([72, 300, 280, 310], radius=4, fill=GREEN)
d.text((72, 340), "USSD Data Delivery  ·  Auto-Fulfillment", font=font(26, bold=False), fill=LIGHT)
d.text((72, 395), "M-Pesa  →  SMS match  →  Instant USSD", font=font(22), fill=ACCENT)
d.rounded_rectangle([720, 90, 1120, 540], radius=32, fill=(18, 42, 32))
d.rounded_rectangle([748, 120, 1092, 168], radius=14, fill=(11, 61, 44))
d.text((768, 132), "Dashboard  ·  Live", font=font(18), fill=WHITE)
for i, label in enumerate(["Backend · Operational", "SMS · Connected", "Accessibility · Active"]):
    y = 200 + i * 40
    d.ellipse([760, y, 776, y + 16], fill=GREEN)
    d.text((792, y - 2), label, font=font(16, bold=False), fill=LIGHT)
d.rounded_rectangle([748, 340, 1092, 510], radius=14, fill=DARK)
d.text((768, 355), "Activity", font=font(16), fill=ACCENT)
for i, line in enumerate(["USSD Delivered · Bingwa 1GB", "SMS Matched · KES 99", "Auto-fulfillment OK"]):
    d.text((768, 390 + i * 34), "✓  " + line, font=font(14, bold=False), fill=LIGHT)
og.save(OUT / "og-image.png")
og.save(IMG / "og-image.png")
print("Brand PNGs written to", OUT, "and", IMG)
