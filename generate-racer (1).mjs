#!/usr/bin/env node
// NEON RACER (dodge + coins): a pseudo-3D driving game rendered as an auto-playing animated SVG
// (pure SMIL, no JavaScript, so it works inside a GitHub README <img>).
//
//  * Perspective road with scrolling bands, rumble strips, roadside trees and lamp posts
//  * Layered city skyline (your contribution graph sets the tallest buildings), clouds, haze and a low sun
//  * An autopilot dodges oncoming traffic and weaves through lanes to collect coin trails
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
const C = 212; // screen y = YH + C / z
const R = 330; // road half-width at z = 1
const LANE = 220; // lane spacing at z = 1
const ROAD_SPEED = 9; // world units / s
const BAND_L = 1.2;
const PHASES = 8;
const PH_DUR = (2 * BAND_L) / ROAD_SPEED;
const ZMAX = 40;
const PLAYER_Z = 1.25;
const SPAWN_Z = 20;
const FPS = 30;

const COIN_GROUPS = 6;
const COINS_PER_GROUP = 5;
const COIN_DZ = 1.5;
const COIN_H = 26; // coin height above the road (world units)

const sy = (z) => YH + C / z;
const sx = (lane, z) => CX + (lane * LANE) / z;

const THEMES = {
  light: {
    night: false,
    sky: ["#2d7bd6", "#5fa7ec", "#a9d3f5", "#e4edf0", "#fbe3c0"],
    glow: "#fff1c2",
    sunDisc: "#fffdf0",
    cloudTop: "#ffffff",
    cloudBot: "#b4cbe4",
    haze: "#dfe9f1",
    farMtn: "#8fa9c8",
    midMtn: "#6d8db2",
    city: "#4d6884",
    winA: "#aee0ff",
    winB: "#ffffff",
    grassA: "#63b25a",
    grassB: "#559f4d",
    asphalt: "#454a55",
    rumbleA: "#d93a32",
    rumbleB: "#f4f4f4",
    lane: "#f2f2f2",
    treeA: "#2f8a4a",
    treeB: "#226f3a",
    trunk: "#4e3626",
    lampPole: "#3a424f",
    lampGlow: "#fff0a0",
    player: { body: "#2bd46b", neon: "#27e6ff", cabin: "#126b3a" },
    enemy: ["#d9382f", "#e08a1e", "#7a49c9", "#2f7fd3", "#c93b7a"],
  },
  dark: {
    night: true,
    sky: ["#04061a", "#101a4a", "#3a2f6e", "#b3547a", "#ff9a62"],
    glow: "#ff9a5a",
    sunDisc: "#ffe3a0",
    cloudTop: "#9a64a8",
    cloudBot: "#2b2250",
    haze: "#ff8f6b",
    farMtn: "#43306d",
    midMtn: "#2a1d4e",
    city: "#0b0a1c",
    winA: "#ffd58a",
    winB: "#7fdcff",
    grassA: "#0c1a22",
    grassB: "#10242d",
    asphalt: "#16151e",
    rumbleA: "#c2285a",
    rumbleB: "#d8d8ea",
    lane: "#ffd98a",
    treeA: "#0d4a48",
    treeB: "#0a3a3f",
    trunk: "#1b1030",
    lampPole: "#2a2540",
    lampGlow: "#ffd27a",
    player: { body: "#39d353", neon: "#39f5ff", cabin: "#0f5a2a" },
    enemy: ["#e0284f", "#f0901a", "#a655ee", "#e8478f", "#f0602a"],
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

// ---------- the "movie": traffic, coins, and the autopilot's lane schedule ----------
function buildPlan(seedBase) {
  for (let attempt = 0; attempt < 8000; attempt++) {
    const rand = mulberry32(seedBase + attempt * 7919);

    // traffic
    const cars = [];
    for (let i = 0; i < 7; i++) {
      const r = 4.2 + rand() * 1.1;
      const ts = 0.4 + i * 2.3 + rand() * 0.6;
      let lane = Math.floor(rand() * 3) - 1;
      const tc = ts + (SPAWN_Z - PLAYER_Z) / r;
      for (let tries = 0; tries < 4; tries++) {
        if (cars.some((c) => c.lane === lane && Math.abs(c.tc - tc) < 1.5)) lane = ((lane + 2) % 3) - 1;
      }
      cars.push({ i, r, ts, lane, tc, tEnd: ts + (SPAWN_Z - 0.45) / r, color: Math.floor(rand() * 5) });
    }

    // coin trails
    const groups = [];
    for (let g = 0; g < COIN_GROUPS; g++) {
      const ts = 0.8 + g * 2.9 + rand() * 0.5;
      const lane = Math.floor(rand() * 3) - 1;
      const coins = [];
      for (let k = 0; k < COINS_PER_GROUP; k++) {
        const z0 = SPAWN_Z + k * COIN_DZ;
        coins.push({ g, k, lane, ts, z0, arrive: ts + (z0 - PLAYER_Z) / ROAD_SPEED, pass: ts + (z0 - 0.45) / ROAD_SPEED });
      }
      groups.push({ g, ts, lane, coins, a0: coins[0].arrive, a1: coins[COINS_PER_GROUP - 1].arrive, handled: false });
    }

    const blocks = (lane, t0, t1) => cars.some((c) => c.lane === lane && c.tc + 0.36 > t0 && c.tc - 0.36 < t1);
    const lastEvent = Math.max(...cars.map((c) => c.tEnd), ...groups.map((g) => g.coins[COINS_PER_GROUP - 1].pass));

    // reactive planner: dodge cars, steer toward coin trails
    const knots = [{ t: 0, l: 0 }];
    let cur = 0;
    let moveEnd = 0;
    let failed = false;
    for (let t = 0; t < lastEvent && !failed; t += 0.05) {
      if (t < moveEnd - 1e-9) continue;

      const threat = cars.find((c) => c.lane === cur && c.tc - 0.36 - t <= 1.05 && c.tc + 0.36 > t);
      if (threat) {
        const opts = [cur - 1, cur + 1].filter((l) => l >= -1 && l <= 1 && !blocks(l, t, threat.tc + 0.7));
        if (!opts.length) {
          failed = true;
          break;
        }
        const wanted = groups.find((g) => !g.handled && g.a0 > t && opts.includes(g.lane));
        const X = wanted ? wanted.lane : opts[Math.floor(rand() * opts.length)];
        knots.push({ t, l: cur }, { t: t + 0.5, l: X });
        cur = X;
        moveEnd = t + 0.5;
        continue;
      }

      const g = groups.find((q) => !q.handled && q.a1 > t);
      if (g) {
        if (g.lane === cur) g.handled = true;
        else {
          const need = Math.abs(g.lane - cur);
          const dur = 0.55 * need;
          if (g.a0 - t <= dur + 0.5) {
            g.handled = true;
            if (g.a0 - t >= dur + 0.1) {
              const lanes = [];
              for (let l = Math.min(cur, g.lane); l <= Math.max(cur, g.lane); l++) lanes.push(l);
              const safe = lanes.every((l) => (l === g.lane ? !blocks(l, t + dur - 0.2, g.a1 + 0.25) : !blocks(l, t, t + dur + 0.15)));
              if (safe) {
                knots.push({ t, l: cur }, { t: t + dur, l: g.lane });
                cur = g.lane;
                moveEnd = t + dur;
              }
            }
          }
        }
      }
    }
    if (failed) continue;

    // drift back to the centre lane so the loop is seamless
    const tBack = Math.max(lastEvent, moveEnd) + 0.1;
    knots.push({ t: tBack, l: cur }, { t: tBack + 0.7, l: 0 });
    const T = Math.ceil((tBack + 1.2) * 2) / 2;
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

    // verify: no collisions at all
    for (let t = 0; t < T && !failed; t += 0.02) {
      const l = laneAt(t);
      for (const c of cars) if (Math.abs(t - c.tc) < 0.3 && Math.abs(l - c.lane) < 0.8) failed = true;
    }
    if (failed) continue;

    // which coins get collected
    let got = 0;
    for (const gr of groups)
      for (const c of gr.coins) {
        c.collected = Math.abs(laneAt(c.arrive) - c.lane) < 0.3;
        if (c.collected) got++;
      }
    if (got < 14) continue;

    return { cars, groups, laneAt, T, got, attempt };
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
${isPlayer ? `<ellipse cx="0" cy="-2" rx="58" ry="9" fill="${neon}" opacity=".3"/>` : ""}
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
<circle cx="-27" cy="-6" r="4.5" fill="#1b1b24"/><circle cx="27" cy="-6" r="4.5" fill="#1b1b24"/>
<ellipse cx="-27" cy="-2" rx="3" ry="4" fill="#ffb23e"><animate attributeName="ry" values="3;6;3.5;7;3" dur="0.18s" repeatCount="indefinite"/></ellipse>
<ellipse cx="27" cy="-2" rx="3" ry="4" fill="#ffb23e"><animate attributeName="ry" values="4;7;3;6;4" dur="0.2s" repeatCount="indefinite"/></ellipse>
</g>`;
}

function coinDef() {
  return `
<linearGradient id="goldG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset=".5" stop-color="#ffc928"/><stop offset="1" stop-color="#c98a00"/></linearGradient>
<g id="coin"><circle r="13" fill="#9a6a00"/><circle r="12" fill="url(#goldG)"/><circle r="8.2" fill="none" stroke="#b97d00" stroke-width="1.6"/>
<path d="M-2.2 -5.5h4.4v11h-4.4z" fill="#b97d00" opacity=".8"/><path d="M-9 -6 A11 11 0 0 1 3 -10.5" fill="none" stroke="#fffbe0" stroke-width="2" stroke-linecap="round" opacity=".85"/></g>`;
}

function roadsideDefs(t) {
  return `
<g id="tree"><rect x="-3" y="-16" width="6" height="16" fill="${t.trunk}"/>
<path d="M0 -96 L-22 -52 L22 -52 Z" fill="${t.treeA}"/><path d="M0 -74 L-27 -30 L27 -30 Z" fill="${t.treeB}"/><path d="M0 -52 L-31 -12 L31 -12 Z" fill="${t.treeA}"/></g>
<g id="lamp"><rect x="-2.5" y="-100" width="5" height="100" fill="${t.lampPole}"/><rect x="-16" y="-104" width="22" height="4" rx="2" fill="${t.lampPole}"/>
${t.night ? `<circle cx="-12" cy="-98" r="14" fill="url(#glow-lamp)"/>` : ""}<rect x="-17" y="-101" width="10" height="4" rx="2" fill="${t.lampGlow}"/></g>`;
}

// ---------- road ----------
function bandPaths(p) {
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
  const opOf = { grass: 1, rumble: 1, tint: 0.04, dash: 0.92 };
  for (let p = 0; p < K; p++) {
    const paths = bandPaths(p);
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

function roadside(t, T) {
  const ZMIN = 1.05;
  const D = (ZMAX - ZMIN) / ROAD_SPEED;
  const y0 = sy(ZMAX);
  const y1 = sy(ZMIN);
  const times = [];
  const NS = 30;
  for (let i = 0; i <= NS; i++) {
    const y = y0 + ((y1 - y0) * i) / NS;
    times.push((ZMAX - C / (y - YH)) / ROAD_SPEED);
  }
  const zAt = (tt) => clamp(ZMAX - ROAD_SPEED * tt, ZMIN, ZMAX);
  let out = "";
  const COUNT = 7;
  for (let i = 0; i < COUNT; i++) {
    for (const side of [-1, 1]) {
      const kind = (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "tree" : "lamp";
      const shift = (D / COUNT) * i + (side > 0 ? D / (COUNT * 2) : 0);
      const off = kind === "lamp" ? 1.22 : 1.5;
      const flip = kind === "lamp" ? (side > 0 ? -1 : 1) : 1;
      out += el(
        "g",
        {},
        [{ kind: "translate", dur: D, shift, times, fn: (tt) => [CX + (side * off * R) / zAt(tt), sy(zAt(tt))] }],
        el("g", {}, [{ kind: "scale", dur: D, shift, times, fn: (tt) => [flip / zAt(tt), 1 / zAt(tt)], dec: 3 }], `<use href="#${kind}"/>`, T),
        T
      );
    }
  }
  return out;
}

// ---------- sky, clouds, mountains, city ----------
function cloudLayer(seed, yMin, yMax, count, scale, op, dur, flat) {
  const rand = mulberry32(seed);
  let one = "";
  for (let i = 0; i < count; i++) {
    const cx = rand() * W;
    const cy = yMin + rand() * (yMax - yMin);
    const s = scale * (0.7 + rand() * 0.8);
    const puffs = flat ? 3 : 4 + Math.floor(rand() * 4);
    for (let p = 0; p < puffs; p++) {
      const px = cx + (p - puffs / 2) * s * (flat ? 26 : 14) + (rand() - 0.5) * 8;
      const py = cy + (rand() - 0.5) * (flat ? 2 : 6);
      const rx = s * (flat ? 30 + rand() * 30 : 14 + rand() * 16);
      const ry = s * (flat ? 2.6 + rand() * 2 : 5 + rand() * 6);
      one += `<ellipse cx="${n(px)}" cy="${n(py)}" rx="${n(rx)}" ry="${n(ry)}"/>`;
    }
  }
  return (
    `<g opacity="${op}" fill="url(#cloud)"><g>${one}<g transform="translate(${W} 0)">${one}</g>` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;${-W} 0" dur="${dur}s" repeatCount="indefinite"/></g></g>`
  );
}

function ridge(color, seed, base, amp, step) {
  const rand = mulberry32(seed);
  const pts = [];
  let y = base;
  for (let x = -step; x <= W + step * 2; x += step) {
    y = clamp(y + (rand() - 0.5) * amp * 1.6, base - amp, base + amp);
    pts.push([x, y]);
  }
  let d = `M${pts[0][0]} ${YH + 3}L${pts[0][0]} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${pts[i][0]} ${n(pts[i][1])} ${n(mx)} ${n(my)}`;
  }
  d += `L${W + step * 2} ${YH + 3}Z`;
  return `<path d="${d}" fill="${color}"/>`;
}

function cityLayer(calendar, t, o) {
  const rand = mulberry32(o.seed);
  const totals = calendar.weeks.map((w) => w.reduce((s, d) => s + d.count, 0));
  const max = Math.max(1, ...totals);
  const color = o.color;
  let shapes = "";
  const winPaths = {};
  let lights = "";
  const addWin = (col, x, y, w, h) => {
    winPaths[col] = (winPaths[col] || "") + `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
  };
  let x = -4;
  let lightCount = 0;
  while (x < W + 4) {
    const w = o.wMin + rand() * (o.wMax - o.wMin);
    const cx = x + w / 2;
    let h;
    if (o.heat) {
      const idx = clamp(Math.floor((cx / W) * calendar.weeks.length), 0, calendar.weeks.length - 1);
      const norm = Math.sqrt(totals[idx] / max);
      h = o.hMin + o.hRange * (0.8 * norm + 0.2 * rand());
    } else h = o.hMin + o.hRange * rand();
    const y = YH + 3 - h;
    shapes += `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`;

    if (o.detail) {
      // rooftop variety
      const kind = Math.floor(rand() * 6);
      if (kind === 0) shapes += `<rect x="${n(x - 0.6)}" y="${n(y - 1.6)}" width="${n(w + 1.2)}" height="1.8"/>`;
      else if (kind === 1 && h > 28) shapes += `<rect x="${n(x + w * 0.2)}" y="${n(y - h * 0.16)}" width="${n(w * 0.6)}" height="${n(h * 0.16 + 1)}"/><rect x="${n(x + w * 0.32)}" y="${n(y - h * 0.16 - 3)}" width="${n(w * 0.36)}" height="3.4"/>`;
      else if (kind === 2) shapes += `<rect x="${n(cx - 0.6)}" y="${n(y - 11)}" width="1.2" height="12"/>`;
      else if (kind === 3) shapes += `<rect x="${n(x + w * 0.25)}" y="${n(y - 5)}" width="${n(w * 0.34)}" height="5"/><path d="M${n(x + w * 0.22)} ${n(y - 5)}L${n(x + w * 0.42)} ${n(y - 8)}L${n(x + w * 0.62)} ${n(y - 5)}Z"/>`;
      else if (kind === 4) shapes += `<path d="M${n(x)} ${n(y)}L${n(x + w * 0.15)} ${n(y - 5)}L${n(x + w)} ${n(y - 1)}L${n(x + w)} ${n(y)}Z"/>`;
      if (t.night && h > 48 && lightCount < 8) {
        lightCount++;
        lights += `<circle cx="${n(cx)}" cy="${n(y - (kind === 2 ? 12 : 3))}" r="1.3" fill="#ff3b3b"><animate attributeName="opacity" values="1;1;.1;1" keyTimes="0;.5;.7;1" dur="${n(1.6 + rand() * 1.2, 1)}s" begin="${n(-rand() * 2, 1)}s" repeatCount="indefinite"/></circle>`;
      }
      // face shading (3D feel)
      shapes += `<rect x="${n(x)}" y="${n(y)}" width="${n(w * 0.26)}" height="${n(h)}" fill="#fff" opacity="${t.night ? 0.05 : 0.09}"/>`;
      shapes += `<rect x="${n(x + w * 0.74)}" y="${n(y)}" width="${n(w * 0.26)}" height="${n(h)}" fill="#000" opacity="0.14"/>`;
    }

    if (o.windows) {
      const px = 4.3;
      const py = 6.6;
      const cols = Math.floor((w - 3) / px);
      const rows = Math.floor((h - 6) / py);
      const offX = (w - cols * px) / 2 + 0.6;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rand() < o.winP) {
            const col = rand() < 0.72 ? t.winA : t.winB;
            addWin(col, x + offX + c * px, y + 4 + r * py, 2.5, 3.6);
          }
        }
      }
    }
    x += w + (rand() < 0.3 ? 1 + rand() * 3 : 0.4);
  }
  let out = `<g fill="${color}" opacity="${o.opacity ?? 1}">${shapes}</g>`;
  for (const [col, d] of Object.entries(winPaths)) out += `<path d="${d}" fill="${col}" opacity="${t.night ? 0.8 : 0.5}"/>`;
  return out + lights;
}

function treeline(color) {
  const rand = mulberry32(91);
  let d = `M0 ${YH + 4}`;
  for (let x = 0; x < W; ) {
    const w = 6 + rand() * 12;
    const h = 3 + rand() * 6;
    d += `Q${n(x + w / 2)} ${n(YH + 4 - h * 2)} ${n(x + w)} ${YH + 4}`;
    x += w;
  }
  return `<path d="${d}Z" fill="${color}"/>`;
}

function birds(t) {
  if (t.night) return "";
  let out = "";
  for (let i = 0; i < 4; i++) {
    const y = 34 + i * 9;
    const x0 = -60 - i * 24;
    out +=
      `<g transform="translate(${x0} ${y})" stroke="#3a4a5c" stroke-width="1.2" fill="none" stroke-linecap="round">` +
      `<path d="M-4 0Q-2 -3 0 0Q2 -3 4 0"><animate attributeName="d" values="M-4 0Q-2 -3 0 0Q2 -3 4 0;M-4 -2Q-2 0 0 0Q2 0 4 -2;M-4 0Q-2 -3 0 0Q2 -3 4 0" dur="0.5s" repeatCount="indefinite"/></path>` +
      `<animateTransform attributeName="transform" type="translate" values="${x0} ${y};${W + 80} ${y - 14}" dur="${34 + i * 3}s" repeatCount="indefinite"/></g>`;
  }
  return out;
}

// ---------- compose ----------
function buildSvg(calendar, plan, theme) {
  const t = THEMES[theme];
  const { cars, groups, laneAt, T } = plan;
  const allCoins = groups.flatMap((g) => g.coins);
  const collected = allCoins.filter((c) => c.collected).sort((a, b) => a.arrive - b.arrive);
  const coinCount = (tt) => collected.filter((c) => c.arrive <= tt).length;
  const ph = phaseGroups(t, T);

  // ---- defs
  const sunX = CX + (t.night ? 150 : 170);
  const sunY = YH - (t.night ? 8 : 34);
  let defs = `<clipPath id="frame"><rect width="${W}" height="${H}" rx="8"/></clipPath>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${t.sky.map((c, i) => `<stop offset="${[0, 0.3, 0.62, 0.86, 1][i]}" stop-color="${c}"/>`).join("")}</linearGradient>
<radialGradient id="sunglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${t.glow}" stop-opacity="${t.night ? 0.95 : 0.9}"/><stop offset=".25" stop-color="${t.glow}" stop-opacity="${t.night ? 0.55 : 0.4}"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="sundisc" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="${t.sunDisc}"/><stop offset="1" stop-color="${t.sunDisc}" stop-opacity=".0"/></radialGradient>
<linearGradient id="cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.cloudTop}"/><stop offset="1" stop-color="${t.cloudBot}"/></linearGradient>
<linearGradient id="fog" gradientUnits="userSpaceOnUse" x1="0" y1="${YH - 8}" x2="0" y2="${YH + 96}"><stop offset="0" stop-color="${t.haze}" stop-opacity="${t.night ? 0.6 : 0.62}"/><stop offset=".45" stop-color="${t.haze}" stop-opacity="${t.night ? 0.2 : 0.22}"/><stop offset="1" stop-color="${t.haze}" stop-opacity="0"/></linearGradient>
<linearGradient id="skyfog" gradientUnits="userSpaceOnUse" x1="0" y1="${YH - 46}" x2="0" y2="${YH + 4}"><stop offset="0" stop-color="${t.haze}" stop-opacity="0"/><stop offset="1" stop-color="${t.haze}" stop-opacity="${t.night ? 0.5 : 0.55}"/></linearGradient>
<linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="0" y1="${YH}" x2="0" y2="${YH + 120}"><stop offset="0" stop-color="${t.sky[3]}" stop-opacity=".45"/><stop offset="1" stop-color="${t.sky[3]}" stop-opacity="0"/></linearGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".78"><stop offset=".65" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient>
<radialGradient id="glow-lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${t.lampGlow}" stop-opacity=".85"/><stop offset="1" stop-color="${t.lampGlow}" stop-opacity="0"/></radialGradient>`;
  defs += carDef("car-player", t.player.body, t.player.cabin, t.player.neon, true);
  t.enemy.forEach((c, i) => (defs += carDef(`car-e${i}`, c, mix(c, "#000000", 0.5), mix(c, "#ffffff", 0.2), false)));
  defs += coinDef() + roadsideDefs(t);

  // ---- sky & distance
  let bg = `<rect width="${W}" height="${YH + 3}" fill="url(#sky)"/>`;
  if (t.night) {
    const r = mulberry32(5);
    for (let i = 0; i < 38; i++) {
      const tw = i % 6 === 0 ? `<animate attributeName="opacity" values="1;.25;1" dur="${n(1.5 + r() * 2, 1)}s" repeatCount="indefinite"/>` : "";
      bg += `<circle cx="${n(r() * W)}" cy="${n(r() * 62)}" r="${n(0.4 + r() * 0.8, 1)}" fill="#fff" opacity="${n(0.3 + r() * 0.6, 2)}">${tw}</circle>`;
    }
  }
  bg += `<circle cx="${sunX}" cy="${sunY}" r="${t.night ? 230 : 190}" fill="url(#sunglow)"/>`;
  bg += `<circle cx="${sunX}" cy="${sunY}" r="${t.night ? 40 : 26}" fill="url(#sundisc)"/>`;
  bg += cloudLayer(3, 12, 52, 5, 1.5, t.night ? 0.55 : 0.85, 160, false);
  bg += cloudLayer(8, 56, 92, 5, 1.0, t.night ? 0.7 : 0.8, 110, false);
  bg += cloudLayer(14, 100, 118, 6, 0.9, t.night ? 0.6 : 0.65, 80, true);
  bg += birds(t);
  bg += ridge(mix(t.farMtn, t.haze, 0.3), 11, YH - 30, 15, 38);
  bg += ridge(mix(t.midMtn, t.haze, 0.18), 23, YH - 15, 8, 30);
  // layered city: far (hazy) -> mid -> main (contribution-driven)
  bg += cityLayer(calendar, t, { seed: 101, color: mix(t.city, t.haze, 0.62), heat: false, hMin: 10, hRange: 30, wMin: 12, wMax: 26, windows: false, detail: false, opacity: 0.95 });
  bg += cityLayer(calendar, t, { seed: 202, color: mix(t.city, t.haze, 0.34), heat: false, hMin: 14, hRange: 36, wMin: 11, wMax: 22, windows: true, winP: t.night ? 0.2 : 0.3, detail: true, opacity: 1 });
  bg += cityLayer(calendar, t, { seed: 303, color: t.city, heat: true, hMin: 14, hRange: 56, wMin: 13, wMax: 24, windows: true, winP: t.night ? 0.4 : 0.45, detail: true, opacity: 1 });
  bg += treeline(mix("#0a2a1a", t.haze, t.night ? 0.2 : 0.35));
  bg += `<rect x="0" y="${YH - 46}" width="${W}" height="50" fill="url(#skyfog)"/>`;

  // ---- ground + road
  let ground = `<rect x="0" y="${YH + 3}" width="${W}" height="${H - YH - 3}" fill="${t.grassA}"/>` + ph.grass;
  ground += `<path d="M${CX} ${YH}L${CX + 1.12 * R} ${H}L${CX - 1.12 * R} ${H}Z" fill="${t.rumbleB}"/>` + ph.rumble;
  ground += `<path d="M${CX} ${YH}L${CX + R} ${H}L${CX - R} ${H}Z" fill="${t.asphalt}"/>`;
  ground += `<path d="M${CX} ${YH}L${CX + R} ${H}L${CX - R} ${H}Z" fill="url(#sheen)"/>` + ph.tint + ph.dash;
  ground += `<path d="M${CX} ${YH}L${CX + 0.955 * R} ${H}L${CX + 0.985 * R} ${H}ZM${CX} ${YH}L${CX - 0.955 * R} ${H}L${CX - 0.985 * R} ${H}Z" fill="${t.rumbleB}"/>`;

  // ---- coins (far -> near, behind traffic order doesn't matter much)
  let coins = "";
  for (const c of allCoins) {
    const zEnd = c.collected ? PLAYER_Z : 0.45;
    const tEnd = c.collected ? c.arrive : c.pass;
    const NSc = c.collected ? 18 : 26;
    const times = [];
    for (let i = 0; i <= NSc; i++) {
      const z = c.z0 * Math.pow(zEnd / c.z0, i / NSc);
      times.push(c.ts + (c.z0 - z) / ROAD_SPEED);
    }
    const zNow = (tt) => clamp(c.z0 - ROAD_SPEED * (tt - c.ts), zEnd, c.z0);
    const win = [c.ts, tEnd];
    const vis = { kind: "attr", name: "opacity", discrete: true, events: [c.ts, tEnd], dec: 0, fn: (tt) => (tt >= c.ts && tt < tEnd ? 1 : 0) };
    const pos = { kind: "translate", win, times, fn: (tt) => [sx(c.lane, zNow(tt)), sy(zNow(tt)) - COIN_H / zNow(tt)] };
    const scl = { kind: "scale", win, times, fn: (tt) => 1 / zNow(tt) };
    const spin = `<animateTransform attributeName="transform" type="scale" values="1 1;.18 1;1 1;.18 1;1 1" keyTimes="0;.25;.5;.75;1" dur="0.8s" begin="${n(-(c.g * 0.31 + c.k * 0.13), 2)}s" repeatCount="indefinite"/>`;
    const body = `<ellipse cx="0" cy="${COIN_H}" rx="14" ry="4" fill="#000" opacity=".28"/><g>${`<use href="#coin" transform="scale(1.5)"/>`}${spin}</g>`;
    coins += el("g", {}, [vis], el("g", {}, [pos], el("g", {}, [scl], body, T), T), T);
  }

  // ---- traffic (far -> near)
  let traffic = "";
  for (const e of [...cars].sort((a, b) => b.ts - a.ts)) {
    const zNow = (tt) => clamp(SPAWN_Z - e.r * (tt - e.ts), 0.45, SPAWN_Z);
    const times = [];
    for (let i = 0; i <= 70; i++) {
      const z = SPAWN_Z * Math.pow(0.45 / SPAWN_Z, i / 70);
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

  // ---- coin pickup effects
  let pickups = "";
  const rays = "M0 -9V-17M0 9V17M-9 0H-17M9 0H17M6.5 -6.5L12 -12M-6.5 -6.5L-12 -12M6.5 6.5L12 12M-6.5 6.5L-12 12";
  for (const c of collected) {
    const ex = sx(c.lane, PLAYER_Z);
    const ey = sy(PLAYER_Z) - COIN_H / PLAYER_Z;
    const win = [c.arrive, c.arrive + 0.4];
    const P = (tt) => clamp((tt - c.arrive) / 0.4, 0, 1);
    pickups += el(
      "circle",
      { cx: n(ex), cy: n(ey), fill: "none", stroke: "#ffd54a", "stroke-width": 2.4 },
      [
        { kind: "attr", name: "r", win, fn: (tt) => (P(tt) <= 0 ? 0 : 8 + 24 * easeOut(P(tt))) },
        { kind: "attr", name: "opacity", win, fn: (tt) => (P(tt) <= 0 || P(tt) >= 1 ? 0 : 0.9 * (1 - P(tt))), dec: 2 },
      ],
      "",
      T
    );
    pickups += el(
      "g",
      { opacity: 0 },
      [{ kind: "attr", name: "opacity", win, fn: (tt) => (P(tt) <= 0 || P(tt) >= 1 ? 0 : 1 - P(tt)), dec: 2 }],
      el("g", {}, [{ kind: "translate", win, fn: () => [ex, ey], times: [] }], el("g", {}, [{ kind: "scale", win, fn: (tt) => 0.5 + 1.1 * easeOut(P(tt)) }], `<path d="${rays}" stroke="#fff3a0" stroke-width="2" stroke-linecap="round" fill="none"/>`, T), T),
      T
    );
  }

  // ---- coin counter (small, bottom-left)
  let counter = `<rect x="12" y="${H - 38}" width="86" height="26" rx="13" fill="#000" fill-opacity=".45"/><circle cx="29" cy="${H - 25}" r="8" fill="url(#goldG)" stroke="#9a6a00" stroke-width="1"/>`;
  for (let i = 0; i <= collected.length; i++) {
    counter += el(
      "text",
      { x: 43, y: H - 20, "font-family": "'Courier New',monospace", "font-size": 14, "font-weight": 800, fill: "#fff" },
      [{ kind: "attr", name: "opacity", discrete: true, events: collected.map((c) => c.arrive), dec: 0, fn: (tt) => (coinCount(tt) === i ? 1 : 0) }],
      `x ${String(i).padStart(2, "0")}`,
      T
    );
  }

  const scene = `${bg}${ground}<rect x="0" y="${YH - 8}" width="${W}" height="104" fill="url(#fog)"/>${roadside(t, T)}${coins}${traffic}${player}${pickups}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">` +
    `<title>Neon Racer: dodging traffic and collecting coins above my GitHub contribution skyline</title>` +
    `<defs>${defs}</defs>` +
    `<g clip-path="url(#frame)"><g>${scene}</g><rect width="${W}" height="${H}" fill="url(#vig)"/>${counter}</g>` +
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
  const svg = buildSvg(calendar, plan, theme);
  const file = SNAP !== null ? `${OUT_DIR}/racer-snap-${theme}.svg` : `${OUT_DIR}/racer-${theme}.svg`;
  writeFileSync(file, svg);
  console.log(`${file}  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`loop ${plan.T}s, ${plan.got}/${COIN_GROUPS * COINS_PER_GROUP} coins, ${plan.cars.length} cars dodged (plan #${plan.attempt})`);
