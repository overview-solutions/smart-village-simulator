/**
 * Example customers around BUILD LV poles (service laterals).
 * 11 kV: none. 0.38 kV: ≥10/pole. 0.22 kV: denser (≥14/pole).
 * Markets / shops / civic sit near the community centroid.
 */

import { USE_CLASSES } from "./customer-use.js";

const SEP_FALLBACK = [1.2, 1.0, 0.85, 0.7];
const PLANT_CLEAR = 6.5;
const POLE_ON_LINE = 1.65;
const POLE_MERGE = 0.85;
const TAP_R0 = 1.7;
const TAP_R1 = 3.3;
const BASE_PER_POLE = 10;
const PER_POLE = { lv220: 14, lv380: 10, mv: 0 };

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function lineLen(l) {
  return Math.hypot((l.bx ?? l.x) - l.x, (l.bz ?? l.z) - l.z) || 0.01;
}

function distPointSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function nearestOnLine(px, pz, l) {
  const ax = l.x;
  const az = l.z;
  const bx = l.bx ?? l.x;
  const bz = l.bz ?? l.z;
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return { x: ax + dx * t, z: az + dz * t };
}

function poleKey(x, z) {
  const qx = Math.round(x / POLE_MERGE) * POLE_MERGE;
  const qz = Math.round(z / POLE_MERGE) * POLE_MERGE;
  return `${qx.toFixed(2)},${qz.toFixed(2)}`;
}

/** LV 220 / LV 380 / MV. Customers only tap LV. */
export function lineServeBand(rec) {
  const kv = Number(rec.nominalKv);
  const n = Number.isFinite(kv) ? kv : rec.assetClass === "secondary" ? 0.22 : rec.assetClass === "primary" ? 11 : 0.4;
  if (n >= 1) return "mv";
  if (n <= 0.25 || rec.assetClass === "secondary") return "lv220";
  return "lv380";
}

function communityCenter(lines) {
  let sx = 0;
  let sz = 0;
  let w = 0;
  for (const l of lines) {
    const len = lineLen(l);
    sx += ((l.x + (l.bx ?? l.x)) / 2) * len;
    sz += ((l.z + (l.bz ?? l.z)) / 2) * len;
    w += len;
  }
  if (w < 1e-6) return { x: 0, z: 0, r: 20 };
  const x = sx / w;
  const z = sz / w;
  let r = 8;
  for (const l of lines) {
    r = Math.max(r, Math.hypot(l.x - x, l.z - z), Math.hypot((l.bx ?? l.x) - x, (l.bz ?? l.z) - z));
  }
  return { x, z, r };
}

/**
 * Civic / market near center. Industry stays off the core.
 * @param {number} norm 0 at centroid, 1 at rim
 */
export function pickUseClass(norm, band, i) {
  const u = hash(i + 19);
  if (norm < 0.3) {
    if (u < 0.22) return "market";
    if (u < 0.4) return "commercial";
    if (u < 0.5) return "worship";
    if (u < 0.58) return "school";
    if (u < 0.64) return "medical";
    if (u < 0.7) return "leisure";
    if (u < 0.76) return "telecom";
    return "residential";
  }
  if (norm < 0.62) {
    if (band === "lv380" && u < 0.14) return "industrial";
    if (u < 0.12) return "commercial";
    if (u < 0.2) return "market";
    if (u < 0.26) return "telecom";
    if (u < 0.34) return "streetlight";
    if (u < 0.4) return "worship";
    if (u < 0.45) return "school";
    return "residential";
  }
  if (u < 0.22) return "agricultural";
  if (u < 0.3) return "water";
  if (band === "lv380" && u < 0.42) return "industrial";
  if (u < 0.48) return "streetlight";
  return "residential";
}

/** Floor + overflow so 10-per-pole flood still shows non-home classes. */
function classMins(n) {
  /** @type {Record<string, number>} */
  const want = {};
  const add = (id, min) => {
    want[id] = Math.max(want[id] || 0, min);
  };
  if (n >= 8) {
    add("market", 1);
    add("commercial", 1);
    add("agricultural", 1);
    add("streetlight", 1);
  }
  if (n >= 16) {
    add("water", 1);
    add("school", 1);
    add("worship", 1);
  }
  if (n >= 24) {
    add("medical", 1);
    add("industrial", 1);
  }
  if (n >= 40) {
    add("telecom", 1);
    add("leisure", 1);
  }
  if (n >= 70) add("security", 1);
  if (n >= 80) {
    add("market", Math.round(n * 0.04));
    add("commercial", Math.round(n * 0.04));
    add("agricultural", Math.round(n * 0.04));
    add("industrial", Math.round(n * 0.03));
    add("streetlight", Math.round(n * 0.02));
    add("water", 2);
    add("school", 2);
    add("worship", 2);
    add("medical", 1);
  }
  return want;
}

function locOk(id, norm) {
  if (id === "market" || id === "commercial" || id === "worship" || id === "school" || id === "medical" || id === "leisure") {
    return norm < 0.58;
  }
  if (id === "agricultural" || id === "water") return norm > 0.38;
  if (id === "industrial") return norm > 0.26;
  return true;
}

const REBALANCE_CYCLE = [
  "market",
  "commercial",
  "agricultural",
  "industrial",
  "streetlight",
  "worship",
  "school",
  "water",
  "leisure",
  "telecom",
  "medical",
];

function rebalanceUseClasses(out, center) {
  const n = out.length;
  if (n < 8 || !center) return;
  const r = Math.max(center.r || 1, 1);
  const rows = out.map((c) => ({
    c,
    norm: Math.min(1, Math.hypot(c.x - center.x, c.z - center.z) / r),
  }));
  const counts = Object.create(null);
  for (const { c } of rows) counts[c.useClass] = (counts[c.useClass] || 0) + 1;

  const takeHome = (id) => {
    const homes = rows.filter((x) => x.c.useClass === "residential");
    const prefer = homes.filter((x) => locOk(id, x.norm));
    return (prefer.length ? prefer : homes)[0] || null;
  };

  const convert = (id) => {
    const row = takeHome(id);
    if (!row) return false;
    row.c.useClass = id;
    counts.residential = (counts.residential || 1) - 1;
    counts[id] = (counts[id] || 0) + 1;
    return true;
  };

  for (const [id, min] of Object.entries(classMins(n))) {
    while ((counts[id] || 0) < min) {
      if (!convert(id)) break;
    }
  }

  const resMax = Math.floor(n * 0.72);
  let guard = 0;
  let k = 0;
  while ((counts.residential || 0) > resMax && guard < n) {
    guard += 1;
    const id = REBALANCE_CYCLE[k % REBALANCE_CYCLE.length];
    k += 1;
    if (!convert(id)) break;
  }
}

function tooClose(x, z, pts, minD) {
  for (const p of pts) {
    if (Math.hypot(p.x - x, p.z - z) < minD) return true;
  }
  return false;
}

function poleBand(rec) {
  if (rec.bands.has("lv220")) return "lv220";
  if (rec.bands.has("lv380")) return "lv380";
  return "mv";
}

function pickLine(rec, band) {
  return rec.lines.find((l) => lineServeBand(l) === band) || rec.lines[0];
}

/** BUILD poles sitting on an LV span, plus each span's endpoints. */
function collectLvPoles(lv, placed) {
  const poles = (placed || []).filter((p) => p.assetClass === "pole");
  const map = new Map();
  const add = (x, z, line) => {
    const key = poleKey(x, z);
    let rec = map.get(key);
    if (!rec) {
      rec = { key, x, z, lines: [], bands: new Set() };
      map.set(key, rec);
    }
    rec.lines.push(line);
    rec.bands.add(lineServeBand(line));
  };
  for (const l of lv) {
    add(l.x, l.z, l);
    add(l.bx ?? l.x, l.bz ?? l.z, l);
    for (const p of poles) {
      if (distPointSeg(p.x, p.z, l.x, l.z, l.bx ?? l.x, l.bz ?? l.z) <= POLE_ON_LINE) {
        add(p.x, p.z, l);
      }
    }
  }
  return [...map.values()];
}

/**
 * @param {object[]} placed
 * @returns {{ x: number, z: number, useClass: string, lineId: string, nominalKv: number, ax: number, az: number, poleKey: string }[]}
 */
export function planCustomers(placed) {
  const lines = (placed || []).filter((p) => p.kind === "line");
  const lv = lines.filter((l) => lineServeBand(l) !== "mv");
  if (!lv.length) return [];
  const plants = (placed || []).filter((p) => p.assetClass === "gen" || p.assetClass === "station");
  const center = communityCenter(lv);
  const occ = (placed || [])
    .filter((p) => p.kind !== "line")
    .map((p) => ({ x: p.x, z: p.z }));

  const poles = collectLvPoles(lv, placed);
  const have = new Map();
  const out = [];
  let i = 0;

  const fillTo = (pole, nWant) => {
    const band = poleBand(pole);
    if (!nWant || band === "mv") return;
    const line = pickLine(pole, band);
    if (!line) return;
    const tap = nearestOnLine(pole.x, pole.z, line);
    let got = have.get(pole.key) || 0;
    for (const minD of SEP_FALLBACK) {
      let tries = 0;
      const maxTries = Math.max(8, (nWant - got) * 12);
      while (got < nWant && tries < maxTries) {
        i += 1;
        tries += 1;
        const ang = (2 * Math.PI * (got + 0.12 + hash(i) * 0.3)) / nWant + hash(i + 5) * 0.55;
        const r = TAP_R0 + hash(i + 11) * (TAP_R1 - TAP_R0);
        const x = tap.x + Math.cos(ang) * r;
        const z = tap.z + Math.sin(ang) * r;
        if (plants.some((p) => Math.hypot(p.x - x, p.z - z) < PLANT_CLEAR)) continue;
        if (tooClose(x, z, occ, minD)) continue;
        const norm = Math.min(1, Math.hypot(x - center.x, z - center.z) / center.r);
        const useClass = pickUseClass(norm, band, i);
        occ.push({ x, z });
        out.push({
          x,
          z,
          useClass,
          lineId: line.id,
          nominalKv: Number(line.nominalKv) || (band === "lv220" ? 0.22 : 0.38),
          ax: tap.x,
          az: tap.z,
          poleKey: pole.key,
        });
        got += 1;
      }
      if (got >= nWant) break;
    }
    have.set(pole.key, got);
  };

  // Guarantee first, then 220 V extras so neighbors do not starve 380 V poles.
  for (const pole of poles) fillTo(pole, BASE_PER_POLE);
  for (const pole of poles) fillTo(pole, PER_POLE[poleBand(pole)] || 0);

  rebalanceUseClasses(out, center);
  return out;
}

export function useClassHex(id) {
  return USE_CLASSES[id]?.hex ?? 0x6b8cae;
}
