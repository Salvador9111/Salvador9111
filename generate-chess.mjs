#!/usr/bin/env node
// Chess on your GitHub contribution graph -> animated SVG (works inside a README <img>).
// Replays Morphy's "Opera Game" (1858). The 8x8 board is your last 64 days of
// contributions: each square is tinted by that day's contribution level.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-chess.mjs <github-username>
//   node generate-chess.mjs --demo
//
// Output: dist/chess-light.svg, dist/chess-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const SW = 50; // square width in px  (raise for a wider board)
const SH = 24; // square height in px (lower for a shorter board)
const PIECE_STRETCH = 1.2; // pieces drawn a bit wider than tall to fill the wide squares
const PAD = 6;
const WIDTH = 8 * SW + PAD * 2;
const HEIGHT = 8 * SH + PAD * 2;
const MOVE_S = 0.6; // seconds a move takes
const GAP_S = 0.5; // pause between moves
const START_S = 1.2;
const END_S = 3.5;

const PALETTES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    checker: ["#eaeef2", "#c3cbd4"],
    frame: "#d0d7de",
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    checker: ["#2b323b", "#12161c"],
    frame: "#30363d",
  },
};

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

// Opera Game: Morphy vs Duke of Brunswick & Count Isouard, Paris 1858.
// [from, to] (+ [rookFrom, rookTo] for castling)
const MOVES = [
  ["e2", "e4"], ["e7", "e5"],
  ["g1", "f3"], ["d7", "d6"],
  ["d2", "d4"], ["c8", "g4"],
  ["d4", "e5"], ["g4", "f3"],
  ["d1", "f3"], ["d6", "e5"],
  ["f1", "c4"], ["g8", "f6"],
  ["f3", "b3"], ["d8", "e7"],
  ["b1", "c3"], ["c7", "c6"],
  ["c1", "g5"], ["b7", "b5"],
  ["c3", "b5"], ["c6", "b5"],
  ["c4", "b5"], ["b8", "d7"],
  ["e1", "c1", "a1", "d1"], ["a8", "d8"], // 12. O-O-O Rd8
  ["d1", "d7"], ["d8", "d7"],
  ["h1", "d1"], ["e7", "e6"],
  ["b5", "d7"], ["f6", "d7"],
  ["b3", "b8"], ["d7", "b8"],
  ["d1", "d8"], // 17. Rd8#
];

// simple piece silhouettes in a 100x100 box (drawn once, reused with <use>)
const PIECE_DEFS = `
<defs>
  <g id="pawn"><circle cx="50" cy="30" r="13"/><path d="M34 76 Q36 54 50 48 Q64 54 66 76 Z"/><rect x="28" y="76" width="44" height="10" rx="4"/></g>
  <g id="rook"><path d="M28 18 H38 V27 H45 V18 H55 V27 H62 V18 H72 V42 L64 50 V74 H36 V50 L28 42 Z"/><rect x="24" y="74" width="52" height="12" rx="4"/></g>
  <g id="knight"><path d="M30 76 H72 C74 56 68 38 54 26 L50 14 L42 24 L24 42 L28 52 L40 46 L48 40 C40 54 36 64 30 76 Z"/><rect x="24" y="76" width="52" height="10" rx="4"/></g>
  <g id="bishop"><circle cx="50" cy="18" r="7"/><path d="M50 26 C72 40 68 58 62 72 H38 C32 58 28 40 50 26 Z"/><rect x="26" y="72" width="48" height="12" rx="4"/></g>
  <g id="queen"><path d="M24 34 L36 58 L42 28 L50 56 L58 28 L64 58 L76 34 L70 74 H30 Z"/><circle cx="24" cy="30" r="5"/><circle cx="42" cy="24" r="5"/><circle cx="58" cy="24" r="5"/><circle cx="76" cy="30" r="5"/><rect x="26" y="74" width="48" height="12" rx="4"/></g>
  <g id="king"><rect x="46" y="8" width="8" height="24" rx="2"/><rect x="38" y="16" width="24" height="8" rx="2"/><path d="M32 76 C28 54 36 38 50 34 C64 38 72 54 68 76 Z"/><rect x="26" y="76" width="48" height="12" rx="4"/></g>
</defs>`;

const DRAW_ORDER = { pawn: 0, rook: 1, knight: 2, bishop: 3, queen: 4, king: 5 };

// ---------- data ----------
async function fetchCalendar(user, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "readme-chess",
    },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) {
    throw new Error("GitHub API error: " + JSON.stringify(json.errors || json));
  }
  const days = [];
  for (const w of json.data.user.contributionsCollection.contributionCalendar.weeks) {
    for (const d of w.contributionDays) {
      days.push({ count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 });
    }
  }
  return days; // chronological
}

function demoDays() {
  let a = 42;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 371 }, () => {
    const r = rand();
    const level = r < 0.3 ? 0 : r < 0.55 ? 1 : r < 0.78 ? 2 : r < 0.92 ? 3 : 4;
    return { count: level * 3, level };
  });
}

// ---------- game ----------
const files = "abcdefgh";
const sq = (s) => ({ col: files.indexOf(s[0]), row: 8 - Number(s[1]) });
const px = (col) => PAD + col * SW;
const py = (row) => PAD + row * SH;
const key = (row, col) => `${row},${col}`;

function simulate() {
  const BACK = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
  const pieces = [];
  const board = new Map();
  const add = (type, color, row, col) => {
    const p = { type, color, frames: [{ t: 0, x: px(col), y: py(row), o: 1 }] };
    pieces.push(p);
    board.set(key(row, col), p);
  };
  for (let c = 0; c < 8; c++) {
    add(BACK[c], "black", 0, c);
    add("pawn", "black", 1, c);
    add("pawn", "white", 6, c);
    add(BACK[c], "white", 7, c);
  }

  const frame = (p, t) => {
    const last = p.frames[p.frames.length - 1];
    if (last.t < t) {
      const f = { ...last, t };
      p.frames.push(f);
      return f;
    }
    return last;
  };
  const moveTo = (p, t0, t1, x, y) => {
    frame(p, t0);
    const g = frame(p, t1);
    g.x = x;
    g.y = y;
  };

  const step = (from, to, t0) => {
    const a = sq(from);
    const b = sq(to);
    const p = board.get(key(a.row, a.col));
    if (!p) throw new Error(`No piece on ${from}`);
    const victim = board.get(key(b.row, b.col));
    board.delete(key(a.row, a.col));
    if (victim) frame(victim, t0 + MOVE_S).o = 0;
    board.set(key(b.row, b.col), p);
    moveTo(p, t0, t0 + MOVE_S, px(b.col), py(b.row));
  };

  let t = START_S;
  for (const m of MOVES) {
    step(m[0], m[1], t);
    if (m.length === 4) step(m[2], m[3], t); // castling rook
    t += MOVE_S + GAP_S;
  }
  const mateAt = t - GAP_S; // final move landed here
  const T = +(t + END_S).toFixed(3);

  for (const p of pieces) {
    frame(p, T);
    p.frames = p.frames.filter((f, i, arr) => {
      if (i === 0 || i === arr.length - 1) return true;
      const a = arr[i - 1];
      const c = arr[i + 1];
      return !(a.x === f.x && a.y === f.y && a.o === f.o && c.x === f.x && c.y === f.y && c.o === f.o);
    });
  }
  const mate = sq("e8"); // black king, checkmated by 17.Rd8#
  return { pieces, T, mateAt, mate };
}

// ---------- svg ----------
function toSvg(days, sim, theme) {
  const pal = PALETTES[theme];
  const { pieces, T, mateAt, mate } = sim;
  const last64 = days.slice(-64);
  while (last64.length < 64) last64.unshift({ count: 0, level: 0 });
  const f1 = (n) => +n.toFixed(1);
  const dur = `${T}s`;

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  out += `<title>Chess on my GitHub contribution graph</title>\n${PIECE_DEFS}\n`;
  out += `<rect x="${PAD - 1}" y="${PAD - 1}" width="${8 * SW + 2}" height="${8 * SH + 2}" rx="4" fill="none" stroke="${pal.frame}" stroke-width="1"/>\n`;

  // board: checkerboard tinted by the last 64 days (oldest top-left -> newest bottom-right)
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const level = last64[r * 8 + c].level;
      const base = pal.checker[(r + c) % 2];
      out += `<rect x="${px(c)}" y="${py(r)}" width="${SW}" height="${SH}" fill="${base}"/>\n`;
      if (level > 0) {
        out += `<rect x="${px(c)}" y="${py(r)}" width="${SW}" height="${SH}" fill="${pal.levels[level]}" opacity="${(r + c) % 2 ? 0.8 : 0.6}"/>\n`;
      }
    }
  }

  // checkmate flash on the king's square
  out +=
    `<rect x="${px(mate.col)}" y="${py(mate.row)}" width="${SW}" height="${SH}" fill="#f85149" opacity="0">` +
    `<animate attributeName="opacity" values="0;0.65;0" keyTimes="0;${+(mateAt / T).toFixed(5)};1" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/></rect>\n`;

  // pieces (small ones first so big ones draw on top while moving)
  const style = {
    white: `fill="#f6f8fa" stroke="#1f2328"`,
    black: `fill="#24292f" stroke="#f0f3f6"`,
  };
  const ky = (SH * 0.88) / 100;
  const kx = Math.min(ky * PIECE_STRETCH, (SW * 0.88) / 100);
  const offX = (SW - kx * 100) / 2;
  const offY = (SH - ky * 100) / 2;
  const ordered = [...pieces].sort((a, b) => DRAW_ORDER[a.type] - DRAW_ORDER[b.type]);
  for (const p of ordered) {
    const kt = p.frames.map((fr) => +(fr.t / T).toFixed(5)).join(";");
    const pos = p.frames.map((fr) => `${f1(fr.x)} ${f1(fr.y)}`).join(";");
    const op = p.frames.map((fr) => fr.o).join(";");
    out +=
      `<g transform="translate(${f1(p.frames[0].x)} ${f1(p.frames[0].y)})">` +
      `<animateTransform attributeName="transform" type="translate" values="${pos}" keyTimes="${kt}" dur="${dur}" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="${op}" keyTimes="${kt}" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>` +
      `<g transform="translate(${f1(offX)} ${f1(offY)}) scale(${kx.toFixed(4)} ${ky.toFixed(4)})" ${style[p.color]} stroke-width="3.5" stroke-linejoin="round"><use href="#${p.type}"/></g>` +
      `</g>\n`;
  }
  out += `</svg>\n`;
  return out;
}

// ---------- main ----------
const args = process.argv.slice(2);
const demo = args.includes("--demo");
const user = args.find((a) => !a.startsWith("--")) || process.env.GITHUB_USER;

let days;
if (demo) {
  days = demoDays();
} else {
  if (!user) throw new Error("Pass a GitHub username (or use --demo).");
  if (!process.env.GITHUB_TOKEN) throw new Error("Set GITHUB_TOKEN.");
  days = await fetchCalendar(user, process.env.GITHUB_TOKEN);
}

const sim = simulate();
mkdirSync(OUT_DIR, { recursive: true });
for (const theme of Object.keys(PALETTES)) {
  const svg = toSvg(days, sim, theme);
  writeFileSync(`${OUT_DIR}/chess-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/chess-${theme}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`${MOVES.length} plies, ${sim.T}s loop, ${WIDTH}x${HEIGHT}px`);
