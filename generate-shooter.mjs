#!/usr/bin/env node
// Doom-style first-person corridor shooter on your GitHub contribution graph -> animated SVG
// (pseudo-3D perspective, works inside a README <img>; no JavaScript needed on GitHub).
//
//  - Every day you contributed is an enemy. Its weekday decides which lane it walks down,
//    its contribution level decides its size, colour and health.
//  - One wave per week of your graph, left to right.
//  - The bottom HUD is your real heatmap; each kill lights the matching cell back up.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-shooter.mjs <github-username>
//   node generate-shooter.mjs --demo
//
// Output: dist/shooter.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const WIDTH = 808;
const HEIGHT = 260; // total height (view + HUD)
const HUD_H = 42;
const HALL_HALF_W = 3.6; // hall half width in world units
const CYCLE_S = 1.2; // seconds for the hall to scroll by one segment (camera speed)
const SEG = 1.5; // length of one hall segment (world units)

const WAVE_S = 1.0; // seconds between weekly waves (auto-compressed for long graphs)
const MAX_ENEMIES = 170; // cap for file size (keeps the highest-level days)
const FIRE_S = 0.16; // seconds between shots
const RANGE = 10; // shooting range (world units)
const Z_SPAWN = 15;
const Z_HURT = 1.5; // enemy that gets this close hurts you
const START_S = 1.0;
const END_HOLD_S = 2.0;
const MAX_TIME_S = 85;

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};
const HUD_LEVELS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]; // GitHub dark heatmap
const MOB_COLOR = [null, "#2ea043", "#3fb950", "#56d364", "#7ee787"];
const MOB_H = [0, 0.9, 1.0, 1.1, 1.25]; // world height by level
const MOB_HP = [0, 1, 1, 2, 3];

// ---------- derived layout ----------
const VH = HEIGHT - HUD_H;
const CX = WIDTH / 2;
const CY = VH * 0.5;
const F = VH * 0.48; // focal length in px
const SPRITE_H = 60;

// ---------- data ----------
async function fetchCalendar(user, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "readme-shooter",
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
const zAt = (e, t) => e.z0 - e.vz * (t - e.spawnT);
const xAt = (e, t) => e.X + e.amp * Math.sin(e.ph + 1.2 * (t - e.spawnT));
const proj = (e, t) => {
  const z = Math.max(0.3, zAt(e, t));
  const k = F / z;
  return { x: CX + xAt(e, t) * k, y: CY + k * (1 - MOB_H[e.level] / 2), floorY: CY + k, s: (k * MOB_H[e.level]) / SPRITE_H, k, z };
};

function simulate(calendar) {
  const cols = calendar.length;
  let seed = 0x811c9dc5;
  calendar.forEach((w, i) =>
    w.forEach((d, j) => {
      seed = (Math.imul(seed ^ (d.count + 1), 0x01000193) + i * 7 + j) >>> 0;
    })
  );
  const rand = mulberry32(seed);

  // one wave per week that has contributions
  const waves = [];
  for (let c = 0; c < cols; c++) {
    const rows = [];
    for (let r = 0; r < 7; r++) if (calendar[c][r].exists && calendar[c][r].level > 0) rows.push(r);
    if (rows.length) waves.push({ c, rows });
  }
  const waveS = Math.min(WAVE_S, 52 / Math.max(1, waves.length));

  let enemies = [];
  waves.forEach((w, wi) => {
    const waveT = START_S + wi * waveS;
    for (const r of w.rows) {
      const d = calendar[w.c][r];
      enemies.push({
        c: w.c, r, level: d.level, count: d.count,
        spawnT: waveT + rand() * 0.3,
        z0: Z_SPAWN + rand() * 0.8,
        vz: 1.5 + 0.18 * d.level + rand() * 0.15,
        hp: MOB_HP[d.level],
        X: (r - 3) * 0.95, // weekday = lane
        amp: d.level >= 3 ? 0.22 : 0,
        ph: rand() * 6.28,
        dead: false, hurt: false, deathT: null, deathZ: null, skipped: false, litT: null,
      });
    }
  });
  if (enemies.length > MAX_ENEMIES) {
    const keep = new Set([...enemies].sort((a, b) => b.level - a.level || b.count - a.count).slice(0, MAX_ENEMIES));
    enemies.forEach((e) => {
      if (!keep.has(e)) {
        e.skipped = true;
        e.litT = e.spawnT;
      }
    });
  }
  const active = enemies.filter((e) => !e.skipped);

  const DT = 1 / 120;
  let t = 0;
  let nextShot = START_S;
  const shots = [];
  const hurts = [];
  const lastSpawn = Math.max(...active.map((e) => e.spawnT), 0);

  while (t < MAX_TIME_S) {
    t += DT;
    for (const e of active) {
      if (!e.dead && t >= e.spawnT && zAt(e, t) <= Z_HURT) {
        e.dead = true;
        e.hurt = true;
        e.deathT = t;
        e.deathZ = Z_HURT;
        hurts.push(t);
      }
    }
    if (t >= nextShot) {
      let target = null;
      let tz = Infinity;
      for (const e of active) {
        if (e.dead || t < e.spawnT) continue;
        const z = zAt(e, t);
        if (z <= RANGE && z < tz) {
          target = e;
          tz = z;
        }
      }
      if (target) {
        const p = proj(target, t);
        shots.push({ t, x: p.x, y: p.y });
        target.hp--;
        if (target.hp <= 0) {
          target.dead = true;
          target.deathT = t;
          target.deathZ = tz;
        }
        nextShot = t + FIRE_S;
      }
    }
    if (t > lastSpawn && active.every((e) => e.dead)) break;
  }
  for (const e of active) {
    if (!e.dead) {
      e.dead = true;
      e.deathT = t;
      e.deathZ = zAt(e, t);
      e.silent = true;
    }
  }
  for (const e of enemies) if (!e.skipped) e.litT = e.deathT;

  const T = +(Math.max(...active.map((e) => e.deathT), t) + END_HOLD_S).toFixed(3);
  return { enemies, active, shots, hurts, T, cols, kills: active.filter((e) => !e.hurt && !e.silent).length };
}

// ---------- svg helpers ----------
const f1 = (n) => +n.toFixed(1);
const f2 = (n) => +n.toFixed(2);
const fk = (v) => +v.toFixed(5);

// scrolling hall segments (animated with SMIL path keyframes, one loop = one segment)
const PH = 16;
const ZMIN = 0.8;
const K = 11;
const zOf = (k, phase) => Math.max(0.3, ZMIN + (k - phase) * SEG);
function anim(fn) {
  const vals = [];
  for (let i = 0; i <= PH; i++) vals.push(fn(i / PH));
  return `<animate attributeName="d" values="${vals.join(";")}" dur="${CYCLE_S}s" repeatCount="indefinite"/>`;
}
const P = (x, y) => `${f1(x)} ${f1(y)}`;
const floorQuad = (za, zb) => `M${P(CX - HALL_HALF_W * F / za, CY + F / za)}L${P(CX + HALL_HALF_W * F / za, CY + F / za)}L${P(CX + HALL_HALF_W * F / zb, CY + F / zb)}L${P(CX - HALL_HALF_W * F / zb, CY + F / zb)}Z`;
const ceilQuad = (za, zb, hw) => `M${P(CX - hw * F / za, CY - F / za)}L${P(CX + hw * F / za, CY - F / za)}L${P(CX + hw * F / zb, CY - F / zb)}L${P(CX - hw * F / zb, CY - F / zb)}Z`;
const wallQuad = (side, za, zb, inset) => {
  const x = (z) => CX + side * HALL_HALF_W * F / z;
  return `M${P(x(za), CY - inset * F / za)}L${P(x(za), CY + inset * F / za)}L${P(x(zb), CY + inset * F / zb)}L${P(x(zb), CY - inset * F / zb)}Z`;
};

const SPRITE = `
<g id="mob">
  <ellipse cx="0" cy="0" rx="22" ry="5" fill="#000" opacity="0.4"/>
  <ellipse cx="-24" cy="-20" rx="5" ry="10" transform="rotate(14 -24 -20)"/>
  <ellipse cx="24" cy="-20" rx="5" ry="10" transform="rotate(-14 24 -20)"/>
  <path d="M-20 0 C-27 -20 -20 -48 0 -50 C20 -48 27 -20 20 0 Z"/>
  <path d="M-20 0 C-22 -10 -20 -17 0 -17 C20 -17 22 -10 20 0 Z" fill="#000" opacity="0.25"/>
  <ellipse cx="0" cy="-26" rx="12" ry="14" fill="#fff" opacity="0.1"/>
  <path d="M-14 -44 L-24 -60 L-6 -48 Z M14 -44 L24 -60 L6 -48 Z" fill="#1b1f27"/>
  <ellipse cx="-8" cy="-33" rx="5.5" ry="3.6" fill="#ff2d2d"/>
  <ellipse cx="8" cy="-33" rx="5.5" ry="3.6" fill="#ff2d2d"/>
  <circle cx="-9.2" cy="-33.8" r="1.1" fill="#fff"/><circle cx="6.8" cy="-33.8" r="1.1" fill="#fff"/>
  <path d="M-11 -18 Q0 -8 11 -18 Q0 -14 -11 -18 Z" fill="#240000"/>
  <path d="M-6 -16 l2 4 l2 -4 Z M2 -16 l2 4 l2 -4 Z" fill="#fff"/>
</g>`;

function toSvg(calendar, sim) {
  const { enemies, active, shots, hurts, T } = sim;
  const rep = `dur="${T}s" repeatCount="indefinite"`;
  const muzzleY = VH - 66;
  const tk = (arr) => arr.map((t) => fk(t / T)).join(";");

  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  o += `<title>Doom-style shooter fighting my GitHub contribution graph</title>\n`;
  o += `<defs>
<clipPath id="screen"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="6"/></clipPath>
<linearGradient id="floor" x1="0" y1="${CY}" x2="0" y2="${VH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0b0f16"/><stop offset="1" stop-color="#262d3a"/></linearGradient>
<linearGradient id="ceil" x1="0" y1="${CY}" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0b0f16"/><stop offset="1" stop-color="#1a202b"/></linearGradient>
<linearGradient id="wallL" x1="0" y1="0" x2="${CX}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2b3547"/><stop offset="1" stop-color="#0d1118"/></linearGradient>
<linearGradient id="wallR" x1="${WIDTH}" y1="0" x2="${CX}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2b3547"/><stop offset="1" stop-color="#0d1118"/></linearGradient>
<radialGradient id="portal"><stop offset="0" stop-color="#b6ffc4"/><stop offset="0.35" stop-color="#39d353" stop-opacity="0.8"/><stop offset="1" stop-color="#39d353" stop-opacity="0"/></radialGradient>
<radialGradient id="boom"><stop offset="0" stop-color="#fffbe0"/><stop offset="0.3" stop-color="#ffd24a"/><stop offset="0.65" stop-color="#ff7a1a" stop-opacity="0.9"/><stop offset="1" stop-color="#ff3b1a" stop-opacity="0"/></radialGradient>
<radialGradient id="flash"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#ffe27a"/><stop offset="1" stop-color="#ff9d1a" stop-opacity="0"/></radialGradient>
<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a303b"/><stop offset="0.5" stop-color="#8a93a3"/><stop offset="1" stop-color="#2a303b"/></linearGradient>
${SPRITE}
</defs>\n`;
  o += `<g clip-path="url(#screen)">\n`;

  // ----- hall -----
  const zf = 18;
  const zn = 0.4;
  const wx = (side, z) => CX + side * HALL_HALF_W * F / z;
  o += `<rect width="${WIDTH}" height="${VH}" fill="#0b0f16"/>\n`;
  o += `<path d="M${P(wx(-1, zn), CY - F / zn)}L${P(wx(-1, zf), CY - F / zf)}L${P(wx(-1, zf), CY + F / zf)}L${P(wx(-1, zn), CY + F / zn)}Z" fill="url(#wallL)"/>\n`;
  o += `<path d="M${P(wx(1, zn), CY - F / zn)}L${P(wx(1, zf), CY - F / zf)}L${P(wx(1, zf), CY + F / zf)}L${P(wx(1, zn), CY + F / zn)}Z" fill="url(#wallR)"/>\n`;
  o += `<path d="M${P(wx(-1, zn), CY + F / zn)}L${P(wx(-1, zf), CY + F / zf)}L${P(wx(1, zf), CY + F / zf)}L${P(wx(1, zn), CY + F / zn)}Z" fill="url(#floor)"/>\n`;
  o += `<path d="M${P(wx(-1, zn), CY - F / zn)}L${P(wx(-1, zf), CY - F / zf)}L${P(wx(1, zf), CY - F / zf)}L${P(wx(1, zn), CY - F / zn)}Z" fill="url(#ceil)"/>\n`;

  // far end: glowing portal
  o += `<ellipse cx="${CX}" cy="${CY}" rx="46" ry="30" fill="url(#portal)"/>\n`;
  o += `<rect x="${f1(CX - HALL_HALF_W * F / zf * 0.5)}" y="${f1(CY - F / zf * 0.8)}" width="${f1(HALL_HALF_W * F / zf)}" height="${f1(F / zf * 1.6)}" fill="#0d3b1a" opacity="0.9"/>\n`;

  // animated, scrolling segments (far to near so near ones draw on top)
  for (let k = K; k >= 0; k--) {
    const za = (p) => zOf(k, p);
    const half = 0.55 * SEG;
    o += `<path fill="#2e3748" opacity="0.55" d="${floorQuad(za(0), za(0) + half)}">${anim((p) => floorQuad(za(p), za(p) + half))}</path>\n`;
    o += `<path fill="#1d2430" d="${wallQuad(-1, za(0), za(0) + half, 0.8)}">${anim((p) => wallQuad(-1, za(p), za(p) + half, 0.8))}</path>\n`;
    o += `<path fill="#1d2430" d="${wallQuad(1, za(0), za(0) + half, 0.8)}">${anim((p) => wallQuad(1, za(p), za(p) + half, 0.8))}</path>\n`;
    o += `<path fill="#39d353" opacity="0.9" d="${wallQuad(-1, za(0), za(0) + 0.07 * SEG, 0.95)}">${anim((p) => wallQuad(-1, za(p), za(p) + 0.07 * SEG, 0.95))}</path>\n`;
    o += `<path fill="#39d353" opacity="0.9" d="${wallQuad(1, za(0), za(0) + 0.07 * SEG, 0.95)}">${anim((p) => wallQuad(1, za(p), za(p) + 0.07 * SEG, 0.95))}</path>\n`;
    o += `<path fill="#d7ffe0" opacity="0.85" d="${ceilQuad(za(0), za(0) + 0.3 * SEG, 1.1)}">${anim((p) => ceilQuad(za(p), za(p) + 0.3 * SEG, 1.1))}</path>\n`;
  }

  // ----- enemies (far ones first) -----
  const order = [...active].sort((a, b) => b.deathZ - a.deathZ);
  for (const e of order) {
    const times = [0, e.spawnT];
    const pos = [];
    const scl = [];
    const p0 = proj(e, e.spawnT);
    pos.push(P(p0.x, p0.floorY), P(p0.x, p0.floorY));
    scl.push(f2(p0.s), f2(p0.s));
    let last = p0;
    for (let t = e.spawnT + 0.05; t < e.deathT - 0.02; t += 0.05) {
      const p = proj(e, t);
      if (Math.abs(1 / p.z - 1 / last.z) >= 0.05 || Math.abs(p.x - last.x) >= 6 || t - times[times.length - 1] >= 0.5) {
        times.push(t);
        pos.push(P(p.x, p.floorY));
        scl.push(f2(p.s));
        last = p;
      }
    }
    const pe = proj(e, e.deathT);
    times.push(e.deathT, T);
    pos.push(P(pe.x, pe.floorY), P(pe.x, pe.floorY));
    scl.push(f2(pe.s), f2(pe.s));
    const kt = tk(times);
    o +=
      `<g opacity="0" transform="translate(${pos[0]})">` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="${fk(0)};${fk(e.spawnT / T)};${fk(e.deathT / T)};1" calcMode="discrete" ${rep}/>` +
      `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="scale(${scl[0]})"><animateTransform attributeName="transform" type="scale" values="${scl.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<use href="#mob" fill="${MOB_COLOR[e.level]}"/></g></g>\n`;
  }

  // ----- explosions -----
  for (const e of active) {
    if (e.silent) continue;
    const p = proj(e, e.deathT);
    const R = Math.max(9, p.k * MOB_H[e.level] * 0.95);
    const a = fk(e.deathT / T);
    const b = fk(Math.min(0.9999, (e.deathT + 0.4) / T));
    o +=
      `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="0" fill="url(#boom)" opacity="0">` +
      `<animate attributeName="r" values="0;0;${f1(R)};${f1(R)}" keyTimes="0;${a};${b};1" ${rep}/>` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${a};${b};1" ${rep}/></circle>\n`;
  }

  // ----- tracer + crosshair + gun -----
  if (shots.length) {
    const tt = [0];
    const xs = [shots[0].x];
    const ys = [shots[0].y];
    const on = [0];
    for (const s of shots) {
      tt.push(s.t, s.t + 0.07);
      xs.push(s.x, s.x);
      ys.push(s.y, s.y);
      on.push(1, 0);
    }
    tt.push(T);
    xs.push(xs[xs.length - 1]);
    ys.push(ys[ys.length - 1]);
    on.push(0);
    const kt = tk(tt);
    o +=
      `<line x1="${CX}" y1="${muzzleY}" x2="${f1(xs[0])}" y2="${f1(ys[0])}" stroke="#d9ffc9" stroke-width="2" stroke-linecap="round" opacity="0">` +
      `<animate attributeName="x2" values="${xs.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="y2" values="${ys.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="opacity" values="${on.join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></line>\n`;

    // crosshair glides to each target
    const ct = [0, ...shots.map((s) => s.t), T];
    const cp = [P(CX, CY), ...shots.map((s) => P(s.x, s.y)), P(shots[shots.length - 1].x, shots[shots.length - 1].y)];
    o +=
      `<g transform="translate(${cp[0]})"><animateTransform attributeName="transform" type="translate" values="${cp.join(";")}" keyTimes="${tk(ct)}" ${rep}/>` +
      `<circle r="9" fill="none" stroke="#7ee787" stroke-width="1.4" opacity="0.9"/>` +
      `<path d="M-14 0H-5M5 0H14M0 -14V-5M0 5V14" stroke="#7ee787" stroke-width="1.4"/></g>\n`;
  }

  // gun with recoil
  const rt = [0];
  const rv = ["0 0"];
  for (const s of shots) {
    rt.push(s.t, s.t + 0.04, s.t + 0.14);
    rv.push("0 0", "0 5", "0 0");
  }
  rt.push(T);
  rv.push("0 0");
  const gunBody =
    `<ellipse cx="${CX - 36}" cy="${VH - 4}" rx="17" ry="10" fill="#202733"/><ellipse cx="${CX + 36}" cy="${VH - 4}" rx="17" ry="10" fill="#202733"/>` +
    `<path d="M${CX - 8} ${VH - 64}H${CX + 8}L${CX + 17} ${VH - 18}H${CX - 17}Z" fill="url(#metal)"/>` +
    `<ellipse cx="${CX}" cy="${VH - 64}" rx="8" ry="2.6" fill="#0a0d12"/>` +
    `<rect x="${CX - 24}" y="${VH - 26}" width="48" height="28" rx="5" fill="#2a303b" stroke="#454d5c"/>` +
    `<rect x="${CX - 18}" y="${VH - 20}" width="36" height="4" rx="2" fill="#39d353"/>` +
    `<rect x="${CX - 2}" y="${VH - 72}" width="4" height="9" fill="#cfd6e4"/>`;
  o += shots.length
    ? `<g><animateTransform attributeName="transform" type="translate" values="${rv.join(";")}" keyTimes="${tk(rt)}" ${rep}/>${gunBody}</g>\n`
    : `<g>${gunBody}</g>\n`;

  // muzzle flash + screen flash
  if (shots.length) {
    const ft = [0];
    const fv = [0];
    for (const s of shots) {
      ft.push(s.t, s.t + 0.06);
      fv.push(1, 0);
    }
    ft.push(T);
    fv.push(0);
    const kt = tk(ft);
    o +=
      `<g transform="translate(${CX} ${muzzleY})" opacity="0"><animate attributeName="opacity" values="${fv.join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<circle r="26" fill="url(#flash)"/>` +
      `<path d="M0 -30L5 -8L24 -14L9 0L26 12L6 8L0 28L-6 8L-26 12L-9 0L-24 -14L-5 -8Z" fill="#fff6c2" opacity="0.95"/></g>\n`;
    o +=
      `<rect width="${WIDTH}" height="${VH}" fill="#fff" opacity="0"><animate attributeName="opacity" values="${fv.map((v) => v * 0.06).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></rect>\n`;
  }

  // damage flash if something ever reaches you
  if (hurts.length) {
    const ht = [0];
    const hv = [0];
    for (const h of hurts) {
      ht.push(h, h + 0.3);
      hv.push(0.35, 0);
    }
    ht.push(T);
    hv.push(0);
    o += `<rect width="${WIDTH}" height="${VH}" fill="#ff1a1a" opacity="0"><animate attributeName="opacity" values="${hv.join(";")}" keyTimes="${tk(ht)}" calcMode="discrete" ${rep}/></rect>\n`;
  }

  o += `<rect width="${WIDTH}" height="${VH}" fill="url(#vignette)"/>\n`;

  // ----- HUD: your heatmap, lit up kill by kill -----
  o += `<rect x="0" y="${VH}" width="${WIDTH}" height="${HUD_H}" fill="#0a0e14"/>\n<rect x="0" y="${VH}" width="${WIDTH}" height="1.5" fill="#39d353" opacity="0.7"/>\n`;
  const hx0 = 8;
  const pitchX = (WIDTH - 16) / sim.cols;
  const cellW = pitchX - 2;
  const hy0 = VH + 6;
  const litByCell = new Map(enemies.map((e) => [`${e.c},${e.r}`, e.litT]));
  calendar.forEach((week, c) =>
    week.forEach((d, r) => {
      if (!d.exists) return;
      const x = f1(hx0 + c * pitchX);
      const y = hy0 + r * 5;
      if (d.level === 0) {
        o += `<rect x="${x}" y="${y}" width="${f1(cellW)}" height="4" rx="1" fill="${HUD_LEVELS[0]}"/>\n`;
        return;
      }
      const lt = litByCell.get(`${c},${r}`);
      o +=
        `<rect x="${x}" y="${y}" width="${f1(cellW)}" height="4" rx="1" fill="${HUD_LEVELS[d.level]}" opacity="0.22">` +
        (lt != null ? `<animate attributeName="opacity" values="0.22;1;1" keyTimes="0;${fk(lt / T)};1" calcMode="discrete" ${rep}/>` : "") +
        `</rect>\n`;
    })
  );

  o += `</g>\n<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" fill="none" stroke="#30363d"/>\n</svg>\n`;
  return o;
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
const svg = toSvg(calendar, sim);
writeFileSync(`${OUT_DIR}/shooter.svg`, svg);
console.log(`${OUT_DIR}/shooter.svg  ${(svg.length / 1024).toFixed(0)} KB`);
console.log(`${sim.active.length} enemies (${sim.enemies.length - sim.active.length} skipped), ${sim.kills} killed, ${sim.hurts.length} reached you, ${sim.shots.length} shots, ${sim.T}s loop, ${WIDTH}x${HEIGHT}px`);
