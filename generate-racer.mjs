#!/usr/bin/env node
// NEON RACER: a pseudo-3D racing + missile shooter, rendered as an auto-playing animated SVG
// (pure SMIL, no JavaScript, so it works inside a GitHub README <img>).
//
//  * Outrun-style perspective road, scrolling bands, rumble strips, roadside trees and lamps
//  * Your GitHub contribution graph becomes the city skyline on the horizon
//  * An autopilot weaves between traffic lanes, locks onto enemy cars and blows them up with missiles
//  * Explosions, sparks, smoke, camera shake, kill counter and HUD
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-racer.mjs <github-username>
//   node generate-racer.mjs --demo
//   node generate-racer.mjs --demo --snap 5.2     (static frame at t=5.2s, for previews)
//
// Output: dist/racer-light.svg, dist/racer-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const W = 860;
const H = 340;
const CX = W / 2;
const YH = 128; // horizon y
const C = 212; // road depth constant: screen y = YH + C / z
const R = 330; // road half-width at z = 1
const LANE = 220; // lane spacing at z = 1
const ROAD_SPEED = 9; // world units / s the road scrolls toward the camera
const BAND_L = 1.2;
const PHASES = 8;
const PH_DUR = (2 * BAND_L) / ROAD_SPEED;
const ZMAX = 40;
const PLAYER_Z = 1.25;
const SPAWN_Z = 20;
const FIRE_Z = 5.2;
const MISSILE_V = 12;
const MISSILE_Z0 = 1.3;
const EXP_DUR = 0.9;
const FPS = 30;

const sy = (z) => YH + C / z;
const sx = (lane, z) => CX + (lane * LANE) / z;

const THEMES = {
  light: {
    sky: ["#3f9cf5", "#8ccdfb", "#ffe3a8", "#ffc489"],
    sunA: "#fff6bf",
    sunB: "#ffb56b",
    sunBar: "#ffd9a0",
    farMtn: "#8fb4da",
    nearMtn: "#6f98c4",
    city: "#52708f",
    cityLit: "#fff3bd",
    cityLit2: "#bfe4ff",
    haze: "#fff0cf",
    grassA: "#5fd06c",
    grassB: "#49bb59",
    asphalt: "#474c59",
    rumbleA: "#e53935",
    rumbleB: "#ffffff",
    lane: "#ffffff",
    treeA: "#2f9e57",
    treeB: "#1f7f44",
    trunk: "#5a3d2b",
    lampPole: "#37404d",
    lampGlow: "#fff2a8",
    hud: "#ffffff",
    player: { body: "#2bd46b", neon: "#27e6ff", cabin: "#126b3a" },
    enemy: ["#ff3b30", "#ff9f0a", "#a855f7", "#ef476f", "#ff7a1a"],
    stars: false,
  },
  dark: {
    sky: ["#04020d", "#170a38", "#5a1a6e", "#ff4d8d"],
    sunA: "#ffe27a",
    sunB: "#ff4d8d",
    sunBar: "#5a1a6e",
    farMtn: "#2b1050",
    nearMtn: "#1b0a34",
    city: "#0c0720",
    cityLit: "#ffd86b",
    cityLit2: "#6be3ff",
    haze: "#ff4d8d",
    grassA: "#0a1d2c",
    grassB: "#0e2c40",
    asphalt: "#15121f",
    rumbleA: "#ff2e88",
    rumbleB: "#e8e8ff",
    lane: "#ffe28a",
    treeA: "#0f6b62",
    treeB: "#0a4d5a",
    trunk: "#1b1030",
    lampPole: "#2a2540",
    lampGlow: "#6be3ff",
    hud: "#ffffff",
    player: { body: "#39d353", neon: "#39f5ff", cabin: "#0f5a2a" },
    enemy: ["#ff2e63", "#ff9f0a", "#b45cff", "#ff4d8d", "#ff6a2a"],
    stars: true,
  },
};

// ---------- small helpers ----------
const n = (v, d = 1) => {
  const s = (+v).toFixed(d);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (u) => u * u * (3 - 2 * u);
const easeOut = (u) => 1 - (1 - u) * (1 - u);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => {
  const A = hex2(a);
  const B = hex2(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

// ---------- data ----------
const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function fetchCalendar(user, token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount contributionLevel weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "readme-racer" },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) throw new Error("GitHub API error: " + JSON.stringify(json.errors || json));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => {
    const col = Array.from({ length: 7 }, () => ({ count: 0, level: 0, exists: false }));
    for (const d of w.contributionDays) col[d.weekday] = { count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0, exists: true };
    return col;
  });
  return { weeks, total: cal.totalContributions };
}

function demoCalendar() {
  const rand = mulberry32(Number(process.env.DEMO_SEED || 42));
  const weeks = Array.from({ length: 53 }, () =>
    Array.from({ length: 7 }, () => {
      const r = rand();
      const level = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
      return { count: level * 3 + Math.floor(rand() * 3), level, exists: true };
    })
  );
  return { weeks, total: weeks.flat().reduce((s, d) => s + d.count, 0) };
}

// ---------- the "movie": enemies, kills, and the player's lane schedule ----------
function buildPlan(seedBase) {
  for (let attempt = 0; attempt < 6000; attempt++) {
    const rand = mulberry32(seedBase + attempt * 7919);
    const N = 7;
    const decoys = new Set([2, 5]);
    const enemies = [];
    for (let i = 0; i < N; i++) {
      const e = {
        i,
        lane: Math.floor(rand() * 3) - 1,
        r: 4.3 + rand() * 1.1,
        ts: 0.5 + i * 2.25 + rand() * 0.45,
        shoot: !decoys.has(i),
        color: Math.floor(rand() * 5),
      };
      if (e.shoot) {
        e.tf = e.ts + (SPAWN_Z - FIRE_Z) / e.r;
        const tau = (FIRE_Z - MISSILE_Z0) / (MISSILE_V + e.r);
        e.th = e.tf + tau;
        e.zh = FIRE_Z - e.r * tau;
        e.tEnd = e.th;
      } else {
        e.tEnd = e.ts + (SPAWN_Z - 0.55) / e.r;
        e.tPass0 = e.ts + (SPAWN_Z - 2.6) / e.r;
      }
      enemies.push(e);
    }

    const kills = enemies.filter((e) => e.shoot).sort((a, b) => a.tf - b.tf);
    const knots = [{ t: 0, l: 0 }];
    let cur = 0;
    let ok = true;
    for (const k of kills) {
      const t1 = k.tf - 0.95;
      const t2 = k.tf - 0.4;
      const t3 = k.th + 0.25;
      if (t1 < knots[knots.length - 1].t + 0.05) {
        ok = false;
        break;
      }
      knots.push({ t: t1, l: cur }, { t: t2, l: k.lane }, { t: t3, l: k.lane });
      cur = k.lane;
    }
    if (!ok) continue;
    const lastKnot = knots[knots.length - 1];
    knots.push({ t: lastKnot.t + 0.9, l: 0 });
    const endAll = Math.max(lastKnot.t + 1.3, ...enemies.map((e) => e.tEnd + 0.3));
    const T = Math.ceil(endAll * 2) / 2;
    knots.push({ t: T, l: 0 });

    const laneAt = (t) => {
      if (t <= knots[0].t) return knots[0].l;
      for (let i = 0; i < knots.length - 1; i++) {
        const a = knots[i];
        const b = knots[i + 1];
        if (t <= b.t) return a.l + (b.l - a.l) * smooth(b.t === a.t ? 1 : (t - a.t) / (b.t - a.t));
      }
      return knots[knots.length - 1].l;
    };

    // decoys must never be hit by the player's car
    for (const d of enemies.filter((e) => !e.shoot)) {
      for (let t = d.tPass0; t <= d.tEnd; t += 0.03) {
        if (Math.abs(laneAt(t) - d.lane) < 0.95) ok = false;
      }
    }
    if (!ok) continue;
    return { enemies, kills, laneAt, T, attempt };
  }
  throw new Error("could not build a valid plan");
}

// ---------- svg element builder with time-driven attributes ----------
let SNAP = null;

function uniq(arr) {
  return [...new Set(arr.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
}

// spec: { kind: 'attr'|'translate'|'scale'|'rotate', name?, fn(t), win?, times?, fps?, dur?, shift?, discrete?, events?, dec? }
function animFor(spec, T) {
  const dur = spec.dur || T;
  let times;
  if (spec.discrete) {
    times = uniq([0, ...spec.events.filter((t) => t > 0 && t < dur)]);
  } else if (spec.times && spec.dur) {
    times = uniq(spec.times);
  } else {
    const [a, b] = spec.win || [0, dur];
    let mid;
    if (spec.times) mid = spec.times.filter((t) => t > a && t < b);
    else {
      mid = [];
      const fps = spec.fps || (b - a < 1.5 ? 15 : FPS);
      for (let t = a; t < b; t += 1 / fps) mid.push(t);
    }
    times = uniq([0, a, ...mid, b, dur]).filter((t) => t >= 0 && t <= dur);
  }
  const dec = spec.dec ?? (spec.kind === "scale" ? 3 : 1);
  const fmt = (v) => (Array.isArray(v) ? v.map((x) => n(x, dec)).join(" ") : n(v, dec));
  const vals = times.map((t) => fmt(spec.fn(spec.discrete && t > 0 ? t + 1e-5 : t)));
  const keyTimes = times.map((t) => n(t / dur, 5));
  if (keyTimes[keyTimes.length - 1] !== "1" && !spec.discrete) {
    keyTimes.push("1");
    vals.push(vals[vals.length - 1]);
  }
  const begin = spec.shift ? ` begin="${n(-spec.shift, 3)}s"` : "";
  const common = `values="${vals.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${n(dur, 4)}s" repeatCount="indefinite"${begin}`;
  const calc = spec.discrete ? ` calcMode="discrete"` : "";
  if (spec.kind === "attr") return `<animate attributeName="${spec.name}"${calc} ${common}/>`;
  return `<animateTransform attributeName="transform" type="${spec.kind}" ${common}/>`;
}

function staticVal(spec, T) {
  const dur = spec.dur || T;
  let t = 0;
  if (SNAP !== null) t = spec.dur ? (SNAP + (spec.shift || 0)) % dur : SNAP;
  else if (spec.shift) t = spec.shift % dur;
  return spec.fn(t);
}

function el(tag, attrs, dyns, inner, T) {
  const a = { ...attrs };
  let anims = "";
  for (const spec of dyns || []) {
    const v = staticVal(spec, T);
    const dec = spec.dec ?? (spec.kind === "scale" ? 3 : 1);
    const fmt = (x) => (Array.isArray(x) ? x.map((q) => n(q, dec)).join(" ") : n(x, dec));
    if (spec.kind === "attr") a[spec.name] = fmt(v);
    else if (spec.kind === "translate") a.transform = `translate(${fmt(v)})`;
    else if (spec.kind === "scale") a.transform = `scale(${fmt(v)})`;
    else if (spec.kind === "rotate") a.transform = `rotate(${fmt(v)})`;
    if (SNAP === null) anims += animFor(spec, T);
  }
  const attrStr = Object.entries(a)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  const body = (inner || "") + anims;
  return body ? `<${tag} ${attrStr}>${body}</${tag}>` : `<${tag} ${attrStr}/>`;
}

// ---------- sprites ----------
function carDef(id, body, cabin, neon, isPlayer) {
  const dark = mix(body, "#000000", 0.45);
  const light = isPlayer ? "#ff3355" : "#ff2a4d";
  return `
<linearGradient id="gb-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(body, "#ffffff", 0.3)}"/><stop offset="1" stop-color="${mix(body, "#000000", 0.35)}"/></linearGradient>
<g id="${id}">
<ellipse cx="0" cy="1" rx="62" ry="8" fill="#000" opacity=".4"/>
<ellipse cx="0" cy="-2" rx="58" ry="9" fill="${neon}" opacity=".3"/>
<rect x="-58" y="-21" width="19" height="21" rx="5" fill="#09090d"/><rect x="39" y="-21" width="19" height="21" rx="5" fill="#09090d"/>
<rect x="-55" y="-16" width="13" height="2.5" fill="#262633"/><rect x="42" y="-16" width="13" height="2.5" fill="#262633"/>
<path d="M-55 -7 L-51 -34 Q-49 -39 -43 -39 L43 -39 Q49 -39 51 -34 L55 -7 Z" fill="url(#gb-${id})"/>
<path d="M-53 -5 L53 -5 L51 0 L-51 0 Z" fill="#0d0e14"/>
<path d="M-38 -39 L-28 -59 Q-26 -62 -20 -62 L20 -62 Q26 -62 28 -59 L38 -39 Z" fill="${cabin}"/>
<path d="M-32 -41 L-25 -57 L25 -57 L32 -41 Z" fill="#081022"/>
<path d="M-24 -56 L-12 -56 L-22 -41 L-31 -41 Z" fill="#fff" opacity=".13"/>
<rect x="-49" y="-33" width="29" height="9" rx="3.5" fill="${light}"/><rect x="20" y="-33" width="29" height="9" rx="3.5" fill="${light}"/>
<rect x="-45" y="-31" width="21" height="2.4" rx="1.2" fill="#fff" opacity=".55"/><rect x="24" y="-31" width="21" height="2.4" rx="1.2" fill="#fff" opacity=".55"/>
<rect x="-19" y="-30" width="38" height="3" rx="1.5" fill="${light}" opacity=".85"/>
<rect x="-13" y="-25" width="26" height="10" rx="2" fill="#eef0f5"/><rect x="-10" y="-22" width="20" height="2" fill="#9aa0b0"/><rect x="-10" y="-18.5" width="14" height="2" fill="#9aa0b0"/>
<rect x="-50" y="-70" width="100" height="5" rx="2" fill="${dark}"/><rect x="-37" y="-65" width="4" height="26" fill="${dark}"/><rect x="33" y="-65" width="4" height="26" fill="${dark}"/>
<rect x="-50" y="-70" width="100" height="1.6" rx="0.8" fill="${mix(body, "#ffffff", 0.45)}" opacity=".8"/>
${isPlayer ? `<rect x="-15" y="-76" width="30" height="7" rx="2" fill="#c7ced9"/><rect x="-12" y="-74.5" width="9" height="4" rx="1" fill="#2a3140"/><rect x="3" y="-74.5" width="9" height="4" rx="1" fill="#2a3140"/>` : ""}
<circle cx="-27" cy="-6" r="4.5" fill="#1b1b24"/><circle cx="27" cy="-6" r="4.5" fill="#1b1b24"/>
<ellipse cx="-27" cy="-2" rx="3" ry="4" fill="#ffb23e"><animate attributeName="ry" values="3;6;3.5;7;3" dur="0.18s" repeatCount="indefinite"/></ellipse>
<ellipse cx="27" cy="-2" rx="3" ry="4" fill="#ffb23e"><animate attributeName="ry" values="4;7;3;6;4" dur="0.2s" repeatCount="indefinite"/></ellipse>
</g>`;
}

function roadsideDefs(t) {
  return `
<g id="tree"><rect x="-3" y="-16" width="6" height="16" fill="${t.trunk}"/>
<path d="M0 -96 L-22 -52 L22 -52 Z" fill="${t.treeA}"/><path d="M0 -74 L-27 -30 L27 -30 Z" fill="${t.treeB}"/><path d="M0 -52 L-31 -12 L31 -12 Z" fill="${t.treeA}"/></g>
<g id="lamp"><rect x="-2.5" y="-100" width="5" height="100" fill="${t.lampPole}"/><rect x="-16" y="-104" width="22" height="4" rx="2" fill="${t.lampPole}"/>
<circle cx="-12" cy="-98" r="14" fill="url(#glow-lamp)"/><rect x="-17" y="-101" width="10" height="4" rx="2" fill="${t.lampGlow}"/></g>`;
}

// ---------- scene pieces ----------
function bandPaths(p, t) {
  const off = (p * 2 * BAND_L) / PHASES;
  let grass = "";
  let rumble = "";
  let tint = "";
  let dash = "";
  for (let k = -2; ; k++) {
    const zl = 1 + k * BAND_L - off;
    const zh = zl + BAND_L;
    if (zl > ZMAX) break;
    const lo = Math.max(zl, 1);
    const hi = Math.min(zh, ZMAX);
    if (hi <= lo) continue;
    const yl = sy(lo);
    const yh = sy(hi);
    const even = ((k % 2) + 2) % 2 === 0;
    if (even) {
      grass += `M0 ${n(yh)}H${W}V${n(yl)}H0Z`;
      for (const s of [-1, 1]) {
        const a1 = CX + (s * 1.12 * R) / hi;
        const a2 = CX + (s * R) / hi;
        const b2 = CX + (s * R) / lo;
        const b1 = CX + (s * 1.12 * R) / lo;
        rumble += `M${n(a1)} ${n(yh)}L${n(a2)} ${n(yh)}L${n(b2)} ${n(yl)}L${n(b1)} ${n(yl)}Z`;
        const w = 2.2;
        dash += `M${n(CX + (s * 110 - w) / hi)} ${n(yh)}L${n(CX + (s * 110 + w) / hi)} ${n(yh)}L${n(CX + (s * 110 + w) / lo)} ${n(yl)}L${n(CX + (s * 110 - w) / lo)} ${n(yl)}Z`;
      }
    } else {
      tint += `M${n(CX - R / hi)} ${n(yh)}L${n(CX + R / hi)} ${n(yh)}L${n(CX + R / lo)} ${n(yl)}L${n(CX - R / lo)} ${n(yl)}Z`;
    }
  }
  return { grass, rumble, tint, dash };
}

function phaseGroups(t, T) {
  const K = PHASES;
  const groups = { grass: "", rumble: "", tint: "", dash: "" };
  const fillOf = { grass: t.grassB, rumble: t.rumbleA, tint: "#ffffff", dash: t.lane };
  const opOf = { grass: 1, rumble: 1, tint: 0.05, dash: 0.95 };
  for (let p = 0; p < K; p++) {
    const paths = bandPaths(p, t);
    for (const key of Object.keys(groups)) {
      if (!paths[key]) continue;
      const events = [];
      for (let i = 1; i < K; i++) events.push((i * PH_DUR) / K);
      const spec = {
        kind: "attr",
        name: "opacity",
        discrete: true,
        dur: PH_DUR,
        events,
        fn: (tt) => (Math.floor((((tt % PH_DUR) + PH_DUR) % PH_DUR) / PH_DUR * K) === p ? 1 : 0),
        dec: 0,
      };
      groups[key] += el("g", {}, [spec], `<path d="${paths[key]}" fill="${fillOf[key]}" fill-opacity="${opOf[key]}"/>`, T);
    }
  }
  return groups;
}

function skyline(calendar, t) {
  const weeks = calendar.weeks;
  const totals = weeks.map((w) => w.reduce((s, d) => s + d.count, 0));
  const max = Math.max(1, ...totals);
  const rand = mulberry32(77);
  const bw = W / weeks.length;
  let out = `<g fill="${t.city}">`;
  let wins = "";
  const blink = [];
  weeks.forEach((_, i) => {
    const h = 10 + 56 * Math.sqrt(totals[i] / max);
    const x = i * bw;
    const y = YH + 2 - h;
    out += `<rect x="${n(x + 0.6)}" y="${n(y)}" width="${n(bw - 1.2)}" height="${n(h)}"/>`;
    if (h > 30) {
      out += `<rect x="${n(x + bw / 2 - 0.7)}" y="${n(y - 7)}" width="1.4" height="7"/>`;
    }
    const cols = bw > 14 ? 3 : 2;
    for (let r = 0; r < Math.floor((h - 6) / 8); r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() < 0.45) {
          const wx = x + 2.6 + c * ((bw - 6) / cols);
          const wy = y + 4 + r * 8;
          const col = rand() < 0.75 ? t.cityLit : t.cityLit2;
          wins += `<rect x="${n(wx)}" y="${n(wy)}" width="2.6" height="3.4" fill="${col}" opacity="${n(0.5 + rand() * 0.5, 2)}"/>`;
          if (blink.length < 14 && rand() < 0.1) blink.push([wx, wy, col]);
        }
      }
    }
  });
  out += `</g><g>${wins}</g>`;
  blink.forEach(([wx, wy, col], i) => {
    out += `<rect x="${n(wx)}" y="${n(wy)}" width="2.6" height="3.4" fill="${col}" opacity="1"><animate attributeName="opacity" values="1;0;1;1" keyTimes="0;.3;.4;1" dur="${n(2 + (i % 5) * 0.7, 1)}s" begin="${n(-i * 0.4, 1)}s" repeatCount="indefinite"/></rect>`;
  });
  return out;
}

function mountains(color, seed, base, amp, step) {
  const rand = mulberry32(seed);
  let d = `M0 ${YH + 2}`;
  let y = base;
  for (let x = 0; x <= W + step; x += step) {
    y = clamp(base + (rand() - 0.5) * 2 * amp, base - amp, base + amp);
    d += `L${x} ${n(y)}`;
  }
  d += `L${W + step} ${YH + 2}Z`;
  return `<path d="${d}" fill="${color}"/>`;
}

function roadside(t, T) {
  const ZMIN = 1.05;
  const D = (ZMAX - ZMIN) / ROAD_SPEED;
  const y0 = sy(ZMAX);
  const y1 = sy(ZMIN);
  const times = [];
  const zs = [];
  const NS = 30;
  for (let i = 0; i <= NS; i++) {
    const y = y0 + ((y1 - y0) * i) / NS;
    const z = C / (y - YH);
    zs.push(z);
    times.push((ZMAX - z) / ROAD_SPEED);
  }
  const zAt = (tt) => {
    const z = ZMAX - ROAD_SPEED * tt;
    return clamp(z, ZMIN, ZMAX);
  };
  let out = "";
  const COUNT = 7;
  for (let i = 0; i < COUNT; i++) {
    for (const side of [-1, 1]) {
      const kind = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "tree" : "lamp";
      const shift = (D / COUNT) * i + (side > 0 ? D / (COUNT * 2) : 0);
      const off = kind === "lamp" ? 1.22 : 1.5;
      const flip = kind === "lamp" ? (side > 0 ? -1 : 1) : 1;
      const pos = el(
        "g",
        {},
        [{ kind: "translate", dur: D, shift, times, fn: (tt) => [CX + (side * off * R) / zAt(tt), sy(zAt(tt))] }],
        el("g", {}, [{ kind: "scale", dur: D, shift, times, fn: (tt) => [flip / zAt(tt), 1 / zAt(tt)], dec: 3 }], `<use href="#${kind}"/>`, T),
        T
      );
      out += pos;
    }
  }
  return out;
}

// ---------- compose ----------
function buildSvg(calendar, plan, theme, user) {
  const t = THEMES[theme];
  const { enemies, kills, laneAt, T } = plan;
  const ph = phaseGroups(t, T);
  const kc = (tt) => kills.filter((k) => k.th <= tt).length;
  const hitWin = (k) => [k.th, k.th + EXP_DUR];

  // ---- defs
  let defs = `<clipPath id="frame"><rect width="${W}" height="${H}" rx="8"/></clipPath>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${t.sky.map((c, i) => `<stop offset="${n(i / 3, 2)}" stop-color="${c}"/>`).join("")}</linearGradient>
<linearGradient id="sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.sunA}"/><stop offset="1" stop-color="${t.sunB}"/></linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.haze}" stop-opacity="0"/><stop offset=".55" stop-color="${t.haze}" stop-opacity=".55"/><stop offset="1" stop-color="${t.haze}" stop-opacity="0"/></linearGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></radialGradient>
<radialGradient id="fire" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff7c2"/><stop offset=".35" stop-color="#ffc233"/><stop offset=".75" stop-color="#ff5a1f"/><stop offset="1" stop-color="#b3200f" stop-opacity="0"/></radialGradient>
<radialGradient id="glow-lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${t.lampGlow}" stop-opacity=".9"/><stop offset="1" stop-color="${t.lampGlow}" stop-opacity="0"/></radialGradient>
<radialGradient id="glow-missile" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" /><stop offset=".3" stop-color="#ffd24a"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
<linearGradient id="trail" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd24a" stop-opacity=".95"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></linearGradient>`;
  defs += carDef("car-player", t.player.body, t.player.cabin, t.player.neon, true);
  t.enemy.forEach((c, i) => (defs += carDef(`car-e${i}`, c, mix(c, "#000000", 0.5), mix(c, "#ffffff", 0.2), false)));
  defs += roadsideDefs(t);

  // ---- background
  let bg = `<rect width="${W}" height="${YH + 2}" fill="url(#sky)"/>`;
  if (t.stars) {
    const r = mulberry32(5);
    for (let i = 0; i < 46; i++) {
      const tw = i % 6 === 0 ? `<animate attributeName="opacity" values="1;.2;1" dur="${n(1.5 + r() * 2, 1)}s" repeatCount="indefinite"/>` : "";
      bg += `<circle cx="${n(r() * W)}" cy="${n(r() * 78)}" r="${n(0.5 + r() * 0.9, 1)}" fill="#fff" opacity="${n(0.4 + r() * 0.6, 2)}">${tw}</circle>`;
    }
  } else {
    bg += `<g fill="#fff" opacity=".85">` + [[90, 38, 1], [420, 26, 0.8], [700, 48, 1.1]].map(([x, y, s], i) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="34" ry="9"/><ellipse cx="-16" cy="-6" rx="18" ry="9"/><ellipse cx="12" cy="-8" rx="20" ry="10"/><animateTransform attributeName="transform" type="translate" values="0 0;${40 + i * 10} 0;0 0" dur="${50 + i * 17}s" repeatCount="indefinite" additive="sum"/></g>`).join("") + `</g>`;
  }
  const sunY = YH - 24;
  bg += `<clipPath id="sunclip"><circle cx="${CX}" cy="${sunY}" r="64"/></clipPath><circle cx="${CX}" cy="${sunY}" r="64" fill="url(#sun)"/>`;
  bg += `<g clip-path="url(#sunclip)" fill="${t.sunBar}">` + [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${CX - 70}" y="${n(sunY + 6 + i * 10)}" width="140" height="${n(1.5 + i * 1.1, 1)}"/>`).join("") + `</g>`;
  bg += mountains(t.farMtn, 11, YH - 30, 16, 36);
  bg += mountains(t.nearMtn, 23, YH - 14, 9, 28);
  bg += skyline(calendar, t);
  bg += `<rect x="0" y="${YH - 16}" width="${W}" height="30" fill="url(#haze)"/>`;

  // ---- ground + road
  let ground = `<rect x="0" y="${YH}" width="${W}" height="${H - YH}" fill="${t.grassA}"/>` + ph.grass;
  ground += `<path d="M${CX} ${YH}L${CX + 1.12 * R} ${H}L${CX - 1.12 * R} ${H}Z" fill="${t.rumbleB}"/>` + ph.rumble;
  ground += `<path d="M${CX} ${YH}L${CX + R} ${H}L${CX - R} ${H}Z" fill="${t.asphalt}"/>` + ph.tint + ph.dash;
  ground += `<path d="M${CX} ${YH}L${CX + 0.955 * R} ${H}L${CX + 0.985 * R} ${H}ZM${CX} ${YH}L${CX - 0.955 * R} ${H}L${CX - 0.985 * R} ${H}Z" fill="${t.rumbleB}"/>`;
  ground += `<rect x="0" y="${YH}" width="${W}" height="14" fill="url(#haze)" opacity=".7"/>`;

  // ---- traffic (far -> near)
  let traffic = "";
  const order = [...enemies].sort((a, b) => b.ts - a.ts);
  for (const e of order) {
    const zNow = (tt) => clamp(SPAWN_Z - e.r * (tt - e.ts), 0.55, SPAWN_Z);
    const zEnd = e.shoot ? e.zh : 0.55;
    const nSamp = e.shoot ? 24 : 70;
    const times = [];
    for (let i = 0; i <= nSamp; i++) {
      const z = SPAWN_Z * Math.pow(zEnd / SPAWN_Z, i / nSamp);
      times.push(e.ts + (SPAWN_Z - z) / e.r);
    }
    const win = [e.ts, e.tEnd];
    const vis = { kind: "attr", name: "opacity", discrete: true, events: [e.ts, e.tEnd], dec: 0, fn: (tt) => (tt >= e.ts && tt < e.tEnd ? 1 : 0) };
    const pos = { kind: "translate", win, times, fn: (tt) => [sx(e.lane, zNow(tt)), sy(zNow(tt))] };
    const scl = { kind: "scale", win, times, fn: (tt) => 1 / zNow(tt) };
    traffic += el("g", {}, [vis], el("g", {}, [pos], el("g", {}, [scl], `<use href="#car-e${e.color}"/>`, T), T), T);
  }

  // ---- player
  const px = (tt) => sx(laneAt(tt), PLAYER_Z);
  const py = (tt) => sy(PLAYER_Z) + Math.sin(tt * 20) * 0.7;
  const prot = (tt) => clamp(((laneAt(tt + 0.02) - laneAt(tt - 0.02)) / 0.04) * 7, -12, 12);
  const player = el(
    "g",
    {},
    [{ kind: "translate", fn: (tt) => [px(tt), py(tt)], fps: 20 }],
    el(
      "g",
      {},
      [{ kind: "rotate", fn: (tt) => [prot(tt), 0, -28], fps: 20 }],
      el("g", { transform: `scale(${n(1 / PLAYER_Z, 3)})` }, [], `<use href="#car-player"/>`, T),
      T
    ),
    T
  );

  // ---- missiles, muzzle flashes
  let missiles = "";
  for (const k of kills) {
    const tau = (FIRE_Z - MISSILE_Z0) / (MISSILE_V + k.r);
    const mz = (tt) => MISSILE_Z0 + MISSILE_V * clamp(tt - k.tf, 0, tau);
    const mh = (tt) => 45 - 21 * clamp((tt - k.tf) / tau, 0, 1);
    const pos = (tt) => [sx(k.lane, mz(tt)), sy(mz(tt)) - mh(tt) / mz(tt)];
    const vis = { kind: "attr", name: "opacity", discrete: true, events: [k.tf, k.th], dec: 0, fn: (tt) => (tt >= k.tf && tt < k.th ? 1 : 0) };
    const win = [k.tf, k.th];
    const body =
      `<path d="M0 0L0 46" stroke="url(#trail)" stroke-width="7" stroke-linecap="round"/>` +
      `<circle r="12" fill="url(#glow-missile)"/><ellipse rx="4" ry="5.5" fill="#e8ecf4"/><ellipse rx="2" ry="3" fill="#fff"/>`;
    missiles += el(
      "g",
      {},
      [vis],
      el("g", {}, [{ kind: "translate", win, fps: 60, fn: pos }], el("g", {}, [{ kind: "scale", win, fps: 60, fn: (tt) => 1 / mz(tt) }], body, T), T),
      T
    );
    const mx = px(k.tf);
    const my = py(k.tf) - 78 / PLAYER_Z;
    missiles += el(
      "circle",
      { cx: n(mx), cy: n(my), fill: "#ffe9a8" },
      [
        { kind: "attr", name: "r", win: [k.tf, k.tf + 0.16], fps: 60, fn: (tt) => 4 + 16 * clamp((tt - k.tf) / 0.16, 0, 1) },
        { kind: "attr", name: "opacity", win: [k.tf, k.tf + 0.16], fps: 60, fn: (tt) => (tt < k.tf ? 0 : 1 - clamp((tt - k.tf) / 0.16, 0, 1)) },
      ],
      "",
      T
    );
  }

  // ---- explosions
  let boom = "";
  let popups = "";
  const flashTimes = [];
  for (const k of kills) {
    const ex = sx(k.lane, k.zh);
    const S = 150 / k.zh;
    const ey = sy(k.zh) - 24 / k.zh;
    const win = hitWin(k);
    const P = (tt) => clamp((tt - k.th) / EXP_DUR, 0, 1);
    const fade = (a, b) => (tt) => {
      const p = P(tt);
      if (p <= 0 || p >= 1) return 0;
      return p < a ? 1 : clamp(1 - (p - a) / (b - a), 0, 1);
    };
    let g = "";
    g += el("circle", { cx: 0, cy: 0, fill: "#fff" }, [{ kind: "attr", name: "r", win, fn: (tt) => (P(tt) <= 0 ? 0 : S * (0.2 + 1.5 * easeOut(clamp(P(tt) * 3, 0, 1)))) }, { kind: "attr", name: "opacity", win, fn: fade(0.05, 0.3) }], "", T);
    g += el("circle", { cx: 0, cy: 0, fill: "url(#fire)" }, [{ kind: "attr", name: "r", win, fn: (tt) => (P(tt) <= 0 ? 0 : S * (0.35 + 1.05 * easeOut(P(tt)))) }, { kind: "attr", name: "opacity", win, fn: fade(0.35, 0.95) }], "", T);
    g += el("circle", { cx: 0, cy: 0, fill: "none", stroke: "#ffd9a0", "stroke-width": n(Math.max(1.5, S / 14), 1) }, [{ kind: "attr", name: "r", win, fn: (tt) => (P(tt) <= 0 ? 0 : S * (0.4 + 2.1 * easeOut(P(tt)))) }, { kind: "attr", name: "opacity", win, fn: (tt) => (P(tt) <= 0 || P(tt) >= 1 ? 0 : 0.8 * (1 - P(tt))) }], "", T);
    const sr = mulberry32(k.i * 131 + 7);
    for (let s = 0; s < 9; s++) {
      const a = sr() * Math.PI * 2;
      const v = (0.9 + sr() * 1.3) * S;
      g += el("circle", { fill: s % 3 === 0 ? "#fff1a8" : "#ff9a2e", r: n(Math.max(1, S / 16), 1) }, [
        { kind: "attr", name: "cx", win, fn: (tt) => Math.cos(a) * v * easeOut(P(tt)) },
        { kind: "attr", name: "cy", win, fn: (tt) => Math.sin(a) * v * easeOut(P(tt)) * 0.8 + S * 0.9 * P(tt) * P(tt) },
        { kind: "attr", name: "opacity", win, fn: fade(0.5, 1) },
      ], "", T);
    }
    for (let s = 0; s < 3; s++) {
      const a = -Math.PI / 2 + (sr() - 0.5) * 1.4;
      const v = (0.5 + sr() * 0.8) * S;
      g += el("rect", { width: n(Math.max(3, S / 7), 1), height: n(Math.max(2, S / 11), 1), fill: s % 2 ? "#1a1a22" : "#ff3b30", x: 0, y: 0 }, [
        { kind: "attr", name: "x", win, fn: (tt) => Math.cos(a) * v * 1.2 * easeOut(P(tt)) },
        { kind: "attr", name: "y", win, fn: (tt) => Math.sin(a) * v * 1.2 * easeOut(P(tt)) + S * 1.3 * P(tt) * P(tt) },
        { kind: "attr", name: "opacity", win, fn: fade(0.6, 1) },
      ], "", T);
    }
    for (let s = 0; s < 3; s++) {
      const ox = (s - 1.5) * S * 0.22;
      g += el("circle", { cx: n(ox), fill: "#2b2b33" }, [
        { kind: "attr", name: "cy", win, fn: (tt) => -S * (0.2 + 0.9 * P(tt)) },
        { kind: "attr", name: "r", win, fn: (tt) => (P(tt) <= 0 ? 0 : S * (0.25 + 0.4 * P(tt))) },
        { kind: "attr", name: "opacity", win, fn: (tt) => (P(tt) <= 0.15 || P(tt) >= 1 ? 0 : 0.55 * (1 - P(tt))), dec: 2 },
      ], "", T);
    }
    boom += `<g transform="translate(${n(ex)} ${n(ey)})">${g}</g>`;
    popups += el("text", { x: n(ex), "text-anchor": "middle", "font-family": "'Courier New',monospace", "font-size": 15, "font-weight": 800, fill: "#ffe066", stroke: "#000", "stroke-width": 3, "paint-order": "stroke" }, [
      { kind: "attr", name: "y", win: [k.th, k.th + 1.1], fn: (tt) => ey - S * 0.6 - 30 * easeOut(clamp((tt - k.th) / 1.1, 0, 1)) },
      { kind: "attr", name: "opacity", win: [k.th, k.th + 1.1], fn: (tt) => (tt < k.th + 0.05 || tt > k.th + 1.1 ? 0 : 1 - clamp((tt - k.th - 0.5) / 0.6, 0, 1)), dec: 2 },
    ], "+100", T);
    for (let tt = k.th; tt < k.th + 0.3; tt += 1 / 30) flashTimes.push(tt);
  }

  // ---- camera shake + screen flash
  const shake = (tt) => {
    let sxv = 0;
    let syv = 0;
    for (const k of kills) {
      const d = tt - k.th;
      if (d >= 0 && d < 0.45) {
        const a = Math.pow(1 - d / 0.45, 2) * 3.2;
        sxv += Math.sin(tt * 95) * a;
        syv += Math.cos(tt * 77) * a;
      }
    }
    return [sxv, syv];
  };
  const shakeTimes = [];
  for (const k of kills) for (let tt = k.th; tt < k.th + 0.46; tt += 1 / 24) shakeTimes.push(tt);
  const flash = (tt) => {
    let v = 0;
    for (const k of kills) {
      const d = tt - k.th;
      if (d >= 0 && d < 0.28) v = Math.max(v, 0.3 * (1 - d / 0.28));
    }
    return v;
  };

  // ---- speed lines
  let speed = "";
  for (let i = 0; i < 16; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const dx = (20 + (i >> 1) * 22) * side;
    speed += `<path d="M${CX + dx * 0.3} ${YH + 30}L${CX + dx * 4.2} ${H}" stroke="#fff" stroke-opacity=".16" stroke-width="1.4" stroke-dasharray="14 70" fill="none"><animate attributeName="stroke-dashoffset" values="0;-84" dur="${n(0.28 + (i % 4) * 0.04, 2)}s" repeatCount="indefinite"/></path>`;
  }

  // ---- HUD
  const NAME = (user || "demo").toUpperCase();
  let killTexts = "";
  for (let i = 0; i <= kills.length; i++) {
    const events = kills.map((k) => k.th);
    killTexts += el("text", { x: W - 28, y: 28, "text-anchor": "end", "font-family": "'Courier New',monospace", "font-size": 15, "font-weight": 800, fill: "#fff" }, [
      { kind: "attr", name: "opacity", discrete: true, events, dec: 0, fn: (tt) => (kc(tt) === i ? 1 : 0) },
    ], `KILLS ${String(i).padStart(2, "0")}`, T);
  }
  const hud =
    `<rect x="12" y="10" width="${Math.min(470, 24 + 9.1 * (`@${NAME}   ${calendar.total.toLocaleString("en-US")} CONTRIBUTIONS`).length)}" height="26" rx="13" fill="#000" fill-opacity=".5"/>` +
    `<text x="26" y="28" font-family="'Courier New',monospace" font-size="13" font-weight="700" fill="${t.hud}">@${NAME}   <tspan fill="#ffd24a">${calendar.total.toLocaleString("en-US")}</tspan> CONTRIBUTIONS</text>` +
    `<rect x="${W - 138}" y="10" width="126" height="26" rx="13" fill="#000" fill-opacity=".5"/>` +
    killTexts +
    `<text x="14" y="${H - 22}" font-family="'Courier New',monospace" font-size="10" font-weight="800" fill="#fff" fill-opacity=".85">NITRO</text>` +
    `<rect x="52" y="${H - 30}" width="120" height="9" rx="4.5" fill="#000" fill-opacity=".5"/>` +
    `<rect x="52" y="${H - 30}" width="60" height="9" rx="4.5" fill="${t.player.neon}"><animate attributeName="width" values="40;118;64;110;40" dur="6s" repeatCount="indefinite"/></rect>`;

  const scene =
    `<g>${bg}${ground}${roadside(t, T)}${traffic}${missiles}${player}${boom}${popups}${speed}</g>`;
  const shaken = el("g", {}, [{ kind: "translate", win: [0, T], times: shakeTimes, fn: shake }], scene, T);
  const flashRect = el("rect", { width: W, height: H, fill: "#fff" }, [{ kind: "attr", name: "opacity", win: [0, T], times: flashTimes, fn: flash, dec: 3 }], "", T);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">` +
    `<title>Neon Racer: a racing and shooting game on my GitHub contribution skyline</title>` +
    `<defs>${defs}</defs>` +
    `<g clip-path="url(#frame)">${shaken}${flashRect}<rect width="${W}" height="${H}" fill="url(#vig)"/>${hud}</g>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="none" stroke="${theme === "dark" ? "#30363d" : "#d0d7de"}"/>` +
    `</svg>\n`
  );
}

// ---------- main ----------
const args = process.argv.slice(2);
const demo = args.includes("--demo");
const snapIdx = args.indexOf("--snap");
if (snapIdx >= 0) SNAP = parseFloat(args[snapIdx + 1]);
const user = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--snap") || process.env.GITHUB_USER;

let calendar;
if (demo) calendar = demoCalendar();
else {
  if (!user) throw new Error("Pass a GitHub username (or use --demo).");
  if (!process.env.GITHUB_TOKEN) throw new Error("Set GITHUB_TOKEN.");
  calendar = await fetchCalendar(user, process.env.GITHUB_TOKEN);
}

// deterministic plan seeded from your contribution data
let seed = 0x811c9dc5;
for (const w of calendar.weeks) for (const d of w) seed = (Math.imul(seed ^ (d.count + 1), 0x01000193) + 13) >>> 0;
const plan = buildPlan(seed);

mkdirSync(OUT_DIR, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const svg = buildSvg(calendar, plan, theme, user || "demo");
  const file = SNAP !== null ? `${OUT_DIR}/racer-snap-${theme}.svg` : `${OUT_DIR}/racer-${theme}.svg`;
  writeFileSync(file, svg);
  console.log(`${file}  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`loop ${plan.T}s, ${plan.kills.length} kills, ${plan.enemies.length} cars (plan #${plan.attempt})`);
