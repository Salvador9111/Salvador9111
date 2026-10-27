#!/usr/bin/env node
// Doodle Jump on your GitHub contribution graph -> animated SVG (works inside a README <img>).
// Every few weeks of your heatmap become a platform sitting on that stretch's busiest weekday.
// An auto-playing doodler bounces from platform to platform, left -> right, counting a score.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-doodle.mjs <github-username>
//   node generate-doodle.mjs --demo
//
// Output: dist/doodle-light.svg, dist/doodle-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const CELL_W = 12;
const CELL_H = 16;
const GAP = 3;
const PITCH_X = CELL_W + GAP;
const PITCH_Y = CELL_H + GAP;
const PAD = 8;

const PLAT_COLS = 3; // platform width in heatmap columns
const STEP_COLS = 4; // columns between platform starts
const FIRST_COL = 1;
const MIN_ROW = 2; // keep platforms off the top two rows so the bounce has headroom
const MAX_ROW = 6;
const GRAVITY = 600;
const MIN_APEX = 22; // every bounce rises at least this many px
const MIN_LAND_VY = 30; // doodler must be falling when it lands (platforms are one-way)
const START_HOLD_S = 0.7;
const END_HOLD_S = 1.4;
const SAMPLE_S = 1 / 30;

const PALETTES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    panel: "#ffffff",
    frame: "#d0d7de",
    text: "#1f2328",
    bgOpacity: 0.7,
    body: "#8bc34a",
    bodyDark: "#5b8f1e",
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    panel: "#0d1117",
    frame: "#30363d",
    text: "#f0f6fc",
    bgOpacity: 0.6,
    body: "#a5d65b",
    bodyDark: "#6aa12a",
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
      "User-Agent": "readme-doodle",
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
// Each hop is a parabola solved exactly so the doodler lands in the middle of the next platform.
function solveHop(dy) {
  for (let t = 0.55; t <= 1.4; t += 0.01) {
    const v0 = (0.5 * GRAVITY * t * t - dy) / t; // upward launch speed
    const apex = (v0 * v0) / (2 * GRAVITY);
    const vLand = -v0 + GRAVITY * t; // > 0 means falling when it arrives
    if (v0 > 0 && apex >= MIN_APEX && vLand >= MIN_LAND_VY) return { t, v0 };
  }
  const t = 1.4;
  return { t, v0: (0.5 * GRAVITY * t * t - dy) / t };
}

function simulate(calendar) {
  const cols = calendar.length;
  const rows = 7;
  const WIDTH = PAD * 2 + cols * PITCH_X - GAP;
  const HEIGHT = PAD * 2 + rows * PITCH_Y - GAP;
  const rowY0 = (r) => PAD + r * PITCH_Y;

  let seed = 0x811c9dc5;
  calendar.forEach((w, i) =>
    w.forEach((d, j) => {
      seed = (Math.imul(seed ^ (d.count + 1), 0x01000193) + i * 7 + j) >>> 0;
    })
  );
  const rand = mulberry32(seed);

  // platforms: one per stretch of weeks, on that stretch's busiest weekday
  const plats = [];
  for (let c = FIRST_COL; c + PLAT_COLS <= cols - 1; c += STEP_COLS) {
    const perDay = new Array(rows).fill(0);
    for (let k = 0; k < PLAT_COLS; k++) calendar[c + k].forEach((d, r) => (perDay[r] += d.count));
    const max = Math.max(...perDay);
    const ties = perDay.map((v, r) => (v === max ? r : -1)).filter((r) => r >= 0);
    const busiest = ties[Math.floor(rand() * ties.length)];
    const row = Math.min(MAX_ROW, Math.max(MIN_ROW, busiest));
    const x0 = PAD + c * PITCH_X;
    const x1 = x0 + PLAT_COLS * PITCH_X - GAP;
    plats.push({ c, row, x0, x1, cx: (x0 + x1) / 2, top: rowY0(row), landT: null });
  }

  // path: platform 0 -> ... -> last platform -> bounce off the right edge
  const stops = plats.map((p) => ({ x: p.cx, y: p.top }));
  const last = stops[stops.length - 1];
  stops.push({ x: WIDTH + 28, y: Math.max(rowY0(3), last.y - 30) });

  let t = START_HOLD_S;
  const frames = [
    { t: 0, x: stops[0].x, y: stops[0].y, rot: 0 },
    { t, x: stops[0].x, y: stops[0].y, rot: 0 },
  ];
  let minTop = Infinity;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const { t: hop, v0 } = solveHop(dy);
    for (let tau = SAMPLE_S; tau < hop - 1e-6; tau += SAMPLE_S) {
      const vy = -v0 + GRAVITY * tau;
      const y = a.y - v0 * tau + 0.5 * GRAVITY * tau * tau;
      minTop = Math.min(minTop, y - 18);
      frames.push({
        t: t + tau,
        x: a.x + (dx * tau) / hop,
        y,
        rot: Math.max(-14, Math.min(18, (vy / 350) * 16)),
      });
    }
    t += hop;
    frames.push({ t, x: b.x, y: b.y, rot: 0 });
    if (i < plats.length - 1) plats[i + 1].landT = t;
  }

  const T = +(t + END_HOLD_S).toFixed(3);
  const lf = frames[frames.length - 1];
  frames.push({ t: T, x: lf.x, y: lf.y, rot: 0 });

  return {
    plats,
    frames,
    T,
    WIDTH,
    HEIGHT,
    minTop,
    score: plats.filter((p) => p.landT !== null).length,
  };
}

// ---------- svg ----------
function toSvg(calendar, sim, theme) {
  const pal = PALETTES[theme];
  const { plats, frames, T, WIDTH, HEIGHT } = sim;
  const rep = `dur="${T}s" repeatCount="indefinite"`;
  const f1 = (n) => +n.toFixed(1);
  const kt = frames.map((f) => +(f.t / T).toFixed(5)).join(";");

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  out += `<title>Doodle Jump bouncing across my GitHub contribution graph</title>\n`;
  out += `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" fill="${pal.panel}" stroke="${pal.frame}"/>\n`;

  // your real heatmap as the sky
  out += `<g opacity="${pal.bgOpacity}">\n`;
  calendar.forEach((week, c) =>
    week.forEach((d, r) => {
      if (!d.exists) return;
      out += `<rect x="${PAD + c * PITCH_X}" y="${PAD + r * PITCH_Y}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[d.level]}"/>\n`;
    })
  );
  out += `</g>\n`;

  // platforms built from heatmap cells
  for (const p of plats) {
    for (let k = 0; k < PLAT_COLS; k++) {
      out += `<rect x="${PAD + (p.c + k) * PITCH_X}" y="${p.top}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[4]}"/>\n`;
    }
  }

  // score (one label per value, shown between landings)
  const times = [0, ...plats.filter((p) => p.landT !== null).map((p) => p.landT), T];
  for (let s = 0; s < times.length - 1; s++) {
    const a = +(times[s] / T).toFixed(5);
    const b = +(times[s + 1] / T).toFixed(5);
    const values = s === 0 ? "1;0;0" : "0;1;0;0";
    const keys = s === 0 ? `0;${b};1` : `0;${a};${b};1`;
    out +=
      `<text x="${WIDTH - PAD - 4}" y="${PAD + 15}" text-anchor="end" font-family="-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" font-size="14" font-weight="700" fill="${pal.text}" stroke="${pal.panel}" stroke-width="3" paint-order="stroke" opacity="${s === 0 ? 1 : 0}">` +
      `Score ${s}<animate attributeName="opacity" values="${values}" keyTimes="${keys}" calcMode="discrete" ${rep}/></text>\n`;
  }

  // doodler (origin = feet center, faces right)
  const pos = frames.map((f) => `${f1(f.x)} ${f1(f.y)}`).join(";");
  const rot = frames.map((f) => f1(f.rot)).join(";");
  out +=
    `<g transform="translate(${f1(frames[0].x)} ${f1(frames[0].y)})">` +
    `<animateTransform attributeName="transform" type="translate" values="${pos}" keyTimes="${kt}" ${rep}/>` +
    `<g transform="translate(0 -9)"><g><animateTransform attributeName="transform" type="rotate" values="${rot}" keyTimes="${kt}" ${rep}/>` +
    `<g transform="translate(0 9)">` +
    `<rect x="-6" y="-4" width="3.4" height="4" rx="1.2" fill="${pal.bodyDark}"/>` +
    `<rect x="2.6" y="-4" width="3.4" height="4" rx="1.2" fill="${pal.bodyDark}"/>` +
    `<rect x="-8" y="-17" width="16" height="14" rx="6" fill="${pal.body}" stroke="${pal.bodyDark}" stroke-width="0.8"/>` +
    `<rect x="6" y="-13.5" width="8" height="3.6" rx="1.8" fill="${pal.bodyDark}"/>` +
    `<circle cx="2.5" cy="-11.5" r="3" fill="#ffffff"/><circle cx="3.4" cy="-11.5" r="1.3" fill="#1f2328"/>` +
    `<path d="M-8 -12 L-11 -15 L-7 -14.5 Z" fill="${pal.bodyDark}"/>` +
    `</g></g></g></g>\n`;

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
  writeFileSync(`${OUT_DIR}/doodle-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/doodle-${theme}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`score ${sim.score}/${sim.plats.length - 1}, ${sim.T}s loop, ${sim.WIDTH}x${sim.HEIGHT}px, highest point y=${sim.minTop.toFixed(1)}`);
