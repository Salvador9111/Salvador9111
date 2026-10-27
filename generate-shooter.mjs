#!/usr/bin/env node
// Doom-style first-person corridor shooter -> animated SVG (pseudo-3D perspective).
// Works inside a GitHub README <img> (no JavaScript needed there).
//
// Usage:  node generate-shooter.mjs        ->  ./shooter.svg
//         OUT=assets/shooter.svg node generate-shooter.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ---------- config ----------
const OUT = process.env.OUT || "shooter.svg";
const SEED = Number(process.env.SEED || 0xd00d);
const WIDTH = 808;
const HEIGHT = 260; // total height (view + HUD)
const HUD_H = 34;
const HALL_HALF_W = 3.6; // hall half width (world units)
const CYCLE_S = 1.2; // seconds for the hall to scroll by one segment
const SEG = 1.5; // length of one hall segment

const ENEMY_COUNT = 40;
const SPAWN_GAP_S = 1.7; // average seconds between spawn groups
const FIRE_S = 0.24; // seconds between shots (higher = slower)
const RANGE = 7; // shooting range
const Z_SPAWN = 14;
const Z_HURT = 1.2; // an enemy this close hurts you
const START_S = 1.0;
const END_HOLD_S = 2.2;
const MAX_TIME_S = 90;

// enemy types: world height, width factor, health, speed range
const TYPES = {
  grunt: { H: 1.55, W: 1.0, hp: 2, v: [1.2, 1.5], armor: false },
  brute: { H: 1.8, W: 1.3, hp: 4, v: [0.9, 1.1], armor: true },
  runner: { H: 1.5, W: 0.92, hp: 1, v: [1.9, 2.2], armor: false },
};
const SHIRTS = ["#6b3b2a", "#2f4a6b", "#5b2b3a", "#4a4f2a", "#4b4b52"];

// ---------- derived layout ----------
const VH = HEIGHT - HUD_H;
const CX = WIDTH / 2;
const CY = VH * 0.5;
const F = VH * 0.6; // focal length (bigger = camera closer to the action)
const SPRITE_H = 112;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- simulation ----------
const zAt = (e, t) => e.z0 - e.vz * (t - e.spawnT);
const xAt = (e, t) => e.X + e.amp * Math.sin(e.ph + 1.3 * (t - e.spawnT));
const proj = (e, t) => {
  const z = Math.max(0.3, zAt(e, t));
  const k = F / z;
  return { x: CX + xAt(e, t) * k, y: CY + k * (1 - e.H / 2), floorY: CY + k, s: (k * e.H) / SPRITE_H, k, z };
};

function simulate() {
  const rand = mulberry32(SEED);
  const enemies = [];
  let t = START_S;
  while (enemies.length < ENEMY_COUNT) {
    const groupSize = 1 + (rand() < 0.35 ? 1 : 0) + (rand() < 0.1 ? 1 : 0);
    const lanes = [];
    for (let g = 0; g < groupSize && enemies.length < ENEMY_COUNT; g++) {
      let X;
      for (let tries = 0; tries < 20; tries++) {
        X = (rand() * 2 - 1) * 2.5;
        if (lanes.every((l) => Math.abs(l - X) > 1.0)) break;
      }
      lanes.push(X);
      const r = rand();
      const type = r < 0.2 ? "brute" : r < 0.35 ? "runner" : "grunt";
      const ty = TYPES[type];
      enemies.push({
        type, H: ty.H, W: ty.W, hp: ty.hp, X,
        amp: type === "runner" ? 0.25 : 0.08,
        ph: rand() * 6.28,
        spawnT: t + rand() * 0.35,
        z0: Z_SPAWN + rand(),
        vz: ty.v[0] + rand() * (ty.v[1] - ty.v[0]),
        shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
        dead: false, hurt: false, silent: false, deathT: null, deathZ: null,
      });
    }
    t += SPAWN_GAP_S * (0.75 + rand() * 0.5);
  }

  const DT = 1 / 120;
  let now = 0;
  let nextShot = START_S;
  const shots = [];
  const hurts = [];
  const lastSpawn = Math.max(...enemies.map((e) => e.spawnT));

  while (now < MAX_TIME_S) {
    now += DT;
    for (const e of enemies) {
      if (!e.dead && now >= e.spawnT && zAt(e, now) <= Z_HURT) {
        e.dead = true; e.hurt = true; e.deathT = now; e.deathZ = Z_HURT;
        hurts.push(now);
      }
    }
    if (now >= nextShot) {
      let target = null;
      let tz = Infinity;
      for (const e of enemies) {
        if (e.dead || now < e.spawnT) continue;
        const z = zAt(e, now);
        if (z <= RANGE && z < tz) { target = e; tz = z; }
      }
      if (target) {
        const p = proj(target, now);
        shots.push({ t: now, x: p.x, y: p.y - target.H * p.k * 0.12 });
        target.hp--;
        if (target.hp <= 0) { target.dead = true; target.deathT = now; target.deathZ = tz; }
        nextShot = now + FIRE_S;
      }
    }
    if (now > lastSpawn && enemies.every((e) => e.dead)) break;
  }
  for (const e of enemies) {
    if (!e.dead) { e.dead = true; e.deathT = now; e.deathZ = zAt(e, now); e.silent = true; }
  }
  const T = +(Math.max(...enemies.map((e) => e.deathT)) + END_HOLD_S).toFixed(3);
  return { enemies, shots, hurts, T, kills: enemies.filter((e) => !e.hurt && !e.silent).length };
}

// ---------- svg helpers ----------
const f1 = (n) => +n.toFixed(1);
const f2 = (n) => +n.toFixed(2);
const fk = (v) => +v.toFixed(5);
const P = (x, y) => `${f1(x)} ${f1(y)}`;

// scrolling hall segments
const PH = 16;
const ZMIN = 0.8;
const K = 11;
const zOf = (k, phase) => Math.max(0.3, ZMIN + (k - phase) * SEG);
function anim(fn) {
  const vals = [];
  for (let i = 0; i <= PH; i++) vals.push(fn(i / PH));
  return `<animate attributeName="d" values="${vals.join(";")}" dur="${CYCLE_S}s" repeatCount="indefinite"/>`;
}
const floorQuad = (za, zb) => `M${P(CX - HALL_HALF_W * F / za, CY + F / za)}L${P(CX + HALL_HALF_W * F / za, CY + F / za)}L${P(CX + HALL_HALF_W * F / zb, CY + F / zb)}L${P(CX - HALL_HALF_W * F / zb, CY + F / zb)}Z`;
const ceilQuad = (za, zb, hw) => `M${P(CX - hw * F / za, CY - F / za)}L${P(CX + hw * F / za, CY - F / za)}L${P(CX + hw * F / zb, CY - F / zb)}L${P(CX - hw * F / zb, CY - F / zb)}Z`;
const wallQuad = (side, za, zb, inset) => {
  const x = (z) => CX + side * HALL_HALF_W * F / z;
  return `M${P(x(za), CY - inset * F / za)}L${P(x(za), CY + inset * F / za)}L${P(x(zb), CY + inset * F / zb)}L${P(x(zb), CY - inset * F / zb)}Z`;
};

// ---------- enemy artwork (feet at y=0, ~112 units tall, walk cycle animated once in <defs>) ----------
const WALK = "0.64s";
const SPRITES = `
<linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b3bf9f"/><stop offset="0.55" stop-color="#8d9b7c"/><stop offset="1" stop-color="#5e6a52"/></linearGradient>
<radialGradient id="headg" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#c6d1b2"/><stop offset="0.6" stop-color="#8d9b7c"/><stop offset="1" stop-color="#4f5a45"/></radialGradient>
<radialGradient id="eyeglow"><stop offset="0" stop-color="#ff4a3a"/><stop offset="1" stop-color="#ff1a1a" stop-opacity="0"/></radialGradient>
<g id="mob">
  <ellipse cx="0" cy="0" rx="28" ry="5.5" fill="#000" opacity="0.45"/>
  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -2.2;0 0" dur="${WALK}" repeatCount="indefinite"/>
    <g>
      <animateTransform attributeName="transform" type="rotate" values="-15 -9 -46;15 -9 -46;-15 -9 -46" dur="${WALK}" repeatCount="indefinite"/>
      <path d="M-16 -47 L-3 -47 L-5 -9 L-15 -9 Z" fill="#2a2f3a"/>
      <path d="M-15 -28 L-4.5 -28 L-5 -23 L-14.5 -23 Z" fill="#000" opacity="0.18"/>
      <path d="M-17 -9 H-3 L-1.5 0 H-19 Z" fill="#14161b"/>
      <path d="M-17 -9 H-3 L-3.5 -6 H-16.5 Z" fill="#3a404d"/>
    </g>
    <g>
      <animateTransform attributeName="transform" type="rotate" values="15 9 -46;-15 9 -46;15 9 -46" dur="${WALK}" repeatCount="indefinite"/>
      <path d="M3 -47 L16 -47 L15 -9 L5 -9 Z" fill="#2a2f3a"/>
      <path d="M4.5 -28 L15 -28 L14.5 -23 L5 -23 Z" fill="#000" opacity="0.18"/>
      <path d="M3 -9 H17 L19 0 H1.5 Z" fill="#14161b"/>
      <path d="M3 -9 H17 L16.5 -6 H3.5 Z" fill="#3a404d"/>
    </g>
    <path d="M-22 -89 Q0 -96 22 -89 L20 -46 L-20 -46 Z"/>
    <path d="M-20 -46 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l3 6 l3 -5 l2 4 L20 -46 Z" fill="#000" opacity="0.28"/>
    <path d="M-15 -86 L15 -86 L13 -55 L-13 -55 Z" fill="#1b2027" opacity="0.88"/>
    <path d="M-13 -80 H13 M-12 -72 H12 M-11 -64 H11" stroke="#3a4350" stroke-width="1.4" fill="none"/>
    <path d="M-20 -52 H20 V-46 H-20 Z" fill="#14161b"/>
    <rect x="-3" y="-52" width="6" height="6" fill="#9a8f5a"/>
    <path d="M-9 -78 q-4 8 -2 14 q3 -6 4 -13 Z M8 -70 q4 6 2 12 q-3 -5 -3 -11 Z" fill="#7a0f12" opacity="0.75"/>
    <g>
      <animateTransform attributeName="transform" type="rotate" values="9 -22 -88;-9 -22 -88;9 -22 -88" dur="${WALK}" repeatCount="indefinite"/>
      <path d="M-22 -89 C-31 -87 -34 -70 -33 -57 L-26 -55 C-26 -67 -24 -77 -19 -85 Z" fill="url(#skin)"/>
      <ellipse cx="-30" cy="-51" rx="5.5" ry="6.5" fill="url(#skin)"/>
      <path d="M-34 -47 l-2 8 l4 -5 Z M-30 -45 l-1 9 l4 -7 Z M-26 -47 l0 8 l3 -6 Z" fill="#cfc9b0"/>
    </g>
    <g>
      <animateTransform attributeName="transform" type="rotate" values="-9 22 -88;9 22 -88;-9 22 -88" dur="${WALK}" repeatCount="indefinite"/>
      <path d="M22 -89 C31 -87 34 -70 33 -57 L26 -55 C26 -67 24 -77 19 -85 Z" fill="url(#skin)"/>
      <ellipse cx="30" cy="-51" rx="5.5" ry="6.5" fill="url(#skin)"/>
      <path d="M34 -47 l2 8 l-4 -5 Z M30 -45 l1 9 l-4 -7 Z M26 -47 l0 8 l-3 -6 Z" fill="#cfc9b0"/>
    </g>
    <path d="M-5 -97 H5 V-90 H-5 Z" fill="#6e7b60"/>
    <g>
      <animateTransform attributeName="transform" type="rotate" values="-2.5 0 -92;2.5 0 -92;-2.5 0 -92" dur="${WALK}" repeatCount="indefinite"/>
      <path d="M-13 -101 C-14 -116 14 -116 13 -101 L12 -88 C10 -80 -10 -80 -12 -88 Z" fill="url(#headg)"/>
      <path d="M-13 -104 C-13 -116 13 -116 13 -104 C8 -109 -8 -109 -13 -104 Z" fill="#1a1512"/>
      <ellipse cx="-5.6" cy="-97" rx="4" ry="3" fill="#150808"/>
      <ellipse cx="5.6" cy="-97" rx="4" ry="3" fill="#150808"/>
      <circle cx="-5.6" cy="-97" r="4.2" fill="url(#eyeglow)"/>
      <circle cx="5.6" cy="-97" r="4.2" fill="url(#eyeglow)"/>
      <circle cx="-5.6" cy="-97" r="1.5" fill="#ff5a4a"/>
      <circle cx="5.6" cy="-97" r="1.5" fill="#ff5a4a"/>
      <path d="M-1.6 -95 L0 -90 L1.6 -95 Z" fill="#4f5a45" opacity="0.8"/>
      <path d="M-6 -87.5 Q0 -81 6 -87.5 Q0 -90 -6 -87.5 Z" fill="#2a0707"/>
      <path d="M-4.5 -87 l1.2 2.2 l1.2 -2.2 Z M-1.2 -86.6 l1.2 2.6 l1.2 -2.6 Z M2.1 -87 l1.2 2.2 l1.2 -2.2 Z" fill="#e8e2c8"/>
      <path d="M8 -105 q3 8 1 14" stroke="#7a0f12" stroke-width="1.6" fill="none" opacity="0.8"/>
      <path d="M-10 -101 l6 3" stroke="#4f5a45" stroke-width="1.2" opacity="0.7"/>
    </g>
  </g>
</g>
<g id="armor">
  <g>
    <animateTransform attributeName="transform" type="translate" values="0 0;0 -2.2;0 0" dur="${WALK}" repeatCount="indefinite"/>
    <path d="M-15 -100 C-15 -120 15 -120 15 -100 L15 -94 H-15 Z" fill="#3b4352" stroke="#1b2029" stroke-width="1.2"/>
    <rect x="-11" y="-99" width="22" height="3.4" rx="1.4" fill="#ff3a2a"/>
    <path d="M-15 -94 H15" stroke="#1b2029" stroke-width="1.5"/>
    <ellipse cx="-27" cy="-88" rx="11" ry="7.5" fill="#3b4352" stroke="#1b2029" stroke-width="1.2"/>
    <ellipse cx="27" cy="-88" rx="11" ry="7.5" fill="#3b4352" stroke="#1b2029" stroke-width="1.2"/>
    <path d="M-16 -84 H16 L13 -58 H-13 Z" fill="#47506a" opacity="0.85" stroke="#1b2029" stroke-width="1"/>
    <path d="M-16 -84 H16" stroke="#8a95ad" stroke-width="1" opacity="0.7"/>
  </g>
</g>`;

function toSvg(sim) {
  const { enemies, shots, hurts, T, kills } = sim;
  const rep = `dur="${T}s" repeatCount="indefinite"`;
  const muzzleY = VH - 66;
  const tk = (arr) => arr.map((t) => fk(t / T)).join(";");

  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">\n`;
  o += `<title>First-person corridor shooter</title>\n<defs>
<clipPath id="screen"><rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="6"/></clipPath>
<linearGradient id="floor" x1="0" y1="${CY}" x2="0" y2="${VH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0b0e14"/><stop offset="1" stop-color="#2a2f3a"/></linearGradient>
<linearGradient id="ceil" x1="0" y1="${CY}" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0b0e14"/><stop offset="1" stop-color="#1b212c"/></linearGradient>
<linearGradient id="wallL" x1="0" y1="0" x2="${CX}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#303a4c"/><stop offset="1" stop-color="#0d1118"/></linearGradient>
<linearGradient id="wallR" x1="${WIDTH}" y1="0" x2="${CX}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#303a4c"/><stop offset="1" stop-color="#0d1118"/></linearGradient>
<radialGradient id="portal"><stop offset="0" stop-color="#ffd9a0"/><stop offset="0.35" stop-color="#ff8a1f" stop-opacity="0.75"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></radialGradient>
<radialGradient id="blood"><stop offset="0" stop-color="#ffb199"/><stop offset="0.3" stop-color="#e5342a"/><stop offset="0.7" stop-color="#7a0b12" stop-opacity="0.85"/><stop offset="1" stop-color="#4a0508" stop-opacity="0"/></radialGradient>
<radialGradient id="spark"><stop offset="0" stop-color="#fff"/><stop offset="0.4" stop-color="#ffd24a"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
<radialGradient id="flash"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#ffe27a"/><stop offset="1" stop-color="#ff9d1a" stop-opacity="0"/></radialGradient>
<radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.6"/></radialGradient>
<linearGradient id="metal" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a303b"/><stop offset="0.5" stop-color="#939cac"/><stop offset="1" stop-color="#2a303b"/></linearGradient>
${SPRITES}
</defs>\n<g clip-path="url(#screen)">\n`;

  // ----- hall -----
  const zf = 18;
  const zn = 0.4;
  const wx = (side, z) => CX + side * HALL_HALF_W * F / z;
  o += `<rect width="${WIDTH}" height="${VH}" fill="#0b0e14"/>\n`;
  o += `<path d="M${P(wx(-1, zn), CY - F / zn)}L${P(wx(-1, zf), CY - F / zf)}L${P(wx(-1, zf), CY + F / zf)}L${P(wx(-1, zn), CY + F / zn)}Z" fill="url(#wallL)"/>\n`;
  o += `<path d="M${P(wx(1, zn), CY - F / zn)}L${P(wx(1, zf), CY - F / zf)}L${P(wx(1, zf), CY + F / zf)}L${P(wx(1, zn), CY + F / zn)}Z" fill="url(#wallR)"/>\n`;
  o += `<path d="M${P(wx(-1, zn), CY + F / zn)}L${P(wx(-1, zf), CY + F / zf)}L${P(wx(1, zf), CY + F / zf)}L${P(wx(1, zn), CY + F / zn)}Z" fill="url(#floor)"/>\n`;
  o += `<path d="M${P(wx(-1, zn), CY - F / zn)}L${P(wx(-1, zf), CY - F / zf)}L${P(wx(1, zf), CY - F / zf)}L${P(wx(1, zn), CY - F / zn)}Z" fill="url(#ceil)"/>\n`;
  o += `<ellipse cx="${CX}" cy="${CY}" rx="52" ry="34" fill="url(#portal)"/>\n`;
  o += `<rect x="${f1(CX - HALL_HALF_W * F / zf * 0.5)}" y="${f1(CY - F / zf * 0.8)}" width="${f1(HALL_HALF_W * F / zf)}" height="${f1(F / zf * 1.6)}" fill="#3a1a08" opacity="0.9"/>\n`;

  for (let k = K; k >= 0; k--) {
    const za = (p) => zOf(k, p);
    const half = 0.55 * SEG;
    o += `<path fill="#343b48" opacity="0.55" d="${floorQuad(za(0), za(0) + half)}">${anim((p) => floorQuad(za(p), za(p) + half))}</path>\n`;
    o += `<path fill="#1e2530" d="${wallQuad(-1, za(0), za(0) + half, 0.8)}">${anim((p) => wallQuad(-1, za(p), za(p) + half, 0.8))}</path>\n`;
    o += `<path fill="#1e2530" d="${wallQuad(1, za(0), za(0) + half, 0.8)}">${anim((p) => wallQuad(1, za(p), za(p) + half, 0.8))}</path>\n`;
    o += `<path fill="#ff9d1a" opacity="0.92" d="${wallQuad(-1, za(0), za(0) + 0.07 * SEG, 0.95)}">${anim((p) => wallQuad(-1, za(p), za(p) + 0.07 * SEG, 0.95))}</path>\n`;
    o += `<path fill="#ff9d1a" opacity="0.92" d="${wallQuad(1, za(0), za(0) + 0.07 * SEG, 0.95)}">${anim((p) => wallQuad(1, za(p), za(p) + 0.07 * SEG, 0.95))}</path>\n`;
    o += `<path fill="#fff1d0" opacity="0.85" d="${ceilQuad(za(0), za(0) + 0.3 * SEG, 1.1)}">${anim((p) => ceilQuad(za(p), za(p) + 0.3 * SEG, 1.1))}</path>\n`;
  }

  // ----- enemies (far ones first) -----
  const order = [...enemies].sort((a, b) => b.deathZ - a.deathZ);
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
      if (Math.abs(1 / p.z - 1 / last.z) >= 0.04 || Math.abs(p.x - last.x) >= 5 || t - times[times.length - 1] >= 0.5) {
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
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${fk(e.spawnT / T)};${fk(e.deathT / T)};1" calcMode="discrete" ${rep}/>` +
      `<animateTransform attributeName="transform" type="translate" values="${pos.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="scale(${scl[0]})"><animateTransform attributeName="transform" type="scale" values="${scl.join(";")}" keyTimes="${kt}" ${rep}/>` +
      `<g transform="scale(${e.W} 1)"><use href="#mob" fill="${e.shirt}"/>${TYPES[e.type].armor ? `<use href="#armor"/>` : ""}</g></g></g>\n`;
  }

  // ----- death bursts -----
  for (const e of enemies) {
    if (e.silent) continue;
    const p = proj(e, e.deathT);
    const R = Math.max(12, p.k * e.H * 0.75);
    const a = fk(e.deathT / T);
    const b = fk(Math.min(0.9999, (e.deathT + 0.45) / T));
    const c = fk(Math.min(0.9999, (e.deathT + 0.15) / T));
    o +=
      `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="0" fill="url(#blood)" opacity="0">` +
      `<animate attributeName="r" values="0;0;${f1(R)};${f1(R)}" keyTimes="0;${a};${b};1" ${rep}/>` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${a};${b};1" ${rep}/></circle>\n` +
      `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="0" fill="url(#spark)" opacity="0">` +
      `<animate attributeName="r" values="0;0;${f1(R * 0.55)};${f1(R * 0.55)}" keyTimes="0;${a};${c};1" ${rep}/>` +
      `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;${a};${c};1" ${rep}/></circle>\n`;
  }

  // ----- tracer, impact spark, crosshair, gun -----
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
      `<line x1="${CX}" y1="${muzzleY}" x2="${f1(xs[0])}" y2="${f1(ys[0])}" stroke="#ffe7a0" stroke-width="2" stroke-linecap="round" opacity="0">` +
      `<animate attributeName="x2" values="${xs.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="y2" values="${ys.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="opacity" values="${on.join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></line>\n`;
    o +=
      `<circle r="9" fill="url(#spark)" cx="${f1(xs[0])}" cy="${f1(ys[0])}" opacity="0">` +
      `<animate attributeName="cx" values="${xs.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="cy" values="${ys.map(f1).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/>` +
      `<animate attributeName="opacity" values="${on.join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></circle>\n`;

    const ct = [0, ...shots.map((s) => s.t), T];
    const cp = [P(CX, CY), ...shots.map((s) => P(s.x, s.y)), P(shots[shots.length - 1].x, shots[shots.length - 1].y)];
    o +=
      `<g transform="translate(${cp[0]})"><animateTransform attributeName="transform" type="translate" values="${cp.join(";")}" keyTimes="${tk(ct)}" ${rep}/>` +
      `<circle r="9" fill="none" stroke="#ff5a4a" stroke-width="1.4" opacity="0.9"/>` +
      `<path d="M-14 0H-5M5 0H14M0 -14V-5M0 5V14" stroke="#ff5a4a" stroke-width="1.4"/></g>\n`;
  }

  const rt = [0];
  const rv = ["0 0"];
  for (const s of shots) {
    rt.push(s.t, s.t + 0.04, s.t + 0.16);
    rv.push("0 0", "0 5", "0 0");
  }
  rt.push(T);
  rv.push("0 0");
  const gunBody =
    `<ellipse cx="${CX - 36}" cy="${VH - 4}" rx="17" ry="10" fill="#202733"/><ellipse cx="${CX + 36}" cy="${VH - 4}" rx="17" ry="10" fill="#202733"/>` +
    `<path d="M${CX - 8} ${VH - 64}H${CX + 8}L${CX + 17} ${VH - 18}H${CX - 17}Z" fill="url(#metal)"/>` +
    `<ellipse cx="${CX}" cy="${VH - 64}" rx="8" ry="2.6" fill="#0a0d12"/>` +
    `<rect x="${CX - 24}" y="${VH - 26}" width="48" height="28" rx="5" fill="#2a303b" stroke="#454d5c"/>` +
    `<rect x="${CX - 18}" y="${VH - 20}" width="36" height="4" rx="2" fill="#ff9d1a"/>` +
    `<rect x="${CX - 2}" y="${VH - 72}" width="4" height="9" fill="#cfd6e4"/>`;
  o += shots.length
    ? `<g><animateTransform attributeName="transform" type="translate" values="${rv.join(";")}" keyTimes="${tk(rt)}" ${rep}/>${gunBody}</g>\n`
    : `<g>${gunBody}</g>\n`;

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
    o += `<rect width="${WIDTH}" height="${VH}" fill="#fff" opacity="0"><animate attributeName="opacity" values="${fv.map((v) => v * 0.06).join(";")}" keyTimes="${kt}" calcMode="discrete" ${rep}/></rect>\n`;
  }

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

  // ----- HUD: health bar + kill counter -----
  const font = `font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="700"`;
  o += `<rect x="0" y="${VH}" width="${WIDTH}" height="${HUD_H}" fill="#0a0c10"/>\n<rect x="0" y="${VH}" width="${WIDTH}" height="1.5" fill="#ff9d1a" opacity="0.8"/>\n`;
  const hy = VH + HUD_H / 2;
  o += `<text x="16" y="${hy + 4.5}" ${font} font-size="13" fill="#9aa4b5">HEALTH</text>\n`;
  o += `<rect x="78" y="${hy - 6}" width="170" height="12" rx="3" fill="#2a1114" stroke="#4a1d22"/>\n`;
  const hpPct = (n) => Math.max(0, 100 - n * 10);
  const hv2 = ["170"];
  const ht2 = [0];
  hurts.forEach((h, i) => {
    ht2.push(h);
    hv2.push(String(f1((hpPct(i + 1) / 100) * 170)));
  });
  ht2.push(T);
  hv2.push(hv2[hv2.length - 1]);
  o += `<rect x="78" y="${hy - 6}" width="170" height="12" rx="3" fill="#d7263d"><animate attributeName="width" values="${hv2.join(";")}" keyTimes="${tk(ht2)}" calcMode="discrete" ${rep}/></rect>\n`;
  o += `<text x="${WIDTH - 150}" y="${hy + 4.5}" ${font} font-size="13" fill="#9aa4b5">KILLS</text>\n`;
  const killTimes = enemies.filter((e) => !e.hurt && !e.silent).map((e) => e.deathT).sort((a, b) => a - b);
  const bounds = [0, ...killTimes, T];
  for (let n = 0; n <= killTimes.length; n++) {
    const a = fk(bounds[n] / T);
    const b = fk(bounds[n + 1] / T);
    const values = n === 0 ? "1;0;0" : "0;1;0;0";
    const keys = n === 0 ? `0;${b};1` : `0;${a};${b};1`;
    o += `<text x="${WIDTH - 98}" y="${hy + 5}" ${font} font-size="15" fill="#ffffff" opacity="${n === 0 ? 1 : 0}">${n}<animate attributeName="opacity" values="${values}" keyTimes="${keys}" calcMode="discrete" ${rep}/></text>\n`;
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
console.log(`${sim.enemies.length} enemies, ${sim.kills} killed, ${sim.hurts.length} reached you, ${sim.shots.length} shots, ${sim.T}s loop, ${WIDTH}x${HEIGHT}px`);
