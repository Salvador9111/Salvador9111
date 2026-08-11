#!/usr/bin/env python3
"""
Turns an ASCII-art text grid into a looping animated SVG (streak-style reveal,
top-left to bottom-right), embeddable directly in a GitHub README.

Usage:
    python3 generate_ascii_image_animation.py ascii_art.txt --out profile-ascii.svg
"""
import argparse
import html


def build_svg(lines, char_w, char_h, fg, bg, sweep_dur, hold_dur, stagger):
    cols = max(len(l) for l in lines)
    rows = len(lines)
    width = cols * char_w
    height = rows * char_h

    cycle_dur = stagger * rows + sweep_dur + hold_dur + 0.6

    clip_defs = []
    text_rows = []
    for i, line in enumerate(lines):
        y = (i + 1) * char_h
        begin_t = i * stagger
        clip_id = f"c{i}"
        clip_defs.append(
            f'<clipPath id="{clip_id}">'
            f'<rect x="0" y="{y - char_h}" width="0" height="{char_h + 2}">'
            f'<animate attributeName="width" from="0" to="{width}" '
            f'dur="{sweep_dur}s" begin="cyc.begin+{begin_t:.2f}s" fill="freeze" '
            f'calcMode="spline" keySplines="0.15 0 0.25 1"/>'
            f'</rect></clipPath>'
        )
        escaped = html.escape(line) if line.strip() else "&#160;"
        text_rows.append(
            f'<text x="0" y="{y}" clip-path="url(#{clip_id})" class="a">{escaped}</text>'
        )

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" font-family="'DejaVu Sans Mono','Fira Code',Consolas,monospace">
  <defs>
    {''.join(clip_defs)}
    <rect id="trig" width="0" height="0">
      <animate id="cyc" attributeName="width" from="0" to="1" dur="{cycle_dur:.2f}s" begin="0s;cyc.end" repeatCount="indefinite"/>
    </rect>
  </defs>
  <style>
    .a {{ font-size: {char_h - 1}px; fill: {fg}; white-space: pre; }}
  </style>
  <rect width="{width}" height="{height}" fill="{bg}"/>
  {''.join(text_rows)}
</svg>'''
    return svg


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("txt_file")
    ap.add_argument("--char-w", type=int, default=6)
    ap.add_argument("--char-h", type=int, default=9)
    ap.add_argument("--fg", default="#e8f0ff")
    ap.add_argument("--bg", default="#020204")
    ap.add_argument("--sweep-dur", type=float, default=0.35)
    ap.add_argument("--hold-dur", type=float, default=2.5)
    ap.add_argument("--stagger", type=float, default=0.035)
    ap.add_argument("--out", default="ascii_animation.svg")
    args = ap.parse_args()

    with open(args.txt_file) as f:
        lines = f.read().split("\n")
    while lines and lines[-1].strip() == "":
        lines.pop()

    svg = build_svg(lines, args.char_w, args.char_h, args.fg, args.bg,
                     args.sweep_dur, args.hold_dur, args.stagger)
    with open(args.out, "w") as f:
        f.write(svg)
    print(f"wrote {args.out}")
