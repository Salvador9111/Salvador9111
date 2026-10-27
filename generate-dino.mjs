#!/usr/bin/env node
// Chrome Dino Runner on your GitHub contribution graph -> animated SVG (works inside a README <img>).
// Your busiest weeks become cacti built from heatmap cells: the busier the week, the taller the cactus.
// An auto-playing dino runs left -> right and jumps every one of them, counting a score.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-dino.mjs <github-username>
//   node generate-dino.mjs --demo
//
// Output: dist/dino-light.svg, dist/dino-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const CELL_W = 12;
const CELL_H = 16;
const GAP = 3;
const PITCH_X = CELL_W + GAP;
const PITCH_Y = CELL_H + GAP;
const PAD = 8;

const CACTUS_COLS = 2; // cactus width in heatmap columns
const MAX_CACTI = 8;
const MIN_SPACING = 7; // min columns between cactus starts
const SPEED = 75; // dino speed in px/s (left -> right)
const GRAVITY = 800;
const CLEARANCE = 44; // px of air between the dino's feet and the cactus top at the apex
const START_HOLD_S = 0.8;
const END_HOLD_S = 1.6;
const SAMPLE_S = 1 / 30;

// dino hitbox relative to its feet-center (x, y = feet)
const HIT_L = 6;
const HIT_R = 8;

const PALETTES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    panel: "#ffffff",
    frame: "#d0d7de",
    text: "#1f2328",
    dino: "#535353",
    bgOpacity: 0.7,
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    panel: "#0d1117",
    frame: "#30363d",
    text: "#f0f6fc",
    dino: "#d0d7de",
    bgOpacity: 0.6,
  },
};

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// ---------- data ----------
async function fetchCalendar(user, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "readme-dino",
    },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) {
    throw new Error("GitHub API error: " + JSON.stringify(json.errors || json));
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks.map((w) => {
    const col = Array.from({ length: 7 }, () => ({ count: 0, level: 0, exists: false }));
    for (const d of w.contributionDays) {
      col[d.weekday] = { count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0, exists: true };
    }
    return col;
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoCalendar() {
  const rand = mulberry32(Number(process.env.DEMO_SEED || 42));
  return Array.from({ length: 53 }, () =>
    Array.from({ length: 7 }, () => {
      const r = rand();
      const level = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
      return { count: level * 3 + Math.floor(rand() * 3), level, exists: true };
    })
  );
}

// ---------- simulation ----------
function simulate(calendar) {
  const cols = calendar.length;
  const rows = 7;
  const WIDTH = PAD * 2 + cols * PITCH_X - GAP;
  const HEIGHT = PAD * 2 + rows * PITCH_Y - GAP;
  const rowY0 = (r) => PAD + r * PITCH_Y;
  const groundY = HEIGHT - PAD; // the dino's feet rest here

  // cacti: the busiest pairs of weeks, spread out, with a runway at the start
  const first = 8;
  const last = cols - CACTUS_COLS - 3;
  const cand = [];
  for (let c = first; c <= last; c++) {
    let score = 0;
    for (let k = 0; k < CACTUS_COLS; k++) for (const d of calendar[c + k]) score += d.count;
    cand.push({ c, score });
  }
  cand.sort((a, b) => b.score - a.score || a.c - b.c);
  const picked = [];
  for (const p of cand) {
    if (picked.length >= MAX_CACTI) break;
    if (picked.every((o) => Math.abs(o.c - p.c) >= MIN_SPACING)) picked.push(p);
  }

  // busiest third -> 3 cells tall, middle third -> 2, the rest -> 1
  const byScore = [...picked].sort((a, b) => b.score - a.score || a.c - b.c);
  byScore.forEach((p, i) => {
    const q = i / Math.max(1, byScore.length);
    p.h = q < 1 / 3 ? 3 : q < 2 / 3 ? 2 : 1;
  });
  picked.sort((a, b) => a.c - b.c);

  const cacti = picked.map((p) => {
    const x0 = PAD + p.c * PITCH_X;
    const x1 = x0 + CACTUS_COLS * PITCH_X - GAP;
    const top = rowY0(rows - p.h); // top edge of the tallest cell
    const apex = groundY - top + CLEARANCE; // how high the feet must rise
    const v0 = Math.sqrt(2 * GRAVITY * apex);
    const air = (2 * v0) / GRAVITY;
    const center = (x0 + x1) / 2;
    return {
      c: p.c,
      h: p.h,
      x0,
      x1,
      top,
      v0,
      jumpX: center - (SPEED * air) / 2 - (HIT_R - HIT_L) / 2,
      passT: null,
    };
  });

  // ----- physics + autopilot -----
  const dt = 1 / 240;
  let t = START_HOLD_S;
  let x = PAD + 16;
  let y = groundY;
  let vy = 0;
  let crashed = false;
  const frames = [
    { t: 0, x, y },
    { t, x, y },
  ];
  let nextSample = t + SAMPLE_S;
  const endX = WIDTH - PAD + 20;

  while (x < endX && !crashed) {
    t += dt;
    x += SPEED * dt;

    // autopilot: jump when the next cactus is exactly one half-jump away
    if (y >= groundY) {
      const nxt = cacti.find((c) => x - HIT_L <= c.x1 && c.passT === null);
      if (nxt && x >= nxt.jumpX) {
        vy = -nxt.v0;
        y = groundY - 0.001;
      }
    }
    if (y < groundY) {
      vy += GRAVITY * dt;
      y += vy * dt;
      if (y >= groundY) {
        y = groundY;
        vy = 0;
      }
    }

    for (const c of cacti) {
      const overlapX = x + HIT_R > c.x0 && x - HIT_L < c.x1;
      if (overlapX && y > c.top + 2) crashed = true;
      if (c.passT === null && x - HIT_L > c.x1) c.passT = t;
    }

    if (t >= nextSample) {
      frames.push({ t, x, y });
      nextSample += SAMPLE_S;
    }
  }

  frames.push({ t, x, y });
  const T = +(t + END_HOLD_S).toFixed(3);
  frames.push({ t: T, x, y });

  return {
    cacti,
    frames,
    T,
    WIDTH,
    HEIGHT,
    groundY,
    crashed,
    score: cacti.filter((c) => c.passT !== null).length,
  };
}

// ---------- svg ----------
function toSvg(calendar, sim, theme) {
  const pal = PALETTES[theme];
  const { cacti, frames, T, WIDTH, HEIGHT, groundY } = sim;
  const dur = `${T}s`;
  const rep = `dur="${dur}" repeatCount="indefinite"`;
  const f1 = (n) => +n.toFixed(1);
  const kt = frames.map((f) => +(f.t / T).toFixed(5)).join(";");

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  out += `<title>Chrome Dino running through my GitHub contribution graph</title>\n`;
  out += `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" fill="${pal.panel}" stroke="${pal.frame}"/>\n`;

  // your real heatmap as the desert sky
  out += `<g opacity="${pal.bgOpacity}">\n`;
  calendar.forEach((week, c) =>
    week.forEach((d, r) => {
      if (!d.exists) return;
      out += `<rect x="${PAD + c * PITCH_X}" y="${PAD + r * PITCH_Y}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[d.level]}"/>\n`;
    })
  );
  out += `</g>\n`;

  // cacti built from heatmap cells (brightest cell on top)
  for (const c of cacti) {
    for (let k = 0; k < CACTUS_COLS; k++) {
      const x = PAD + (c.c + k) * PITCH_X;
      for (let i = 0; i < c.h; i++) {
        const r = 6 - i;
        const topCell = i === c.h - 1;
        out += `<rect x="${x}" y="${PAD + r * PITCH_Y}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[topCell ? 4 : 3]}"/>\n`;
      }
    }
  }

  // dino (origin = feet center)
  const pos = frames.map((f) => `${f1(f.x)} ${f1(f.y)}`).join(";");
  const D = pal.dino;
  out +=
    `<g transform="translate(${f1(frames[0].x)} ${f1(frames[0].y)})">` +
    `<animateTransform attributeName="transform" type="translate" values="${pos}" keyTimes="${kt}" ${rep}/>` +
    // tail + body
    `<path d="M-8 -12 L-14 -8 L-8 -6 Z" fill="${D}"/>` +
    `<rect x="-8" y="-14" width="12" height="10" rx="2" fill="${D}"/>` +
    // head + eye + mouth
    `<rect x="1" y="-21" width="10" height="9" rx="2" fill="${D}"/>` +
    `<rect x="6" y="-19" width="2.4" height="2.4" fill="${pal.panel}"/>` +
    `<rect x="6" y="-14.5" width="5" height="1" fill="${pal.panel}"/>` +
    // arm
    `<rect x="4" y="-9" width="3.5" height="2" rx="1" fill="${D}"/>` +
    // legs (run cycle)
    `<rect x="-5" y="-5" width="3.4" height="5" fill="${D}"><animate attributeName="height" values="5;2;5" dur="0.22s" repeatCount="indefinite"/></rect>` +
    `<rect x="0" y="-5" width="3.4" height="2" fill="${D}"><animate attributeName="height" values="2;5;2" dur="0.22s" repeatCount="indefinite"/></rect>` +
    `</g>\n`;

  out += `</svg>\n`;
  return out;
}

// ---------- main ----------
const args = process.argv.slice(2);
const demo = args.includes("--demo");
const user = args.find((a) => !a.startsWith("--")) || process.env.GITHUB_USER;

let calendar;
if (demo) {
  calendar = demoCalendar();
} else {
  if (!user) throw new Error("Pass a GitHub username (or use --demo).");
  if (!process.env.GITHUB_TOKEN) throw new Error("Set GITHUB_TOKEN.");
  calendar = await fetchCalendar(user, process.env.GITHUB_TOKEN);
}

const sim = simulate(calendar);
mkdirSync(OUT_DIR, { recursive: true });
for (const theme of Object.keys(PALETTES)) {
  const svg = toSvg(calendar, sim, theme);
  writeFileSync(`${OUT_DIR}/dino-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/dino-${theme}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`score ${sim.score}/${sim.cacti.length}${sim.crashed ? " (CRASHED)" : ""}, ${sim.T}s loop, ${sim.WIDTH}x${sim.HEIGHT}px`);
