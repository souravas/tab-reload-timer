#!/usr/bin/env python3
"""Generate extension icons: rounded-square tile with a circular reload arrow.

Idle variant: graphite tile, soft-gray glyph.
Active variant: phosphor-green tile, dark glyph.
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), "..", "icons")
S = 1024  # supersampled canvas


def rounded_tile(draw, color):
    r = S * 0.22
    draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=color)


def reload_glyph(draw, color):
    cx, cy = S / 2, S / 2
    radius = S * 0.30
    stroke = S * 0.115
    # Arc from 300deg sweeping clockwise around to 170deg (leaving a gap for the head)
    start_deg, end_deg = -250, 40
    steps = 220
    for i in range(steps + 1):
        a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        x = cx + radius * math.cos(a)
        y = cy + radius * math.sin(a)
        draw.ellipse([x - stroke / 2, y - stroke / 2, x + stroke / 2, y + stroke / 2], fill=color)
    # Arrowhead at the end of the arc, pointing along the tangent (clockwise)
    a = math.radians(end_deg)
    tipx = cx + radius * math.cos(a)
    tipy = cy + radius * math.sin(a)
    tangent = a + math.pi / 2  # clockwise direction of travel
    head = S * 0.21
    p1 = (tipx + head * math.cos(tangent), tipy + head * math.sin(tangent))
    base = math.radians(end_deg)
    bw = head * 0.62
    p2 = (tipx + bw * math.cos(base), tipy + bw * math.sin(base))
    p3 = (tipx - bw * math.cos(base), tipy - bw * math.sin(base))
    draw.polygon([p1, p2, p3], fill=color)


def make(name, tile, glyph):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rounded_tile(d, tile)
    reload_glyph(d, glyph)
    for size in (16, 32, 48, 128):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, f"{name}-{size}.png"))


os.makedirs(ROOT, exist_ok=True)
make("idle", tile=(21, 26, 23, 255), glyph=(176, 188, 180, 255))
make("active", tile=(46, 211, 122, 255), glyph=(10, 18, 13, 255))
print("icons written to", os.path.abspath(ROOT))
