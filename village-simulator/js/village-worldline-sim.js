/**
 * Hypothetical GroundBolt prepaid day — not live telemetry.
 *
 * Rules match ThunderCloud/GroundBolt:
 *   HEARTBEAT_PERIOD = 15 min
 *   cost = kWh * tariff
 *   meter_config.state = AUTO → on iff credit_wallet > 0
 *   low_balance_threshold → SMS once
 *   POST /transaction/ then set_balance before watts
 *
 * Load types + loadLimitW are viz-only (not a GroundBolt table).
 */

import {
  CLUSTERS,
  FEEDERS,
  GRID_SEGS,
  HOUSES,
  MAIN_XFMR,
  BESS,
  BESS_HOME_IDS,
  NORTH,
  OUTAGES,
  POLES,
  PV_FARM,
  PV_ROOF_IDS,
  TARGET_HOMES,
  TRANSFORMERS,
  VENDORS,
  VILLAGE_PEOPLE,
  PEOPLE_PER_HOME,
  DTMS,
  PHASES,
  BOARDS,
  STATIONS,
  HOMES_PER_BOARD,
  LEAKS,
} from "./village-worldline-layout.js";

export {
  BESS,
  BESS_HOME_IDS,
  CLUSTERS,
  FEEDERS,
  GRID_SEGS,
  HOUSES,
  MAIN_XFMR,
  NORTH,
  OUTAGES,
  POLES,
  PV_FARM,
  PV_ROOF_IDS,
  TARGET_HOMES,
  VILLAGE_PEOPLE,
  PEOPLE_PER_HOME,
  TRANSFORMERS,
  VENDORS,
  DTMS,
  PHASES,
  BOARDS,
  STATIONS,
  HOMES_PER_BOARD,
  LEAKS,
};

export const TARIFF_PER_KWH = 200;
export const LOW_BALANCE = 50;
export const SLOT_MIN = 15;
export const DAY_MIN = 24 * 60;
export const SLOTS = DAY_MIN / SLOT_MIN;

const DEMO_CTX = {
  houses: HOUSES,
  feeders: FEEDERS,
  outages: OUTAGES,
  leaks: LEAKS,
  vendors: VENDORS,
  usb: null,
  hopsToUsb: null,
  nextTowardUsb: null,
  pvNameplateW: null,
  xfmrCapW: null,
};

/** Active village for this sim pass — demo layout or BUILD-seeded customers. */
let ACTIVE = { ...DEMO_CTX };

export function setSimContext(ctx) {
  _adj = null;
  if (!ctx) {
    ACTIVE = { ...DEMO_CTX };
    return;
  }
  ACTIVE = {
    houses: ctx.houses || DEMO_CTX.houses,
    feeders: ctx.feeders || DEMO_CTX.feeders,
    outages: ctx.outages || DEMO_CTX.outages,
    leaks: ctx.leaks || DEMO_CTX.leaks,
    vendors: ctx.vendors || DEMO_CTX.vendors,
    usb: ctx.usb || null,
    hopsToUsb: ctx.hopsToUsb || null,
    nextTowardUsb: ctx.nextTowardUsb || null,
    pvNameplateW: ctx.pvNameplateW ?? null,
    xfmrCapW: ctx.xfmrCapW ?? null,
  };
}

export function getSimContext() {
  return ACTIVE;
}

/** Stretched hamlets: RF does not cover the whole site. Units schematic metres-ish. */
export const LANDMARKS = {
  gen: { x: -26.0, z: -11.0, label: "gen + solar" },
  xfmr: { x: MAIN_XFMR.x, z: MAIN_XFMR.z, label: "LV xfmr" },
  market: { x: -6.0, z: -3.0, label: "Market" },
  clinic: { x: 12.0, z: -4.0, label: "Clinic" },
  kiosk: { x: -3.0, z: 0.2, label: "kiosk" },
  ops: { x: 20.0, z: -9.0, label: "Ops hut" },
  usb: { x: 16.0, z: -3.0, label: "USB GW" },
  cloud: { x: 2.0, z: -38.0, label: "ThunderCloud" },
};

/** End-use hues for the load color scheme + house streamgraph. Viz-only. */
export const LOAD_TYPES = {
  lighting: { id: "lighting", label: "lighting", hex: 0xe6c84a },
  heating: { id: "heating", label: "heating", hex: 0xc0392b },
  fridge: { id: "fridge", label: "refrigeration", hex: 0x0f9b8e },
  ict: { id: "ict", label: "computer / internet", hex: 0x3d8bfd },
  laundry: { id: "laundry", label: "laundry", hex: 0x5b8def },
  cooking: { id: "cooking", label: "cooking", hex: 0xba7517 },
  pump: { id: "pump", label: "water pump", hex: 0x2b6cb0 },
  ag: { id: "ag", label: "agriculture", hex: 0x6a994e },
  tools: { id: "tools", label: "tools / weld", hex: 0x9b4dca },
  productive: { id: "productive", label: "tools / weld", hex: 0x9b4dca },
  idle: { id: "idle", label: "standby / off", hex: 0x3a3a38 },
};

export const STREAM_KEYS = ["lighting", "heating", "fridge", "ict", "laundry", "cooking", "pump", "ag", "tools"];

/** Typical lagging PF by end-use. Schematic, not a meter register. */
export const LOAD_PF = {
  lighting: 0.92,
  heating: 0.99,
  fridge: 0.68,
  ict: 0.62,
  laundry: 0.72,
  cooking: 0.97,
  pump: 0.74,
  ag: 0.7,
  tools: 0.55,
  productive: 0.55,
  idle: 1,
};

export const CIVIC_PF = 0.85;
export const PF_POOR = 0.8;
export const CAP_WARN = 0.8;
export const CAP_LIMIT = 1;
export const CAP_TRIP = 1.5;
export const OVER_100_TRIP_MIN = 30;
export const OVER_150_TRIP_MIN = 15;

export function pfFromMix(mix) {
  let p = 0;
  let q = 0;
  for (const [k, w] of Object.entries(mix || {})) {
    if (!(w > 0)) continue;
    const pf = Math.max(0.2, Math.min(1, LOAD_PF[k] ?? 0.9));
    p += w;
    q += w * Math.tan(Math.acos(pf));
  }
  if (p <= 0) return { pf: 1, varQ: 0 };
  return { pf: p / Math.hypot(p, q), varQ: q };
}

/** Typical current THD % by end-use. Schematic, not a meter register. IEEE 519-ish. */
export const LOAD_THD = {
  lighting: 12,
  heating: 3,
  fridge: 18,
  ict: 28,
  laundry: 22,
  cooking: 7,
  pump: 14,
  ag: 16,
  tools: 32,
  productive: 32,
  idle: 2,
};
export const CIVIC_THD = 10;
/** Color ramp saturates near 15% current THD. 5% is the IEEE 519 voltage-THD neighborhood. */
export const THD_HI = 15;

export function thdFromMix(mix) {
  let p = 0;
  let acc = 0;
  for (const [k, w] of Object.entries(mix || {})) {
    if (!(w > 0)) continue;
    p += w;
    acc += w * (LOAD_THD[k] ?? 8);
  }
  if (p <= 0) return 0;
  return acc / p;
}

export const XFMR_CAPACITY_W = 68000;

/** Sun elevation 0–1, 06:00–18:00 sine. Same curve as the 3D sun bead. */
export function sunElev(min) {
  const t = min / 60 / 12 - 0.5;
  if (t <= 0 || t >= 1) return 0;
  return Math.sin(Math.PI * t);
}

export function pvFarmW(min) {
  const nameplate = ACTIVE.pvNameplateW ?? PV_FARM.nameplateW ?? 0;
  return Math.round(nameplate * sunElev(min));
}

export function civicW(min) {
  const h = min / 60;
  const scale = Math.sqrt(Math.max(1, (ACTIVE.houses || HOUSES).length / 60));
  if (h >= 17 && h < 21) return Math.round(700 * scale);
  if (h >= 8 && h < 17) return Math.round(280 * scale);
  return Math.round(90 * scale);
}

export const SYNC_MINS = [6 * 60, 12 * 60, 18 * 60];


/** Meter-meter RF vs USB Gateway. Short range → choke relays, not one blob. */
export const RF_RANGE = 12;
export const USB_RANGE = 12;
export const RF_MAX_NEIGHBORS = 6;
export const USB_MAX_NEIGHBORS = 16;
/** SparkMAC-ish: one relay can forward this many last-breath packets per slot. */
export const RF_CHANNEL_CAP = 3;

function rfNodes() {
  const homes = ACTIVE.houses || HOUSES;
  const usb = ACTIVE.usb || LANDMARKS.usb;
  return [
    ...homes.map((h) => ({ id: h.id, x: h.x, z: h.z })),
    { id: "usb", x: usb.x, z: usb.z },
  ];
}

function hypotXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

let _adj = null;
export function rfAdj() {
  if (_adj) return _adj;
  const nodes = rfNodes();
  const adj = Object.fromEntries(nodes.map((n) => [n.id, []]));
  for (const a of nodes) {
    const cands = [];
    for (const b of nodes) {
      if (a.id === b.id) continue;
      const range = a.id === "usb" || b.id === "usb" ? USB_RANGE : RF_RANGE;
      const d = hypotXZ(a, b);
      if (d <= range) cands.push({ id: b.id, d });
    }
    cands.sort((x, y) => x.d - y.d || x.id.localeCompare(y.id));
    const cap = a.id === "usb" ? USB_MAX_NEIGHBORS : RF_MAX_NEIGHBORS;
    for (const c of cands.slice(0, cap)) {
      if (!adj[a.id].includes(c.id)) adj[a.id].push(c.id);
      if (!adj[c.id].includes(a.id)) adj[c.id].push(a.id);
    }
  }
  _adj = adj;
  return adj;
}

export function rfEdges() {
  const adj = rfAdj();
  const edges = [];
  const seen = new Set();
  for (const [a, nbrs] of Object.entries(adj)) {
    for (const b of nbrs) {
      const k = a < b ? `${a}>${b}` : `${b}>${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push([a, b]);
    }
  }
  return edges;
}

function distTo(adj, dst) {
  const dist = { [dst]: 0 };
  const q = [dst];
  for (let qi = 0; qi < q.length; qi++) {
    const u = q[qi];
    for (const v of adj[u] || []) {
      if (dist[v] == null) {
        dist[v] = dist[u] + 1;
        q.push(v);
      }
    }
  }
  return dist;
}

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let x = seed || 1;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function walkTo(adj, start, dst, dist, rand, used) {
  const path = [start];
  let u = start;
  const seen = new Set(used);
  seen.add(start);
  for (let i = 0; i < 24 && u !== dst; i++) {
    const cand = (adj[u] || []).filter((v) => !seen.has(v) && dist[v] != null);
    if (!cand.length) return null;
    cand.sort((a, b) => dist[a] - dist[b] || a.localeCompare(b));
    const best = dist[cand[0]];
    const pool = cand.filter((v) => dist[v] === best);
    const v = pool[Math.floor(rand() * pool.length)] || cand[0];
    path.push(v);
    seen.add(v);
    u = v;
  }
  return u === dst ? path : null;
}

/**
 * One progressing route house ↔ USB ↔ GroundBolt. No flood, no overheard stubs.
 * Hop-count greedy; seed only breaks ties so samples do not clone one tree.
 */
export function meshPath(houseId, dir, seed) {
  const adj = rfAdj();
  const src = dir === "up" ? houseId : "usb";
  const dst = dir === "up" ? "usb" : houseId;
  if (src === dst) {
    return dir === "up" ? [src, "ops"] : ["ops", src];
  }
  const dist = distTo(adj, dst);
  const rand = rng(hash32(`${houseId}:${dir}:${seed}`));
  const p = walkTo(adj, src, dst, dist, rand, new Set([src]));
  if (!p) return null;
  return dir === "up" ? [...p, "ops"] : ["ops", ...p];
}

export function hopsToUsb(houseId) {
  if (ACTIVE.hopsToUsb) return ACTIVE.hopsToUsb(houseId);
  const d = distTo(rfAdj(), "usb")[houseId];
  return d == null ? 99 : d;
}

/** Next hop on the hop-count gradient toward the USB Gateway. */
export function nextTowardUsb(houseId) {
  if (ACTIVE.nextTowardUsb) return ACTIVE.nextTowardUsb(houseId);
  const adj = rfAdj();
  const dist = distTo(adj, "usb");
  const d0 = dist[houseId];
  if (d0 == null) return null;
  const nbrs = (adj[houseId] || []).filter((v) => dist[v] != null && dist[v] < d0);
  nbrs.sort((a, b) => dist[a] - dist[b] || a.localeCompare(b));
  return nbrs[0] || null;
}

/** Last-breath packet reaches GroundBolt only if hop count ≤ this (west/south relays = 4, die mid-mesh). */
export const LAST_BREATH_MAX_HOPS = 3;

export function fmtClock(min) {
  const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function hid(house) {
  const n = Number(String(house.id).replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function loudHouse(house) {
  if (house?.loud != null) return !!house.loud;
  const i = hid(house);
  return i % 41 === 0;
}

function inWin(min, start, dur) {
  return min >= start && min < start + dur;
}

function applyUseClassMix(house, min, out, i) {
  const uc = house.useClass;
  if (!uc) return;
  const hr = min / 60;
  if (uc === "streetlight") {
    for (const k of Object.keys(out)) delete out[k];
    if (hr >= 18.2 || hr < 6.2) out.lighting = 40 + (i % 8);
    else out.lighting = 2;
    return;
  }
  if (uc === "medical") {
    out.fridge = Math.max(out.fridge || 0, 72);
    out.lighting = Math.max(out.lighting || 0, hr >= 7 && hr < 20 ? 38 : 16);
    out.ict = Math.max(out.ict || 0, 24);
  } else if (uc === "water") {
    if ((hr >= 6 && hr < 8) || (hr >= 16.5 && hr < 18.5)) out.pump = Math.max(out.pump || 0, 220);
  } else if (uc === "school") {
    if (hr >= 7.5 && hr < 16) {
      out.lighting = Math.max(out.lighting || 0, 28);
      out.ict = Math.max(out.ict || 0, 36);
    }
  } else if (uc === "worship") {
    if ((hr >= 5.5 && hr < 8) || (hr >= 17.5 && hr < 20.5)) out.lighting = Math.max(out.lighting || 0, 46);
  } else if (uc === "telecom") {
    out.ict = Math.max(out.ict || 0, 88);
  } else if (uc === "market" || uc === "commercial") {
    if (hr >= 7 && hr < 19) {
      out.ict = Math.max(out.ict || 0, 18);
      out.lighting = Math.max(out.lighting || 0, 14);
    }
  } else if (uc === "industrial" && hr >= 8 && hr < 17) {
    out.tools = Math.max(out.tools || 0, 160);
  } else if (uc === "agricultural") {
    if ((hr >= 7 && hr < 11) || (hr >= 14 && hr < 17)) out.ag = Math.max(out.ag || 0, 90);
  } else if (uc === "leisure") {
    if (hr >= 17 && hr < 22) out.lighting = Math.max(out.lighting || 0, 50);
  } else if (uc === "security" || uc === "fire") {
    out.lighting = Math.max(out.lighting || 0, 18);
    out.ict = Math.max(out.ict || 0, 12);
  }
}

/**
 * Household end-use bursts. Fridge holds; tasks come in succession, staggered by meter.
 * Per-house traits from layout — not the same schedule cloned 1000 times.
 */
function activityMix(house, min, shed = false) {
  const i = hid(house);
  const hr = min / 60;
  const rural = house.cluster === "west" || house.cluster === "south";
  const urban = house.cluster === "market" || house.cluster === "east";
  const scale = house.loadScale || 1;
  const out = {};

  out.fridge = Math.round((house.fridgeW || (rural ? 22 : 30)) * (0.85 + (i % 5) * 0.04));

  const away = house.awayDay && hr >= 8.2 && hr < 16.4;
  if (away) {
    out.fridge = Math.round(out.fridge * 0.9);
  } else {
    if (hr < 6.4 || hr >= 18.1) {
      out.lighting = hr >= 22.4 || hr < 5.4 ? 6 + (i % 5) * 3 : 12 + (i % 6) * 3;
    } else if (urban && hr >= 9 && hr < 17) {
      out.lighting = 4 + (i % 4) * 2;
    }

    if (house.heat && hr >= 5.0 + (i % 7) * 0.15 && hr < 7.4) out.heating = 18 + (i % 4) * 6;

    if (house.cookBreakfast) {
      const breakfast = 5 * 60 + 40 + (i % 14) * 12;
      if (inWin(min, breakfast, 20 + (i % 3) * 10)) out.cooking = Math.round((rural ? 70 : 95) * scale);
    }

    if (house.cookDinner) {
      const dinner = 16 * 60 + 20 + (house.dinnerOff || 0);
      if (inWin(min, dinner, house.dinnerDur || 60)) {
        const c = house.cookW || (rural ? 150 : 210);
        out.cooking = Math.max(out.cooking || 0, Math.round(c));
      }
    }

    if (house.laundry) {
      const laundryStart = 8 * 60 + 20 + (house.laundryOff || 0);
      if (inWin(min, laundryStart, 40 + (i % 4) * 10) && !out.cooking) out.laundry = Math.round(70 + (i % 6) * 12);
    }

    if (house.pump) {
      const pumpStart = 6 * 60 + 40 + (i % 11) * 25;
      if (inWin(min, pumpStart, 18 + (i % 3) * 8)) out.pump = 110 + (i % 5) * 18;
    }

    if (house.ag) {
      const a0 = 8 * 60 + 50 + (i % 9) * 12;
      const a1 = 13 * 60 + 20 + (i % 7) * 14;
      if (inWin(min, a0, 25 + (i % 4) * 8) || inWin(min, a1, 20 + (i % 3) * 10)) {
        out.ag = Math.round((55 + (i % 5) * 18) * scale);
      }
    }

    if (house.ict) {
      if (hr >= 9.2 + (i % 5) * 0.2 && hr < 16.5) out.ict = Math.round(house.ictW || 28);
      else if (hr >= 18.8 && hr < 22.1 && i % 3 !== 0) out.ict = Math.round((house.ictW || 28) * 0.7);
    } else if (hr >= 19.2 && hr < 21.4 && i % 4 === 1) {
      out.ict = 16 + (i % 3) * 6;
    }

    if (house.peakW != null && min >= house.peakStart && min < house.peakEnd) {
      out.tools = house.peakW;
    } else if (house.tools && inWin(min, 11 * 60 + (i % 8) * 20, 35 + (i % 4) * 10)) {
      out.tools = Math.round(70 + (i % 6) * 20);
    }
  }

  applyUseClassMix(house, min, out, i);

  if (shed) {
    for (const k of ["cooking", "tools", "ag", "laundry", "pump"]) {
      if (out[k]) out[k] = Math.round(out[k] * 0.45);
    }
  }

  for (const k of STREAM_KEYS) {
    if (!out[k]) continue;
    out[k] = Math.round(out[k]);
    if (out[k] <= 0) delete out[k];
  }
  return out;
}

export function outageHit(house, min) {
  if (!house) return null;
  for (const o of ACTIVE.outages || OUTAGES) {
    if (min <= o.min || min >= o.restore) continue;
    if (o.feederId && house.feederId === o.feederId) return o;
    if (o.xfmrId && house.xfmrId === o.xfmrId) return o;
  }
  return null;
}

export function outageCovers(seg, min) {
  for (const o of ACTIVE.outages || OUTAGES) {
    if (min <= o.min || min >= o.restore) continue;
    if (o.xfmrId && seg.xfmrId === o.xfmrId) return o;
    if (o.feederId && seg.feederId === o.feederId) return o;
  }
  return null;
}

export function loadW(house, min, shed = false) {
  const mix = activityMix(house, min, shed);
  let s = 0;
  for (const v of Object.values(mix)) s += v;
  return s;
}

export function loadMix(house, min, powerW, on, shed = false) {
  if (!on || powerW <= 0) return {};
  return activityMix(house, min, shed);
}

export function dominantLoad(house, min, on, mix) {
  if (!on) return "idle";
  if (mix) {
    let best = "idle";
    let bestW = 0;
    for (const [k, v] of Object.entries(mix)) {
      if (v > bestW) {
        bestW = v;
        best = k;
      }
    }
    return best;
  }
  if (house.peakLoad && house.peakW != null && min >= house.peakStart && min < house.peakEnd) {
    return house.peakLoad === "productive" ? "tools" : house.peakLoad;
  }
  const h = min / 60;
  if (h < 6 || h >= 22) return house.nightLoad || "lighting";
  if (h < 17) return house.dayLoad || "lighting";
  return house.eveLoad || "lighting";
}

function costOf(energyWh) {
  return (energyWh / 1000) * TARIFF_PER_KWH;
}

function runDtmTransfers(byId, min, shed, events, lastXfer, xferCount) {
  for (const f of ACTIVE.feeders || FEEDERS) {
    if ((xferCount[f.id] || 0) >= 2) continue;
    if (lastXfer[f.id] != null && min - lastXfer[f.id] < 75) continue;
    const live = Object.values(byId).filter((h) => h.feederId === f.id && h.on && !outageHit(h, min));
    if (live.length < 2) continue;
    const load = { A: 0, B: 0, C: 0 };
    const members = { A: [], B: [], C: [] };
    for (const h of live) {
      const ph = PHASES.includes(h.phase) ? h.phase : "A";
      const w = loadW(h, min, shed);
      load[ph] += w;
      members[ph].push(h);
    }
    const mx = Math.max(load.A, load.B, load.C);
    const mn = Math.min(load.A, load.B, load.C);
    if (mx < 80 || mn < 12) continue;
    const imb = (mx - mn) / mx;
    if (imb < 0.38) continue;
    const heavy = PHASES.find((p) => load[p] === mx);
    const light = PHASES.find((p) => load[p] === mn);
    if (!heavy || !light || heavy === light) continue;
    const pick = members[heavy].slice().sort((a, b) => loadW(b, min, shed) - loadW(a, min, shed))[0];
    if (!pick) continue;
    const from = pick.phase;
    pick.phase = light;
    lastXfer[f.id] = min;
    xferCount[f.id] = (xferCount[f.id] || 0) + 1;
    events.push({
      min,
      kind: "phase_xfer",
      houseId: pick.id,
      feederId: f.id,
      fromPhase: from,
      toPhase: light,
      note: `DTM ${f.cluster} 3φ compare · transfer ${pick.name} ${from}→${light} · imbalance ${Math.round(imb * 100)}%`,
    });
  }
}

/**
 * @returns {{
 *   houses: typeof HOUSES,
 *   events: object[],
 *   readings: object[],
 *   summary: object
 * }}
 */
export function simulateDay(ctx) {
  if (ctx) setSimContext(ctx);
  const houses = ACTIVE.houses || HOUSES;
  const outages = ACTIVE.outages || OUTAGES;
  const leaks = ACTIVE.leaks || LEAKS;
  const vendors = ACTIVE.vendors || VENDORS;
  const xfmrCap = ACTIVE.xfmrCapW ?? XFMR_CAPACITY_W;
  const events = [];
  const readings = [];
  const byId = Object.fromEntries(
    houses.map((h) => [
      h.id,
      {
        ...h,
        wallet: h.startCredit,
        on: h.startCredit > 0,
        smsSent: false,
        cutReason: null,
        over100Min: 0,
        over150Min: 0,
        warn80: false,
        warn100: false,
        warnPf: false,
      },
    ]),
  );
  let shed = false;
  let peakFeederW = 0;
  let peakPvW = 0;
  let pvWh = 0;
  let lastBreathArrivedN = 0;
  let lastBreathSilentN = 0;
  let payN = 0;
  let paySum = 0;
  const lastXfer = {};
  const xferCount = {};
  let cutN = 0;
  let overloadN = 0;
  let cap80N = 0;
  let cap100N = 0;
  let pfWarnN = 0;
  let recN = 0;
  let smsN = 0;
  const outageLog = outages.map((o) => ({ ...o, lastBreathArrived: 0, lastBreathSilent: 0, nDark: 0 }));

  for (const h of Object.values(byId)) {
    if (!h.on && loudHouse(h)) {
      events.push({
        min: 0,
        kind: "off",
        houseId: h.id,
        wallet: h.wallet,
        note: "STATE_AUTO · credit 0 · relay off at midnight",
      });
    }
  }

  for (let slot = 0; slot < SLOTS; slot++) {
    const min = slot * SLOT_MIN;
    const pvW = pvFarmW(min);
    if (pvW > peakPvW) peakPvW = pvW;
    pvWh += pvW * (SLOT_MIN / 60);

    for (const h of Object.values(byId)) {
      for (const pay of h.payments) {
        if (pay.min < min || pay.min >= min + SLOT_MIN) continue;
        h.wallet += pay.amount;
        payN += 1;
        paySum += pay.amount;
        const loud = loudHouse(h);
        if (loud) {
          const vendor = vendors.find((v) => v.id === h.vendorId);
          const via = h.payVia || "vendor";
          const where =
            via === "vendor"
              ? vendor?.label || "kiosk"
              : via === "phone"
                ? "mobile money"
                : "CIU keypad";
          events.push({
            min: pay.min,
            kind: "pay",
            houseId: h.id,
            amount: pay.amount,
            wallet: h.wallet,
            via,
            vendorId: h.vendorId,
            note: `POST /transaction/ +${pay.amount} · ${where}`,
          });
          events.push({
            min: pay.min + 1,
            kind: "credit",
            houseId: h.id,
            amount: pay.amount,
            wallet: h.wallet,
            via,
            vendorId: h.vendorId,
            note: "set_balance → CIU",
          });
        }
        if (!h.on && h.wallet > 0 && !outageHit(h, pay.min + 1)) {
          h.on = true;
          recN += 1;
          if (loud) {
            events.push({
              min: pay.min + 1,
              kind: "reconnect",
              houseId: h.id,
              wallet: h.wallet,
              note: "configure_meter STATE_ON (AUTO funds)",
            });
          }
        }
      }
    }

    if (SYNC_MINS.includes(min)) {
      events.push({
        min,
        kind: "sync",
        houseId: null,
        note: "SymmetricDS ground→cloud (optional WAN)",
      });
    }

    for (const o of outages) {
      if (min === o.min + 15) {
        events.push({
          min,
          kind: "repair",
          houseId: null,
          note: `Crew at ${o.label} · ${o.note}`,
          outageId: o.id,
        });
      }
      if (o.kind === "overload" && min === o.min + 45) {
        shed = true;
        events.push({
          min,
          kind: "shed",
          houseId: null,
          note: "Load shed on remaining feeders · cooking / weld advisory",
          outageId: o.id,
        });
      }
      if (min === o.restore) {
        let n = 0;
        for (const h of Object.values(byId)) {
          const hit = o.xfmrId ? h.xfmrId === o.xfmrId : h.feederId === o.feederId;
          if (!hit) continue;
          if (h.wallet > 0) {
            h.on = true;
            n += 1;
          }
        }
        events.push({
          min,
          kind: "restore",
          houseId: null,
          note: `${o.label} close · ${n} meters re-energized`,
          outageId: o.id,
        });
      }
    }

    let intended = civicW(min);
    for (const h of Object.values(byId)) {
      if (h.on && !outageHit(h, min)) intended += loadW(h, min, shed);
    }
    if (intended > peakFeederW) peakFeederW = intended;

    for (const h of Object.values(byId)) {
      const dark = outageHit(h, min);
      const limit = h.loadLimitW || 400;
      if (!dark && !h.on && h.cutReason === "overload" && loadW(h, min, shed) < limit) {
        h.on = true;
        h.cutReason = null;
        h.over100Min = 0;
        h.over150Min = 0;
        recN += 1;
        if (loudHouse(h)) {
          events.push({
            min,
            kind: "reconnect",
            houseId: h.id,
            wallet: h.wallet,
            note: "overload clear · under load_limit_w · configure_meter STATE_ON",
          });
        }
      }
      if (dark || !h.on) {
        h.over100Min = 0;
        h.over150Min = 0;
        readings.push({
          min,
          houseId: h.id,
          energyWh: 0,
          powerW: 0,
          on: false,
          wallet: h.wallet,
          cost: 0,
          loadType: "idle",
          loadLimitW: h.loadLimitW,
          capacity: 0,
          pf: 1,
          varQ: 0,
          thd: 0,
          phase: h.phase || "A",
          feederOut: !!dark,
          mix: {},
        });
        continue;
      }

      const powerW = loadW(h, min, shed);
      const energyWh = powerW * (SLOT_MIN / 60);
      let cost = costOf(energyWh);
      let billedWh = energyWh;
      let disconnected = false;
      let cutKind = null;

      if (cost >= h.wallet) {
        billedWh = h.wallet > 0 ? (h.wallet / TARIFF_PER_KWH) * 1000 : 0;
        cost = h.wallet;
        h.wallet = 0;
        h.on = false;
        h.cutReason = "credit";
        disconnected = true;
        cutKind = "credit";
      } else {
        h.wallet -= cost;
      }

      let watts = disconnected ? 0 : powerW;
      let mix = loadMix(h, min, watts, !disconnected, shed);
      let pq = disconnected ? { pf: 1, varQ: 0 } : pfFromMix(mix);
      const ratio = limit ? watts / limit : 0;

      if (!disconnected) {
        if (ratio >= CAP_TRIP) {
          h.over150Min += SLOT_MIN;
          h.over100Min += SLOT_MIN;
        } else if (ratio >= CAP_LIMIT) {
          h.over150Min = 0;
          h.over100Min += SLOT_MIN;
        } else {
          h.over150Min = 0;
          h.over100Min = 0;
        }
        if (ratio >= CAP_WARN && !h.warn80) {
          h.warn80 = true;
          cap80N += 1;
          if (loudHouse(h)) {
            events.push({
              min,
              kind: "cap_warn",
              houseId: h.id,
              capacity: ratio,
              note: `${Math.round(ratio * 100)}% of load_limit_w (${limit} W) · 80% threshold`,
            });
          }
        }
        if (ratio >= CAP_LIMIT && !h.warn100) {
          h.warn100 = true;
          cap100N += 1;
          if (loudHouse(h)) {
            events.push({
              min,
              kind: "cap_warn",
              houseId: h.id,
              capacity: ratio,
              note: `${Math.round(ratio * 100)}% of load_limit_w (${limit} W) · 100% allotment`,
            });
          }
        }
        if (pq.pf < PF_POOR && !h.warnPf) {
          h.warnPf = true;
          pfWarnN += 1;
          if (loudHouse(h)) {
            events.push({
              min,
              kind: "pf_warn",
              houseId: h.id,
              pf: pq.pf,
              note: `PF ${pq.pf.toFixed(2)} < ${PF_POOR.toFixed(2)} · ${dominantLoad(h, min, true, mix)}`,
            });
          }
        }
        if (h.over150Min >= OVER_150_TRIP_MIN || h.over100Min >= OVER_100_TRIP_MIN) {
          const why = h.over150Min >= OVER_150_TRIP_MIN ? "15 min ≥ 150%" : "30 min ≥ 100%";
          h.on = false;
          h.cutReason = "overload";
          disconnected = true;
          cutKind = "overload";
          watts = 0;
          mix = {};
          pq = { pf: 1, varQ: 0 };
          h.over100Min = 0;
          h.over150Min = 0;
          overloadN += 1;
          events.push({
            min,
            kind: "overload",
            houseId: h.id,
            wallet: h.wallet,
            note: `${why} load_limit_w · configure_meter STATE_OFF`,
          });
        }
      }

      const loadType = dominantLoad(h, min, !disconnected, mix);
      const capacity = disconnected ? 0 : ratio;
      let thd = disconnected ? 0 : thdFromMix(mix);
      if (!disconnected && PV_ROOF_IDS.includes(h.id)) thd += 5 * sunElev(min);
      readings.push({
        min,
        houseId: h.id,
        energyWh: billedWh,
        powerW: watts,
        on: !disconnected,
        wallet: h.wallet,
        cost,
        loadType,
        loadLimitW: h.loadLimitW,
        capacity,
        pf: pq.pf,
        varQ: pq.varQ,
        thd,
        phase: h.phase || "A",
        feederOut: false,
        mix,
      });

      if (!h.smsSent && h.wallet > 0 && h.wallet <= LOW_BALANCE) {
        h.smsSent = true;
        smsN += 1;
        if (loudHouse(h)) {
          events.push({
            min,
            kind: "sms",
            houseId: h.id,
            wallet: h.wallet,
            note: `TYPE_CUSTOMER_LOW_BALANCE (threshold ${LOW_BALANCE})`,
          });
        }
      }

      if (disconnected && cutKind === "credit") {
        cutN += 1;
        if (loudHouse(h)) {
          events.push({
            min,
            kind: "disconnect",
            houseId: h.id,
            wallet: 0,
            note: "credit_wallet <= 0 · configure_meter STATE_OFF",
          });
        }
      }
    }

    runDtmTransfers(byId, min, shed, events, lastXfer, xferCount);

    for (const o of outages) {
      if (o.min !== min) continue;
      const silentByCluster = {};
      const slotReadings = readings.slice(readings.length - houses.length);
      const hit = (h) => (o.xfmrId ? h.xfmrId === o.xfmrId : h.feederId === o.feederId);
      for (const r of slotReadings) {
        if (!hit(byId[r.houseId])) continue;
        const hops = hopsToUsb(r.houseId);
        const gaspingOn = r.on && r.powerW > 0;
        r.lastBreath = gaspingOn;
        r.lastBreathHops = hops;
        r.lastBreathReason = null;
        r.lastBreathArrived = gaspingOn && hops <= LAST_BREATH_MAX_HOPS;
        r.feederOut = true;
        r.outageId = o.id;
      }
      const arrived = slotReadings.filter((r) => r.lastBreathArrived && r.outageId === o.id);
      const byNext = {};
      for (const r of arrived) {
        const nxt = nextTowardUsb(r.houseId) || "usb";
        (byNext[nxt] = byNext[nxt] || []).push(r);
      }
      for (const [nxt, rs] of Object.entries(byNext)) {
        rs.sort((a, b) => a.houseId.localeCompare(b.houseId));
        const cap = nxt === "usb" ? 8 : RF_CHANNEL_CAP;
        for (let i = cap; i < rs.length; i++) {
          rs[i].lastBreathArrived = false;
          rs[i].lastBreathReason = "channel";
        }
      }
      const arrivedFinal = [];
      const log = outageLog.find((x) => x.id === o.id);
      for (const r of slotReadings) {
        if (!r.lastBreath || r.outageId !== o.id) continue;
        if (r.lastBreathArrived) {
          lastBreathArrivedN += 1;
          if (log) log.lastBreathArrived += 1;
          arrivedFinal.push(r);
        } else {
          lastBreathSilentN += 1;
          if (log) log.lastBreathSilent += 1;
          if (!r.lastBreathReason) r.lastBreathReason = "hops";
          const cl = byId[r.houseId].cluster;
          silentByCluster[cl] = silentByCluster[cl] || { hops: 0, channel: 0 };
          silentByCluster[cl][r.lastBreathReason] += 1;
        }
      }
      if (log) log.nDark = slotReadings.filter((r) => hit(byId[r.houseId])).length;
      for (const r of arrivedFinal.slice(0, 8)) {
        events.push({
          min,
          kind: "lastbreath",
          houseId: r.houseId,
          powerW: r.powerW,
          wallet: r.wallet,
          outageId: o.id,
          note: `last breath reached GB · ${r.powerW} W · ${r.lastBreathHops} hop${r.lastBreathHops === 1 ? "" : "s"} · ${o.label}`,
        });
      }
      for (const [cl, n] of Object.entries(silentByCluster)) {
        if (n.hops) {
          events.push({
            min,
            kind: "lastbreath_lost",
            houseId: null,
            outageId: o.id,
            note: `${cl}: ${n.hops} last-breath packet${n.hops === 1 ? "" : "s"} died mid-mesh (${LAST_BREATH_MAX_HOPS + 1}+ hops) · ${o.label}`,
          });
        }
        if (n.channel) {
          events.push({
            min,
            kind: "lastbreath_lost",
            houseId: null,
            outageId: o.id,
            note: `${cl}: ${n.channel} dropped · RF channel cap ${RF_CHANNEL_CAP} · ${o.label}`,
          });
        }
      }
      events.push({
        min,
        kind: "outage",
        houseId: null,
        outageId: o.id,
        note: `${o.note} · ${log ? log.nDark : 0} meters dark after this slot`,
      });
    }
  }

  for (const lk of leaks) {
    events.push({
      min: lk.min,
      kind: "leak",
      leakId: lk.id,
      houseId: null,
      note: `${lk.note} · span ${lk.label}`,
    });
    events.push({
      min: lk.restore,
      kind: "leak_clear",
      leakId: lk.id,
      houseId: null,
      note: `Leak clear · ${lk.label} · ΔP back inside noise`,
    });
  }

  events.sort((a, b) => a.min - b.min || String(a.kind).localeCompare(b.kind));

  const kWh = readings.reduce((s, r) => s + r.energyWh, 0) / 1000;
  const summary = {
    customers: houses.length,
    tariff: TARIFF_PER_KWH,
    heartbeatMin: SLOT_MIN,
    xfmrCapW: xfmrCap,
    peakFeederW: Math.round(peakFeederW),
    pvNameplateW: PV_FARM.nameplateW || 0,
    pvPeakW: Math.round(peakPvW),
    pvKWh: Math.round((pvWh / 1000) * 10) / 10,
    tripMin: outages[0]?.min ?? null,
    restoreMin: outages[outages.length - 1]?.restore ?? null,
    outages: outageLog,
    faultAt: outages.map((o) => o.label).join(" · "),
    faultCluster: outages.map((o) => o.label).join(", "),
    faultClusterW: 0,
    civicAtTrip: 0,
    lastBreathArrived: lastBreathArrivedN,
    lastBreathSilent: lastBreathSilentN,
    lastBreathArrivedIds: readings.filter((r) => r.lastBreathArrived).slice(0, 12).map((r) => r.houseId),
    payments: payN,
    paymentSum: paySum,
    phaseXfers: events.filter((e) => e.kind === "phase_xfer").length,
    cutoffs: cutN,
    overloads: overloadN,
    cap80: cap80N,
    cap100: cap100N,
    pfWarns: pfWarnN,
    reconnects: recN,
    sms: smsN,
    leaks: leaks.length,
    leakW: leaks.reduce((s, lk) => s + (lk.leakW || 0), 0),
    kWh: Math.round(kWh * 1000) / 1000,
    billed: Math.round(kWh * TARIFF_PER_KWH * 100) / 100,
    readings: readings.length,
  };

  return { houses, events, readings, summary };
}
