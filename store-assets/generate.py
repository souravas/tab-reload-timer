"""Render Chrome Web Store listing assets from inline SVGs.

Produces 24-bit PNGs (no alpha) at the exact dimensions the store requires.
The mocked popup mirrors the real UI (popup/popup.css) so the listing matches
what users actually see.

Run: python3 generate.py
"""
import io
import math
from pathlib import Path

import cairosvg
from PIL import Image

OUT = Path(__file__).parent

# ---- palette (mirrors popup/popup.css dark theme) ----
BG = "#0c100e"
BG_DEEP = "#05080a"
SURFACE = "#131a16"
SURFACE_2 = "#1a231e"
LINE = "#26312a"          # rgba(235,250,240,.09) over SURFACE, flattened
LINE_STRONG = "#34423a"
TEXT = "#e7efe9"
DIM = "#8da398"
FAINT = "#5d6f66"
ACC = "#3fe081"
ACC_DARK = "#1d9a5b"
ACC_INK = "#07130c"
WARN = "#e8b256"

FONT = "DejaVu Sans, Liberation Sans, sans-serif"
MONO = "DejaVu Sans Mono, monospace"


def escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;")


def shared_defs() -> str:
    return f"""
    <defs>
      <linearGradient id="brandH" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="{ACC}"/>
        <stop offset="1" stop-color="{ACC_DARK}"/>
      </linearGradient>
      <radialGradient id="bgGlow" cx="22%" cy="16%" r="85%">
        <stop offset="0" stop-color="#14301f" stop-opacity="0.95"/>
        <stop offset="0.55" stop-color="{BG}" stop-opacity="1"/>
        <stop offset="1" stop-color="{BG_DEEP}" stop-opacity="1"/>
      </radialGradient>
      <radialGradient id="popGlow" cx="50%" cy="0%" r="80%">
        <stop offset="0" stop-color="{ACC}" stop-opacity="0.07"/>
        <stop offset="0.6" stop-color="{ACC}" stop-opacity="0"/>
      </radialGradient>
      <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
        <feOffset dx="0" dy="8"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="greenBlur" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7"/>
      </filter>
    </defs>
    """


# ----------------------------------------------------------------------
# the extension icon (mirrors dev/make_icons.py "active" variant)
# ----------------------------------------------------------------------
def reload_arc(cx: float, cy: float, radius: float, stroke: float, color: str,
               head_scale: float = 1.8) -> str:
    """Circular reload arrow: arc from -250deg to 40deg plus an arrowhead."""
    a0, a1 = math.radians(-250), math.radians(40)
    x0, y0 = cx + radius * math.cos(a0), cy + radius * math.sin(a0)
    x1, y1 = cx + radius * math.cos(a1), cy + radius * math.sin(a1)
    tangent = a1 + math.pi / 2
    head = stroke * head_scale
    bw = head * 0.62
    p1 = (x1 + head * math.cos(tangent), y1 + head * math.sin(tangent))
    p2 = (x1 + bw * math.cos(a1), y1 + bw * math.sin(a1))
    p3 = (x1 - bw * math.cos(a1), y1 - bw * math.sin(a1))
    return f"""
      <path d="M {x0:.2f} {y0:.2f} A {radius:.2f} {radius:.2f} 0 1 1 {x1:.2f} {y1:.2f}"
            fill="none" stroke="{color}" stroke-width="{stroke:.2f}" stroke-linecap="round"/>
      <polygon points="{p1[0]:.2f},{p1[1]:.2f} {p2[0]:.2f},{p2[1]:.2f} {p3[0]:.2f},{p3[1]:.2f}"
               fill="{color}"/>"""


def app_icon(cx: float, cy: float, size: float, shadow: bool = True) -> str:
    s = size
    x, y = cx - s / 2, cy - s / 2
    filt = 'filter="url(#softShadow)"' if shadow else ""
    return f"""
    <g {filt}>
      <rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{s * 0.22}" fill="#2ed37a"/>
      <rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{s * 0.22}" fill="url(#popGlow)"/>
      {reload_arc(cx, cy, s * 0.30, s * 0.115, "#0a120d")}
      <rect x="{x + 1}" y="{y + 1}" width="{s - 2}" height="{s - 2}" rx="{s * 0.22 - 1}"
            fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
    </g>"""


# ----------------------------------------------------------------------
# popup primitives (all coordinates in popup-local 340-wide space)
# ----------------------------------------------------------------------
PW = 340  # popup width, same as popup.css body


def micro(x: float, y: float, label: str, color: str = FAINT) -> str:
    return (f'<text x="{x}" y="{y}" font-family="{MONO}" font-size="9.5" font-weight="500" '
            f'letter-spacing="1.6" fill="{color}">{escape(label.upper())}</text>')


def favicon_box(x: float, y: float, s: float) -> str:
    """Favicon placeholder: rounded box with the globe fallback glyph."""
    cx, cy = x + s / 2, y + s / 2
    r = s * 0.23
    return f"""
      <rect x="{x}" y="{y}" width="{s}" height="{s}" rx="{s * 0.25}" fill="{SURFACE_2}" stroke="{LINE}"/>
      <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{FAINT}" stroke-width="1.6"/>
      <line x1="{cx - r}" y1="{cy}" x2="{cx + r}" y2="{cy}" stroke="{FAINT}" stroke-width="1.1"/>
      <ellipse cx="{cx}" cy="{cy}" rx="{r * 0.45}" ry="{r}" fill="none" stroke="{FAINT}" stroke-width="1.1"/>"""


def switch(x: float, y: float, on: bool) -> str:
    knob_x = x + (16 if on else 4)
    return f"""
      <rect x="{x}" y="{y}" width="32" height="18" rx="9" fill="{ACC if on else LINE_STRONG}"/>
      <circle cx="{knob_x + 5}" cy="{y + 9}" r="7" fill="{BG if on else BG}"/>"""


def num_box(x: float, y: float, w: float, value: str, unit: str) -> str:
    return f"""
      <rect x="{x}" y="{y}" width="{w}" height="34" rx="9" fill="{SURFACE_2}" stroke="{LINE_STRONG}"/>
      <text x="{x + w - 26}" y="{y + 23}" text-anchor="end" font-family="{MONO}" font-size="17"
            font-weight="600" fill="{TEXT}">{escape(value)}</text>
      <text x="{x + w - 10}" y="{y + 23}" text-anchor="end" font-family="{MONO}" font-size="10.5"
            fill="{FAINT}">{escape(unit)}</text>"""


def chip(x: float, y: float, w: float, label: str, sel: bool) -> str:
    fill = ACC if sel else "none"
    color = ACC_INK if sel else DIM
    border = ACC if sel else LINE
    weight = 600 if sel else 500
    return f"""
      <rect x="{x}" y="{y}" width="{w}" height="22" rx="11" fill="{fill}" stroke="{border}"/>
      <text x="{x + w / 2}" y="{y + 15}" text-anchor="middle" font-family="{MONO}" font-size="11"
            font-weight="{weight}" fill="{color}">{escape(label)}</text>"""


def gear(cx: float, cy: float, r: float) -> str:
    teeth = "".join(
        f'<rect x="{cx - 1.4}" y="{cy - r - 2.6}" width="2.8" height="4.4" rx="1.2" fill="{DIM}" '
        f'transform="rotate({a} {cx} {cy})"/>'
        for a in range(0, 360, 45)
    )
    return f"""{teeth}
      <circle cx="{cx}" cy="{cy}" r="{r - 1.2}" fill="none" stroke="{DIM}" stroke-width="1.8"/>
      <circle cx="{cx}" cy="{cy}" r="{r * 0.36}" fill="none" stroke="{DIM}" stroke-width="1.6"/>"""


def popup_header() -> str:
    return f"""
      {reload_arc(23, 24, 7.2, 2.6, ACC)}
      <text x="40" y="29" font-family="{FONT}" font-size="13" font-weight="600"
            letter-spacing="0.5" fill="{TEXT}">Tab Reload Timer</text>
      {gear(PW - 26, 24, 8)}"""


def tab_row(card_x: float, card_y: float, host: str, dot_color: str = ACC) -> str:
    return f"""
      {favicon_box(card_x + 14, card_y + 14, 32)}
      {micro(card_x + 56, card_y + 25, "This tab")}
      <circle cx="{card_x + 128}" cy="{card_y + 21.5}" r="3" fill="{dot_color}"/>
      <circle cx="{card_x + 128}" cy="{card_y + 21.5}" r="6.5" fill="{dot_color}" opacity="0.25"/>
      <text x="{card_x + 56}" y="{card_y + 43}" font-family="{FONT}" font-size="13.5"
            font-weight="600" fill="{TEXT}">{escape(host)}</text>
      <line x1="{card_x + 14}" y1="{card_y + 58}" x2="{card_x + PW - 38}" y2="{card_y + 58}"
            stroke="{LINE}"/>"""


def tick_scale(x: float, y: float, w: float, h: float, progress: float) -> str:
    """Chronograph tick scale: 2px bars every 8px, filled portion in accent."""
    bars = []
    n = int(w // 8)
    for i in range(n):
        bx = x + i * 8
        filled = (i / n) < progress
        top_c = ACC if filled else LINE
        bot_c = ACC if filled else LINE_STRONG
        top_o = 0.45 if filled else 1
        bars.append(f'<rect x="{bx}" y="{y}" width="2" height="{h * 0.45}" fill="{top_c}" opacity="{top_o}"/>')
        bars.append(f'<rect x="{bx}" y="{y + h * 0.45}" width="2" height="{h * 0.55}" fill="{bot_c}"/>')
    center = x + w / 2
    bars.append(f'<line x1="{center}" y1="{y - 4}" x2="{center}" y2="{y + h + 4}" stroke="{LINE_STRONG}"/>')
    return "".join(bars)


def action_button(x: float, y: float, w: float, label: str, glyph: str) -> str:
    return f"""
      <rect x="{x}" y="{y}" width="{w}" height="34" rx="9" fill="{SURFACE_2}" stroke="{LINE_STRONG}"/>
      <g transform="translate({x + w / 2 - 7 - len(label) * 3.4}, {y + 17})">{glyph}</g>
      <text x="{x + w / 2 + 8}" y="{y + 21.5}" text-anchor="middle" font-family="{FONT}"
            font-size="12" font-weight="500" fill="{TEXT}">{escape(label)}</text>"""


GLYPH_NOW = f'{reload_arc(0, 0, 5.4, 2.0, TEXT, head_scale=1.6)}'
GLYPH_PAUSE = f'<path d="M -2.6 -5.5 V 5.5 M 2.6 -5.5 V 5.5" stroke="{TEXT}" stroke-width="2.4" stroke-linecap="round"/>'
GLYPH_STOP = f'<rect x="-5.5" y="-5.5" width="11" height="11" rx="2" fill="{TEXT}"/>'


def job_row(x: float, y: float, w: float, host: str, time: str, paused: bool = False) -> str:
    t_color = FAINT if paused else ACC
    return f"""
      <rect x="{x}" y="{y}" width="{w}" height="40" rx="10" fill="{SURFACE}" stroke="{LINE}"/>
      {favicon_box(x + 8, y + 8, 24)}
      <text x="{x + 41}" y="{y + 25}" font-family="{FONT}" font-size="12.5" font-weight="500"
            fill="{TEXT}">{escape(host)}</text>
      <text x="{x + w - 64}" y="{y + 25}" text-anchor="end" font-family="{MONO}" font-size="12"
            font-weight="500" fill="{t_color}">{escape(time)}</text>
      <path d="M {x + w - 50} {y + 14} V {y + 26} M {x + w - 45} {y + 14} V {y + 26}"
            stroke="{FAINT}" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="{x + w - 31}" y="{y + 14}" width="12" height="12" rx="2.5" fill="{FAINT}"/>"""


def popup_shell(h: float, body: str) -> str:
    """340-wide popup chrome around `body`."""
    return f"""
      <g filter="url(#softShadow)">
        <rect width="{PW}" height="{h}" rx="14" fill="{BG}"/>
        <rect width="{PW}" height="{h}" rx="14" fill="url(#popGlow)"/>
        <rect x="0.5" y="0.5" width="{PW - 1}" height="{h - 1}" rx="13.5"
              fill="none" stroke="{LINE_STRONG}"/>
      </g>
      {popup_header()}
      {body}"""


def jobs_section(y: float, rows: list) -> str:
    out = [micro(16, y, "Other active jobs")]
    out.append(f'<rect x="147" y="{y - 12}" width="24" height="17" rx="8.5" fill="none" stroke="{ACC}"/>')
    out.append(f'<text x="159" y="{y}" text-anchor="middle" font-family="{MONO}" '
               f'font-size="10" font-weight="600" fill="{ACC}">{len(rows)}</text>')
    # pause-all / stop-all bulk controls at the right edge of the header
    out.append(f'<path d="M {PW - 52} {y - 9.5} V {y - 0.5} M {PW - 47} {y - 9.5} V {y - 0.5}" '
               f'stroke="{FAINT}" stroke-width="2.2" stroke-linecap="round"/>')
    out.append(f'<rect x="{PW - 36}" y="{y - 9.5}" width="10" height="10" rx="2.2" fill="{FAINT}"/>')
    yy = y + 10
    for host, time, *flags in rows:
        out.append(job_row(12, yy, PW - 24, host, time, paused="paused" in flags))
        yy += 46
    return "".join(out)


def popup_run(host: str = "dashboard.grafana.io", countdown: str = "4:37",
              meta: str = "EVERY 5M · ±15S · NO-CACHE · 12 RELOADS",
              progress: float = 0.62, jobs: list | None = None) -> tuple[str, float]:
    """Popup in the running state. Returns (svg, height)."""
    cx, cy = 12, 44  # card origin
    card_h = 246
    body = f"""
      <rect x="{cx}" y="{cy}" width="{PW - 24}" height="{card_h}" rx="12"
            fill="{SURFACE}" stroke="{LINE}"/>
      {tab_row(cx, cy, host)}
      <text x="{PW / 2}" y="{cy + 112}" text-anchor="middle" font-family="{MONO}" font-size="44"
            font-weight="600" fill="{ACC}" opacity="0.55" filter="url(#greenBlur)">{escape(countdown)}</text>
      <text x="{PW / 2}" y="{cy + 112}" text-anchor="middle" font-family="{MONO}" font-size="44"
            font-weight="600" fill="{TEXT}">{escape(countdown)}</text>
      <text x="{PW / 2}" y="{cy + 132}" text-anchor="middle" font-family="{MONO}" font-size="10"
            letter-spacing="1" fill="{FAINT}">{escape(meta)}</text>
      {tick_scale(cx + 14, cy + 148, PW - 52, 26, progress)}
      {action_button(cx + 14, cy + 196, 94, "Now", GLYPH_NOW)}
      {action_button(cx + 115, cy + 196, 94, "Pause", GLYPH_PAUSE)}
      {action_button(cx + 216, cy + 196, 86, "Stop", GLYPH_STOP)}
    """
    h = cy + card_h + 14
    if jobs:
        body += jobs_section(h + 16, jobs)
        h += 16 + 10 + len(jobs) * 46 + 6
    return popup_shell(h, body), h


def opt_row(x: float, y: float, w: float, label: str, control: str) -> str:
    return f"""
      <text x="{x}" y="{y + 21}" font-family="{FONT}" font-size="12.5" fill="{DIM}">{escape(label)}</text>
      {control}
      <line x1="{x}" y1="{y + 33}" x2="{x + w}" y2="{y + 33}" stroke="{LINE}"/>"""


def inline_num(x: float, y: float, value: str, unit: str) -> str:
    return f"""
      <rect x="{x}" y="{y}" width="52" height="22" rx="6" fill="{SURFACE}" stroke="{LINE_STRONG}"/>
      <text x="{x + 44}" y="{y + 15.5}" text-anchor="end" font-family="{MONO}" font-size="12.5"
            font-weight="500" fill="{TEXT}">{escape(value)}</text>
      <text x="{x + 60}" y="{y + 15.5}" font-family="{MONO}" font-size="10.5" fill="{FAINT}">{escape(unit)}</text>"""


def popup_idle(host: str = "dashboard.grafana.io") -> tuple[str, float]:
    """Popup in the idle/configure state with More options expanded."""
    cx, cy = 12, 44
    card_w = PW - 24
    chips_y = cy + 124
    chips = [("30s", False), ("1m", False), ("2m", False), ("5m", True),
             ("15m", False), ("30m", False), ("1h", False)]
    chip_svg, chx = [], cx + 14
    for label, sel in chips:
        w = 14 + len(label) * 7.4
        chip_svg.append(chip(chx, chips_y, w, label, sel))
        chx += w + 5

    more_y = chips_y + 36
    body_y = more_y + 22
    rows_w = card_w - 50
    rows = f"""
      <rect x="{cx + 14}" y="{body_y}" width="{card_w - 28}" height="138" rx="9"
            fill="{SURFACE_2}" stroke="{LINE}"/>
      {opt_row(cx + 25, body_y + 6, rows_w, "Random variation  ±",
               inline_num(cx + card_w - 112, body_y + 11, "15", "sec"))}
      {opt_row(cx + 25, body_y + 39, rows_w, "Only reload when tab is inactive",
               switch(cx + card_w - 58, body_y + 47, True))}
      {opt_row(cx + 25, body_y + 72, rows_w, "Hard reload (bypass cache)",
               switch(cx + card_w - 58, body_y + 80, False))}
      <text x="{cx + 25}" y="{body_y + 126}" font-family="{FONT}" font-size="12.5"
            fill="{DIM}">Stop after</text>
      {inline_num(cx + card_w - 132, body_y + 110, "20", "reloads")}
    """
    start_y = body_y + 152
    card_h = start_y + 38 + 14 - cy
    body = f"""
      <rect x="{cx}" y="{cy}" width="{card_w}" height="{card_h}" rx="12"
            fill="{SURFACE}" stroke="{LINE}"/>
      {tab_row(cx, cy, host, dot_color=FAINT)}
      {micro(cx + 14, cy + 80, "Reload every")}
      {num_box(cx + 14, cy + 88, 94, "0", "h")}
      {num_box(cx + 115, cy + 88, 94, "5", "m")}
      {num_box(cx + 216, cy + 88, 86, "0", "s")}
      {"".join(chip_svg)}
      <rect x="{cx + 14}" y="{more_y - 2}" width="14" height="14" rx="4" fill="none" stroke="{ACC}"/>
      <text x="{cx + 21}" y="{more_y + 9}" text-anchor="middle" font-family="{MONO}" font-size="11"
            fill="{ACC}">–</text>
      {micro(cx + 34, more_y + 9, "More options", DIM)}
      {rows}
      <rect x="{cx + 14}" y="{start_y}" width="{card_w - 28}" height="38" rx="10" fill="{ACC}"/>
      <polygon points="{PW / 2 - 68},{start_y + 12} {PW / 2 - 68},{start_y + 26} {PW / 2 - 56},{start_y + 19}"
               fill="{ACC_INK}"/>
      <text x="{PW / 2 + 10}" y="{start_y + 24}" text-anchor="middle" font-family="{FONT}"
            font-size="13.5" font-weight="600" fill="{ACC_INK}">Start reloading</text>
    """
    h = cy + card_h + 14
    return popup_shell(h, body), h


# ----------------------------------------------------------------------
# screenshot building blocks
# ----------------------------------------------------------------------
def canvas(w: int, h: int, inner: str, dots: bool = True) -> str:
    dot_grid = ""
    if dots:
        dot_grid = ('<g fill="#FFFFFF" fill-opacity="0.035">'
                    + "".join(f'<circle cx="{x}" cy="{y}" r="1.3"/>'
                              for x in range(24, w, 32) for y in range(24, h, 32))
                    + "</g>")
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
      {shared_defs()}
      <rect width="{w}" height="{h}" fill="url(#bgGlow)"/>
      {dot_grid}
      {inner}
    </svg>"""


def headline(w: float, y: float, title: str, sub: str) -> str:
    return f"""
      <text x="{w / 2}" y="{y}" text-anchor="middle" font-family="{FONT}" font-size="26"
            font-weight="800" fill="{TEXT}" letter-spacing="-0.4">{escape(title)}</text>
      <text x="{w / 2}" y="{y + 32}" text-anchor="middle" font-family="{FONT}" font-size="15"
            fill="{DIM}">{escape(sub)}</text>"""


def callout(x: float, y: float, w: float, label: str) -> str:
    return f"""
      <g transform="translate({x}, {y})">
        <rect y="-15" width="{w}" height="30" rx="15" fill="{ACC}" fill-opacity="0.10"
              stroke="{ACC}" stroke-opacity="0.5"/>
        <circle cx="15" cy="0" r="4" fill="{ACC}"/>
        <text x="29" y="4.5" font-family="{FONT}" font-size="12" font-weight="800"
              fill="{ACC}" letter-spacing="0.8">{escape(label.upper())}</text>
      </g>"""


def toolbar_badge_mock(x: float, y: float, w: float = 300) -> str:
    """A browser-toolbar strip with the extension icon and a live countdown badge."""
    icon_x = x + w - 56
    return f"""
      <rect x="{x}" y="{y}" width="{w}" height="56" rx="13" fill="{SURFACE}" stroke="{LINE_STRONG}"/>
      <rect x="{x + 16}" y="{y + 15}" width="{w - 92}" height="26" rx="13" fill="{BG}" stroke="{LINE}"/>
      <text x="{x + 32}" y="{y + 32}" font-family="{MONO}" font-size="11.5"
            fill="{FAINT}">dashboard.grafana.io/d/k8s</text>
      <g>
        <rect x="{icon_x}" y="{y + 10}" width="36" height="36" rx="8.6" fill="#2ed37a"/>
        {reload_arc(icon_x + 18, y + 28, 10.4, 4.0, "#0a120d")}
        <rect x="{icon_x + 12}" y="{y + 32}" width="32" height="17" rx="4" fill="#1d9a5b"
              stroke="{BG_DEEP}" stroke-width="1.6"/>
        <text x="{icon_x + 28}" y="{y + 44.5}" text-anchor="middle" font-family="{MONO}"
              font-size="11" font-weight="600" fill="#ffffff">45s</text>
      </g>"""


# ----------------------------------------------------------------------
# 1) Small promo tile — 440x280
# ----------------------------------------------------------------------
def small_promo() -> str:
    W, H = 440, 280
    inner = f"""
      {app_icon(108, 140, 148)}
      <text x="204" y="116" font-family="{FONT}" font-size="27" font-weight="800"
            fill="{TEXT}" letter-spacing="-0.4">Tab Reload</text>
      <text x="204" y="148" font-family="{FONT}" font-size="27" font-weight="800"
            fill="url(#brandH)" letter-spacing="-0.4">Timer</text>
      <text x="204" y="184" font-family="{FONT}" font-size="13" font-weight="500"
            fill="{DIM}">Auto-reload any tab on its own</text>
      <text x="204" y="202" font-family="{FONT}" font-size="13" font-weight="500"
            fill="{DIM}">schedule. Set it and forget it.</text>
      <rect x="204" y="222" width="218" height="28" rx="14" fill="url(#brandH)"/>
      <text x="313" y="240.5" text-anchor="middle" font-family="{FONT}" font-size="10"
            font-weight="700" fill="{ACC_INK}" letter-spacing="0.5">PER-TAB TIMERS · NO TRACKING</text>
    """
    return canvas(W, H, inner)


# ----------------------------------------------------------------------
# 2) Marquee promo tile — 1400x560
# ----------------------------------------------------------------------
def marquee_promo() -> str:
    W, H = 1400, 560
    pop, ph = popup_run(jobs=[("queue.dev/board", "0:42"), ("news.ycombinator.com", "12m")])
    scale = 1.04
    chips = [("Badge countdown", 200), ("Random jitter", 168), ("Survives restarts", 196)]
    chip_svg, chx = [], 256
    for label, cw in chips:
        chip_svg.append(f"""
          <rect x="{chx}" y="396" width="{cw}" height="38" rx="19" fill="{SURFACE}" stroke="{LINE_STRONG}"/>
          <text x="{chx + cw / 2}" y="420" text-anchor="middle" font-family="{FONT}" font-size="14"
                font-weight="700" fill="{TEXT}">{escape(label)}</text>""")
        chx += cw + 16
    inner = f"""
      {app_icon(140, 218, 196)}
      <text x="256" y="196" font-family="{FONT}" font-size="48" font-weight="800"
            fill="{TEXT}" letter-spacing="-1.2">Tab Reload <tspan fill="url(#brandH)">Timer</tspan></text>
      <text x="256" y="248" font-family="{FONT}" font-size="19" font-weight="500"
            fill="{DIM}">Auto-reload tabs on a custom interval — every tab</text>
      <text x="256" y="274" font-family="{FONT}" font-size="19" font-weight="500"
            fill="{DIM}">with its own independent timer, from 30s to hours.</text>
      <text x="256" y="300" font-family="{FONT}" font-size="19" font-weight="500"
            fill="{DIM}">Dashboards, queues, feeds — always fresh.</text>
      {"".join(chip_svg)}
      <g transform="translate(920, {(H - ph * scale) / 2}) scale({scale})">{pop}</g>
    """
    return canvas(W, H, inner)


# ----------------------------------------------------------------------
# 3) Screenshot 1 — hero: running timer + badge (1280x800)
# ----------------------------------------------------------------------
def screenshot_hero() -> str:
    W, H = 1280, 800
    pop, ph = popup_run()
    scale = 1.62
    px, py = 150, 170
    inner = f"""
      {headline(W, 64, "Every tab on its own schedule.",
                "Pick an interval, press Start — done. The countdown is always one glance away.")}
      <g transform="translate({px}, {py}) scale({scale})">{pop}</g>
      {callout(px + PW * scale + 60, py + 150, 232, "Live countdown")}
      <path d="M {px + PW * scale + 60} 320 q -28 6 -42 -16" fill="none" stroke="{ACC}"
            stroke-opacity="0.5" stroke-width="2" stroke-dasharray="3 5"/>
      {toolbar_badge_mock(px + PW * scale + 58, 392)}
      {callout(px + PW * scale + 60, 480, 296, "Badge counts down on the icon")}
      <text x="{px + PW * scale + 60}" y="540" font-family="{FONT}" font-size="14.5" fill="{DIM}">Pause, reload now, or stop —</text>
      <text x="{px + PW * scale + 60}" y="562" font-family="{FONT}" font-size="14.5" fill="{DIM}">right from the popup.</text>
    """
    return canvas(W, H, inner)


# ----------------------------------------------------------------------
# 4) Screenshot 2 — all running timers in one popup (1280x800)
# ----------------------------------------------------------------------
def screenshot_jobs() -> str:
    W, H = 1280, 800
    pop, ph = popup_run(jobs=[("queue.dev/board", "0:42"),
                              ("news.ycombinator.com", "12m"),
                              ("ci.internal/builds", "paused", "paused")])
    scale = 1.36
    px, py = 190, 150
    cx = px + PW * scale + 64
    inner = f"""
      {headline(W, 64, "Every running timer, one popup.",
                "Independent per-tab jobs — live countdowns, pause, stop, or jump to the tab.")}
      <g transform="translate({px}, {py}) scale({scale})">{pop}</g>
      {callout(cx, 268, 252, "One timer per tab")}
      <text x="{cx}" y="312" font-family="{FONT}" font-size="14.5" fill="{DIM}">Each tab keeps its own interval,</text>
      <text x="{cx}" y="334" font-family="{FONT}" font-size="14.5" fill="{DIM}">options, and countdown.</text>
      {callout(cx, 408, 268, "Manage without switching")}
      <text x="{cx}" y="452" font-family="{FONT}" font-size="14.5" fill="{DIM}">Pause or stop any job — or all at once.</text>
      <text x="{cx}" y="474" font-family="{FONT}" font-size="14.5" fill="{DIM}">Click a row to jump to its tab.</text>
      {callout(cx, 548, 246, "Survives restarts")}
      <text x="{cx}" y="592" font-family="{FONT}" font-size="14.5" fill="{DIM}">Timers re-attach to your tabs</text>
      <text x="{cx}" y="614" font-family="{FONT}" font-size="14.5" fill="{DIM}">after the browser restarts.</text>
    """
    return canvas(W, H, inner)


# ----------------------------------------------------------------------
# 5) Screenshot 3 — configuration / more options (1280x800)
# ----------------------------------------------------------------------
def screenshot_options() -> str:
    W, H = 1280, 800
    pop, ph = popup_idle()
    scale = 1.34
    px, py = 190, 142
    cx = px + PW * scale + 64
    inner = f"""
      {headline(W, 64, "Two clicks to configure. Power when you want it.",
                "Presets for the common cases — jitter, hard reload, and limits one fold away.")}
      <g transform="translate({px}, {py}) scale({scale})">{pop}</g>
      {callout(cx, 250, 236, "One-click presets")}
      <text x="{cx}" y="294" font-family="{FONT}" font-size="14.5" fill="{DIM}">30s to 1h, or any custom h/m/s.</text>
      {callout(cx, 360, 248, "Random variation")}
      <text x="{cx}" y="404" font-family="{FONT}" font-size="14.5" fill="{DIM}">Add ± jitter so reloads don't fire</text>
      <text x="{cx}" y="426" font-family="{FONT}" font-size="14.5" fill="{DIM}">at robotic, identical intervals.</text>
      {callout(cx, 492, 312, "Polite + cache-busting modes")}
      <text x="{cx}" y="536" font-family="{FONT}" font-size="14.5" fill="{DIM}">Reload only while you're away, bypass</text>
      <text x="{cx}" y="558" font-family="{FONT}" font-size="14.5" fill="{DIM}">the cache, or stop after N reloads.</text>
    """
    return canvas(W, H, inner)


# ----------------------------------------------------------------------
# 6) Screenshot 4 — how it works + privacy strip (1280x800)
# ----------------------------------------------------------------------
def step_card(x: float, y: float, w: float, num: str, title: str, body: str) -> str:
    def wrap(text: str, width: int) -> list:
        words, lines, cur = text.split(), [], ""
        for word in words:
            cand = (cur + " " + word).strip()
            if len(cand) > width and cur:
                lines.append(cur)
                cur = word
            else:
                cur = cand
        if cur:
            lines.append(cur)
        return lines

    title_lines = wrap(title, 22)
    title_svg = "".join(
        f'<text x="22" y="{122 + i * 25}" font-family="{FONT}" font-size="18" font-weight="800" '
        f'fill="{TEXT}">{escape(line)}</text>'
        for i, line in enumerate(title_lines))
    body_start = 122 + len(title_lines) * 25 + 12
    body_svg = "".join(
        f'<text x="22" y="{body_start + i * 20}" font-family="{FONT}" font-size="13" '
        f'fill="{DIM}">{escape(line)}</text>'
        for i, line in enumerate(wrap(body, 32)))
    return f"""
      <g transform="translate({x}, {y})">
        <rect width="{w}" height="270" rx="14" fill="{SURFACE}" stroke="{LINE_STRONG}"/>
        <circle cx="52" cy="52" r="27" fill="url(#brandH)"/>
        <text x="52" y="62" text-anchor="middle" font-family="{FONT}" font-size="26"
              font-weight="800" fill="{ACC_INK}">{escape(num)}</text>
        {title_svg}
        {body_svg}
      </g>"""


def screenshot_how() -> str:
    W, H = 1280, 800
    steps = [
        ("1", "Open the popup", "Or right-click the page, or press Alt+Shift+R — three ways in."),
        ("2", "Pick an interval", "One-click presets from 30s to 1h, or any custom hours/minutes/seconds."),
        ("3", "Press Start", "The tab reloads on schedule; the badge counts down to the next one."),
        ("4", "Walk away", "Timers run per tab, defer while you read, and survive browser restarts."),
    ]
    cell_w, gap = 280, 24
    total = len(steps) * cell_w + (len(steps) - 1) * gap
    start_x = (W - total) / 2
    cards = "".join(step_card(start_x + i * (cell_w + gap), 220, cell_w, *s)
                    for i, s in enumerate(steps))
    inner = f"""
      <text x="{W / 2}" y="110" text-anchor="middle" font-family="{FONT}" font-size="34"
            font-weight="800" fill="{TEXT}" letter-spacing="-0.6">How it works</text>
      <text x="{W / 2}" y="148" text-anchor="middle" font-family="{FONT}" font-size="16"
            fill="{DIM}">Understand it in 5 seconds, configure it in 2 clicks.</text>
      {cards}
      <g transform="translate({W / 2 - 430}, 580)">
        <rect width="860" height="84" rx="14" fill="{SURFACE}" stroke="{LINE_STRONG}"/>
        <text x="430" y="36" text-anchor="middle" font-family="{FONT}" font-size="14"
              font-weight="800" fill="{TEXT}" letter-spacing="0.4">PRIVATE BY DESIGN</text>
        <text x="430" y="62" text-anchor="middle" font-family="{MONO}" font-size="12.5"
              fill="{DIM}">no host permissions · no content scripts · no network requests · no data collection</text>
      </g>
    """
    return canvas(W, H, inner)


# ----------------------------------------------------------------------
def render(svg: str, w: int, h: int, out_path: Path) -> None:
    """Rasterize SVG at 2x, downsample with Lanczos, flatten to 24-bit PNG."""
    png_bytes = cairosvg.svg2png(bytestring=svg.encode("utf-8"),
                                 output_width=w * 2, output_height=h * 2)
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    flat = Image.new("RGB", img.size, (5, 8, 10))  # BG_DEEP, must match design
    flat.paste(img, mask=img.split()[3])
    flat = flat.resize((w, h), Image.LANCZOS)
    flat.save(out_path, "PNG", optimize=True)
    print(f"  wrote {out_path.name}  ({flat.size[0]}x{flat.size[1]}, mode={flat.mode})")


def main() -> None:
    print("rendering store assets …")
    render(small_promo(), 440, 280, OUT / "promo-small-440x280.png")
    render(marquee_promo(), 1400, 560, OUT / "promo-marquee-1400x560.png")
    render(screenshot_hero(), 1280, 800, OUT / "screenshot-1-hero-1280x800.png")
    render(screenshot_jobs(), 1280, 800, OUT / "screenshot-2-jobs-1280x800.png")
    render(screenshot_options(), 1280, 800, OUT / "screenshot-3-options-1280x800.png")
    render(screenshot_how(), 1280, 800, OUT / "screenshot-4-howitworks-1280x800.png")
    print("done.")


if __name__ == "__main__":
    main()
