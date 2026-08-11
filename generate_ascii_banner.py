#!/usr/bin/env python3
"""
Generates an animated, looping "terminal typing" SVG banner from ASCII/figlet
art. GitHub renders raw SVGs (including SMIL animations) directly when you
reference them with an <img> tag or markdown image syntax in a README, so
no GIF conversion is needed.

Usage:
    pip install pyfiglet --break-system-packages
    python3 generate_ascii_banner.py "YOUR NAME" --font ansi_shadow --out banner.svg
"""
import argparse
import html

import pyfiglet


def build_svg(text: str, font: str, prompt: str, char_w: int, char_h: int,
               fg: str, accent: str, bg: str, bar_bg: str) -> str:
    art = pyfiglet.figlet_format(text, font=font).rstrip("\n").split("\n")
    while art and art[0].strip() == "":
        art.pop(0)
    max_w = max((len(l) for l in art), default=0)

    pad_x, pad_top, pad_bottom = 24, 56, 24
    prompt_h = char_h + 10
    width = pad_x * 2 + max_w * char_w
    height = pad_top + prompt_h + len(art) * char_h + pad_bottom
    width = max(width, 420)

    # timings
    row_dur = 0.22          # seconds to reveal one row
    row_gap = 0.06
    start_delay = 1.0       # after prompt types
    loop_pause = 2.2        # how long the finished banner stays before restart
    total_type_time = len(art) * (row_dur + row_gap)
    cycle_dur = start_delay + total_type_time + loop_pause + 1.2

    rows_svg = []
    clip_defs = []
    for i, line in enumerate(art):
        y = pad_top + prompt_h + i * char_h
        begin_t = start_delay + i * (row_dur + row_gap)
        clip_id = f"clip{i}"
        clip_defs.append(
            f'<clipPath id="{clip_id}">'
            f'<rect x="{pad_x}" y="{y - char_h + 6}" width="0" height="{char_h + 4}">'
            f'<animate attributeName="width" from="0" to="{max_w * char_w}" '
            f'dur="{row_dur}s" begin="cycle.begin+{begin_t:.2f}s" fill="freeze" '
            f'calcMode="spline" keySplines="0.2 0 0.2 1"/>'
            f'</rect></clipPath>'
        )
        escaped = html.escape(line) if line.strip() else "&#160;"
        rows_svg.append(
            f'<text x="{pad_x}" y="{y}" clip-path="url(#{clip_id})" '
            f'class="art">{escaped}</text>'
        )

    prompt_text = html.escape(prompt)
    prompt_len = len(prompt)
    cursor_x = pad_x + prompt_len * (char_w * 0.62) + 4

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" font-family="'Cascadia Code','Fira Code','JetBrains Mono',Consolas,monospace">
  <defs>
    {''.join(clip_defs)}
    <rect id="cycletrigger" width="0" height="0">
      <animate id="cycle" attributeName="width" from="0" to="1" dur="{cycle_dur:.2f}s" begin="0s;cycle.end" repeatCount="indefinite"/>
    </rect>
  </defs>
  <style>
    .art {{ font-size: {char_h - 4}px; fill: {fg}; white-space: pre; letter-spacing: 0; }}
    .prompt {{ font-size: {char_h - 2}px; fill: {accent}; }}
    .dim {{ fill: #6b7280; font-size: 13px; }}
    .dot {{ }}
  </style>

  <rect width="{width}" height="{height}" rx="10" fill="{bg}"/>
  <rect width="{width}" height="34" rx="10" fill="{bar_bg}"/>
  <rect y="20" width="{width}" height="14" fill="{bar_bg}"/>
  <circle cx="20" cy="17" r="6" fill="#ff5f56"/>
  <circle cx="40" cy="17" r="6" fill="#ffbd2e"/>
  <circle cx="60" cy="17" r="6" fill="#27c93f"/>
  <text x="{width/2}" y="21" text-anchor="middle" class="dim">{html.escape(text.lower().replace(' ', ''))}@github: ~</text>

  <text x="{pad_x}" y="{pad_top}" class="prompt">{prompt_text}</text>
  <rect class="dot" x="{cursor_x:.0f}" y="{pad_top - char_h + 8}" width="9" height="{char_h - 4}" fill="{accent}">
    <animate attributeName="opacity" values="1;1;0;0;1" keyTimes="0;0.4;0.4;0.9;1" dur="1s" repeatCount="indefinite"/>
  </rect>

  {''.join(rows_svg)}
</svg>'''
    return svg


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--font", default="ansi_shadow")
    ap.add_argument("--prompt", default="$ whoami")
    ap.add_argument("--char-w", type=int, default=11)
    ap.add_argument("--char-h", type=int, default=18)
    ap.add_argument("--fg", default="#58a6ff")
    ap.add_argument("--accent", default="#3fb950")
    ap.add_argument("--bg", default="#0d1117")
    ap.add_argument("--bar-bg", default="#161b22")
    ap.add_argument("--out", default="banner.svg")
    args = ap.parse_args()

    svg = build_svg(args.text, args.font, args.prompt, args.char_w, args.char_h,
                     args.fg, args.accent, args.bg, args.bar_bg)
    with open(args.out, "w") as f:
        f.write(svg)
    print(f"wrote {args.out}")
