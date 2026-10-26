#!/usr/bin/env node
// Tetris on your GitHub contribution graph -> animated SVG (works inside a README <img>).
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-tetris.mjs <github-username>
//   node generate-tetris.mjs --demo            (fake heatmap, no network)
//
// Output: dist/tetris-light.svg, dist/tetris-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const CELL_W = 10; // cell width  (raise for a wider game)
const CELL_H = 17; // cell height (raise for a taller game)
const GAP = 3;
const PITCH_X = CELL_W + GAP;
const PITCH_Y = CELL_H + GAP;
const PAD = 10;
const RADIUS = 2;

const ROWS = 7; // weekdays (game height)
const DROP_MS_PER_ROW = 55; // fall speed
const CLEAR_BLINKS = 2;
const BLINK_S = 0.09;
const SHIFT_S = 0.14; // time for rows to collapse after a clear
const WANDER = 0.1; // 0..1, how far pieces may slide sideways while falling
const MAX_PIECES = 160;
const MAX_TIME_S = 55; // loop length cap

const PALETTES = {
  light: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  dark: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
};

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const SHAPES = [
  [[0, 1], [1, 1], [2, 1], [3, 1]], // I
  [[0, 0], [0, 1], [1, 1], [2, 1]], // J
  [[2, 0], [0, 1], [1, 1], [2, 1]], // L
  [[1, 0], [2, 0], [0, 1], [1, 1]], // S
  [[0, 0], [1, 0], [1, 1], [2, 1]], // Z
  [[1, 0], [0, 1], [1, 1], [2, 1]], // T
  [[0, 0], [1, 0], [0, 1], [1, 1]], // O
];

// ---------- data ----------
async function fetchCalendar(user, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "readme-tetris",
    },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) {
    throw new Error("GitHub API error: " + JSON.stringify(json.errors || json));
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks.map(
    (w) => {
      const col = Array.from({ length: 7 }, () => ({
        count: 0,
        level: 0,
        exists: false,
      }));
      for (const d of w.contributionDays) {
        col[d.weekday] = {
          count: d.contributionCount,
          level: LEVELS[d.contributionLevel] ?? 0,
          exists: true,
        };
      }
      return col;
    }
  );
}

function demoCalendar() {
  const rand = mulberry32(42);
  return Array.from({ length: 53 }, () =>
    Array.from({ length: 7 }, () => {
      const r = rand();
      const level = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
      return { count: level * 3, level, exists: true };
    })
  );
}

// ---------- helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rotate(shape, turns) {
  let cells = SHAPES[shape].map(([c, r]) => [c, r]);
  for (let t = 0; t < turns; t++) {
    let maxRow = 0;
    for (const [, r] of cells) maxRow = Math.max(maxRow, r);
    cells = cells.map(([c, r]) => [maxRow - r, c]);
  }
  let minC = Infinity;
  let minR = Infinity;
  for (const [c, r] of cells) {
    minC = Math.min(minC, c);
    minR = Math.min(minR, r);
  }
  return cells.map(([c, r]) => [c - minC, r - minR]);
}

// ---------- simulation (your Tetris AI, played on the heatmap grid) ----------
function simulate(calendar) {
  const cols = calendar.length;
  const rows = ROWS;
  const dropS = DROP_MS_PER_ROW / 1000;

  // The heatmap drives the game: piece colours follow your contribution
  // levels in chronological order, and the RNG is seeded from your data.
  const seq = [];
  let seed = 0x811c9dc5;
  calendar.forEach((week, i) =>
    week.forEach((d, j) => {
      if (d.level > 0) seq.push(Math.max(2, d.level));
      seed = (Math.imul(seed ^ (d.count + 1), 0x01000193) + i * 7 + j) >>> 0;
    })
  );
  if (!seq.length) seq.push(2, 3, 4);
  const rand = mulberry32(seed);

  let grid = new Array(cols * rows).fill(-1); // holds block ids
  const blocks = [];
  const px = (col) => PAD + col * PITCH_X;
  const py = (row) => PAD + row * PITCH_Y;

  const fits = (cells, col, row) => {
    for (const [c, r] of cells) {
      const gc = col + c;
      const gr = row + r;
      if (gc < 0 || gc >= cols || gr >= rows) return false;
      if (gr >= 0 && grid[gr * cols + gc] !== -1) return false;
    }
    return true;
  };

  const landing = (cells, col) => {
    if (!fits(cells, col, 0)) return -1;
    let row = 0;
    while (fits(cells, col, row + 1)) row++;
    return row;
  };

  const score = (cells, col, row) => {
    const test = grid.slice();
    for (const [c, r] of cells) {
      const gr = row + r;
      if (gr >= 0) test[gr * cols + (col + c)] = 1;
    }
    let lines = 0;
    for (let r = 0; r < rows; r++) {
      let full = true;
      for (let c = 0; c < cols; c++) {
        if (test[r * cols + c] === -1) {
          full = false;
          break;
        }
      }
      if (full) lines++;
    }
    let aggHeight = 0;
    let holes = 0;
    let bump = 0;
    let prevTop = -1;
    for (let c = 0; c < cols; c++) {
      let top = rows;
      for (let r = 0; r < rows; r++) {
        if (test[r * cols + c] !== -1) {
          top = r;
          break;
        }
      }
      aggHeight += rows - top;
      for (let r = top + 1; r < rows; r++) if (test[r * cols + c] === -1) holes++;
      if (prevTop >= 0) bump += Math.abs(top - prevTop);
      prevTop = top;
    }
    return lines * 4.0 - aggHeight * 0.5 - holes * 3.5 - bump * 0.3;
  };

  // ----- keyframe helpers -----
  const frame = (b, t) => {
    const last = b.frames[b.frames.length - 1];
    if (last.t < t) {
      const f = { ...last, t };
      b.frames.push(f);
      return f;
    }
    return last;
  };
  const moveTo = (b, t0, t1, x, y) => {
    frame(b, t0);
    const g = frame(b, t1);
    g.x = x;
    g.y = y;
  };
  const setO = (b, t, o) => {
    frame(b, t).o = o;
  };
  const blink = (ids, t) => {
    for (let i = 0; i < CLEAR_BLINKS; i++) {
      for (const id of ids) {
        setO(blocks[id], t + i * 2 * BLINK_S, 0.25);
        setO(blocks[id], t + (i * 2 + 1) * BLINK_S, 1);
      }
    }
    const end = t + CLEAR_BLINKS * 2 * BLINK_S;
    for (const id of ids) setO(blocks[id], end, 0);
    return end;
  };

  const pathClear = (cells, startCol, startRow, tCol, tRow) => {
    const span = tRow - startRow;
    let prevCol = startCol;
    for (let row = startRow; row <= tRow; row++) {
      const prog = span > 0 ? (row - startRow) / span : 1;
      const col = Math.round(startCol + (tCol - startCol) * prog);
      if (!fits(cells, col, row)) return false;
      if (!fits(cells, prevCol, row)) return false;
      if (row > startRow && !fits(cells, col, row - 1)) return false;
      prevCol = col;
    }
    return true;
  };

  let t = 0.5;
  let n = 0;

  while (n < MAX_PIECES && t < MAX_TIME_S) {
    const shape = Math.floor(rand() * SHAPES.length);
    let best = null;
    let bestScore = -Infinity;
    for (let turn = 0; turn < 4; turn++) {
      const cells = rotate(shape, turn);
      let width = 0;
      for (const [c] of cells) width = Math.max(width, c);
      for (let col = 0; col + width < cols; col++) {
        const row = landing(cells, col);
        if (row < 0) continue;
        const s = score(cells, col, row);
        if (s > bestScore) {
          bestScore = s;
          best = { cells, col, row, width };
        }
      }
    }
    if (!best) break; // board full -> game over

    let maxR = 0;
    for (const [, r] of best.cells) maxR = Math.max(maxR, r);
    const startRow = -1 - maxR;

    let startCol = best.col;
    const swing = Math.round((rand() * 2 - 1) * WANDER * cols);
    const cand = Math.min(cols - 1 - best.width, Math.max(0, best.col + swing));
    if (cand !== best.col && pathClear(best.cells, cand, startRow, best.col, best.row)) {
      startCol = cand;
    }

    const level = seq[n % seq.length];
    const dur = (best.row - startRow) * dropS;
    const ids = [];
    for (const [c, r] of best.cells) {
      const b = {
        level,
        col: best.col + c,
        row: best.row + r,
        frames: [{ t: 0, x: px(startCol + c), y: py(startRow + r), o: 0 }],
      };
      blocks.push(b);
      const id = blocks.length - 1;
      ids.push(id);
      setO(b, t, 1);
      moveTo(b, t, t + dur, px(best.col + c), py(best.row + r));
      grid[(best.row + r) * cols + (best.col + c)] = id;
    }
    t += dur;
    n++;

    // line clears (a full column of 7 weekdays-tall rows = a full row of 53 weeks)
    const full = [];
    for (let r = 0; r < rows; r++) {
      let solid = true;
      for (let c = 0; c < cols; c++) {
        if (grid[r * cols + c] === -1) {
          solid = false;
          break;
        }
      }
      if (solid) full.push(r);
    }
    if (full.length) {
      const gone = [];
      for (const r of full) for (let c = 0; c < cols; c++) gone.push(grid[r * cols + c]);
      t = blink(gone, t);

      const next = new Array(cols * rows).fill(-1);
      for (let r = 0; r < rows; r++) {
        if (full.includes(r)) continue;
        const shift = full.filter((f) => f > r).length;
        for (let c = 0; c < cols; c++) {
          const id = grid[r * cols + c];
          if (id === -1) continue;
          next[(r + shift) * cols + c] = id;
          if (shift > 0) {
            blocks[id].row = r + shift;
            moveTo(blocks[id], t, t + SHIFT_S, blocks[id].frames.at(-1).x, py(r + shift));
          }
        }
      }
      grid = next;
      t += SHIFT_S;
    }
  }

  // game over / time up: blink whatever is left, pause, loop
  const alive = [...new Set(grid.filter((id) => id !== -1))];
  if (alive.length) t = blink(alive, t + 0.4);
  const T = +(t + 1.2).toFixed(3);

  for (const b of blocks) {
    frame(b, T);
    // drop redundant middle frames
    b.frames = b.frames.filter((f, i, a) => {
      if (i === 0 || i === a.length - 1) return true;
      const p = a[i - 1];
      const q = a[i + 1];
      return !(p.x === f.x && p.y === f.y && p.o === f.o && q.x === f.x && q.y === f.y && q.o === f.o);
    });
  }
  return { blocks, T, pieces: n };
}

// ---------- svg ----------
function toSvg(calendar, sim, theme) {
  const pal = PALETTES[theme];
  const cols = calendar.length;
  const width = PAD * 2 + cols * PITCH_X - GAP;
  const height = PAD * 2 + ROWS * PITCH_Y - GAP;
  const { blocks, T } = sim;
  const f = (n) => +n.toFixed(1);

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">\n`;
  out += `<title>Tetris playing on my GitHub contribution graph</title>\n`;

  // the real heatmap, dimmed, as the board background
  out += `<g opacity="0.55">\n`;
  calendar.forEach((week, c) =>
    week.forEach((d, r) => {
      if (!d.exists) return;
      out += `<rect x="${PAD + c * PITCH_X}" y="${PAD + r * PITCH_Y}" width="${CELL_W}" height="${CELL_H}" rx="${RADIUS}" fill="${pal[d.level]}"/>\n`;
    })
  );
  out += `</g>\n`;

  // falling blocks
  const dur = `${T}s`;
  for (const b of blocks) {
    const kt = b.frames.map((fr) => +(fr.t / T).toFixed(5)).join(";");
    const pos = b.frames.map((fr) => `${f(fr.x)} ${f(fr.y)}`).join(";");
    const op = b.frames.map((fr) => fr.o).join(";");
    out +=
      `<rect width="${CELL_W}" height="${CELL_H}" rx="${RADIUS}" fill="${pal[b.level]}" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="${pos}" keyTimes="${kt}" dur="${dur}" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="${op}" keyTimes="${kt}" calcMode="discrete" dur="${dur}" repeatCount="indefinite"/>` +
      `</rect>\n`;
  }
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
  writeFileSync(`${OUT_DIR}/tetris-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/tetris-${theme}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`${sim.pieces} pieces, ${sim.T}s loop, ${calendar.length}x7 board`);
