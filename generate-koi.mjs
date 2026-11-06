#!/usr/bin/env node
// KOI POND: your GitHub contribution graph is the pond.
//
//  * The loop is a time-lapse of your year: week by week, active days bloom into lily pads
//    (busiest days become lotus flowers).
//  * The koi grow as your contributions accumulate, and new koi appear at milestones.
//    The more you contributed this year, the bigger and more numerous the koi end up.
//  * Pure SMIL animation (no JavaScript), so it works inside a GitHub README <img>.
//
// Usage:
//   GITHUB_TOKEN=xxx node generate-koi.mjs <github-username>
//   node generate-koi.mjs --demo
//   node generate-koi.mjs --demo --snap 9      (static frame at t=9s, for previews)
//
// Output: dist/koi-light.svg, dist/koi-dark.svg

import { mkdirSync, writeFileSync } from "node:fs";

// ---------- config ----------
const OUT_DIR = process.env.OUT_DIR || "dist";
const W = 880;
const H = 260;
const PITCH = 16;
const COLS = 53;
const ROWS = 7;
const X0 = (W - COLS * PITCH) / 2;
const Y0 = (H - ROWS * PITCH) / 2;
const START = 0.8; // first week blooms
const FILL_END = 11.6; // last week blooms
const HOLD_END = 14.2; // pond rests, then resets
const T = 15.8;
const FPS = 12;
const KOI_OVER_PADS = process.env.KOI_OVER === "1";

const cx = (c) => X0 + c * PITCH + PITCH / 2;
const cy = (r) => Y0 + r * PITCH + PITCH / 2;

const THEMES = {
  light: {
    night: false,
    water: ["#86e3da", "#47c6c8", "#1fa0b4", "#0f7d98"],
    pebble: "#2e8e9c",
    caustic: "#ffffff",
    stoneA: "#b4b9bd",
    stoneB: "#747a81",
    pads: ["#a9e5a2", "#72cc7e", "#43ab5d", "#2f8c4a"],
    padVein: "#1f6b38",
    petal: "#ffc6de",
    petalD: "#ff8fbd",
    flowerGlow: "#ffd6e8",
    reed: "#3f8f4a",
    koiBelly: ["#ffffff", "#e4ecf2"],
    gold: ["#ffd96a", "#d99a2b"],
    orange: ["#ff9a3c", "#e0591a"],
    red: "#e8412c",
    black: "#1b1d24",
  },
  dark: {
    night: true,
    water: ["#0b3a52", "#0a3149", "#082a3e", "#051b2c"],
    pebble: "#12607a",
    caustic: "#7fe8ff",
    stoneA: "#47515e",
    stoneB: "#222a35",
    pads: ["#1c6b4a", "#1f8a5c", "#26a96b", "#38d98a"],
    padVein: "#0c3d2a",
    petal: "#ffe1f2",
    petalD: "#ffb0dc",
    flowerGlow: "#ff9ed6",
    reed: "#1d6b52",
    koiBelly: ["#f2f5ff", "#c4cfe6"],
    gold: ["#ffd45a", "#d28a20"],
    orange: ["#ff8a2a", "#d9501a"],
    red: "#ec4a34",
    black: "#15161d",
  },
};

// ---------- helpers ----------
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
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "readme-koi" },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors || !json.data?.user) throw new Error("GitHub API error: " + JSON.stringify(json.errors || json));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => {
    const col = Array.from({ length: ROWS }, () => ({ count: 0, level: 0, exists: false }));
    for (const d of w.contributionDays) col[d.weekday] = { count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0, exists: true };
    return col;
  });
  return { weeks, total: cal.totalContributions };
}

function demoCalendar() {
  const rand = mulberry32(Number(process.env.DEMO_SEED || 42));
  const weeks = Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => {
      const r = rand();
      const level = r < 0.35 ? 0 : r < 0.6 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4;
      return { count: level * 3 + Math.floor(rand() * 3), level, exists: true };
    })
  );
  return { weeks, total: weeks.flat().reduce((s, d) => s + d.count, 0) };
}

// ---------- growth model ----------
function buildGrowth(calendar) {
  const weeks = calendar.weeks;
  const nW = weeks.length;
  const totals = weeks.map((w) => w.reduce((s, d) => s + d.count, 0));
  const sum = Math.max(1, totals.reduce((a, b) => a + b, 0));
  const cum = [0];
  totals.forEach((v) => cum.push(cum[cum.length - 1] + v / sum));
  const dtw = (FILL_END - START) / nW;
  const tR0 = HOLD_END;
  const g = (t) => {
    if (t < START) return 0;
    if (t < FILL_END) {
      const i = Math.min(nW - 1, Math.floor((t - START) / dtw));
      const u = (t - START) / dtw - i;
      return cum[i] + u * (cum[i + 1] - cum[i]);
    }
    if (t < tR0) return 1;
    return 1 - smooth(clamp((t - tR0) / (T - tR0), 0, 1));
  };
  const total = calendar.total;
  const nKoi = clamp(2 + Math.floor(total / 400), 2, 6);
  const final = clamp(0.8 + 0.45 * Math.min(1, total / 3000), 0.8, 1.25);
  const thr = [0, 0.12, 0.3, 0.5, 0.7, 0.86].slice(0, nKoi);
  const sizes = [1.0, 0.92, 0.86, 0.8, 0.76, 0.7];
  const koiScale = (i, t) => {
    const gv = g(t);
    const grow = Math.pow(clamp((gv - thr[i]) / (1 - thr[i] || 1), 0, 1), 0.8);
    const pop = i === 0 ? 1 : smooth(clamp((gv - thr[i]) / 0.035, 0, 1));
    return sizes[i] * final * (0.34 + 0.66 * grow) * pop;
  };
  return { g, dtw, tR0, nKoi, koiScale, final, totals };
}

// ---------- svg element builder with time-driven attributes ----------
let SNAP = null;
const uniq = (arr) => [...new Set(arr.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);

function animFor(spec) {
  const dur = T;
  const [a, b] = spec.win || [0, dur];
  let mid;
  if (spec.times) mid = spec.times.filter((t) => t > a && t < b);
  else {
    mid = [];
    const fps = spec.fps || FPS;
    for (let t = a; t < b; t += 1 / fps) mid.push(t);
  }
  const times = uniq([0, a, ...mid, b, dur]).filter((t) => t >= 0 && t <= dur);
  const dec = spec.dec ?? (spec.kind === "scale" ? 3 : 1);
  const fmt = (v) => (Array.isArray(v) ? v.map((x) => n(x, dec)).join(" ") : n(v, dec));
  const vals = times.map((t) => fmt(spec.fn(t)));
  const keyTimes = times.map((t) => n(t / dur, 5));
  const common = `values="${vals.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${n(dur, 3)}s" repeatCount="indefinite"`;
  if (spec.kind === "attr") return `<animate attributeName="${spec.name}" ${common}/>`;
  return `<animateTransform attributeName="transform" type="${spec.kind}" ${common}/>`;
}

function el(tag, attrs, dyns, inner) {
  const a = { ...attrs };
  let anims = "";
  for (const spec of dyns || []) {
    const v = spec.fn(SNAP !== null ? SNAP : 0);
    const dec = spec.dec ?? (spec.kind === "scale" ? 3 : 1);
    const fmt = (x) => (Array.isArray(x) ? x.map((q) => n(q, dec)).join(" ") : n(x, dec));
    if (spec.kind === "attr") a[spec.name] = fmt(v);
    else if (spec.kind === "translate") a.transform = `translate(${fmt(v)})`;
    else if (spec.kind === "scale") a.transform = `scale(${fmt(v)})`;
    else if (spec.kind === "rotate") a.transform = `rotate(${fmt(v)})`;
    if (SNAP === null) anims += animFor(spec);
  }
  const attrStr = Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ");
  const body = (inner || "") + anims;
  return body ? `<${tag} ${attrStr}>${body}</${tag}>` : `<${tag} ${attrStr}/>`;
}

// ---------- koi ----------
const F_PATH = "M42 0C41 -9 30 -14 12 -14C4 -14 -4 -12 -10 -10L-10 10C-4 12 4 14 12 14C30 14 41 9 42 0Z";
const R_PATH = "M0 -10C-14 -9 -26 -5 -36 -1.5L-36 1.5C-26 5 -14 9 0 10Z";
const TAIL_PATH = "M0 0C-10 -6 -26 -20 -40 -16C-32 -8 -30 -3 -34 0C-30 3 -32 8 -40 16C-26 20 -10 6 0 0Z";
const FIN_PATH = "M0 0C6 -6 14 -12 22 -10C16 -4 10 0 0 3Z";

const KOI_KINDS = ["kohaku", "sanke", "ogon", "tancho", "orenji", "showa"];
const ORBITS = [
  { cx: 440, cy: 130, a: 320, b: 62, dir: 1, phase: 0.0, speed: 82 },
  { cx: 440, cy: 134, a: 290, b: 72, dir: -1, phase: 0.37, speed: 74 },
  { cx: 250, cy: 130, a: 150, b: 60, dir: 1, phase: 0.62, speed: 66 },
  { cx: 640, cy: 136, a: 150, b: 58, dir: -1, phase: 0.18, speed: 70 },
  { cx: 440, cy: 128, a: 200, b: 44, dir: 1, phase: 0.81, speed: 62 },
  { cx: 440, cy: 130, a: 105, b: 32, dir: -1, phase: 0.5, speed: 56 },
];

function koiBody(i, kind, th, rand) {
  const base = kind === "ogon" ? th.gold : kind === "orenji" ? th.orange : kind === "showa" ? [th.black, "#0a0b10"] : th.koiBelly;
  let defs = `<clipPath id="kf${i}"><path d="${F_PATH}"/></clipPath><clipPath id="kr${i}"><path d="${R_PATH}"/></clipPath>
<linearGradient id="kb${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${base[0]}"/><stop offset="1" stop-color="${base[1]}"/></linearGradient>`;
  const finCol = kind === "showa" ? "#3a3b46" : mix(base[0], "#ffffff", 0.35);
  const ell = (x, y, rx, ry, col, rot = 0) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${col}" transform="rotate(${n(rot)} ${n(x)} ${n(y)})"/>`;
  let pf = "";
  let pr = "";
  const red = th.red;
  if (kind === "kohaku" || kind === "sanke" || kind === "showa") {
    const cnt = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < cnt; k++) pf += ell(-4 + rand() * 38, -6 + rand() * 12, 6 + rand() * 7, 4 + rand() * 4, kind === "showa" && k % 2 ? "#f3f3f3" : red, rand() * 60 - 30);
    pr += ell(-14 + rand() * 6, -2 + rand() * 4, 7 + rand() * 4, 3 + rand() * 2, red);
    if (kind === "sanke" || kind === "showa") {
      pf += ell(2 + rand() * 20, -7 + rand() * 4, 3 + rand() * 3, 2.4 + rand() * 2, th.black);
      pf += ell(10 + rand() * 18, 4 + rand() * 4, 3 + rand() * 3, 2.4 + rand() * 2, th.black);
    }
  } else if (kind === "tancho") pf += `<circle cx="28" cy="0" r="6.4" fill="${red}"/>`;
  const gloss = `<ellipse cx="14" cy="-7" rx="24" ry="3" fill="#fff" opacity="${kind === "showa" ? 0.18 : 0.38}"/>`;
  return { defs, finCol, pf, pr, gloss, id: i };
}

function koiGroup(i, kind, th, growth, orbit) {
  const rand = mulberry32(1000 + i * 77);
  const k = koiBody(i, kind, th, rand);
  const wag = (amp, lag) => `<animateTransform attributeName="transform" type="rotate" values="${amp};${-amp};${amp}" dur="0.9s" begin="${n(-lag - i * 0.17, 2)}s" repeatCount="indefinite"/>`;
  const flutter = (amp, lag) => `<animateTransform attributeName="transform" type="rotate" values="${amp};${-amp};${amp}" dur="0.7s" begin="${n(-lag - i * 0.11, 2)}s" repeatCount="indefinite"/>`;
  const fill = `url(#kb${i})`;
  const shadow = `<g transform="translate(6 10)" opacity="${th.night ? 0.28 : 0.2}"><path d="${F_PATH}" fill="#000"/><g transform="translate(-10 0)"><path d="${R_PATH}" fill="#000"/></g></g>`;
  const tail = `<g transform="translate(-36 0)"><g>${wag(15, 0.22)}<path d="${TAIL_PATH}" fill="${k.finCol}" opacity=".82"/><path d="M-6 0C-18 -6 -30 -10 -38 -12M-6 0C-20 0 -30 0 -38 0M-6 0C-18 6 -30 10 -38 12" stroke="#fff" stroke-width=".6" fill="none" opacity=".5"/></g></g>`;
  const rear = `<g transform="translate(-10 0)"><g>${wag(7, 0.08)}<path d="${R_PATH}" fill="${fill}"/><g clip-path="url(#kr${i})">${k.pr}</g>${tail}</g></g>`;
  const finTop = `<g transform="translate(14 -11) rotate(-18)"><g>${flutter(10, 0)}<path d="${FIN_PATH}" fill="${k.finCol}" opacity=".78"/></g></g>`;
  const finBot = `<g transform="translate(14 11) scale(1 -1) rotate(-18)"><g>${flutter(10, 0.3)}<path d="${FIN_PATH}" fill="${k.finCol}" opacity=".78"/></g></g>`;
  const front = `<path d="${F_PATH}" fill="${fill}"/><g clip-path="url(#kf${i})">${k.pf}${k.gloss}</g>`;
  const eyes = `<circle cx="31" cy="-7" r="2.3" fill="#111"/><circle cx="31" cy="7" r="2.3" fill="#111"/><circle cx="31.7" cy="-7.7" r=".8" fill="#fff"/><circle cx="31.7" cy="6.3" r=".8" fill="#fff"/>`;
  const barbels = `<path d="M41 -3q5 -1 7 -5M41 3q5 1 7 5" stroke="${th.night ? "#ffd9a0" : "#d9a066"}" stroke-width="1" fill="none" stroke-linecap="round"/>`;
  const sprite = shadow + rear + finTop + finBot + front + eyes + barbels;

  const scaleSpec = { kind: "scale", fps: 12, fn: (t) => growth.koiScale(i, t) };
  const inner = el("g", {}, [scaleSpec], sprite);

  // swim along an elliptical path (constant speed, heading follows the path)
  const { cx: ox, cy: oy, a, b, dir, phase, speed } = orbit;
  const circ = 2 * Math.PI * Math.sqrt((a * a + b * b) / 2);
  const dur = circ / speed;
  const sweep = dir > 0 ? 1 : 0;
  const path = `M${ox + a} ${oy}A${a} ${b} 0 0 ${sweep} ${ox - a} ${oy}A${a} ${b} 0 0 ${sweep} ${ox + a} ${oy}Z`;
  if (SNAP !== null) {
    const u = (((SNAP / dur + phase) % 1) + 1) % 1;
    const th2 = 2 * Math.PI * u * dir;
    const x = ox + a * Math.cos(th2);
    const y = oy + b * Math.sin(th2);
    const hd = (Math.atan2(b * Math.cos(th2) * dir, -a * Math.sin(th2) * dir) * 180) / Math.PI;
    return { defs: k.defs, svg: `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(hd)})">${inner}</g>` };
  }
  return {
    defs: k.defs,
    svg: `<g><animateMotion path="${path}" dur="${n(dur, 2)}s" begin="${n(-phase * dur, 2)}s" repeatCount="indefinite" rotate="auto"/>${inner}</g>`,
  };
}

// ---------- pond pieces ----------
function padPath(r) {
  const a = 0.32;
  const x = r * Math.cos(a);
  const y = r * Math.sin(a);
  return `M0 0L${n(x, 2)} ${n(-y, 2)}A${r} ${r} 0 1 0 ${n(x, 2)} ${n(y, 2)}Z`;
}

function flowerMarkup(th) {
  let petals = "";
  for (let k = 0; k < 8; k++) petals += `<ellipse cx="0" cy="-4.4" rx="2.1" ry="4.6" fill="${k % 2 ? th.petalD : th.petal}" transform="rotate(${k * 45})"/>`;
  return petals + `<circle r="2.6" fill="#ffd45a"/><circle r="1.2" fill="#fff3b0"/>`;
}

function cells(calendar, th, growth) {
  const { dtw, tR0 } = growth;
  const rand = mulberry32(555);
  let pebbles = "";
  let pads = "";
  let ripples = "";
  calendar.weeks.forEach((week, c) => {
    week.forEach((d, r) => {
      if (!d.exists) return;
      const x = cx(c);
      const y = cy(r);
      pebbles += `M${n(x - 2.4)} ${n(y)}a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0 -4.8 0`;
      if (d.level === 0) return;
      const ta = START + c * dtw + r * 0.035;
      const lvl = d.level;
      const rad = [0, 4.8, 5.6, 6.4, 6.9][lvl];
      const rot = Math.floor(rand() * 360);
      const appear = (t) => {
        if (t < ta) return 0;
        if (t < ta + 0.22) return 1.25 * easeOut((t - ta) / 0.22);
        if (t < ta + 0.4) return 1.25 - 0.25 * smooth((t - ta - 0.22) / 0.18);
        if (t < tR0) return 1;
        return 1 - smooth(clamp((t - tR0) / (T - tR0), 0, 1));
      };
      const times = [ta, ta + 0.11, ta + 0.22, ta + 0.31, ta + 0.4, tR0, T];
      let body = "";
      if (lvl === 4) body += `<circle r="14" fill="url(#bloomglow)"/>`;
      body += `<g transform="rotate(${rot})"><path d="${padPath(rad)}" fill="${th.pads[lvl - 1]}"/><path d="M0 0L${n(rad * 0.7)} ${n(-rad * 0.5)}M0 0L${n(-rad * 0.7)} ${n(-rad * 0.5)}M0 0L0 ${n(rad * 0.85)}" stroke="${th.padVein}" stroke-width=".5" opacity=".45" fill="none"/><ellipse cx="${n(-rad * 0.3)}" cy="${n(-rad * 0.35)}" rx="${n(rad * 0.35)}" ry="${n(rad * 0.2)}" fill="#fff" opacity=".22"/></g>`;
      if (lvl === 4) body += flowerMarkup(th);
      pads += `<g transform="translate(${n(x)} ${n(y)})">` + el("g", {}, [{ kind: "scale", times, fn: appear }], body) + `</g>`;
      if (lvl >= 4) {
        const win = [ta + 0.1, ta + 1.0];
        const P = (t) => clamp((t - win[0]) / 0.9, 0, 1);
        ripples += el("circle", { cx: n(x), cy: n(y), fill: "none", stroke: "#fff", "stroke-width": 1.2 }, [
          { kind: "attr", name: "r", win, fn: (t) => (P(t) <= 0 ? 0 : 5 + 20 * easeOut(P(t))) },
          { kind: "attr", name: "opacity", win, fn: (t) => (P(t) <= 0 || P(t) >= 1 ? 0 : 0.7 * (1 - P(t))), dec: 2 },
        ], "");
      }
    });
  });
  return { pebbles: `<path d="${pebbles}" fill="${th.pebble}" opacity=".3"/>`, pads, ripples };
}

function caustics(th) {
  const rand = mulberry32(21);
  let out = "";
  for (let i = 0; i < 9; i++) {
    const x = rand() * W;
    const y = 30 + rand() * (H - 60);
    const rx = 60 + rand() * 90;
    const ry = 16 + rand() * 26;
    const dx = 40 + rand() * 60;
    out += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#caustic)" opacity="${th.night ? 0.5 : 0.6}"><animateTransform attributeName="transform" type="translate" values="0 0;${n(dx)} ${n(rand() * 14 - 7)};0 0" dur="${n(18 + rand() * 20, 1)}s" begin="${n(-rand() * 20, 1)}s" repeatCount="indefinite"/></ellipse>`;
  }
  return out;
}

function waterRipples(th) {
  const rand = mulberry32(88);
  let out = "";
  for (let i = 0; i < 8; i++) {
    const x = 60 + rand() * (W - 120);
    const y = 30 + rand() * (H - 60);
    const dur = n(4.5 + rand() * 3, 1);
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="2" fill="none" stroke="#fff" stroke-width="1" opacity="0"><animate attributeName="r" values="2;30" dur="${dur}s" begin="${n(rand() * 6, 1)}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.5;0" dur="${dur}s" begin="${n(rand() * 6, 1)}s" repeatCount="indefinite"/></circle>`;
  }
  return out;
}

function sparkles(th) {
  const rand = mulberry32(31);
  let out = "";
  const count = th.night ? 14 : 22;
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const y = 14 + rand() * (H - 28);
    const s = 1.4 + rand() * 2;
    out += `<path d="M${n(x)} ${n(y - s * 2)}L${n(x + s * 0.5)} ${n(y - s * 0.5)}L${n(x + s * 2)} ${n(y)}L${n(x + s * 0.5)} ${n(y + s * 0.5)}L${n(x)} ${n(y + s * 2)}L${n(x - s * 0.5)} ${n(y + s * 0.5)}L${n(x - s * 2)} ${n(y)}L${n(x - s * 0.5)} ${n(y - s * 0.5)}Z" fill="${th.night ? "#bfefff" : "#ffffff"}" opacity="0"><animate attributeName="opacity" values="0;.85;0" dur="${n(2 + rand() * 3, 1)}s" begin="${n(rand() * 5, 1)}s" repeatCount="indefinite"/></path>`;
  }
  return out;
}

function stoneFrame(th) {
  const rand = mulberry32(64);
  let out = "";
  const stone = (x, y, rx, ry) => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#stone)"/><ellipse cx="${n(x - rx * 0.25)}" cy="${n(y - ry * 0.35)}" rx="${n(rx * 0.45)}" ry="${n(ry * 0.25)}" fill="#fff" opacity=".18"/>`;
  for (let x = -6; x < W + 10; x += 14 + rand() * 12) {
    out += stone(x, 3 + rand() * 6, 10 + rand() * 8, 7 + rand() * 4);
    out += stone(x + 7, H - 3 - rand() * 6, 10 + rand() * 8, 7 + rand() * 4);
  }
  for (let y = 12; y < H - 8; y += 16 + rand() * 12) {
    out += stone(3 + rand() * 5, y, 7 + rand() * 4, 9 + rand() * 5);
    out += stone(W - 3 - rand() * 5, y + 5, 7 + rand() * 4, 9 + rand() * 5);
  }
  return out;
}

function reeds(th) {
  const rand = mulberry32(7);
  let out = `<g stroke="${th.reed}" stroke-width="2" fill="none" stroke-linecap="round">`;
  for (const [bx, by, dirx] of [[26, H - 8, 1], [W - 26, 10, -1]]) {
    for (let i = 0; i < 9; i++) {
      const h = 34 + rand() * 40;
      const sway = (rand() - 0.5) * 30;
      const sgn = by > H / 2 ? -1 : 1;
      out += `<path d="M${n(bx + (i - 4) * 4)} ${by}Q${n(bx + (i - 4) * 4 + sway * 0.5)} ${n(by + sgn * h * 0.5)} ${n(bx + (i - 4) * 4 + sway + dirx * 8)} ${n(by + sgn * h)}"><animate attributeName="stroke-opacity" values="1;.85;1" dur="${n(3 + rand() * 2, 1)}s" repeatCount="indefinite"/></path>`;
    }
  }
  return out + `</g>`;
}

// ---------- compose ----------
function buildSvg(calendar, growth, theme) {
  const th = THEMES[theme];
  const c = cells(calendar, th, growth);

  let defs = `<clipPath id="frame"><rect width="${W}" height="${H}" rx="10"/></clipPath>
<linearGradient id="water" x1="0" y1="0" x2="0" y2="1">${th.water.map((col, i) => `<stop offset="${n(i / 3, 2)}" stop-color="${col}"/>`).join("")}</linearGradient>
<radialGradient id="caustic" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${th.caustic}" stop-opacity=".28"/><stop offset="1" stop-color="${th.caustic}" stop-opacity="0"/></radialGradient>
<radialGradient id="bloomglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${th.flowerGlow}" stop-opacity="${th.night ? 0.8 : 0.5}"/><stop offset="1" stop-color="${th.flowerGlow}" stop-opacity="0"/></radialGradient>
<radialGradient id="stone" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="${th.stoneA}"/><stop offset="1" stop-color="${th.stoneB}"/></radialGradient>
<radialGradient id="vig" cx=".5" cy=".5" r=".78"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${th.night ? 0.4 : 0.22}"/></radialGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${th.night ? 0.05 : 0.14}"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="${th.night ? 0.03 : 0.08}"/></linearGradient>`;

  const kinds = [...KOI_KINDS];
  let koiSvg = "";
  for (let i = 0; i < growth.nKoi; i++) {
    const kg = koiGroup(i, kinds[i], th, growth, ORBITS[i]);
    defs += kg.defs;
    koiSvg += kg.svg;
  }

  const tint = `<rect width="${W}" height="${H}" fill="${th.water[1]}" opacity="${th.night ? 0.18 : 0.1}"/>`;
  const moon = th.night
    ? `<g opacity=".5"><ellipse cx="${W - 130}" cy="${H * 0.5}" rx="26" ry="26" fill="#dfe9ff" opacity=".18"><animate attributeName="rx" values="26;29;26" dur="5s" repeatCount="indefinite"/></ellipse><ellipse cx="${W - 130}" cy="${H * 0.5}" rx="60" ry="60" fill="#9fc4ff" opacity=".07"/></g>`
    : "";

  const scene =
    `<rect width="${W}" height="${H}" fill="url(#water)"/>` +
    `<rect width="${W}" height="${H}" fill="url(#sheen)"/>` +
    caustics(th) +
    c.pebbles +
    moon +
    (KOI_OVER_PADS ? c.pads + tint + koiSvg : koiSvg + tint + c.pads) +
    c.ripples +
    waterRipples(th) +
    sparkles(th) +
    stoneFrame(th) +
    reeds(th);

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">` +
    `<title>Koi pond: my GitHub contribution graph blooming into lily pads while the koi grow</title>` +
    `<defs>${defs}</defs>` +
    `<g clip-path="url(#frame)">${scene}<rect width="${W}" height="${H}" fill="url(#vig)"/></g>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="none" stroke="${theme === "dark" ? "#30363d" : "#d0d7de"}"/>` +
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

const growth = buildGrowth(calendar);
mkdirSync(OUT_DIR, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const svg = buildSvg(calendar, growth, theme);
  const file = SNAP !== null ? `${OUT_DIR}/koi-snap-${theme}.svg` : `${OUT_DIR}/koi-${theme}.svg`;
  writeFileSync(file, svg);
  console.log(`${file}  ${(svg.length / 1024).toFixed(0)} KB`);
}
console.log(`loop ${T}s, ${growth.nKoi} koi, final size x${growth.final.toFixed(2)}, ${calendar.total} contributions`);
