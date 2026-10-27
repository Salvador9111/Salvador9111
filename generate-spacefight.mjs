#!/usr/bin/env node
// Space dogfight -> animated SVG (pseudo-3D starfield flight). Works inside a GitHub README <img>.
// An auto-piloted fighter banks through a streaking starfield, locks onto enemy fighters,
// fires twin lasers, dodges incoming bolts and blows ships up.
//
// Usage:  node generate-spacefight.mjs        ->  ./spacefight.svg
//         OUT=assets/spacefight.svg SEED=7 node generate-spacefight.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------- config ----------
const OUT = process.env.OUT || "spacefight.svg";
const SEED = Number(process.env.SEED || 0x5eed);
const WIDTH = 808;
const HEIGHT = 260;

const ENEMY_COUNT = 34;
const SPAWN_GAP_S = 1.55; // average seconds between enemy groups
const FIRE_S = 0.26; // seconds between player shots (higher = slower)
const RANGE = 18; // lock-on / firing range (world units); lower = enemies get closer and bigger
const Z_SPAWN = 46;
const Z_RAM = 4.5; // an enemy this close rams you
const BOLT_V = 26; // enemy bolt speed (units/s)
const STAR_COUNT = 120;
const START_S = 1.0;
const END_HOLD_S = 2.2;
const MAX_TIME_S = 100;
const SHIP_SCALE = 1.0;

const TYPES = {
  raider: { span: 3.2, hp: 2, v: [6.5, 8.0], color: "#ff4d4d", bolts: [1, 2] },
  striker: { span: 2.4, hp: 1, v: [9.0, 10.5], color: "#b46bff", bolts: [1, 1] },
  elite: { span: 4.2, hp: 4, v: [5.0, 6.0], color: "#ffb02e", bolts: [2, 3] },
};

// ---------- layout ----------
const CX = WIDTH / 2;
const CY = HEIGHT * 0.46;
const F = HEIGHT * 0.8;
const SHIP_Y = HEIGHT - 54;
const GUN_DX = 58 * SHIP_SCALE;
const GUN_DY = 14 * SHIP_SCALE;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- simulation ----------
const zAt = (e, t) => e.z0 - e.vz * (t - e.spawnT);
const worldXY = (e, t) => {
  const u = t - e.spawnT;
  return { X: e.X0 + e.ax * Math.sin(e.wx * u + e.px), Y: e.Y0 + e.ay * Math.sin(e.wy * u + e.py) };
};
const proj = (e, t) => {
  const z = Math.max(1.5, zAt(e, t));
  const { X, Y } = worldXY(e, t);
  const k = F / z;
  const x = CX + X * k;
  const y = CY + Y * k;
  return { x, y, s: (k * e.span) / 100, k, z, px: (k * e.span) };
};

function simulate() {
  const rand = mulberry32(SEED);

  // ----- enemies -----
  const enemies = [];
  let t = START_S;
  while (enemies.length < ENEMY_COUNT) {
    const group = 1 + (rand() < 0.4 ? 1 : 0) + (rand() < 0.12 ? 1 : 0);
    for (let g = 0; g < group && enemies.length < ENEMY_COUNT; g++) {
      const r = rand();
      const type = r < 0.18 ? "elite" : r < 0.4 ? "striker" : "raider";
      const ty = TYPES[type];
      enemies.push({
        type, span: ty.span, hp: ty.hp, color: ty.color,
        X0: (rand() * 2 - 1) * 11, Y0: (rand() * 2 - 1) * 3.2,
        ax: 1 + rand() * 1.8, ay: 0.5 + rand() * 1.0,
        wx: 0.8 + rand() * 1.0, wy: 0.7 + rand() * 1.1,
        px: rand() * 6.28, py: rand() * 6.28,
        spawnT: t + rand() * 0.4,
        z0: Z_SPAWN + rand() * 2,
        vz: ty.v[0] + rand() * (ty.v[1] - ty.v[0]),
        dead: false, rammed: false, silent: false, deathT: null, deathZ: null,
      });
    }
    t += SPAWN_GAP_S * (0.7 + rand() * 0.6);
  }

  // ----- main loop: targeting, shooting, ship motion -----
  const DT = 1 / 120;
  let now = 0;
  let nextShot = START_S;
  let gun = 0;
  let xp = 0;
  let vp = 0;
  const lastSpawn = Math.max(...enemies.map((e) => e.spawnT));
  const shots = []; // {t, gun, x, y, ex, ey, killed, e}
  const ramHits = [];
  const shipTrack = []; // per step {xp, vp, target}
  let target = null;

  while (now < MAX_TIME_S) {
    now += DT;
    for (const e of enemies) {
      if (!e.dead && now >= e.spawnT && zAt(e, now) <= Z_RAM) {
        e.dead = true; e.rammed = true; e.deathT = now; e.deathZ = Z_RAM;
        ramHits.push(now);
      }
    }
    // pick nearest enemy in range
    target = null;
    let tz = Infinity;
    for (const e of enemies) {
      if (e.dead || now < e.spawnT) continue;
      const z = zAt(e, now);
      if (z <= RANGE && z < tz) { target = e; tz = z; }
    }
    // ship follows the target (spring) with a gentle sway
    const tx = target ? clamp((proj(target, now).x - CX) * 0.45, -170, 170) : Math.sin(now * 0.9) * 40;
    const sway = Math.sin(now * 1.3) * 10;
    vp += (18 * (tx + sway - xp) - 6 * vp) * DT;
    xp += vp * DT;
    shipTrack.push({ xp, vp, target: target ? { ...proj(target, now), e: target } : null });

    if (target && now >= nextShot) {
      const p = proj(target, now);
      const side = gun % 2 === 0 ? -1 : 1;
      gun++;
      const killed = target.hp - 1 <= 0;
      shots.push({
        t: now, side, gx: CX + xp + side * GUN_DX, gy: SHIP_Y + GUN_DY,
        ex: p.x, ey: p.y, killed, e: target,
      });
      target.hp--;
      if (killed) { target.dead = true; target.deathT = now + 0.11; target.deathZ = zAt(target, now + 0.11); }
      nextShot = now + FIRE_S;
    }
    if (now > lastSpawn && enemies.every((e) => e.dead)) break;
  }
  for (const e of enemies) {
    if (!e.dead) { e.dead = true; e.deathT = now; e.deathZ = zAt(e, now); e.silent = true; }
  }
  const shipAt = (tt) => shipTrack[clamp(Math.round(tt / DT) - 1, 0, shipTrack.length - 1)];

  // ----- enemy bolts (planned after the ship track is known) -----
  const bolts = [];
  let boltCounter = 0;
  for (const e of enemies) {
    if (e.silent) continue;
    const ty = TYPES[e.type];
    const n = ty.bolts[0] + Math.floor(rand() * (ty.bolts[1] - ty.bolts[0] + 1));
    if (rand() < 0.2) continue;
    const zFire = 31 - rand() * 5;
    let tf = e.spawnT + (e.z0 - zFire) / e.vz;
    for (let i = 0; i < n; i++, tf += 0.55) {
      if (tf >= e.deathT - 0.2) break;
      const z = zAt(e, tf);
      if (z < 9) break;
      const tau = (z - 2.5) / BOLT_V;
      const arrive = tf + tau;
      const hit = ++boltCounter % 4 === 0;
      const sp = shipAt(arrive);
      const off = hit ? 0 : (rand() < 0.5 ? -1 : 1) * (45 + rand() * 55);
      const tx = CX + sp.xp + off;
      const ty2 = SHIP_Y - 6;
      const { X, Y } = worldXY(e, tf);
      const Xt = ((tx - CX) * 2.5) / F;
      const Yt = ((ty2 - CY) * 2.5) / F;
      const frames = [];
      const steps = 9;
      for (let s = 0; s <= steps + 3; s++) {
        const a = s <= steps ? s / steps : [0.93, 0.97, 1.0][s - steps - 1];
        const aa = s <= steps ? a * 0.9 : a; // sample densely near the end
        const zb = z - BOLT_V * tau * aa;
        const k = F / Math.max(2.5, zb);
        const Xb = X + (Xt - X) * aa;
        const Yb = Y + (Yt - Y) * aa;
        frames.push({ t: tf + tau * aa, x: CX + Xb * k, y: CY + Yb * k, r: clamp(0.3 * k, 1.4, 15) });
      }
      frames.sort((p, q) => p.t - q.t);
      bolts.push({ t0: tf, t1: arrive, frames, hit });
    }
  }
  const hits = [...ramHits, ...bolts.filter((b) => b.hit).map((b) => b.t1)].sort((a, b) => a - b);

  const T = +(Math.max(...enemies.map((e) => e.deathT), ...bolts.map((b) => b.t1), now) + END_HOLD_S).toFixed(3);
  return { enemies, shots, bolts, hits, ramHits, shipTrack, T, DT, kills: enemies.filter((e) => !e.rammed && !e.silent).length };
}

// ---------- svg helpers ----------
const f1 = (n) => +n.toFixed(1);
const f2 = (n) => +n.toFixed(2);
const fk = (v) => +v.toFixed(5);
const P = (x, y) => `${f1(x)} ${f1(y)}`;

const ARTWORK = `
<linearGradient id="hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d1e0"/><stop offset="0.5" stop-color="#7c8699"/><stop offset="1" stop-color="#363c49"/></linearGradient>
<linearGradient id="hullD" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#58606f"/><stop offset="1" stop-color="#1c2029"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9fbff"/><stop offset="0.4" stop-color="#5fc8ff"/><stop offset="1" stop-color="#12466e"/></linearGradient>
<radialGradient id="engine"><stop offset="0" stop-color="#fff"/><stop offset="0.3" stop-color="#9fe3ff"/><stop offset="0.7" stop-color="#2f8cff" stop-opacity="0.8"/><stop offset="1" stop-color="#2f8cff" stop-opacity="0"/></radialGradient>
<radialGradient id="redbolt"><stop offset="0" stop-color="#fff"/><stop offset="0.25" stop-color="#ffd0c0"/><stop offset="0.55" stop-color="#ff3b2f"/><stop offset="1" stop-color="#ff3b2f" stop-opacity="0"/></radialGradient>
<radialGradient id="fire"><stop offset="0" stop-color="#fffbe0"/><stop offset="0.3" stop-color="#ffd24a"/><stop offset="0.65" stop-color="#ff6a1a" stop-opacity="0.9"/><stop offset="1" stop-color="#ff3b1a" stop-opacity="0"/></radialGradient>
<radialGradient id="smoke"><stop offset="0" stop-color="#2b2b33" stop-opacity="0.8"/><stop offset="1" stop-color="#2b2b33" stop-opacity="0"/></radialGradient>
<radialGradient id="shield"><stop offset="0.55" stop-color="#6ad0ff" stop-opacity="0"/><stop offset="0.9" stop-color="#6ad0ff" stop-opacity="0.75"/><stop offset="1" stop-color="#bdeaff" stop-opacity="0.2"/></radialGradient>
<radialGradient id="spark"><stop offset="0" stop-color="#fff"/><stop offset="0.4" stop-color="#9bffb0"/><stop offset="1" stop-color="#39d353" stop-opacity="0"/></radialGradient>
<radialGradient id="nebA"><stop offset="0" stop-color="#7a35ff" stop-opacity="0.5"/><stop offset="1" stop-color="#7a35ff" stop-opacity="0"/></radialGradient>
<radialGradient id="nebB"><stop offset="0" stop-color="#00b7ff" stop-opacity="0.38"/><stop offset="1" stop-color="#00b7ff" stop-opacity="0"/></radialGradient>
<radialGradient id="nebC"><stop offset="0" stop-color="#ff3d9a" stop-opacity="0.32"/><stop offset="1" stop-color="#ff3d9a" stop-opacity="0"/></radialGradient>
<radialGradient id="planet" cx="0.32" cy="0.3" r="0.85"><stop offset="0" stop-color="#ffd9a0"/><stop offset="0.35" stop-color="#d98a4a"/><stop offset="0.75" stop-color="#7a3a22"/><stop offset="1" stop-color="#1a0c0a"/></radialGradient>
<radialGradient id="atmo" cx="0.5" cy="0.5" r="0.5"><stop offset="0.9" stop-color="#ff9d5a" stop-opacity="0.5"/><stop offset="1" stop-color="#ff9d5a" stop-opacity="0"/></radialGradient>
<radialGradient id="moon" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#f2f4f8"/><stop offset="0.6" stop-color="#8d95a6"/><stop offset="1" stop-color="#2a2e38"/></radialGradient>
<radialGradient id="sun"><stop offset="0" stop-color="#fff"/><stop offset="0.15" stop-color="#fff4d0" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd88a" stop-opacity="0"/></radialGradient>
<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
<linearGradient id="laser" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#39d353" stop-opacity="0"/><stop offset="1" stop-color="#d9ffe0"/></linearGradient>
<clipPath id="screen"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="6"/></clipPath>
<clipPath id="planetClip"><circle cx="${f1(WIDTH * 0.8)}" cy="${f1(HEIGHT * 0.86)}" r="100"/></clipPath>

<g id="enemy">
  <path d="M-5 0 L-47 12 L-43 25 L-7 16 Z" fill="url(#hull)"/>
  <path d="M5 0 L47 12 L43 25 L7 16 Z" fill="url(#hull)"/>
  <path d="M-7 16 L-43 25 L-41 20 L-7 11 Z" fill="#000" opacity="0.32"/>
  <path d="M7 16 L43 25 L41 20 L7 11 Z" fill="#000" opacity="0.32"/>
  <path d="M-14 7 L-40 15 L-39 18 L-14 11 Z"/>
  <path d="M14 7 L40 15 L39 18 L14 11 Z"/>
  <rect x="-52" y="6" width="9" height="22" rx="2.5" fill="url(#hullD)"/>
  <rect x="43" y="6" width="9" height="22" rx="2.5" fill="url(#hullD)"/>
  <circle cx="-47.5" cy="9" r="2.4"/><circle cx="47.5" cy="9" r="2.4"/>
  <circle cx="-47.5" cy="24" r="2" fill="#ffb347"/><circle cx="47.5" cy="24" r="2" fill="#ffb347"/>
  <path d="M0 -21 L11 3 L9 21 L-9 21 L-11 3 Z" fill="url(#hull)"/>
  <path d="M0 -21 L11 3 L9 21 L5 21 L5 2 Z" fill="#000" opacity="0.28"/>
  <path d="M0 -21 L0 21" stroke="#2a303c" stroke-width="1"/>
  <path d="M-8 4 H8 M-7 11 H7" stroke="#2a303c" stroke-width="1.2"/>
  <path d="M-9 14 H-4 M4 14 H9" stroke-width="2.4"/>
  <ellipse cx="0" cy="-3" rx="4.8" ry="8.5" fill="url(#glass)" stroke="#11151c" stroke-width="1"/>
  <ellipse cx="-1.4" cy="-6" rx="1.4" ry="3" fill="#fff" opacity="0.7"/>
</g>

<g id="player">
  <path d="M-10 -6 L-64 14 L-60 26 L-12 15 Z" fill="url(#hull)"/>
  <path d="M10 -6 L64 14 L60 26 L12 15 Z" fill="url(#hull)"/>
  <path d="M-12 15 L-60 26 L-58 21 L-12 10 Z" fill="#000" opacity="0.3"/>
  <path d="M12 15 L60 26 L58 21 L12 10 Z" fill="#000" opacity="0.3"/>
  <path d="M-16 4 L-52 16 L-51 19 L-16 8 Z" fill="#39d353"/>
  <path d="M16 4 L52 16 L51 19 L16 8 Z" fill="#39d353"/>
  <rect x="-64" y="8" width="8" height="22" rx="2.5" fill="url(#hullD)"/>
  <rect x="56" y="8" width="8" height="22" rx="2.5" fill="url(#hullD)"/>
  <circle cx="-60" cy="12" r="2.6" fill="#d9ffe0"/><circle cx="60" cy="12" r="2.6" fill="#d9ffe0"/>
  <path d="M-11 0 L-19 -20 L-5 -4 Z" fill="url(#hullD)"/>
  <path d="M11 0 L19 -20 L5 -4 Z" fill="url(#hullD)"/>
  <path d="M0 -28 L13 4 L11 24 L-11 24 L-13 4 Z" fill="url(#hull)"/>
  <path d="M0 -28 L13 4 L11 24 L6 24 L6 3 Z" fill="#000" opacity="0.28"/>
  <path d="M0 -28 V24" stroke="#2a303c" stroke-width="1"/>
  <rect x="-3" y="6" width="6" height="14" rx="2" fill="#39d353" opacity="0.9"/>
  <ellipse cx="0" cy="-7" rx="6.5" ry="12" fill="url(#glass)" stroke="#11151c" stroke-width="1"/>
  <ellipse cx="-2" cy="-11" rx="1.8" ry="4" fill="#fff" opacity="0.75"/>
  <rect x="-18" y="18" width="12" height="12" rx="3" fill="url(#hullD)"/>
  <rect x="6" y="18" width="12" height="12" rx="3" fill="url(#hullD)"/>
  <circle cx="-12" cy="25" r="14" fill="url(#engine)" opacity="0.75"><animate attributeName="r" values="13;17;13" dur="0.14s" repeatCount="indefinite"/></circle>
  <circle cx="12" cy="25" r="14" fill="url(#engine)" opacity="0.75"><animate attributeName="r" values="17;13;17" dur="0.14s" repeatCount="indefinite"/></circle>
  <circle cx="-12" cy="25" r="5" fill="#fff"/><circle cx="12" cy="25" r="5" fill="#fff"/>
</g>`;

function toSvg(sim) {
  const { enemies, shots, bolts, hits, shipTrack, T, DT, kills } = sim;
  const rep = `dur="${T}s" repeatCount="indefinite"`;
  const tk = (arr) => arr.map((t) => fk(t / T)).join(";");
  const rand = mulberry32(SEED ^ 0x9e37);
  const font = `font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="700"`;

  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  o += `<title>Space dogfight</title>\n<defs>${ARTWORK}</defs>\n<g clip-path="url(#screen)">\n`;

  // ----- screen shake wrapper (world only, HUD stays steady) -----
  const shakeHits = [];
  for (const h of hits) if (!shakeHits.length || h - shakeHits[shakeHits.length - 1] > 0.3) shakeHits.push(h);
  const shT = [0];
  const shV = ["0 0"];
  for (const h of shakeHits) {
    [[0, "0 0"], [0.04, "-4 3"], [0.08, "4 -2"], [0.12, "-3 2"], [0.16, "2 -1"], [0.2, "0 0"]].forEach(([dt, v]) => {
      shT.push(h + dt);
      shV.push(v);
    });
  }
  shT.push(T);
  shV.push("0 0");
  o += shakeHits.length
    ? `<g><animateTransform attributeName="transform" type="translate" values="${shV.join(";")}" keyTimes="${tk(shT)}" ${rep}/>\n`
    : `<g>\n`;

  // ----- space backdrop -----
  o += `<rect width="${WIDTH}" height="${HEIGHT}" fill="#04060d"/>\n`;
  o += `<ellipse cx="${f1(WIDTH * 0.25)}" cy="${f1(HEIGHT * 0.3)}" rx="330" ry="150" fill="url(#nebA)"/>\n`;
  o += `<ellipse cx="${f1(WIDTH * 0.65)}" cy="${f1(HEIGHT * 0.35)}" rx="300" ry="130" fill="url(#nebB)"/>\n`;
  o += `<ellipse cx="${f1(WIDTH * 0.5)}" cy="${f1(HEIGHT * 0.7)}" rx="360" ry="110" fill="url(#nebC)"/>\n`;
  // twinkling far stars
  for (let i = 0; i < 70; i++) {
    const x = rand() * WIDTH;
    const y = rand() * HEIGHT;
    const r = 0.4 + rand() * 0.9;
    const d = 1.5 + rand() * 3;
    o += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f2(r)}" fill="#dfe9ff" opacity="${f2(0.35 + rand() * 0.5)}"><animate attributeName="opacity" values="0.2;0.95;0.2" dur="${f2(d)}s" begin="-${f2(rand() * d)}s" repeatCount="indefinite"/></circle>\n`;
  }
  // sun glare, planet, moon
  o += `<circle cx="${f1(WIDTH * 0.14)}" cy="${f1(HEIGHT * 0.2)}" r="70" fill="url(#sun)"/>\n`;
  o += `<circle cx="${f1(WIDTH * 0.8)}" cy="${f1(HEIGHT * 0.86)}" r="110" fill="url(#atmo)"/>\n`;
  o += `<g clip-path="url(#planetClip)"><circle cx="${f1(WIDTH * 0.8)}" cy="${f1(HEIGHT * 0.86)}" r="100" fill="url(#planet)"/>\n`;
  for (let i = 0; i < 5; i++) {
    o += `<ellipse cx="${f1(WIDTH * 0.8 + (rand() - 0.5) * 40)}" cy="${f1(HEIGHT * 0.86 - 70 + i * 26)}" rx="130" ry="${f1(5 + rand() * 6)}" fill="${i % 2 ? "#5a2a18" : "#f3b169"}" opacity="0.28" transform="rotate(-14 ${f1(WIDTH * 0.8)} ${f1(HEIGHT * 0.86)})"/>\n`;
  }
  o += `</g>\n<circle cx="${f1(WIDTH * 0.2)}" cy="${f1(HEIGHT * 0.3)}" r="14" fill="url(#moon)"/>\n<circle cx="${f1(WIDTH * 0.2 + 5)}" cy="${f1(HEIGHT * 0.3 + 2)}" r="14" fill="#000" opacity="0.28"/>\n`;

  // ----- warp starfield: stars stream out of the vanishing point -----
  for (let i = 0; i < STAR_COUNT; i++) {
    const ang = rand() * 6.2832;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const r0 = 8 + rand() * 20;
    const rEnd = 560;
    const d = 0.9 + rand() * 1.7;
    const L = 5 + rand() * 9;
    const w = 0.7 + rand() * 1.1;
    const tint = rand() < 0.25 ? "#a9d4ff" : rand() < 0.15 ? "#ffd9a0" : "#ffffff";
    o +=
      `<g transform="translate(${P(CX + ux * r0, CY + uy * r0 * 0.9)})" opacity="0">` +
      `<animateTransform attributeName="transform" type="translate" values="${P(CX + ux * r0, CY + uy * r0 * 0.9)};${P(CX + ux * rEnd, CY + uy * rEnd * 0.9)}" dur="${f2(d)}s" begin="-${f2(rand() * d)}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.6 0 0.95 0.55"/>` +
      `<animate attributeName="opacity" values="0;1;1" keyTimes="0;0.25;1" dur="${f2(d)}s" begin="-${f2(rand() * d)}s" repeatCount="indefinite"/>` +
      `<line x1="0" y1="0" x2="${f1(-ux * L)}" y2="${f1(-uy * L)}" stroke="${tint}" stroke-width="${f2(w)}" stroke-linecap="round"/></g>\n`;
  }

  // ----- enemies (far first) -----
  const order = [...enemies].sort((a, b) => b.deathZ - a.deathZ);
  for (const e of order) {
    const times = [0, e.spawnT];
    const pos = [];
    const scl = [];
    const rot = [];
    const roll = (t) => clamp(((proj(e, t + 0.04).x - proj(e, t).x) / 0.04) * 0.05, -32, 32);
    const p0 = proj(e, e.spawnT);
    pos.push(P(p0.x, p0.y), P(p0.x, p0.y));
    scl.push(f2(p0.s), f2(p0.s));
    rot.push(f1(roll(e.spawnT)), f1(roll(e.spawnT)));
    let last = p0;
    for (let t = e.spawnT + 0.05; t < e.deathT - 0.03; t += 0.05) {
      const p = proj(e, t);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 6 || Math.abs(p.s / last.s - 1) >= 0.1 || t - times[times.length - 1] >= 0.25) {
        times.push(t);
        pos.push(P(p.x, p.y));
        scl.push(f2(p.s));
        rot.push(f1(roll(t)));
        last = p;
      }
    }
    const pe = proj(e, e.deathT);
    times.push(e.deathT, T);
    pos.push(P(pe.x, pe.y), P(pe.x, pe.y));
    scl.push(f2(pe.s), f2(pe.s));
    rot.push(f1(roll(e.deathT)), f1(roll(e.deathT)));
    const kt = tk(times);
    o +=
      `<g opacity="0" transform="translate(${pos[0]})">` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${fk(e.spawnT / T)};${fk(e.deathT / T)};1" calcMode="discrete" ${rep}/>` +
      `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="rotate(${rot[0]})"><animateTransform attributeName="transform" type="rotate" values="${rot.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="scale(${scl[0]})"><animateTransform attributeName="transform" type="scale" values="${scl.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<use href="#enemy" fill="${e.color}"/></g></g></g>\n`;
  }

  // ----- enemy bolts -----
  for (const b of bolts) {
    const times = [0, ...b.frames.map((f) => f.t), T];
    const first = b.frames[0];
    const lastF = b.frames[b.frames.length - 1];
    const xs = [first.x, ...b.frames.map((f) => f.x), lastF.x].map(f1);
    const ys = [first.y, ...b.frames.map((f) => f.y), lastF.y].map(f1);
    const rs = [first.r, ...b.frames.map((f) => f.r), lastF.r].map(f1);
    const kt = tk(times);
    o +=
      `<circle cx="${xs[0]}" cy="${ys[0]}" r="${rs[0]}" fill="url(#redbolt)" opacity="0">` +
      `<animate attributeName="cx" values="${xs.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="cy" values="${ys.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="r" values="${rs.map((r) => f1(r * 2.2)).join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${fk(b.t0 / T)};${fk(b.t1 / T)};1" calcMode="discrete" ${rep}/></circle>\n`;
  }

  // ----- explosions -----
  for (const e of enemies) {
    if (e.silent) continue;
    const p = proj(e, e.deathT);
    const R = Math.max(16, p.px * (e.rammed ? 1.4 : 0.9));
    const a = fk(e.deathT / T);
    const kk = (dt) => fk(Math.min(0.9999, (e.deathT + dt) / T));
    const cx = f1(p.x);
    const cy = f1(p.y);
    o +=
      `<circle cx="${cx}" cy="${cy}" r="0" fill="url(#smoke)" opacity="0">` +
      `<animate attributeName="r" values="0;0;${f1(R * 1.25)};${f1(R * 1.4)}" keyTimes="0;${a};${kk(0.9)};1" ${rep}/>` +
      `<animate attributeName="opacity" values="0;0.9;0;0" keyTimes="0;${a};${kk(0.9)};1" ${rep}/></circle>\n` +
      `<circle cx="${cx}" cy="${cy}" r="0" fill="url(#fire)" opacity="0">` +
      `<animate attributeName="r" values="0;0;${f1(R)};${f1(R * 1.1)}" keyTimes="0;${a};${kk(0.35)};1" ${rep}/>` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${a};${kk(0.5)};1" ${rep}/></circle>\n` +
      `<circle cx="${cx}" cy="${cy}" r="0" fill="none" stroke="#ffe9b0" stroke-width="2" opacity="0">` +
      `<animate attributeName="r" values="0;0;${f1(R * 1.9)};${f1(R * 1.9)}" keyTimes="0;${a};${kk(0.55)};1" ${rep}/>` +
      `<animate attributeName="opacity" values="0;0.9;0;0" keyTimes="0;${a};${kk(0.55)};1" ${rep}/></circle>\n` +
      `<circle cx="${cx}" cy="${cy}" r="0" fill="#fff">` +
      `<animate attributeName="r" values="0;0;${f1(R * 0.45)};0;0" keyTimes="0;${a};${kk(0.06)};${kk(0.2)};1" ${rep}/></circle>\n`;
    for (let i = 0; i < 6; i++) {
      const ang = rand() * 6.2832;
      const dist = R * (1.2 + rand() * 1.4);
      const dx = Math.cos(ang) * dist;
      const dy = Math.sin(ang) * dist * 0.8;
      o +=
        `<circle r="0" fill="${i % 2 ? "#ffb347" : "#9aa3b5"}" transform="translate(${cx} ${cy})">` +
        `<animateTransform attributeName="transform" type="translate" values="${cx} ${cy};${cx} ${cy};${f1(p.x + dx)} ${f1(p.y + dy)};${f1(p.x + dx)} ${f1(p.y + dy)}" keyTimes="0;${a};${kk(0.7)};1" ${rep}/>` +
        `<animate attributeName="r" values="0;0;${f1(1.6 + rand() * 1.8)};0;0" keyTimes="0;${a};${kk(0.08)};${kk(0.7)};1" ${rep}/></circle>\n`;
    }
  }

  // ----- player lasers (alternate cannons) + impact sparks -----
  for (const side of [-1, 1]) {
    const mine = shots.filter((s) => s.side === side);
    if (!mine.length) continue;
    const tt = [0];
    const X1 = [mine[0].gx];
    const Y1 = [mine[0].gy];
    const X2 = [mine[0].gx];
    const Y2 = [mine[0].gy];
    const op = [0];
    const opT = [0];
    for (const s of mine) {
      const mx = (s.gx + s.ex) / 2;
      const my = (s.gy + s.ey) / 2;
      tt.push(s.t, s.t + 0.05, s.t + 0.11);
      X1.push(s.gx, s.gx, mx);
      Y1.push(s.gy, s.gy, my);
      X2.push(s.gx, mx, s.ex);
      Y2.push(s.gy, my, s.ey);
      opT.push(s.t, s.t + 0.12);
      op.push(1, 0);
    }
    tt.push(T);
    X1.push(X1[X1.length - 1]); Y1.push(Y1[Y1.length - 1]); X2.push(X2[X2.length - 1]); Y2.push(Y2[Y2.length - 1]);
    opT.push(T);
    op.push(0);
    const kt = tk(tt);
    const kto = tk(opT);
    const line = (w, col, a) =>
      `<line x1="${f1(X1[0])}" y1="${f1(Y1[0])}" x2="${f1(X2[0])}" y2="${f1(Y2[0])}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" opacity="0">` +
      `<animate attributeName="x1" values="${X1.map(f1).join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="y1" values="${Y1.map(f1).join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="x2" values="${X2.map(f1).join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="y2" values="${Y2.map(f1).join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<animate attributeName="opacity" values="${op.map((v) => v * a).join(";")}" keyTimes="${kto}" calcMode="discrete" ${rep}/></line>\n`;
    o += line(6, "#39d353", 0.35) + line(2, "#e8ffe9", 1);
  }
  if (shots.length) {
    const tt = [0];
    const xs = [shots[0].ex];
    const ys = [shots[0].ey];
    const op = [0];
    for (const s of shots) {
      tt.push(s.t + 0.11, s.t + 0.25);
      xs.push(s.ex, s.ex);
      ys.push(s.ey, s.ey);
      op.push(1, 0);
    }
    tt.push(T);
    xs.push(xs[xs.length - 1]); ys.push(ys[ys.length - 1]); op.push(0);
    const kt = tk(tt);
    o +=
      `<circle r="9" cx="${f1(xs[0])}" cy="${f1(ys[0])}" fill="url(#spark)" opacity="0">` +
      `<animate attributeName="cx" values="${xs.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="cy" values="${ys.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="opacity" values="${op.join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></circle>\n`;
  }

  // ----- lock-on bracket -----
  {
    const tt = [0];
    const pos = [P(CX, CY)];
    const sc = ["1"];
    const opT = [0];
    const opV = [0];
    let lastLocked = false;
    const step = Math.round(0.1 / DT);
    for (let i = 0; i < shipTrack.length; i += step) {
      const st = shipTrack[i];
      const time = (i + 1) * DT;
      if (st.target) {
        tt.push(time);
        pos.push(P(st.target.x, st.target.y));
        sc.push(f1(Math.max(14, st.target.px * 0.62)));
      }
      const locked = !!st.target;
      if (locked !== lastLocked) {
        opT.push(time);
        opV.push(locked ? 1 : 0);
        lastLocked = locked;
      }
    }
    tt.push(T);
    pos.push(pos[pos.length - 1]);
    sc.push(sc[sc.length - 1]);
    opT.push(T);
    opV.push(0);
    const kt = tk(tt);
    o +=
      `<g opacity="0" transform="translate(${pos[0]})">` +
      `<animate attributeName="opacity" values="${opV.join(";")}" keyTimes="${tk(opT)}" calcMode="discrete" ${rep}/>` +
      `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="scale(${sc[0]})"><animateTransform attributeName="transform" type="scale" values="${sc.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<path d="M-1 -0.55V-1H-0.55M0.55 -1H1V-0.55M1 0.55V1H0.55M-0.55 1H-1V0.55" fill="none" stroke="#39d353" stroke-width="0.09"/></g></g>\n`;
  }

  // ----- player ship (banks with its lateral velocity) -----
  {
    const tt = [0];
    const pos = [P(CX, SHIP_Y)];
    const rot = ["0"];
    const step = Math.round(0.1 / DT);
    for (let i = 0; i < shipTrack.length; i += step) {
      tt.push((i + 1) * DT);
      pos.push(P(CX + shipTrack[i].xp, SHIP_Y));
      rot.push(f1(clamp(shipTrack[i].vp * 0.09, -18, 18)));
    }
    tt.push(T);
    pos.push(pos[pos.length - 1]);
    rot.push("0");
    const kt = tk(tt);
    const sT = [0];
    const sV = [0];
    for (const h of hits) sT.push(h, h + 0.28), sV.push(1, 0);
    sT.push(T);
    sV.push(0);
    o +=
      `<g transform="translate(${pos[0]})"><animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="rotate(${rot[0]})"><animateTransform attributeName="transform" type="rotate" values="${rot.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="scale(${SHIP_SCALE})"><use href="#player"/></g>` +
      `<circle cx="0" cy="6" r="${f1(78 * SHIP_SCALE)}" fill="url(#shield)" opacity="0"><animate attributeName="opacity" values="${sV.join(";")}" keyTimes="${tk(sT)}" calcMode="discrete" ${rep}/></circle>` +
      `</g></g>\n`;
  }

  // muzzle glints
  if (shots.length) {
    for (const side of [-1, 1]) {
      const mine = shots.filter((s) => s.side === side);
      if (!mine.length) continue;
      const tt = [0];
      const xs = [mine[0].gx];
      const ys = [mine[0].gy];
      const op = [0];
      for (const s of mine) {
        tt.push(s.t, s.t + 0.07);
        xs.push(s.gx, s.gx);
        ys.push(s.gy, s.gy);
        op.push(1, 0);
      }
      tt.push(T);
      xs.push(xs[xs.length - 1]); ys.push(ys[ys.length - 1]); op.push(0);
      const kt = tk(tt);
      o +=
        `<circle r="8" cx="${f1(xs[0])}" cy="${f1(ys[0])}" fill="url(#spark)" opacity="0">` +
        `<animate attributeName="cx" values="${xs.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
        `<animate attributeName="cy" values="${ys.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
        `<animate attributeName="opacity" values="${op.join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></circle>\n`;
    }
  }

  o += `</g>\n`; // end shake wrapper
  o += `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#vignette)"/>\n`;

  // red flash on hits
  if (hits.length) {
    const ht = [0];
    const hv = [0];
    for (const h of hits) ht.push(h, h + 0.22), hv.push(0.28, 0);
    ht.push(T);
    hv.push(0);
    o += `<rect width="${WIDTH}" height="${HEIGHT}" fill="#4aa8ff" opacity="0"><animate attributeName="opacity" values="${hv.join(";")}" keyTimes="${tk(ht)}" calcMode="discrete" ${rep}/></rect>\n`;
  }

  // ----- HUD overlay -----
  o += `<path d="M10 24V10H24M${WIDTH - 24} 10H${WIDTH - 10}V24M10 ${HEIGHT - 24}V${HEIGHT - 10}H24M${WIDTH - 24} ${HEIGHT - 10}H${WIDTH - 10}V${HEIGHT - 24}" fill="none" stroke="#39d353" stroke-width="1.4" opacity="0.55"/>\n`;
  o += `<text x="22" y="30" ${font} font-size="12" fill="#9bd7ff">SHIELD</text>\n`;
  o += `<rect x="76" y="20" width="150" height="11" rx="3" fill="#0b1b2b" stroke="#2f6a9a"/>\n`;
  const shT2 = [0];
  const shV2 = ["146"];
  hits.forEach((h, i) => {
    shT2.push(h);
    shV2.push(String(f1(Math.max(6, 146 * (1 - 0.1 * (i + 1))))));
  });
  shT2.push(T);
  shV2.push(shV2[shV2.length - 1]);
  o += `<rect x="78" y="22" width="146" height="7" rx="2" fill="#4aa8ff"><animate attributeName="width" values="${shV2.join(";")}" keyTimes="${tk(shT2)}" calcMode="discrete" ${rep}/></rect>\n`;
  o += `<text x="${WIDTH - 140}" y="30" ${font} font-size="12" fill="#9bd7ff" text-anchor="end">KILLS</text>\n`;
  const killTimes = enemies.filter((e) => !e.rammed && !e.silent).map((e) => e.deathT).sort((a, b) => a - b);
  const bounds = [0, ...killTimes, T];
  for (let n = 0; n <= killTimes.length; n++) {
    const a = fk(bounds[n] / T);
    const b = fk(bounds[n + 1] / T);
    const values = n === 0 ? "1;0;0" : "0;1;0;0";
    const keys = n === 0 ? `0;${b};1` : `0;${a};${b};1`;
    o += `<text x="${WIDTH - 126}" y="31" ${font} font-size="16" fill="#ffffff" opacity="${n === 0 ? 1 : 0}">${n}<animate attributeName="opacity" values="${values}" keyTimes="${keys}" calcMode="discrete" ${rep}/></text>\n`;
  }

  o += `</g>\n<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="6" fill="none" stroke="#30363d"/>\n</svg>\n`;
  return o;
}

// ---------- main ----------
const sim = simulate();
const svg = toSvg(sim);
mkdirSync(dirname(OUT) || ".", { recursive: true });
writeFileSync(OUT, svg);
console.log(`${OUT}  ${(svg.length / 1024).toFixed(0)} KB`);
console.log(`${sim.enemies.length} enemies, ${sim.kills} shot down, ${sim.ramHits.length} rammed you, ${sim.bolts.length} enemy bolts (${sim.bolts.filter((b) => b.hit).length} hits), ${sim.shots.length} shots, ${sim.T}s loop, ${WIDTH}x${HEIGHT}px`);
