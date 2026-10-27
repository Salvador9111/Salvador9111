#!/usr/bin/env node
// Pac-Man on your GitHub contribution graph -> animated SVG (works inside a README <img>).
// Every day you contributed is a dot (in its exact GitHub color). Your biggest days are
// power pellets. Pac-Man eats the whole graph while ghosts chase him; power pellets turn
// the ghosts blue so he can eat them back.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-pacman.mjs <github-username>
//   node generate-pacman.mjs --demo
//
// Output: dist/pacman-light.svg, dist/pacman-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const CELL_W = 12; // cell width
const CELL_H = 16; // cell height (raise for a taller game)
const GAP = 3;
const PITCH_X = CELL_W + GAP;
const PITCH_Y = CELL_H + GAP;
const CHAR_SCALE = 1.25; // size of Pac-Man and the ghosts
const PAD = 8;
const TICK_S = 0.1; // time Pac-Man takes to move one cell
const START_S = 0.8;
const END_HOLD_S = 2.2;
const MAX_TICKS = 800;
const POWER_PELLETS = 4;
const FRIGHT_TICKS = 32;
const GHOST_RESPAWN_TICKS = 9;
const DEATH_S = 1.0;

const PACMAN = "#fddc3a";
const GHOSTS = ["#ff5757", "#ffa3d8", "#46d9ff"]; // blinky, pinky, inky
const FRIGHT = "#3b6cff";

const PALETTES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    panel: "#ffffff",
    frame: "#d0d7de",
    pacStroke: "#bf8700",
    pellet: "#1f2328",
  },
  dark: {
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    panel: "#0d1117",
    frame: "#30363d",
    pacStroke: "none",
    pellet: "#f0f6fc",
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
      "User-Agent": "readme-pacman",
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
  const rand = mulberry32(42);
  return Array.from({ length: 53 }, () =>
    Array.from({ length: 7 }, () => {
      const r = rand();
      const level = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
      return { count: level * 3 + Math.floor(rand() * 3), level, exists: true };
    })
  );
}

// ---------- simulation ----------
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up (angle = idx * 90)

function simulate(calendar) {
  const cols = calendar.length;
  const rows = 7;
  const WIDTH = PAD * 2 + cols * PITCH_X - GAP;
  const HEIGHT = PAD * 2 + rows * PITCH_Y - GAP;
  const cx = (c) => PAD + c * PITCH_X + CELL_W / 2;
  const cy = (r) => PAD + r * PITCH_Y + CELL_H / 2;
  const idx = (c, r) => c * rows + r;
  const inb = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows;
  const man = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);

  let seed = 0x811c9dc5;
  calendar.forEach((w, i) =>
    w.forEach((d, j) => {
      seed = (Math.imul(seed ^ (d.count + 1), 0x01000193) + i * 7 + j) >>> 0;
    })
  );
  const rand = mulberry32(seed);

  // dots = contribution days; power pellets = biggest days, spread out
  const dots = [];
  const dotAt = new Array(cols * rows).fill(-1);
  calendar.forEach((w, c) =>
    w.forEach((d, r) => {
      if (d.exists && d.level > 0) {
        dotAt[idx(c, r)] = dots.length;
        dots.push({ c, r, level: d.level, count: d.count, power: false, eatT: null });
      }
    })
  );
  const byBig = [...dots].sort((a, b) => b.count - a.count || a.c - b.c);
  const chosen = [];
  for (const d of byBig) {
    if (chosen.length >= POWER_PELLETS) break;
    if (chosen.every((o) => Math.abs(o.c - d.c) >= 8)) chosen.push(d);
  }
  chosen.forEach((d) => (d.power = true));
  let dotsLeft = dots.length;

  // ----- keyframe helpers -----
  const frame = (o, t) => {
    const last = o.frames[o.frames.length - 1];
    if (last.t < t) {
      const f = { ...last, t };
      o.frames.push(f);
      return f;
    }
    return last;
  };
  const jump = (o, t, c, r, extra = {}) => {
    frame(o, t);
    const g = frame(o, t + 0.01);
    g.x = cx(c);
    g.y = cy(r);
    Object.assign(g, extra);
  };

  const pacStart = { c: 2, r: 3 };
  const pac = { c: pacStart.c, r: pacStart.r, dir: 0, frames: [{ t: 0, x: cx(pacStart.c), y: cy(pacStart.r), o: 1, rot: 0 }] };
  const homes = [
    { c: cols - 3, r: 1 },
    { c: cols - 3, r: 3 },
    { c: cols - 3, r: 5 },
  ];
  const ghosts = homes.map((h, id) => ({
    id,
    c: h.c,
    r: h.r,
    dir: 2,
    state: "alive",
    respawnAt: 0,
    color: GHOSTS[id],
    frames: [{ t: 0, x: cx(h.c), y: cy(h.r), o: 1, fill: GHOSTS[id] }],
  }));

  const bfs = (start, blocked) => {
    const dist = new Array(cols * rows).fill(-1);
    const first = new Array(cols * rows).fill(-1);
    const q = [start];
    dist[idx(start.c, start.r)] = 0;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      for (let d = 0; d < 4; d++) {
        const nc = cur.c + DIRS[d][0];
        const nr = cur.r + DIRS[d][1];
        if (!inb(nc, nr)) continue;
        const k = idx(nc, nr);
        if (dist[k] !== -1 || blocked[k]) continue;
        dist[k] = dist[idx(cur.c, cur.r)] + 1;
        first[k] = cur.c === start.c && cur.r === start.r ? d : first[idx(cur.c, cur.r)];
        q.push({ c: nc, r: nr });
      }
    }
    return { dist, first };
  };

  const pacChoose = (fright) => {
    const danger = ghosts.filter((g) => g.state === "alive" && fright === 0);
    const blocked = new Array(cols * rows).fill(false);
    for (const g of danger) {
      for (let dc = -2; dc <= 2; dc++) {
        for (let dr = -2; dr <= 2; dr++) {
          if (Math.abs(dc) + Math.abs(dr) > 2) continue;
          const c = g.c + dc;
          const r = g.r + dr;
          if (inb(c, r) && !(c === pac.c && r === pac.r)) blocked[idx(c, r)] = true;
        }
      }
    }
    const { dist, first } = bfs(pac, blocked);

    // hunt frightened ghosts that are close enough to catch
    if (fright > 0) {
      let best = null;
      for (const g of ghosts) {
        if (g.state !== "alive") continue;
        const d = dist[idx(g.c, g.r)];
        if (d > 0 && d <= 12 && d + 2 <= fright && (!best || d < best.d)) best = { d, k: idx(g.c, g.r) };
      }
      if (best) return first[best.k];
    }

    // otherwise: nearest dot (prefer a power pellet if a ghost is nearby)
    const ghostNear = danger.some((g) => man(g, pac) <= 8);
    let best = null;
    let bestP = null;
    for (const d of dots) {
      if (d.eatT !== null) continue;
      const k = idx(d.c, d.r);
      const dd = dist[k];
      if (dd <= 0) continue;
      if (!best || dd < best.dd) best = { dd, k };
      if (d.power && dd <= 14 && (!bestP || dd < bestP.dd)) bestP = { dd, k };
    }
    const pick = ghostNear && bestP ? bestP : best;
    if (pick) return first[pick.k];

    // trapped or nothing reachable: flee from the closest ghost
    let bestDir = 0;
    let bestScore = -Infinity;
    for (let d = 0; d < 4; d++) {
      const nc = pac.c + DIRS[d][0];
      const nr = pac.r + DIRS[d][1];
      if (!inb(nc, nr)) continue;
      const s = Math.min(...ghosts.filter((g) => g.state === "alive").map((g) => man(g, { c: nc, r: nr })), 99);
      if (s > bestScore) {
        bestScore = s;
        bestDir = d;
      }
    }
    return bestDir;
  };

  const ghostChoose = (g, fright) => {
    const opts = [];
    for (let d = 0; d < 4; d++) {
      const nc = g.c + DIRS[d][0];
      const nr = g.r + DIRS[d][1];
      if (inb(nc, nr)) opts.push({ d, c: nc, r: nr });
    }
    const noReverse = opts.filter((o) => o.d !== (g.dir + 2) % 4);
    const use = noReverse.length ? noReverse : opts;
    if (fright > 0) {
      if (rand() < 0.35) return use[Math.floor(rand() * use.length)];
      return use.reduce((a, b) => (man(b, pac) > man(a, pac) ? b : a));
    }
    let target = { c: pac.c, r: pac.r };
    if (g.id === 1) {
      target = {
        c: Math.min(cols - 1, Math.max(0, pac.c + DIRS[pac.dir][0] * 4)),
        r: Math.min(rows - 1, Math.max(0, pac.r + DIRS[pac.dir][1] * 4)),
      };
    } else if (g.id === 2 && man(g, pac) < 8) {
      target = { c: 0, r: rows - 1 };
    }
    if (rand() < 0.12) return use[Math.floor(rand() * use.length)];
    let best = use[0];
    let bd = Infinity;
    for (const o of use) {
      const d = (o.c - target.c) ** 2 + (o.r - target.r) ** 2 + rand() * 0.01;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };

  // pac eats the dot on its starting cell
  const startDot = dotAt[idx(pac.c, pac.r)];
  if (startDot >= 0) {
    dots[startDot].eatT = START_S;
    dotsLeft--;
  }

  let tNow = START_S;
  let tick = 0;
  let fright = 0;
  let deaths = 0;

  while (tick < MAX_TICKS && dotsLeft > 0) {
    const t0 = tNow;
    const t1 = t0 + TICK_S;

    // respawn eaten ghosts
    for (const g of ghosts) {
      if (g.state === "dead" && tick >= g.respawnAt) {
        g.state = "alive";
        g.c = homes[g.id].c;
        g.r = homes[g.id].r;
        g.dir = 2;
        jump(g, t0, g.c, g.r, { o: 1, fill: fright > 0 ? FRIGHT : g.color });
      }
    }

    // choose moves
    const pd = pacChoose(fright);
    const prevPac = { c: pac.c, r: pac.r };
    pac.dir = pd;
    pac.c += DIRS[pd][0];
    pac.r += DIRS[pd][1];
    frame(pac, t0).rot = pd * 90;
    {
      const f = frame(pac, t1);
      f.x = cx(pac.c);
      f.y = cy(pac.r);
    }

    const prevG = ghosts.map((g) => ({ c: g.c, r: g.r }));
    for (const g of ghosts) {
      if (g.state !== "alive") continue;
      const moves = fright > 0 ? tick % 2 === 0 : (tick + g.id) % 3 !== 0;
      if (!moves) continue;
      const o = ghostChoose(g, fright);
      g.c = o.c;
      g.r = o.r;
      g.dir = o.d;
      frame(g, t0);
      const f = frame(g, t1);
      f.x = cx(g.c);
      f.y = cy(g.r);
    }

    // eat
    const di = dotAt[idx(pac.c, pac.r)];
    if (di >= 0 && dots[di].eatT === null) {
      dots[di].eatT = t1;
      dotsLeft--;
      if (dots[di].power) {
        fright = FRIGHT_TICKS;
        for (const g of ghosts) if (g.state === "alive") frame(g, t1).fill = FRIGHT;
      }
    }

    // collisions
    let died = false;
    for (const g of ghosts) {
      if (g.state !== "alive") continue;
      const same = g.c === pac.c && g.r === pac.r;
      const swap = g.c === prevPac.c && g.r === prevPac.r && prevG[g.id].c === pac.c && prevG[g.id].r === pac.r;
      if (!same && !swap) continue;
      if (fright > 0) {
        g.state = "dead";
        g.respawnAt = tick + GHOST_RESPAWN_TICKS;
        frame(g, t1).o = 0;
      } else {
        died = true;
        break;
      }
    }

    if (fright > 0) {
      fright--;
      if (fright === 0) for (const g of ghosts) if (g.state === "alive") frame(g, t1).fill = g.color;
    }

    tNow = t1;
    tick++;

    if (died) {
      deaths++;
      frame(pac, t1).o = 0;
      tNow = t1 + DEATH_S;
      pac.c = pacStart.c;
      pac.r = pacStart.r;
      pac.dir = 0;
      jump(pac, tNow, pac.c, pac.r, { o: 1, rot: 0 });
      for (const g of ghosts) {
        g.state = "alive";
        g.c = homes[g.id].c;
        g.r = homes[g.id].r;
        g.dir = 2;
        jump(g, tNow, g.c, g.r, { o: 1, fill: g.color });
      }
      fright = 0;
      tNow += 0.6;
    }
  }

  const te = tNow;
  const T = +(te + END_HOLD_S).toFixed(3);
  for (const o of [pac, ...ghosts]) {
    frame(o, T);
    const eq = (a, b) => Math.abs(a - b) < 1e-6;
    o.frames = o.frames.filter((f, i, a) => {
      if (i === 0 || i === a.length - 1) return true;
      const p = a[i - 1];
      const n = a[i + 1];
      if (p.o !== f.o || n.o !== f.o || p.rot !== f.rot || n.rot !== f.rot || p.fill !== f.fill || n.fill !== f.fill) return true;
      const k1 = f.t - p.t;
      const k2 = n.t - f.t;
      return !(eq((f.x - p.x) * k2, (n.x - f.x) * k1) && eq((f.y - p.y) * k2, (n.y - f.y) * k1));
    });
  }

  return { dots, pac, ghosts, T, WIDTH, HEIGHT, eaten: dots.length - dotsLeft, deaths };
}

// ---------- svg ----------
const GHOST_BODY = "M0 12 V6 A6 6 0 0 1 12 6 V12 L10 9.8 L8 12 L6 9.8 L4 12 L2 9.8 Z";
const PAC_OPEN = "M0 0 L4.6 3.86 A6 6 0 1 1 4.6 -3.86 Z";
const PAC_SHUT = "M0 0 L5.99 0.31 A6 6 0 1 1 5.99 -0.31 Z";

function toSvg(calendar, sim, theme) {
  const pal = PALETTES[theme];
  const { dots, pac, ghosts, T, WIDTH, HEIGHT } = sim;
  const dur = `${T}s`;
  const f1 = (n) => +n.toFixed(1);
  const kt = (o) => o.frames.map((f) => +(f.t / T).toFixed(5)).join(";");
  const pos = (o) => o.frames.map((f) => `${f1(f.x)} ${f1(f.y)}`).join(";");
  const rep = `dur="${dur}" repeatCount="indefinite"`;

  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  out += `<title>Pac-Man eating my GitHub contribution graph</title>\n`;
  out += `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" fill="${pal.panel}" stroke="${pal.frame}"/>\n`;

  // empty cells of the real graph
  calendar.forEach((week, c) =>
    week.forEach((d, r) => {
      if (!d.exists) return;
      out += `<rect x="${PAD + c * PITCH_X}" y="${PAD + r * PITCH_Y}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[0]}"/>\n`;
    })
  );

  // dots (your contribution days) and power pellets (your biggest days)
  for (const d of dots) {
    const x = PAD + d.c * PITCH_X;
    const y = PAD + d.r * PITCH_Y;
    const shape = d.power
      ? `<circle cx="${x + CELL_W / 2}" cy="${y + CELL_H / 2}" r="${CELL_W / 2}" fill="${pal.levels[d.level]}" stroke="${pal.pellet}" stroke-width="1.5"`
      : `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" rx="2" fill="${pal.levels[d.level]}"`;
    const close = d.power ? "</circle>" : "</rect>";
    if (d.eatT === null) {
      out += shape + `/>\n`;
    } else {
      const f = +(d.eatT / T).toFixed(5);
      out += shape + `><animate attributeName="opacity" values="1;0;0" keyTimes="0;${f};1" calcMode="discrete" ${rep}/>${close}\n`;
    }
  }

  // ghosts
  for (const g of ghosts) {
    const fills = g.frames.map((f) => f.fill).join(";");
    out +=
      `<g transform="translate(${f1(g.frames[0].x)} ${f1(g.frames[0].y)})">` +
      `<animateTransform attributeName="transform" type="translate" values="${pos(g)}" keyTimes="${kt(g)}" ${rep}/>` +
      `<animate attributeName="opacity" values="${g.frames.map((f) => f.o).join(";")}" keyTimes="${kt(g)}" calcMode="discrete" ${rep}/>` +
      `<g transform="scale(${CHAR_SCALE}) translate(-6 -6)">` +
      `<path d="${GHOST_BODY}" fill="${g.frames[0].fill}"><animate attributeName="fill" values="${fills}" keyTimes="${kt(g)}" calcMode="discrete" ${rep}/></path>` +
      `<circle cx="4" cy="5.5" r="1.8" fill="#fff"/><circle cx="8" cy="5.5" r="1.8" fill="#fff"/>` +
      `<circle cx="4.5" cy="5.8" r="0.9" fill="#1f2a44"/><circle cx="8.5" cy="5.8" r="0.9" fill="#1f2a44"/>` +
      `</g></g>\n`;
  }

  // pac-man (rotation = direction, mouth chomps on its own short loop)
  out +=
    `<g transform="translate(${f1(pac.frames[0].x)} ${f1(pac.frames[0].y)})">` +
    `<animateTransform attributeName="transform" type="translate" values="${pos(pac)}" keyTimes="${kt(pac)}" ${rep}/>` +
    `<animate attributeName="opacity" values="${pac.frames.map((f) => f.o).join(";")}" keyTimes="${kt(pac)}" calcMode="discrete" ${rep}/>` +
    `<g>` +
    `<animateTransform attributeName="transform" type="rotate" values="${pac.frames.map((f) => f.rot).join(";")}" keyTimes="${kt(pac)}" calcMode="discrete" ${rep}/>` +
    `<path transform="scale(${CHAR_SCALE})" d="${PAC_OPEN}" fill="${PACMAN}" stroke="${pal.pacStroke}" stroke-width="0.8" stroke-linejoin="round"><animate attributeName="d" values="${PAC_OPEN};${PAC_SHUT};${PAC_OPEN}" dur="0.32s" repeatCount="indefinite"/></path>` +
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
  writeFileSync(`${OUT_DIR}/pacman-${theme}.svg`, svg);
  console.log(`${OUT_DIR}/pacman-${theme}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`${sim.eaten}/${sim.dots.length} dots eaten, ${sim.deaths} deaths, ${sim.T}s loop, ${sim.WIDTH}x${sim.HEIGHT}px`);
