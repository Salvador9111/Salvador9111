#!/usr/bin/env node
// Flappy Bird on your GitHub contribution graph -> animated SVG (works inside a README <img>).
// Your busiest weeks become pipes made of heatmap cells; each pipe's gap sits on your busiest
// weekday of that week. An auto-playing bird flaps through all of them, counting a score.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-flappy.mjs <github-username>
//   node generate-flappy.mjs --demo
//
// Output: dist/flappy-light.svg, dist/flappy-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const CELL_W = 12;
const CELL_H = 16; // raise for a taller game
const GAP = 3;
const PITCH_X = CELL_W + GAP;
const PITCH_Y = CELL_H + GAP;
const PAD = 8;

const PIPE_COLS = 2; // pipe width in heatmap columns
const MAX_PIPES = 9;
const MIN_SPACING = 6; // min columns between pipe starts
const GAP_ROWS = 3; // gap height in cells
const SPEED = 74; // bird speed in px/s (left -> right), lower = slower
const BIRD_R = 7.3;
const GRAVITY = 700;
const FLAP_V = -170;
const START_HOLD_S = 0.8;
const END_HOLD_S = 1.6;
const SAMPLE_S = 1 / 30;

const PALETTES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    panel: "#ffffff",
    frame: "#d0d7de",
    text: "#1f2328",
    bgOpacity: 0.7,
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    panel: "#0d1117",
    frame: "#30363d",
    text: "#f0f6fc",
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
      "User-Agent": "readme-flappy",
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

  let seed = 0x811c9dc5;
  calendar.forEach((w, i) =>
    w.forEach((d, j) => {
      seed = (Math.imul(seed ^ (d.count + 1), 0x01000193) + i * 7 + j) >>> 0;
    })
  );
  const rand = mulberry32(seed);

  // pipes: the busiest pairs of weeks, spread out, with a runway at the start
  const first = 8;
  const last = cols - PIPE_COLS - 2;
  const cand = [];
  for (let c = first; c <= last; c++) {
    let score = 0;
    for (let k = 0; k < PIPE_COLS; k++) for (const d of calendar[c + k]) score += d.count;
    cand.push({ c, score });
  }
  cand.sort((a, b) => b.score - a.score || a.c - b.c);
  const picked = [];
  for (const p of cand) {
    if (picked.length >= MAX_PIPES) break;
    if (picked.every((o) => Math.abs(o.c - p.c) >= MIN_SPACING)) picked.push(p);
  }
  picked.sort((a, b) => a.c - b.c);

  const pipes = picked.map((p) => {
    // gap sits on the busiest weekday of those weeks
    const perDay = new Array(rows).fill(0);
    for (let k = 0; k < PIPE_COLS; k++) calendar[p.c + k].forEach((d, r) => (perDay[r] += d.count));
    const max = Math.max(...perDay);
    const ties = perDay.map((v, r) => (v === max ? r : -1)).filter((r) => r >= 0);
    const busiest = ties[Math.floor(rand() * ties.length)];
    const center = Math.min(4, Math.max(2, busiest)); // keep a pipe stub above and below
    const gapStart = center - Math.floor(GAP_ROWS / 2);
    const gapEnd = gapStart + GAP_ROWS - 1;
    const x0 = PAD + p.c * PITCH_X;
    return {
      c: p.c,
      gapStart,
      gapEnd,
      x0,
      x1: x0 + PIPE_COLS * PITCH_X - GAP,
      gy0: rowY0(gapStart),
      gy1: rowY0(gapEnd) + CELL_H,
      passT: null,
    };
  });

  // ----- physics + autopilot -----
  const dt = 1 / 240;
  let t = 0;
  let x = PAD + 16;
  let y = rowY0(3) + CELL_H / 2;
  let vy = 0;
  let lastFlap = -1;
  let crashed = false;
  const frames = [{ t: 0, x, y, rot: 0 }];
  t = START_HOLD_S;
  frames.push({ t, x, y, rot: 0 });
  let nextSample = t + SAMPLE_S;

  const endX = WIDTH - PAD + 14;
  while (x < endX && !crashed) {
    t += dt;
    x += SPEED * dt;
    vy += GRAVITY * dt;
    y += vy * dt;

    // autopilot: aim for the middle of the next gap
    const cur = pipes.find((p) => p.x1 + BIRD_R + 2 > x);
    const target = cur ? (cur.gy0 + cur.gy1) / 2 : rowY0(3) + CELL_H / 2;
    if (y > target + 3 && vy > -30 && t - lastFlap > 0.16) {
      vy = FLAP_V;
      lastFlap = t;
    }

    // ceiling
    if (y - BIRD_R < PAD) {
      y = PAD + BIRD_R;
      if (vy < 0) vy = 0;
    }
    // floor or pipes = crash
    if (y + BIRD_R > HEIGHT - PAD) crashed = true;
    for (const p of pipes) {
      if (x + BIRD_R < p.x0 || x - BIRD_R > p.x1) continue;
      if (y - BIRD_R < p.gy0 || y + BIRD_R > p.gy1) crashed = true;
      if (p.passT === null && x - BIRD_R > p.x1) p.passT = t;
    }
    for (const p of pipes) if (p.passT === null && x - BIRD_R > p.x1) p.passT = t;

    if (t >= nextSample) {
      const rot = Math.max(-28, Math.min(60, (vy / 400) * 45));
      frames.push({ t, x, y, rot });
      nextSample += SAMPLE_S;
    }
  }

  if (crashed) {
    // tumble to the floor
    const floorY = HEIGHT - PAD - BIRD_R;
    const t0 = t;
    const y0 = y;
    const fall = 0.35;
    frames.push({ t: t0, x, y: y0, rot: 20 });
    frames.push({ t: t0 + fall, x, y: floorY, rot: 90 });
    t = t0 + fall;
  } else {
    frames.push({ t, x, y, rot: 0 });
  }

  const T = +(t + END_HOLD_S).toFixed(3);
  frames.push({ t: T, x: frames[frames.length - 1].x, y: frames[frames.length - 1].y, rot: frames[frames.length - 1].rot });

  return { pipes, frames, T, WIDTH, HEIGHT, crashed, score: pipes.filter((p) => p.passT !== null).length };
}

// ---------- svg ----------
function toSvg(calendar, sim, theme) {
  const pal = PALETTES[theme];
  const { pipes, frames, T, WIDTH, HEIGHT } = sim;
  const dur = `${T}s`;
  const rep = `dur="${dur}" repeatCount="indefinite"`;
  const f1 = (n) => +n.toFixed(1);
  const kt = frames.map((f) => +(f.t / T).toFixed(5)).join(";");

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  out += `<title>Flappy Bird flying through my GitHub contribution graph</title>\n`;
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

  // pipes built from heatmap cells (brighter cells at the lip of the gap)
  for (const p of pipes) {
    for (let k = 0; k < PIPE_COLS; k++) {
      const x = PAD + (p.c + k) * PITCH_X;
      for (let r = 0; r < 7; r++) {
        if (r >= p.gapStart && r <= p.gapEnd) continue;
        const lip = r === p.gapStart - 1 || r === p.gapEnd + 1;
        out += `<rect x="${x}" y="${PAD + r * PITCH_Y}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[lip ? 4 : 3]}"/>\n`;
      }
    }
  }

  

  // bird
  const pos = frames.map((f) => `${f1(f.x)} ${f1(f.y)}`).join(";");
  const rot = frames.map((f) => f1(f.rot)).join(";");
  out +=
    `<g transform="translate(${f1(frames[0].x)} ${f1(frames[0].y)})">` +
    `<animateTransform attributeName="transform" type="translate" values="${pos}" keyTimes="${kt}" ${rep}/>` +
    `<g><animateTransform attributeName="transform" type="rotate" values="${rot}" keyTimes="${kt}" ${rep}/>` +
    `<circle r="${BIRD_R}" fill="#fddc3a" stroke="#c99a00" stroke-width="0.8"/>` +
    `<path d="M5.5 -1.5 L11.5 0.5 L5.5 2.8 Z" fill="#ff8a1f"/>` +
    `<circle cx="2.6" cy="-2.4" r="2" fill="#fff"/><circle cx="3.2" cy="-2.4" r="0.9" fill="#1f2328"/>` +
    `<ellipse cx="-2.6" cy="1.6" rx="3.6" ry="2.2" fill="#f4b400" stroke="#c99a00" stroke-width="0.6"><animate attributeName="ry" values="2.2;3.6;2.2" dur="0.28s" repeatCount="indefinite"/></ellipse>` +
    `</g></g>\n`;

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
  writeFileSync(`${OUT_DIR}/flappy-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/flappy-${theme}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`score ${sim.score}/${sim.pipes.length}${sim.crashed ? " (CRASHED)" : ""}, ${sim.T}s loop, ${sim.WIDTH}x${sim.HEIGHT}px`);
