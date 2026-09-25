import { buildVillageWater } from "./village-water.js";
import { buildProductiveUse } from "./productive-use-view.js";
import { buildEnergyAssets } from "./energy-assets-view.js";
import { ENERGY_CLASSES, ENERGY_CLASS_ORDER, countEnergyByClass } from "./energy-assets.js";
import { createVillageMap, rebindMapOrigin } from "./village-basemap.js";
import { createBuildMode, FEED_KINDS, feedConfigComplete, buildSvgIcon, defaultLineKv, LINE_KV_PRESETS } from "./village-build.js";
import { fetchVillagePack, buildPackLayer, disposePackLayer } from "./village-pack-layer.js";
import { resolvePlace, fetchSiteOsm, cacheSitePack, addSiteOsmLayers, clearSiteOsmLayers } from "./village-site-cache.js";
import {
  blankProject,
  saveProject,
  getProject,
  listProjects,
  deleteProject,
  downloadJson,
  readJsonFile,
  normalizeImport,
  placedToGeoJSON,
  slugName,
} from "./village-project.js";
import { createCandidateOverlay } from "./village-candidates.js";
import { buildKpiReport, kpiGroupsForMode, kpiScore, kpiHit, fmtKpi } from "./village-kpi.js";
import { MODE_HIDE, MODE_META, bindModeSwitcher } from "./village-modes.js";
import {
  USE_CLASSES,
  CRITICAL_ORDER,
  NONCRITICAL_ORDER,
  USE_TIER,
  useClassColor,
  useClassMatchesFocus,
} from "./customer-use.js";
import * as THREE from "three";

import { Sky } from "three/addons/objects/Sky.js";
import {
  BESS,
  BESS_HOME_IDS,
  CLUSTERS,
  DAY_MIN,
  FEEDERS,
  GRID_SEGS,
  HOUSES,
  LANDMARKS,
  LOAD_TYPES,
  NORTH,
  OUTAGES,
  POLES,
  PV_FARM,
  PV_ROOF_IDS,
  SLOT_MIN,
  SLOTS,
  STREAM_KEYS,
  LAST_BREATH_MAX_HOPS,
  RF_CHANNEL_CAP,
  TARGET_HOMES,
  TARIFF_PER_KWH,
  LOW_BALANCE,
  hopsToUsb,
  TRANSFORMERS,
  VENDORS,
  VILLAGE_PEOPLE,
  PEOPLE_PER_HOME,
  XFMR_CAPACITY_W,
  DTMS,
  PHASES,
  BOARDS,
  STATIONS,
  HOMES_PER_BOARD,
  LEAKS,
  CIVIC_PF,
  CIVIC_THD,
  PF_POOR,
  THD_HI,
  civicW,
  sunElev,
  pvFarmW,
  fmtClock,
  meshPath,
  outageCovers,
  outageHit,
  rfEdges,
  simulateDay,
  setSimContext,
  getSimContext,
} from "./village-worldline-sim.js";
import { buildSeededLive, emptyLivePack, overlayLiveFromPlaced } from "./village-seed-day.js";
import { HANG, geoidBlock, ORIGIN, GROUND_SCALE, HEIGHT_SCALE, lonLatToEnu, enuToLonLat, setVillageOrigin, resetVillageOrigin } from "./geo.js";
import { TimeContext } from "@circaevum/locus/time";

function geoidCollection(features, name = "ISV village schematic") {
  return {
    type: "FeatureCollection",
    name,
    features,
  };
}

const COL = {
  site: 0x3b6d11,
  meter: 0x175cd3,
  money: 0xc9a227,
  reading: 0x2aa8b8,
  people: 0x534ab7,
  sms: 0xc45b8a,
  ops: 0x8a8a82,
  off: 0x3a3a38,
  disconnect: 0xb42318,
  outage: 0xb42318,
  fault: 0xff2d4a,
  repair: 0xc9a227,
  shed: 0xba7517,
  cap_warn: 0xba7517,
  pf_warn: 0x3d8bfd,
  overload: 0xb42318,
  restore: 0x3b6d11,
  lastbreath: 0xff4d1a,
  lastbreath_lost: 0xff9a40,
  dtm: 0x2bb6a3,
  phase_xfer: 0x5c7cfa,
  leak: 0xe85dff,
  bg: 0x121214,
  ground: 0x1a1a1d,
};

/** Physical plant — one hue per asset class. */
const ASSET = {
  home: 0x9aa8b8,
  lateral: 0x5ee0a0,
  board: 0xff6a2a,
  feeder: 0x3d8bfd,
  station: 0xffe566,
  dtm: 0x2ee6d0,
  xfmr: 0xd45aa0,
  breaker: 0xff3355,
};

const WINDOW_MIN = 120;
const Y_PER_HOUR = 18;
const SCRUNCH_H = 9;
const yAt = (min) => (min / 60) * Y_PER_HOUR;
const PAST_TOP = yAt(WINDOW_MIN) + SCRUNCH_H;
let boundH = yAt(WINDOW_MIN);

const villageTime = new TimeContext({
  mode: "playhead",
  now: 0,
  window: WINDOW_MIN,
  presentHeight: boundH,
  pastHeight: SCRUNCH_H,
  futureHeight: SCRUNCH_H,
  pastSpan: 1,
  futureSpan: 1,
});

function isV2() {
  return state.viz !== "v1";
}

function v1Top() {
  return boundH * (DAY_MIN / WINDOW_MIN);
}

function yWorldAt(t, now) {
  if (!isV2()) return ((t - now) / WINDOW_MIN) * boundH;
  villageTime.setNow(now);
  villageTime.presentHeight = boundH;
  villageTime.pastSpan = Math.max(now - WINDOW_MIN, 1);
  villageTime.futureSpan = Math.max(DAY_MIN - now, 1);
  return villageTime.y(t);
}

function hopFitK(min, hops, dy) {
  if (hops <= 1) return 1;
  const span = (hops - 1) * dy;
  const base = yWorldAt(min, state.nowMin);
  const top = isV2() ? PAST_TOP - 0.12 : v1Top() + 2;
  const bot = isV2() ? -SCRUNCH_H + 0.12 : yWorldAt(0, state.nowMin) + 0.08;
  const room = base >= 0 ? top - base : base - bot;
  if (span <= 0) return 1;
  if (room <= 0.04) return 0.04 / span;
  return span > room ? room / span : 1;
}

function stackHopWorldY(min, hopI, dyScale = 1, hops = 1) {
  const dy = HOP_DY * dyScale;
  return yWorldAt(min, state.nowMin) + hopI * dy * hopFitK(min, hops, dy);
}

function lastBreathY(min, hopI = 0, hops = 1) {
  return stackHopWorldY(min, hopI, 1.45, hops);
}
const LINE_HANG = HANG.pole;
const WIRE_STEPS = 8;

function houseSize(i) {
  return 0.58 + (i % 5) * 0.05;
}
/** Keep static ground decals off one another. Worldlines may still cross. */
const Y_ROAD = 0.08;
const Y_NOW = 0.28;
const Y_RF = 0.22;
/** Ground corridor around selected feeder traces — between polar grid and RF. */
const Y_FEEDER = 0.19;
const HOP_DY = 0.16;
const KNOB_STEP = 5;
function fitCompass() {
  const pts = HOUSES.map((h) => [h.x, h.z]);
  for (const p of [LANDMARKS.gen, LANDMARKS.xfmr, LANDMARKS.ops, LANDMARKS.usb, LANDMARKS.kiosk, LANDMARKS.clinic, LANDMARKS.market]) {
    pts.push([p.x, p.z]);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  return { x, z, r: Math.max(32, Math.hypot(maxX - x, maxZ - z) + 10) };
}

const COMPASS = HOUSES.length < 200 ? fitCompass() : { x: 4, z: 22, r: 86 };

function camHome(v2) {
  const s = COMPASS.r / 86;
  if (v2) {
    return {
      pos: [COMPASS.x + 91 * s, Math.max(18, 38 * s), COMPASS.z + 103 * s],
      look: [COMPASS.x, PAST_TOP * 0.28, COMPASS.z],
    };
  }
  return {
    pos: [COMPASS.x + 116 * s, Math.max(36, 90 * s), COMPASS.z + 158 * s],
    look: [COMPASS.x, Math.max(6, boundH * 0.35), COMPASS.z],
  };
}
const PV_COL = 0x1a2740;
const PV_ON = 0x40b8ff;

const clipPlanes = [
  new THREE.Plane(new THREE.Vector3(0, 1, 0), SCRUNCH_H + 0.08),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), PAST_TOP + 0.08),
];

const CAP_LO = new THREE.Color(0x3b6d11);
const CAP_MID = new THREE.Color(0xe6c84a);
const CAP_HI = new THREE.Color(0xb42318);
const HAR_LO = new THREE.Color(0x1a8f7a);
const HAR_MID = new THREE.Color(0x9b4dca);
const HAR_HI = new THREE.Color(0xff2d6a);

function capacityColor(t) {
  const c = new THREE.Color();
  const x = Math.max(0, Math.min(1, t));
  if (x < 0.5) return c.lerpColors(CAP_LO, CAP_MID, x / 0.5);
  return c.lerpColors(CAP_MID, CAP_HI, (x - 0.5) / 0.5);
}

function thdColor(pct) {
  const c = new THREE.Color();
  const x = Math.max(0, Math.min(1, (pct || 0) / THD_HI));
  if (x < 0.5) return c.lerpColors(HAR_LO, HAR_MID, x / 0.5);
  return c.lerpColors(HAR_MID, HAR_HI, (x - 0.5) / 0.5);
}

function parseLineGrad(v) {
  if (v === "pf" || v === "harmonics") return v;
  return "capacity";
}

function readingMetricColor(r) {
  if (!r || !r.on || r.feederOut) {
    if (state.lineGrad === "harmonics") return thdColor(0);
    if (state.lineGrad === "pf") return pfColor(1);
    return capacityColor(0);
  }
  if (state.lineGrad === "pf") return pfColor(r.pf ?? 1);
  if (state.lineGrad === "harmonics") return thdColor(r.thd || 0);
  return capacityColor(r.capacity || 0);
}

function flowMetricColor(p, q, cap, thd) {
  if (state.lineGrad === "pf") return pfColor(p <= 0 ? 1 : p / Math.hypot(p, q || 0));
  if (state.lineGrad === "harmonics") return thdColor(thd || 0);
  return capacityColor(Math.min(1, (p || 0) / Math.max(1, cap || 1)));
}

function aggThd(pq) {
  if (!pq || !(pq.p > 0)) return 0;
  return (pq.thdP || 0) / pq.p;
}

function houseIdsMetricColor(ids, last) {
  let p = 0;
  let q = 0;
  let cap = 0;
  let thdP = 0;
  for (const hid of ids || []) {
    const h = houseById[hid];
    const r = last ? last[hid] : readingAt(hid, state.nowMin);
    cap += h?.loadLimitW || 220;
    if (r && r.on && !r.feederOut) {
      p += r.powerW || 0;
      q += r.varQ || 0;
      thdP += (r.thd || 0) * (r.powerW || 0);
    }
  }
  return flowMetricColor(p, q, Math.max(1, cap), p > 0 ? thdP / p : 0);
}

/** House ids per feeder — allotment = Σ load_limit_w of this consumer set. */
const HOUSE_IDS_BY_FEEDER = {};
for (const h of HOUSES) (HOUSE_IDS_BY_FEEDER[h.feederId] ||= []).push(h.id);

let _feederColMin = -1;
let _feederCols = null;

/** One color per feeder: live Σ W / Σ allotted load_limit_w on that feeder's homes. */
function feederAllotColors(last, min = state.nowMin) {
  if (_feederCols && _feederColMin === min) return _feederCols;
  const src = last || loadsAt(min).last;
  const cols = {};
  let p = 0;
  let q = 0;
  let cap = 0;
  let thdP = 0;
  for (const [fid, ids] of Object.entries(HOUSE_IDS_BY_FEEDER)) {
    const c = houseIdsMetricColor(ids, src);
    cols[fid] = c;
    for (const hid of ids) {
      const h = houseById[hid];
      const r = src[hid];
      cap += h?.loadLimitW || 220;
      if (r && r.on && !r.feederOut) {
        p += r.powerW || 0;
        q += r.varQ || 0;
        thdP += (r.thd || 0) * (r.powerW || 0);
      }
    }
  }
  cols._village = flowMetricColor(p, q, Math.max(1, cap), p > 0 ? thdP / p : 0);
  _feederColMin = min;
  _feederCols = cols;
  return cols;
}

function feederColorForHouse(houseId, last) {
  const h = houseById[houseId];
  const cols = feederAllotColors(last);
  return (h && cols[h.feederId] ? cols[h.feederId] : cols._village).clone();
}

/** Lambert + instanceColor as night glow. `uGlow` scales with lighting mode. */
const glowMats = [];
function glowLambert(emit) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.userData.baseEmit = emit;
  m.userData.glow = emit;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: m.userData.glow };
    m.userData.glowUniform = shader.uniforms.uGlow;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
       uniform float uGlow;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       totalEmissiveRadiance += diffuseColor.rgb * uGlow;`,
    );
  };
  m.customProgramCacheKey = () => `glowL:${emit}`;
  glowMats.push(m);
  return m;
}

function setGlowScale(mode) {
  const k = mode === "fill" ? 0.5 : mode === "lamps" ? 1.2 : 1;
  for (const m of glowMats) {
    m.userData.glow = m.userData.baseEmit * k;
    if (m.userData.glowUniform) m.userData.glowUniform.value = m.userData.glow;
  }
}

function pfColor(pf) {
  const t = (1 - Math.max(0.55, Math.min(1, pf))) / 0.45;
  return capacityColor(t);
}

const OSI = {
  1: { id: 1, label: "L1 Physical", hex: 0xc4783a },
  2: { id: 2, label: "L2 Data link", hex: 0xe24b4b },
  3: { id: 3, label: "L3 Network", hex: 0xf0a202 },
  4: { id: 4, label: "L4 Transport", hex: 0xe8e04a },
  5: { id: 5, label: "L5 Session", hex: 0x3bb273 },
  6: { id: 6, label: "L6 Presentation", hex: 0x3d8bfd },
  7: { id: 7, label: "L7 Application", hex: 0x9b4dca },
};

function osiLayerForReading(r) {
  if (r.feederOut) return 1;
  if (r.lastBreathReason === "channel") return 2;
  if (r.lastBreath && !r.lastBreathArrived) return 3;
  if (r.lastBreathArrived) return 4;
  return 7;
}

function osiLayerForKind(kind) {
  if (kind === "outage" || kind === "repair" || kind === "restore" || kind === "knob" || kind === "leak") return 1;
  if (kind === "lastbreath") return 4;
  if (kind === "mesh") return 3;
  if (kind === "sync") return 5;
  if (kind === "sms" || kind === "pf_warn") return 6;
  if (kind === "cap_warn" || kind === "overload") return 7;
  return 7;
}

function eventBaseHex(kind) {
  if (kind === "pay" || kind === "credit") return COL.money;
  if (kind === "reconnect") return COL.meter;
  if (kind === "lastbreath") return COL.lastbreath;
  if (kind === "leak_clear") return COL.restore;
  if (COL[kind] != null) return COL[kind];
  return COL.ops;
}

function colorForReading(r) {
  if (state.scheme === "feeder") return feederColorForHouse(r.houseId);
  if (state.scheme === "messages") {
    if (r.lastBreathArrived) return new THREE.Color(COL.lastbreath);
    if (r.lastBreath) return new THREE.Color(COL.lastbreath_lost);
  }
  if (state.scheme === "load") {
    const spec = LOAD_TYPES[r.loadType] || LOAD_TYPES.idle;
    return new THREE.Color(spec.hex);
  }
  if (state.scheme === "capacity") {
    if (!r.on) return new THREE.Color(COL.off);
    return capacityColor(r.capacity);
  }
  if (state.scheme === "osi") return new THREE.Color(OSI[osiLayerForReading(r)].hex);
  if (state.scheme === "asset") return new THREE.Color(ASSET.home);
  return new THREE.Color(r.on ? COL.reading : COL.off);
}

function applySchemeColors() {
  _feederColMin = -1;
  const color = new THREE.Color();
  if (readingMesh && day.readings.length) {
    const n = Math.min(day.readings.length, readingMesh.count);
    for (let i = 0; i < n; i++) {
      color.copy(colorForReading(day.readings[i]));
      readingMesh.setColorAt(i, color);
    }
    if (readingMesh.instanceColor) readingMesh.instanceColor.needsUpdate = true;
  }

  const attr = worldlineMesh?.geometry?.getAttribute("color");
  if (attr) {
    const byHouse = Object.fromEntries(liveHouses.map((h) => [h.id, []]));
    for (const r of day.readings) {
      if (byHouse[r.houseId]) byHouse[r.houseId].push(r);
    }
    let k = 0;
    for (const h of liveHouses) {
      const rows = byHouse[h.id] || [];
      for (let i = 0; i < rows.length - 1; i++) {
        const c = colorForReading(rows[i]);
        if (k + 1 >= attr.count) break;
        attr.setXYZ(k, c.r, c.g, c.b);
        attr.setXYZ(k + 1, c.r, c.g, c.b);
        k += 2;
      }
    }
    attr.needsUpdate = true;
  }

  const dimEvents = state.scheme !== "messages" && state.scheme !== "osi";
  for (const m of eventMeshes) {
    if (m.material && "opacity" in m.material) {
      m.material.transparent = true;
      m.userData.baseOpacity = dimEvents ? 0.4 : 1;
    }
    if (m.isSprite || !m.material?.color || !m.userData.kind) continue;
    const hex = state.scheme === "osi" ? OSI[osiLayerForKind(m.userData.kind)].hex : eventBaseHex(m.userData.kind);
    m.material.color.setHex(hex);
  }
  if (knobMesh) {
    const kc = new THREE.Color(state.scheme === "osi" ? OSI[1].hex : COL.outage);
    for (let i = 0; i < knobMesh.count; i++) knobMesh.setColorAt(i, kc);
    knobMesh.instanceColor.needsUpdate = true;
  }
  document.querySelectorAll("[data-legend]").forEach((el) => {
    el.hidden = el.getAttribute("data-legend") !== state.scheme;
  });
  const lineLeg = document.getElementById("wl-line-legend");
  if (lineLeg) lineLeg.hidden = state.scheme === "asset" || state.scheme === "useclass";
  const lineGrad = document.getElementById("wl-linegrad");
  if (lineGrad) lineGrad.hidden = state.scheme === "asset" || state.scheme === "useclass";
  colorPowerLines();
  applyVisibility();
}

const DEMO_DAY = simulateDay();
let liveHouses = HOUSES;
let liveFeeders = FEEDERS;
let liveBoards = BOARDS;
let liveLeaks = LEAKS;
let liveOutages = OUTAGES;
let liveVendors = VENDORS;
let liveDtms = DTMS;
let day = DEMO_DAY;
let houseById = Object.fromEntries(liveHouses.map((h) => [h.id, h]));
let houseIndex = Object.fromEntries(liveHouses.map((h, i) => [h.id, i]));
let boardById = Object.fromEntries(liveBoards.map((b) => [b.id, b]));
let HOUSE_N = liveHouses.length;

/** Critical house flags for ops anomaly filter — not SMS / pay / everyday load. */
const ANOM_EVENT = new Set(["disconnect", "reconnect", "cap_warn", "pf_warn", "overload", "lastbreath"]);
const OPS_CRITICAL_KIND = new Set([
  "disconnect",
  "reconnect",
  "overload",
  "cap_warn",
  "pf_warn",
  "leak",
  "leak_clear",
  "outage",
  "lastbreath",
  "lastbreath_lost",
  "repair",
  "knob",
  "shed",
  "restore",
]);
const anomalyIds = new Set();

function rebuildAnomalyIds() {
  anomalyIds.clear();
  for (const e of day.events) {
    if (e.houseId && ANOM_EVENT.has(e.kind)) anomalyIds.add(e.houseId);
  }
  for (const r of day.readings) {
    if (r.lastBreathArrived || r.lastBreathReason === "channel") anomalyIds.add(r.houseId);
  }
}
rebuildAnomalyIds();

function rebuildLiveIndexes() {
  houseById = Object.fromEntries(liveHouses.map((h) => [h.id, h]));
  houseIndex = Object.fromEntries(liveHouses.map((h, i) => [h.id, i]));
  boardById = Object.fromEntries(liveBoards.map((b) => [b.id, b]));
  HOUSE_N = liveHouses.length;
  for (const k of Object.keys(HOUSE_IDS_BY_FEEDER)) delete HOUSE_IDS_BY_FEEDER[k];
  for (const h of liveHouses) (HOUSE_IDS_BY_FEEDER[h.feederId] ||= []).push(h.id);
  houseHealthById = null;
  _feederColMin = -1;
  _feederCols = null;
  rebuildAnomalyIds();
  if (state.you && !houseById[state.you]) state.you = liveHouses[0]?.id || "h0";
}

function refreshLivePanels() {
  fillLedger();
  fillStats();
  fillKpi();
  fillUseClassLegend();
  if (appMode === "productive") applyUseClassSceneDim();
  fillFeederSelect();
  fillHouses(true);
  fillLog();
}

function adoptLivePack(pack) {
  const next = pack || emptyLivePack();
  liveHouses = next.houses || [];
  liveFeeders = next.feeders || [];
  liveBoards = next.boards || [];
  liveLeaks = next.leaks || [];
  liveOutages = next.outages || [];
  liveVendors = next.vendors || [];
  liveDtms = next.dtms || [];
  if (liveHouses.length) {
    day = simulateDay(next);
  } else {
    setSimContext(null);
    day = {
      houses: [],
      events: [],
      readings: [],
      summary: {
        customers: 0,
        tariff: TARIFF_PER_KWH,
        heartbeatMin: SLOT_MIN,
        xfmrCapW: 0,
        peakFeederW: 0,
        pvNameplateW: 0,
        pvPeakW: 0,
        pvKWh: 0,
        tripMin: null,
        restoreMin: null,
        outages: [],
        faultAt: "",
        faultCluster: "",
        faultClusterW: 0,
        civicAtTrip: 0,
        lastBreathArrived: 0,
        lastBreathSilent: 0,
        lastBreathArrivedIds: [],
        payments: 0,
        paymentSum: 0,
        phaseXfers: 0,
        cutoffs: 0,
        overloads: 0,
        cap80: 0,
        cap100: 0,
        pfWarns: 0,
        reconnects: 0,
        sms: 0,
        leaks: 0,
        leakW: 0,
        kWh: 0,
        billed: 0,
        readings: 0,
      },
    };
  }
  rebuildLiveIndexes();
  if (buildMode) {
    for (const [hid, aid] of Object.entries(next.houseMap || {})) buildMode.bindHouse?.(hid, aid);
    for (const [bid, aid] of Object.entries(next.boardMap || {})) buildMode.bindBoard?.(bid, aid);
  }
  rebuildLiveTimeMeshes();
  refreshLivePanels();
}

function restoreDemoLive() {
  setSimContext(null);
  liveHouses = HOUSES;
  liveFeeders = FEEDERS;
  liveBoards = BOARDS;
  liveLeaks = LEAKS;
  liveOutages = OUTAGES;
  liveVendors = VENDORS;
  liveDtms = DTMS;
  day = DEMO_DAY;
  rebuildLiveIndexes();
  rebuildLiveTimeMeshes();
  refreshLivePanels();
}

function syncLiveFromBuild() {
  const placed = buildMode?.getPlaced?.() || [];
  const nCust = placed.filter((p) => p.assetClass === "customer").length;
  if (nCust) {
    adoptLivePack(buildSeededLive(placed));
    const hint = document.getElementById("wl-build-hint");
    if (hint) {
      hint.textContent =
        `Sample day on ${day.summary.customers} meters · ${liveOutages.length} outages · ${liveLeaks.length} leaks · ${day.summary.kWh} kWh`;
    }
    return;
  }
  if (emptyCanvas) adoptLivePack(overlayLiveFromPlaced(placed));
  else restoreDemoLive();
}

function usbXZ() {
  return getSimContext()?.usb || LANDMARKS.usb;
}

function opsXZ() {
  const usb = getSimContext()?.usb;
  if (emptyCanvas && usb) return { x: usb.x + 6, z: usb.z - 3 };
  return LANDMARKS.ops;
}

function cloudXZ() {
  const usb = getSimContext()?.usb;
  if (emptyCanvas && usb) return { x: usb.x, z: usb.z - 10 };
  return LANDMARKS.cloud;
}

function kioskXZ() {
  if (liveVendors[0]) return liveVendors[0];
  const usb = getSimContext()?.usb;
  if (emptyCanvas && usb) return { x: usb.x + 4, z: usb.z + 2 };
  return LANDMARKS.kiosk;
}

function livePlayheadXZ() {
  if (!emptyCanvas || !liveHouses.length) return { x: COMPASS.x, z: COMPASS.z };
  let sx = 0;
  let sz = 0;
  for (const h of liveHouses) {
    sx += h.x;
    sz += h.z;
  }
  return { x: sx / liveHouses.length, z: sz / liveHouses.length };
}

function placePlayheadRing() {
  const p = livePlayheadXZ();
  if (nowPlane) {
    nowPlane.position.x = p.x;
    nowPlane.position.z = p.z;
  }
  if (winBand) {
    winBand.position.x = p.x;
    winBand.position.z = p.z;
  }
  if (pastBand) {
    pastBand.position.x = p.x;
    pastBand.position.z = p.z;
  }
  if (futBand) {
    futBand.position.x = p.x;
    futBand.position.z = p.z;
  }
}

function disposeObject3D(obj) {
  if (!obj) return;
  obj.parent?.remove(obj);
  obj.geometry?.dispose?.();
  const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
  for (const m of mats) m?.dispose?.();
}

function clearTimeMeshes() {
  disposeObject3D(worldlineMesh);
  worldlineMesh = null;
  disposeObject3D(readingMesh);
  readingMesh = null;
  disposeObject3D(knobMesh);
  knobMesh = null;
  for (const m of eventMeshes) disposeObject3D(m);
  eventMeshes.length = 0;
  stackEvents.length = 0;
  for (const m of rfFloorMeshes) disposeObject3D(m);
  rfFloorMeshes.length = 0;
  const keep = [];
  for (const line of spineMeshes) {
    if (line?.userData?.spine === "axis") keep.push(line);
    else disposeObject3D(line);
  }
  spineMeshes.length = 0;
  for (const line of keep) spineMeshes.push(line);
}

function applyModeAnomalyFilter() {
  state.anomalyOnly = !!MODE_META[appMode]?.anomalyOnly;
  document.getElementById("wl-anomaly")?.classList.toggle("on", state.anomalyOnly);
  document.getElementById("wl-anomaly-maint")?.classList.toggle("on", state.anomalyOnly);
}

function rebuildLiveTimeMeshes() {
  if (!scene) return;
  applyModeAnomalyFilter();
  clearTimeMeshes();
  if (!liveHouses.length || (emptyCanvas && liveHouses === HOUSES)) {
    placePlayheadRing();
    applyVisibility();
    return;
  }
  buildWorldlines();
  buildReadings();
  buildDisconnectKnobs();
  buildEvents();
  buildMeshFloor();
  buildMeshPackets();
  buildLastBreaths();
  placePlayheadRing();
  applySchemeColors();
  applyVisibility();
}

function readingAt(houseId, min) {
  const slot = Math.min(SLOTS - 1, Math.max(0, Math.floor(min / SLOT_MIN)));
  return day.readings[slot * HOUSE_N + houseIndex[houseId]];
}

/** Day-long asset health (not playhead). Cached once — sim day is fixed. */
/** @type {Record<string, { stress: number, grade: string, avgCap: number, avgPf: number, avgThd: number, outFrac: number, nBreath: number, nBreathLost: number, disconnects: number }> | null} */
let houseHealthById = null;

function computeHouseDayHealth(houseId) {
  const hi = houseIndex[houseId];
  if (hi == null) {
    return { stress: 0, grade: "ok", avgCap: 0, avgPf: 1, avgThd: 0, outFrac: 0, nBreath: 0, nBreathLost: 0, disconnects: 0 };
  }
  let sumCap = 0;
  let sumPf = 0;
  let sumThd = 0;
  let nOn = 0;
  let nOut = 0;
  let nBreath = 0;
  let nBreathLost = 0;
  for (let s = 0; s < SLOTS; s++) {
    const r = day.readings[s * HOUSE_N + hi];
    if (!r) continue;
    if (r.feederOut || r.outageId) nOut += 1;
    if (r.lastBreathArrived) nBreath += 1;
    else if (r.lastBreath) nBreathLost += 1;
    if (r.on && !r.feederOut) {
      sumCap += r.capacity || 0;
      sumPf += r.pf ?? 1;
      sumThd += r.thd || 0;
      nOn += 1;
    }
  }
  let disconnects = 0;
  for (const e of day.events) {
    if (e.houseId !== houseId) continue;
    if (e.kind === "disconnect" || e.kind === "knob") disconnects += 1;
  }
  const avgCap = nOn ? sumCap / nOn : 0;
  const avgPf = nOn ? sumPf / nOn : 1;
  const avgThd = nOn ? sumThd / nOn : 0;
  const outFrac = nOut / Math.max(1, SLOTS);
  const pfStress = (1 - Math.max(0.55, Math.min(1, avgPf))) / 0.45;
  const thdStress = Math.min(1, avgThd / THD_HI);
  let stress = Math.max(avgCap, pfStress, thdStress, outFrac);
  if (nBreathLost) stress = Math.max(stress, 0.92);
  else if (nBreath) stress = Math.max(stress, 0.78);
  if (disconnects) stress = Math.max(stress, Math.min(1, 0.55 + disconnects * 0.12));
  let grade = "ok";
  if (stress >= 0.72) grade = "bad";
  else if (stress >= 0.4) grade = "warn";
  return { stress, grade, avgCap, avgPf, avgThd, outFrac, nBreath, nBreathLost, disconnects };
}

function ensureHouseHealth() {
  if (houseHealthById) return houseHealthById;
  houseHealthById = Object.create(null);
  for (const h of liveHouses) houseHealthById[h.id] = computeHouseDayHealth(h.id);
  return houseHealthById;
}

function boardDayHealth(boardId) {
  const b = boardById[boardId];
  if (!b) return { stress: 0, grade: "ok" };
  const map = ensureHouseHealth();
  let max = 0;
  for (const hid of b.houseIds || []) max = Math.max(max, map[hid]?.stress || 0);
  if (liveLeaks.some((lk) => lk.fromBoardId === boardId || lk.toBoardId === boardId)) {
    max = Math.max(max, 0.55);
  }
  let grade = "ok";
  if (max >= 0.72) grade = "bad";
  else if (max >= 0.4) grade = "warn";
  return { stress: max, grade };
}

function healthColor(stress) {
  return capacityColor(Math.max(0, Math.min(1, stress)));
}

const state = {
  nowMin: 0,
  playing: false,
  dir: 1,
  speed: 30,
  focus: null,
  scope: { kind: "village" },
  scheme: "messages",
  hide: { ...MODE_HIDE.operations },
  /** Scene / UN layer toggles (true = visible). Ops message layers stay on `hide`. */
  layers: {
    basemap: true,
    candidates: true,
    poles: true,
    lines: true,
    homes: true,
    ems: true,
    xfmr: true,
    station: true,
    breakers: true,
    lamps: true,
    build: true,
    un_structure: true,
    un_device: true,
    un_junction: true,
    un_line: true,
    un_subnetwork: true,
  },
  /** Selected layer id for highlight + edit (null = none). */
  activeLayer: /** @type {string | null} */ (null),
  /** Productive mode: solo use-class highlight (null = show all). */
  activeUseClass: /** @type {string | null} */ (null),
  /** Ops: highlight every home/line touched by any outage in the sim day. */
  dayOutages: false,
  anomalyOnly: true,
  houseQ: "",
  houseCluster: "all",
  viz: "v2",
  lineGrad: "capacity",
  sky: "dark",
  light: "fill",
  role: "ops",
  you: liveHouses[0]?.id || "h0",
  emsId: null,
  scopeBoard: null,
};

const eventMeshes = [];
const stackEvents = [];
const rfFloorMeshes = [];
const spineMeshes = [];
const timeAxisLabels = [];
let readingMesh;
let worldlineMesh;
let knobMesh;
let powerLineMesh;
let poleMesh;
/** Extra hardware batched in buildInfrastructureDetails, keyed by parent layer. */
const infraDetailByLayer = {
  poles: /** @type {import('three').Object3D[]} */ ([]),
  xfmr: /** @type {import('three').Object3D[]} */ ([]),
  ems: /** @type {import('three').Object3D[]} */ ([]),
  homes: /** @type {import('three').Object3D[]} */ ([]),
};
let homeBattMesh;
let lvSegMeta = [];
let feederBufById = {};
let feederPickMesh;
let polePick = [];
let breakerPick = [];
let camFly = null;
let camFeederId = null;
/** EMS / board zone under progressive cam (mag 2). */
let camBoardId = null;
/**
 * Progressive map zoom:
 * 0 village · 1 full feeder (side) · 2 EMS zone · 3 asset
 */
let camMag = 0;
/** @type {ReturnType<typeof createBuildMode> | null} */
let buildMode = null;
/** @type {ReturnType<typeof buildPackLayer> | null} */
let packLayer = null;
/** @type {{ sites?: any[] } | null} */
let siteCatalog = null;
/** @type {ReturnType<typeof blankProject> | null} */
let projectDoc = null;
/** @type {ReturnType<typeof createCandidateOverlay> | null} */
let candidateOverlay = null;
/** @type {'operations'|'build'|'maintenance'|'productive'|'energy'} */
let appMode = "operations";
let dtmBars = [];
let dtmParts = [];
let emsMesh;
let emsPvMesh;
let xfmrMesh;
let breakerMesh;
let stationMeshes = [];
let leakMeshes = [];
let timeGroup;
let nowPlane;
let winBand;
let pastBand;
let sprWin;
let sprPast;
let sprFut;
let nowMark;
let futBand;
let renderer;
let locusMap;
let scene;
let camera;
let controls;
let lastTs = 0;
const panKeys = new Set();
const panFwd = new THREE.Vector3();
const panRight = new THREE.Vector3();
const orbitOffset = new THREE.Vector3();
const orbitSpherical = new THREE.Spherical();
const panDelta = new THREE.Vector3();
const panAxis = new THREE.Vector3();
const PAN_SPEED = 42;
const PAN_X = [-95, 95];
const PAN_Z = [-80, 100];
let hutMesh;
let roofMesh;
let sunLight;
let ambientLight;
let fillLight;
let moonLight;
let civicLights = [];
let sunMesh;
let sunBead;
const compassSprites = [];
const compassMeshes = [];
let emptyCanvas = false;
/** Demo Voundou schematic — hidden on New project. */
let demoVillageRoot = null;
let pvMat;
let pvMesh;
/** @type {THREE.Sprite | null} */
let pvFarmSpr = null;
let hemiLight;
let sky;
let windowMesh;
let streetLampMesh;
let groundMesh;
let productiveUseApi = /** @type {ReturnType<typeof buildProductiveUse> | null} */ (null);
let energyAssetsApi = /** @type {ReturnType<typeof buildEnergyAssets> | null} */ (null);
const hutPose = [];
const poseDummy = new THREE.Object3D();
const SEL_FEEDER = new THREE.Color(0x5ee0ff);
const SEL_EMS = new THREE.Color(0x7af0ff);
const SEL_METER = new THREE.Color(0xe6c84a);
let houseHalo;
let emsHalo;
const lampWarm = new THREE.Color(0xffe29a);
const lampDark = new THREE.Color(0x1c1b18);
const pvSlots = [];
const pvDummy = new THREE.Object3D();
const skyNight = new THREE.Color(0x121214);
const skyDawn = new THREE.Color(0xc46838);
const skyDay = new THREE.Color(0x7eadd8);

const timeUniforms = {
  uNow: { value: 0 },
  uWindow: { value: WINDOW_MIN },
  uYPerHour: { value: Y_PER_HOUR },
  uScrunch: { value: SCRUNCH_H },
  uBound: { value: boundH },
  uPastTop: { value: PAST_TOP },
  uMode: { value: 1 },
  uDay: { value: DAY_MIN },
  uAnomalyOnly: { value: 1 },
  uFocusHid: { value: -1 },
};

const Y_WORLD_GLSL = `
float yWorld(float t) {
  if (uMode < 0.5) return (t - uNow) / uWindow * uBound;
  float age = uNow - t;
  if (age >= 0.0) {
    if (age <= uWindow) return (age / uWindow) * uBound;
    float past = max(uNow - uWindow, 1.0);
    return uBound + (age - uWindow) / past * (uPastTop - uBound);
  }
  float fut = max(uDay - uNow, 1.0);
  return age / fut * uScrunch;
}
`;

function stackSpine(x, z, color, dashed, role = "landmark") {
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, -SCRUNCH_H, z),
      new THREE.Vector3(x, PAST_TOP, z),
    ]),
    dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.35 })
      : new THREE.LineBasicMaterial({ color }),
  );
  if (dashed) line.computeLineDistances();
  line.userData.spine = role;
  scene.add(line);
  spineMeshes.push(line);
  return line;
}

function makeWorldlineMat() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: timeUniforms,
    vertexShader: `
      attribute float tMin;
      attribute float anom;
      attribute float hid;
      varying vec3 vColor;
      varying float vShow;
      varying float vDim;
      uniform float uNow;
      uniform float uWindow;
      uniform float uYPerHour;
      uniform float uScrunch;
      uniform float uBound;
      uniform float uPastTop;
      uniform float uMode;
      uniform float uDay;
      uniform float uAnomalyOnly;
      uniform float uFocusHid;
      ${Y_WORLD_GLSL}
      void main() {
        vColor = color;
        float focused = uFocusHid >= 0.0 && abs(hid - uFocusHid) < 0.5 ? 1.0 : 0.0;
        vShow = (uAnomalyOnly < 0.5 || anom > 0.5 || focused > 0.5) ? 1.0 : 0.0;
        vDim = uFocusHid < 0.0 || focused > 0.5 ? 1.0 : 0.22;
        vec3 p = vec3(position.x, yWorld(tMin), position.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vShow;
      varying float vDim;
      void main() {
        if (vShow < 0.5) discard;
        gl_FragColor = vec4(vColor, 0.85 * vDim);
      }
    `,
  });
}

function makeReadingMat() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: timeUniforms,
    vertexShader: `
      attribute float tMin;
      attribute float anom;
      attribute float hid;
      varying vec3 vColor;
      varying float vShow;
      varying float vDim;
      uniform float uNow;
      uniform float uWindow;
      uniform float uYPerHour;
      uniform float uScrunch;
      uniform float uBound;
      uniform float uPastTop;
      uniform float uMode;
      uniform float uDay;
      uniform float uAnomalyOnly;
      uniform float uFocusHid;
      ${Y_WORLD_GLSL}
      void main() {
        vColor = instanceColor;
        float focused = uFocusHid >= 0.0 && abs(hid - uFocusHid) < 0.5 ? 1.0 : 0.0;
        vShow = (uAnomalyOnly < 0.5 || anom > 0.5 || focused > 0.5) ? 1.0 : 0.0;
        vDim = uFocusHid < 0.0 || focused > 0.5 ? 1.0 : 0.22;
        vec3 origin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec3 scaled = (instanceMatrix * vec4(position, 0.0)).xyz;
        vec3 wp = vec3(origin.x, yWorld(tMin), origin.z) + scaled;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vShow;
      varying float vDim;
      void main() {
        if (vShow < 0.5) discard;
        gl_FragColor = vec4(vColor, 0.9 * vDim);
      }
    `,
  });
}

function makeKnobMat() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: timeUniforms,
    vertexShader: `
      attribute float tMin;
      attribute float hid;
      varying vec3 vColor;
      varying float vDim;
      uniform float uNow;
      uniform float uWindow;
      uniform float uYPerHour;
      uniform float uScrunch;
      uniform float uBound;
      uniform float uPastTop;
      uniform float uMode;
      uniform float uDay;
      uniform float uFocusHid;
      ${Y_WORLD_GLSL}
      void main() {
        vColor = instanceColor;
        float focused = uFocusHid >= 0.0 && abs(hid - uFocusHid) < 0.5 ? 1.0 : 0.0;
        vDim = uFocusHid < 0.0 || focused > 0.5 ? 1.0 : 0.16;
        vec3 origin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vec3 scaled = (instanceMatrix * vec4(position, 0.0)).xyz;
        vec3 wp = vec3(origin.x, yWorld(tMin), origin.z) + scaled;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vDim;
      void main() {
        gl_FragColor = vec4(vColor, 0.9 * vDim);
      }
    `,
  });
}

function addTime(obj) {
  obj.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      m.clippingPlanes = clipPlanes;
      m.clipShadows = true;
    }
    if (o.isSprite) o.scale.y *= -1;
  });
  if (obj.userData.min != null && obj.userData.lineHops == null && obj.userData.y1 == null && obj.userData.bakedY == null) {
    obj.userData.bakedY = Math.abs(obj.position.y) < 1e-4;
  }
  timeGroup.add(obj);
  return obj;
}

async function boot() {
  const stage = document.getElementById("wl-stage");
  if (!stage) return;

  locusMap = await createVillageMap(stage);
  candidateOverlay = createCandidateOverlay(locusMap.map);
  candidateOverlay.load();
  scene = locusMap.scene;
  scene.scale.set(GROUND_SCALE, HEIGHT_SCALE, GROUND_SCALE);
  document.getElementById("wl-sky").hidden = true;
  scene.background = null;
  scene.fog = null;

  camera = new THREE.PerspectiveCamera(42, 1, 0.4, 1200);
  {
    const home = camHome(true);
    camera.position.set(...home.pos);
  }

  renderer = locusMap.renderer;
  renderer.localClippingEnabled = true;
  // Legacy framing helpers retain a pose; Locus/MapLibre owns the visible camera.
  controls = { target: new THREE.Vector3(...camHome(true).look), enabled: true,
    enableDamping: false, update() {} };

  ambientLight = new THREE.AmbientLight(0xe8e4dc, 0.28);
  scene.add(ambientLight);
  hemiLight = new THREE.HemisphereLight(0x6a90b8, 0x3d6230, 0.2);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff2d4, 0.85);
  sunLight.position.set(20, 50, 10);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 8;
  sunLight.shadow.camera.far = 280;
  sunLight.shadow.camera.left = -110;
  sunLight.shadow.camera.right = 110;
  sunLight.shadow.camera.top = 110;
  sunLight.shadow.camera.bottom = -110;
  sunLight.shadow.bias = -0.0008;
  sunLight.shadow.normalBias = 0.04;
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.target.position.set(COMPASS.x, 0, COMPASS.z);
  scene.add(sunLight);
  scene.add(sunLight.target);
  fillLight = new THREE.DirectionalLight(0xf4f0e6, 0);
  fillLight.position.set(COMPASS.x - 36, 72, COMPASS.z + 28);
  fillLight.target.position.set(COMPASS.x, 0, COMPASS.z);
  scene.add(fillLight);
  scene.add(fillLight.target);
  moonLight = new THREE.DirectionalLight(0xa8c4e8, 0);
  moonLight.position.set(COMPASS.x - 42, 58, COMPASS.z - 24);
  moonLight.target.position.set(COMPASS.x, 0, COMPASS.z);
  scene.add(moonLight);
  scene.add(moonLight.target);
  civicLights = [
    LANDMARKS.market,
    LANDMARKS.clinic,
    LANDMARKS.kiosk,
    LANDMARKS.ops,
    LANDMARKS.gen,
  ].map((s) => {
    const l = new THREE.PointLight(0xffc878, 0, 24, 1.55);
    l.position.set(s.x, 3.15, s.z);
    scene.add(l);
    return l;
  });
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe7a8 }),
  );
  sunMesh.position.set(40, 50, 30);
  scene.add(sunMesh);
  buildSky();
  sky.visible = false;
  sunMesh.visible = false;

  timeGroup = new THREE.Group();
  timeGroup.scale.y = -1;
  timeGroup.frustumCulled = false;
  scene.add(timeGroup);

  demoVillageRoot = new THREE.Group();
  demoVillageRoot.name = "demo-village";
  scene.add(demoVillageRoot);
  buildVillage();
  productiveUseApi = buildProductiveUse(scene, TARIFF_PER_KWH, day.summary.kWh, timeSprite);
  energyAssetsApi = buildEnergyAssets(scene, timeSprite);
  const waterGroup = buildVillageWater(scene, timeSprite);
  if (waterGroup) scene.add(waterGroup);
  gatherDemoVillage();
  groundMesh.visible = false;
  locusMap.camera.fitBounds({minX:Math.min(...liveHouses.map(h=>h.x))-12, maxX:Math.max(...liveHouses.map(h=>h.x))+18, minZ:Math.min(...liveHouses.map(h=>h.z))-12, maxZ:Math.max(...liveHouses.map(h=>h.z))+18}, {padding:45, duration:0, maxZoom:20});
  buildWorldlines();
  buildReadings();
  buildDisconnectKnobs();
  buildEvents();
  buildMeshFloor();
  buildMeshPackets();
  buildLastBreaths();
  buildNowPlane();
  applySizeCopy();
  applyLineLegend();
  bindUi();
  buildMode = createBuildMode({
    scene,
    groundAt: groundAtClient,
    toolbarEl: document.getElementById("wl-build-bar"),
    hintEl: document.getElementById("wl-build-hint"),
    extraPoles: () => {
      if (emptyCanvas) return [];
      const pts = [];
      for (const p of POLES) pts.push({ x: p.x, z: p.z });
      for (const f of liveFeeders) pts.push({ x: f.x, z: f.z });
      for (const t of TRANSFORMERS) pts.push({ x: t.x, z: t.z });
      if (LANDMARKS?.xfmr) pts.push({ x: LANDMARKS.xfmr.x, z: LANDMARKS.xfmr.z });
      return pts;
    },
    onSeeded: () => {
      setTimeout(() => syncLiveFromBuild(), 0);
    },
    onChange: () => {
      if (appMode === "build") {
        state.layers.build = true;
        state.layers.un_line = true;
      }
      if (emptyCanvas) {
        const placed = buildMode?.getPlaced?.() || [];
        if (!placed.some((p) => p.assetClass === "customer")) adoptLivePack(overlayLiveFromPlaced(placed));
      }
      syncProjectChip();
      applyLayers();
      if (appMode === "build") fillBuildPanel();
      const panel = document.getElementById("wl-layers-panel");
      if (panel && layersPanelOpen() && state.activeLayer) {
        paintLayersPanel();
      }
    },
  });
  bindBuildConfigForm();
  bindProjectMenu();
  bindLayersMenu();
  bindAppModes();
  bootSiteSelect();
  // Prefetch Africa candidates so first zoom-out is snappy.
  candidateOverlay?.load();
  fillLedger();
  fillStats();
  fillKpi();
  bindKpiUi();
  fillHouses();
  fillGeoid();
  const startMin = applyQuery();
  applySchemeColors();
  setNow(startMin);
  applyVizMode();
  applyRole();
  resize();
  window.addEventListener("resize", resize);
  new ResizeObserver(resize).observe(stage);
  bindStagePick();
  requestAnimationFrame(tick);
}

function packPathForSite(site) {
  if (!site) return "/villages/voundou-grid";
  if (site.kind === "pack" && site.path) return site.path;
  return "/villages/voundou-grid";
}

async function loadSiteCatalog() {
  if (siteCatalog) return siteCatalog;
  const r = await fetch("/villages/catalog.json");
  if (!r.ok) throw new Error(`catalog.json HTTP ${r.status}`);
  siteCatalog = await r.json();
  return siteCatalog;
}

function fillSiteSelect(activeId) {
  const sel = document.getElementById("wl-site");
  if (!sel || !siteCatalog?.sites?.length) return;
  const want = activeId || sel.value || "voundou";
  sel.innerHTML = "";
  for (const s of siteCatalog.sites) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === want)) sel.value = want;
}

async function mountPackForSite(siteId) {
  const cat = siteCatalog || (await loadSiteCatalog().catch(() => null));
  const site = cat?.sites?.find((s) => s.id === siteId) || cat?.sites?.find((s) => s.id === "voundou");
  try {
    disposePackLayer(packLayer);
    packLayer = null;
    const pack = await fetchVillagePack(packPathForSite(site));
    packLayer = buildPackLayer(pack);
    scene.add(packLayer.root);
    const b = packLayer.bounds;
    const hx = liveHouses.map((h) => h.x);
    const hz = liveHouses.map((h) => h.z);
    locusMap.camera.fitBounds(
      {
        minX: Math.min(...hx, b.minX) - 16,
        maxX: Math.max(...hx, b.maxX) + 16,
        minZ: Math.min(...hz, b.minZ) - 16,
        maxZ: Math.max(...hz, b.maxZ) + 16,
      },
      { padding: 45, duration: 0, maxZoom: 18 },
    );
    applyLayers();
  } catch (err) {
    console.warn("village pack", siteId, err);
  }
}

async function bootSiteSelect() {
  const qSite = new URLSearchParams(location.search).get("site");
  try {
    await loadSiteCatalog();
  } catch (err) {
    console.warn("village catalog", err);
  }
  fillSiteSelect(qSite || "voundou");
  const sel = document.getElementById("wl-site");
  sel?.addEventListener("change", () => {
    const id = sel.value || "voundou";
    if (emptyCanvas) leaveEmptyCanvas();
    writeQuery({ site: id === "voundou" ? "" : id });
    mountPackForSite(id);
  });
  await mountPackForSite(sel?.value || "voundou");
}

function resize() {
  const stage = document.getElementById("wl-stage");
  const w = stage.clientWidth || 640;
  const h = stage.clientHeight || 480;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  locusMap.map.resize();
}

function timeSprite(text, color = "#9a9990", width = 256) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.font = "36px sans-serif";
  ctx.fillText(text, 12, 44);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  s.scale.set((width / 256) * 5.5, 1.4, 1);
  return s;
}

function applySizeCopy() {
  document.title = "Village Simulator · ISV";
  const back = document.querySelector(".back a");
  if (back) back.href = "https://isv.wiki/#village-metering/village-simulator";
}

function applyWindow() {
  syncTimeLayout();
  restackTimeStack();
  restackLastBreath();
  restackTimeLabels();
}

function syncTimeLayout() {
  const v2 = isV2();
  timeUniforms.uBound.value = boundH;
  clipPlanes[1].constant = v2 ? PAST_TOP + 1.25 : v1Top() + 4;
  if (winBand) winBand.position.y = boundH;
  if (sprWin) sprWin.position.y = boundH + 0.4;
  if (nowPlane) nowPlane.position.y = Y_NOW;
  placePlayheadRing();
  if (nowMark) nowMark.position.y = v2 ? 1.35 : 1.2;
  const y0 = v2 ? -SCRUNCH_H : yWorldAt(0, state.nowMin);
  const y1 = v2 ? PAST_TOP : yWorldAt(DAY_MIN, state.nowMin);
  for (const line of spineMeshes) {
    const pos = line.geometry.getAttribute("position");
    pos.setY(0, y0);
    pos.setY(1, y1);
    pos.needsUpdate = true;
    if (line.material?.isLineDashedMaterial) line.computeLineDistances();
  }
}

function applyVizMode() {
  const v2 = isV2();
  timeUniforms.uMode.value = v2 ? 1 : 0;
  if (timeGroup) {
    timeGroup.scale.y = v2 ? -1 : 1;
    timeGroup.position.y = v2 ? yAt(state.nowMin) : 0;
  }
  clipPlanes[0].constant = v2 ? SCRUNCH_H + 0.08 : v1Top() + 2;
  if (nowPlane) nowPlane.material.opacity = v2 ? 0.07 : 0.16;
  if (winBand) winBand.visible = v2;
  if (pastBand) pastBand.visible = v2;
  if (futBand) futBand.visible = v2;
  if (sprWin) sprWin.visible = v2;
  if (sprPast) sprPast.visible = v2;
  if (sprFut) sprFut.visible = v2;
  const winUi = document.getElementById("wl-win");
  if (winUi) {
    winUi.hidden = false;
    winUi.title = v2 ? "Height of stretch / scrunch boundary" : "Height of the v1 drop stack";
  }
  const hi = document.getElementById("wl-win-hi");
  const val = document.getElementById("wl-win-val");
  if (hi) hi.textContent = v2 ? "past" : "24:00";
  if (val) val.textContent = v2 ? "−2h" : "00:00";
  syncTimeLayout();
  if (scene?.fog) {
    scene.fog.near = v2 ? 220 : 380;
    scene.fog.far = v2 ? 780 : 1400;
  }
  if (camera && controls && state.scope?.kind !== "feeder") {
    const home = camHome(v2);
    camera.position.set(...home.pos);
    controls.target.set(...home.look);
  }
  restackTimeStack();
  restackLastBreath();
  restackTimeLabels();
}

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function addMesh(geo, color, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function pitchedRoof(x, y, z, sx, sz, color) {
  return addMesh(new THREE.ConeGeometry(0.72, 0.46, 4), color, x, y, z, sx, 1, sz, Math.PI / 4);
}

function buildGenPad(x, z) {
  box(1.25, 0.16, 1.05, 0x3a3a40, x, 0.14, z);
  box(0.95, 0.52, 0.68, 0x7a7a82, x - 0.12, 0.46, z);
  addMesh(new THREE.CylinderGeometry(0.2, 0.22, 0.62, 12), 0x4a4a52, x + 0.48, 0.46, z);
  box(0.07, 0.42, 0.07, 0x2a2a30, x - 0.22, 0.92, z);
  addMesh(new THREE.CylinderGeometry(0.05, 0.08, 0.18, 8), 0x2a2a30, x - 0.22, 1.18, z);
}

function buildMainXfmr(x, z) {
  stationMeshes = [];
  const keep = (m, hex) => {
    m.userData.baseHex = hex;
    stationMeshes.push(m);
    return m;
  };
  const parts = [
    keep(box(0.7, 0.12, 0.7, 0x3a3a38, x, 0.13, z), 0x3a3a38),
    keep(addMesh(new THREE.CylinderGeometry(0.36, 0.4, 1.12, 14), 0x5c5c4a, x, 0.68, z), 0x5c5c4a),
  ];
  for (const dx of [-0.16, 0, 0.16]) {
    parts.push(keep(addMesh(new THREE.CylinderGeometry(0.032, 0.032, 0.26, 8), 0xc9a227, x + dx, 1.36, z), 0xc9a227));
  }
  const st = STATIONS[0];
  for (const m of parts) {
    if (m && st) m.userData.scope = { kind: "station", id: st.id };
  }
}

function buildMarketShed(x, z) {
  const w = 2.55;
  const d = 1.9;
  const h = 1.12;
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    box(0.1, h, 0.1, 0x4a3a28, x + (sx * w) / 2, h / 2, z + (sz * d) / 2);
  }
  box(w + 0.25, 0.08, d + 0.28, 0xc9a227, x, h + 0.1, z);
  box(w * 0.55, 0.48, 0.72, 0x5a4030, x - 0.4, 0.28, z);
  box(w * 0.45, 0.48, 0.72, 0x4a3228, x + 0.55, 0.28, z);
}

function buildClinic(x, z) {
  box(2.35, 1.05, 1.7, 0xe4dfd2, x, 0.55, z);
  box(2.42, 0.1, 1.76, 0x3b6d11, x, 1.12, z);
  pitchedRoof(x, 1.42, z, 2.05, 1.55, 0x6a3a32);
  box(0.16, 0.52, 0.05, 0xb42318, x, 0.72, z + 0.88);
  box(0.52, 0.16, 0.05, 0xb42318, x, 0.72, z + 0.91);
  box(0.42, 0.72, 0.08, 0x2a2a28, x + 0.7, 0.4, z + 0.88);
}

function buildStall(x, z, s = 1) {
  box(0.98 * s, 0.4 * s, 0.64 * s, 0x5c4030, x, 0.23 * s, z);
  box(1.12 * s, 0.06 * s, 0.82 * s, 0xc9a227, x, 0.66 * s, z);
  box(0.07, 0.66 * s, 0.07, 0x3a2a1c, x - 0.46 * s, 0.36 * s, z - 0.3 * s);
  box(0.07, 0.66 * s, 0.07, 0x3a2a1c, x + 0.46 * s, 0.36 * s, z - 0.3 * s);
  box(1.08 * s, 0.04 * s, 0.78 * s, 0xb42318, x, 0.7 * s, z);
}

function buildOpsHut(x, z) {
  box(3.1, 1.42, 2.05, 0x3b6d11, x, 0.74, z);
  box(0.52, 0.88, 0.1, 0x2a2a28, x + 0.9, 0.48, z + 1.06);
  box(0.32, 0.32, 0.08, 0xc9a227, x - 0.75, 0.98, z + 1.06);
  pitchedRoof(x, 1.7, z, 2.55, 1.85, 0x4a4038);
  box(0.07, 1.35, 0.07, 0x8a8a82, x + 1.25, 2.12, z);
  addMesh(new THREE.SphereGeometry(0.11, 8, 8), 0x175cd3, x + 1.25, 2.85, z);
}

function buildUsbGw(x, z) {
  box(0.95, 0.52, 0.55, 0x1a2740, x, 0.3, z);
  box(0.72, 0.1, 0.38, 0x175cd3, x, 0.6, z);
  box(0.05, 0.82, 0.05, 0x8a8a82, x + 0.3, 0.82, z);
  addMesh(new THREE.SphereGeometry(0.07, 8, 8), 0x40b8ff, x + 0.3, 1.26, z);
}

function buildCloudMark(x, z) {
  addMesh(new THREE.SphereGeometry(0.72, 12, 10), 0x9aa0a6, x - 1.05, 6.15, z);
  addMesh(new THREE.SphereGeometry(0.95, 12, 10), 0xb0b4b8, x, 6.4, z);
  addMesh(new THREE.SphereGeometry(0.68, 12, 10), 0x8a8a82, x + 1.05, 6.12, z);
}

function buildBessCan(b) {
  box(b.w, b.h, b.d, 0x2c4a3c, b.x, b.h / 2 + 0.06, b.z);
  box(b.w * 0.94, 0.05, b.d * 0.94, 0x1e3328, b.x, b.h + 0.04, b.z);
  box(0.08, b.h * 0.55, 0.06, 0xc9a227, b.x + b.w * 0.38, b.h * 0.55, b.z + b.d * 0.52);
  box(0.08, b.h * 0.55, 0.06, 0xc9a227, b.x - b.w * 0.38, b.h * 0.55, b.z + b.d * 0.52);
}

/** Face south (+Z). Noon sun sits at +Z; -Z is north. +X tilt aims the panel face that way. */
const SUN_TILT = 0.52;
const skyDir = new THREE.Vector3();

function buildSky() {
  sky = new Sky();
  sky.scale.setScalar(900);
  sky.material.fog = false;
  scene.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 1.2;
  u.rayleigh.value = 0.12;
  u.mieCoefficient.value = 0.001;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.set(0.15, -0.55, 0.35);
}

function orientPv() {
  if (!pvMesh || !pvSlots.length) return;
  for (let i = 0; i < pvSlots.length; i++) {
    const s = pvSlots[i];
    pvDummy.position.set(s.x, s.y, s.z);
    pvDummy.scale.set(s.sx, 1, s.sz);
    pvDummy.quaternion.identity();
    pvDummy.rotation.set(SUN_TILT, 0, 0);
    pvDummy.updateMatrix();
    pvMesh.setMatrixAt(i, pvDummy.matrix);
  }
  pvMesh.instanceMatrix.needsUpdate = true;
}

function placeSun(min) {
  if (!sunLight || !sunMesh) return;
  const hr = min / 60;
  const t = (hr - 6) / 12;
  const elev = sunElev(min);
  const up = elev > 0;
  const u = Math.max(0, Math.min(1, t));
  const { x: cx, z: cz, r } = COMPASS;
  const R = Math.max(48, COMPASS.r + 6);
  const x = cx + Math.cos(Math.PI * u) * R;
  const z = cz + Math.sin(Math.PI * u) * R * (NORTH.z < 0 ? 1 : -1);
  const y = up ? 8 + elev * 58 : -14;
  const mode = state.light === "lamps" || state.light === "sun" ? state.light : "fill";
  sunMesh.position.set(x, y, z);
  sunMesh.visible = !locusMap && y > 3;
  sunMesh.material.color.setHex(elev > 0.25 ? 0xffe7a8 : 0xffc078);
  if (mode === "fill") {
    sunLight.position.set(cx + 28, 62, cz + 18);
    sunLight.castShadow = true;
    sunLight.intensity = 1.45;
    sunLight.color.setHex(0xfff6e8);
    ambientLight.color.setHex(0xf0ece4);
    ambientLight.intensity = 0.62;
    if (hemiLight) {
      hemiLight.intensity = 0.78;
      hemiLight.color.setHex(0xc5def0);
      hemiLight.groundColor.setHex(0x5a7a40);
    }
    if (fillLight) fillLight.intensity = 0.62;
    if (moonLight) moonLight.intensity = 0;
    for (const l of civicLights) l.intensity = 0;
  } else if (mode === "lamps") {
    sunLight.position.set(x, Math.max(y, 6), z);
    sunLight.castShadow = false;
    sunLight.intensity = up ? 0.1 + elev * 0.28 : 0.03;
    sunLight.color.setHex(0xffb070);
    ambientLight.color.setHex(0x6a7a90);
    ambientLight.intensity = 0.2;
    if (hemiLight) {
      hemiLight.intensity = 0.34;
      hemiLight.color.setHex(0x3a4a68);
      hemiLight.groundColor.setHex(0x1c1810);
    }
    if (fillLight) fillLight.intensity = 0;
    if (moonLight) moonLight.intensity = up ? 0.1 : 0.48;
    for (const l of civicLights) l.intensity = 1.15;
  } else {
    sunLight.position.set(x, Math.max(y, 4), z);
    sunLight.castShadow = up;
    sunLight.intensity = 0.28 + elev * 1.85;
    sunLight.color.setHex(elev > 0.18 ? 0xfff2d4 : 0xffb070);
    ambientLight.color.setHex(0xe8e4dc);
    ambientLight.intensity = 0.08 + elev * 0.14;
    if (hemiLight) {
      hemiLight.intensity = 0.06 + elev * 0.32;
      hemiLight.color.setHex(elev > 0.25 ? 0x8eb8dc : 0xc48a58);
      hemiLight.groundColor.setHex(elev > 0.12 ? 0x3d6230 : 0x1a2414);
    }
    if (fillLight) fillLight.intensity = 0;
    if (moonLight) moonLight.intensity = 0;
    for (const l of civicLights) l.intensity = 0;
  }
  if (groundMesh?.material) {
    if (mode === "fill") {
      groundMesh.material.emissive.setHex(0x244a16);
      groundMesh.material.emissiveIntensity = 0.32;
    } else if (mode === "lamps") {
      groundMesh.material.emissive.setHex(0x10180e);
      groundMesh.material.emissiveIntensity = 0.28;
    } else {
      groundMesh.material.emissive.setHex(0x000000);
      groundMesh.material.emissiveIntensity = 0;
    }
  }
  setGlowScale(mode);
  if (windowMesh) windowMesh.visible = mode === "lamps";
  if (streetLampMesh) streetLampMesh.visible = mode === "lamps";
  const bright = state.sky === "bright";
  if (sky) {
    if (bright) {
      skyDir.set(x - cx, y, z - cz).normalize();
      if (!up) skyDir.set(0.15, -0.55, 0.35).normalize();
      sky.material.uniforms.turbidity.value = up ? 2.2 + (1 - elev) * 6 : 1.2;
      sky.material.uniforms.rayleigh.value = up ? 1.2 + elev * 2.6 : 0.12;
      sky.material.uniforms.mieCoefficient.value = up ? 0.004 + (1 - elev) * 0.012 : 0.001;
    } else {
      skyDir.set(0.15, -0.55, 0.35).normalize();
      sky.material.uniforms.turbidity.value = 1.2;
      sky.material.uniforms.rayleigh.value = 0.12;
      sky.material.uniforms.mieCoefficient.value = 0.001;
    }
    sky.material.uniforms.sunPosition.value.copy(skyDir);
  }
  if (scene.fog) {
    if (bright && up) scene.fog.color.copy(skyDawn).lerp(skyDay, elev);
    else scene.fog.color.copy(skyNight);
  }
  if (sunBead) {
    const dx = x - cx;
    const dz = z - cz;
    const len = Math.hypot(dx, dz) || 1;
    sunBead.position.set(cx + (dx / len) * r, 3.2, cz + (dz / len) * r);
    sunBead.visible = up;
    sunBead.material.color.setHex(elev > 0.25 ? 0xffe7a8 : 0xffc078);
  }
  if (pvMat) {
    const on = elev > 0.02;
    pvMat.color.setHex(on ? PV_ON : PV_COL);
    pvMat.emissive.setHex(on ? 0x1a7cff : 0x000000);
    pvMat.emissiveIntensity = on ? 0.95 : 0;
  }
  const emsPvMat = emsPvMesh?.material;
  if (emsPvMat) {
    const on = elev > 0.02;
    emsPvMat.color.setHex(on ? PV_ON : PV_COL);
    emsPvMat.emissive.setHex(on ? 0x1a7cff : 0x000000);
    emsPvMat.emissiveIntensity = on ? 0.95 : 0;
  }
}

function buildPvAndStorage() {
  const panelGeo = new THREE.BoxGeometry(1, 0.045, 0.72);
  pvMat = new THREE.MeshLambertMaterial({ color: PV_COL, emissive: 0x000000, emissiveIntensity: 0 });
  const roofSet = new Set(PV_ROOF_IDS);
  const roofN = PV_ROOF_IDS.length;
  const farmN = PV_FARM.modules || PV_FARM.rows * PV_FARM.cols;
  pvMesh = new THREE.InstancedMesh(panelGeo, pvMat, roofN + farmN + 6);
  pvMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  pvSlots.length = 0;
  const plant = (x, y, z, sx, sz) => {
    pvSlots.push({ x, y, z, sx, sz });
  };

  liveHouses.forEach((h, i) => {
    if (!roofSet.has(h.id)) return;
    const s = houseSize(i);
    const bh = 0.55 + s * 0.24;
    plant(h.x, bh + 0.5, h.z, 0.92 * s, 0.82 * s);
  });

  const pitchX = PV_FARM.pitchX || 1.55;
  const pitchZ = PV_FARM.pitchZ || 1.15;
  let planted = 0;
  for (let r = 0; r < PV_FARM.rows; r++) {
    for (let c = 0; c < PV_FARM.cols; c++) {
      if (planted >= farmN) break;
      plant(PV_FARM.x + c * pitchX, 0.55, PV_FARM.z + r * pitchZ, 1.35, 0.95);
      planted += 1;
    }
  }
  plant(LANDMARKS.clinic.x - 0.35, 1.72, LANDMARKS.clinic.z + 0.15, 1.8, 1.15);
  plant(LANDMARKS.clinic.x + 0.55, 1.72, LANDMARKS.clinic.z + 0.15, 1.8, 1.15);
  plant(LANDMARKS.market.x, 1.42, LANDMARKS.market.z, 1.9, 1.1);
  plant(LANDMARKS.ops.x - 0.4, 2.02, LANDMARKS.ops.z, 1.6, 1.0);
  pvMesh.count = pvSlots.length;
  pvMesh.castShadow = true;
  pvMesh.receiveShadow = true;
  scene.add(pvMesh);
  orientPv();

  const farmSpr = timeSprite(PV_FARM.label, "#8aa0b8", 280);
  farmSpr.scale.set(7.2, 1.35, 1);
  farmSpr.position.set(PV_FARM.x + (PV_FARM.cols * (PV_FARM.pitchX || 1.55)) / 2, 1.6, PV_FARM.z - 1.4);
  scene.add(farmSpr);
  pvFarmSpr = farmSpr;

  const battMat = new THREE.MeshLambertMaterial({ color: 0x2c4a3c });
  for (const b of BESS) {
    buildBessCan(b);
    const spr = timeSprite(b.label, "#7a9a88", 260);
    spr.scale.set(5.6, 1.25, 1);
    spr.position.set(b.x, b.h + 0.85, b.z);
    scene.add(spr);
  }
  const homeSet = new Set(BESS_HOME_IDS);
  const homeN = BESS_HOME_IDS.length;
  const homeBatt = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.48, 0.22), battMat, homeN);
  homeBattMesh = homeBatt;
  let bi = 0;
  liveHouses.forEach((h, i) => {
    if (!homeSet.has(h.id)) return;
    pvDummy.position.set(h.x + 0.7, 0.28, h.z + 0.45);
    pvDummy.quaternion.identity();
    pvDummy.scale.set(1, 1, 1);
    pvDummy.updateMatrix();
    homeBatt.setMatrixAt(bi++, pvDummy.matrix);
  });
  homeBatt.count = bi;
  homeBatt.castShadow = true;
  homeBatt.receiveShadow = true;
  scene.add(homeBatt);
}

function polarGridGeometry() {
  const { x: cx, z: cz, r } = COMPASS;
  const pts = [];
  const rings = 6;
  const segs = 72;
  const spokes = 12;
  for (let k = 1; k <= rings; k++) {
    const rr = (r * k) / rings;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      pts.push(
        cx + Math.cos(a0) * rr,
        0,
        cz + Math.sin(a0) * rr,
        cx + Math.cos(a1) * rr,
        0,
        cz + Math.sin(a1) * rr,
      );
    }
  }
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * Math.PI * 2;
    pts.push(cx, 0, cz, cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

function bakeGroundTexture() {
  const { x: cx, z: cz, r } = COMPASS;
  const W = 1024;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = W;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#3d8a2e";
  ctx.beginPath();
  ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  ctx.fill();
  const yard = (9.4 / (2 * r)) * W;
  for (const h of liveHouses) {
    const px = (0.5 + (h.x - cx) / (2 * r)) * W;
    const py = (0.5 + (h.z - cz) / (2 * r)) * W;
    const g = ctx.createRadialGradient(px, py, yard * 0.12, px, py, yard);
    g.addColorStop(0, "rgba(122, 78, 38, 0.98)");
    g.addColorStop(0.42, "rgba(98, 64, 32, 0.82)");
    g.addColorStop(1, "rgba(61, 138, 46, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, yard, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function addPolarGrid(y, opacity, intoTime, min) {
  const g = new THREE.LineSegments(
    polarGridGeometry(),
    new THREE.LineBasicMaterial({
      color: 0x2c2c32,
      transparent: true,
      opacity,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  g.position.y = y;
  if (intoTime) {
    g.userData.min = min;
    addTime(g);
  } else scene.add(g);
}

function buildVillage() {
  const { x: cx, z: cz, r } = COMPASS;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(r, 72),
    new THREE.MeshLambertMaterial({
      map: bakeGroundTexture(),
      color: 0xffffff,
      emissive: 0x000000,
      emissiveIntensity: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  scene.add(ground);
  groundMesh = ground;

  const west = CLUSTERS.find((c) => c.id === "west");
  const marketC = CLUSTERS.find((c) => c.id === "market");
  const clinicC = CLUSTERS.find((c) => c.id === "clinic");
  const south = CLUSTERS.find((c) => c.id === "south");
  const east = CLUSTERS.find((c) => c.id === "east");
  const tracks = [
    [
      [LANDMARKS.gen.x, LANDMARKS.gen.z],
      [LANDMARKS.xfmr.x, LANDMARKS.xfmr.z],
      [marketC.x, marketC.z],
      [clinicC.x, clinicC.z],
      [east.x, east.z],
      [LANDMARKS.ops.x, LANDMARKS.ops.z],
    ],
    [[LANDMARKS.xfmr.x, LANDMARKS.xfmr.z], [west.x, west.z]],
    [[marketC.x, marketC.z], [south.x, south.z]],
  ];
  tracks.forEach((path, ti) => {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i];
      const [bx, bz] = path[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      const y = Y_ROAD + ti * 0.02 + i * 0.008;
      const strip = box(0.95, 0.07, len, 0x2c2c32, (ax + bx) / 2, y, (az + bz) / 2);
      strip.rotation.y = Math.atan2(dx, dz);
    }
  });

  for (const c of CLUSTERS) {
    const spr = timeSprite(c.label);
    spr.scale.set(6.2, 1.55, 1);
    spr.position.set(c.x, 0.35, c.z - c.r * 0.35);
    scene.add(spr);
  }

  buildPowerLines();
  buildDtms();
  buildEmsBoards();
  buildLeaks();
  buildSelectHalos();

  buildGenPad(LANDMARKS.gen.x, LANDMARKS.gen.z);
  buildMainXfmr(LANDMARKS.xfmr.x, LANDMARKS.xfmr.z);
  buildMarketShed(LANDMARKS.market.x, LANDMARKS.market.z);
  buildClinic(LANDMARKS.clinic.x, LANDMARKS.clinic.z);
  buildStall(LANDMARKS.kiosk.x, LANDMARKS.kiosk.z, 1.05);
  for (const v of liveVendors) {
    if (v.kind === "kiosk") continue;
    buildStall(v.x, v.z, 0.85);
    const spr = timeSprite(v.label, "#c9a227", 300);
    spr.scale.set(6.4, 1.35, 1);
    spr.position.set(v.x, 1.35, v.z);
    scene.add(spr);
  }
  const kioskSpr = timeSprite("market kiosk", "#c9a227", 280);
  kioskSpr.scale.set(6.2, 1.3, 1);
  kioskSpr.position.set(LANDMARKS.kiosk.x, 1.35, LANDMARKS.kiosk.z);
  scene.add(kioskSpr);
  buildOpsHut(LANDMARKS.ops.x, LANDMARKS.ops.z);
  buildUsbGw(LANDMARKS.usb.x, LANDMARKS.usb.z);
  buildCloudMark(LANDMARKS.cloud.x, LANDMARKS.cloud.z);

  const hutGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofGeo = new THREE.ConeGeometry(0.58, 0.42, 4);
  hutMesh = new THREE.InstancedMesh(hutGeo, glowLambert(0.48), HOUSE_N);
  roofMesh = new THREE.InstancedMesh(roofGeo, glowLambert(0.38), HOUSE_N);
  hutPose.length = 0;
  const dummy = new THREE.Object3D();
  const hutCol = new THREE.Color();
  liveHouses.forEach((h, i) => {
    const s = houseSize(i);
    const yaw = ((i * 17) % 11) * 0.28 - 1.1;
    const bh = 0.55 + s * 0.24;
    dummy.position.set(h.x, bh / 2 + 0.02, h.z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1.02 * s, bh, 0.9 * s);
    dummy.updateMatrix();
    hutMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(h.x, bh + 0.24, h.z);
    dummy.rotation.set(0, yaw + Math.PI / 4, 0);
    dummy.scale.set(s, 1, s);
    dummy.updateMatrix();
    roofMesh.setMatrixAt(i, dummy.matrix);
    hutCol.copy(CAP_LO);
    hutMesh.setColorAt(i, hutCol);
    roofMesh.setColorAt(i, hutCol);
    hutPose.push({ x: h.x, z: h.z, yaw, bh, s });
  });
  hutMesh.castShadow = true;
  hutMesh.receiveShadow = true;
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  hutMesh.userData.pickHuts = true;
  roofMesh.userData.pickHuts = true;
  scene.add(hutMesh);
  scene.add(roofMesh);
  buildHouseLamps();

  buildPvAndStorage();

  stackSpine(COMPASS.x - COMPASS.r - 1.2, COMPASS.z, 0xc5d0dc, false, "axis");
  sprFut = timeSprite("future", "#c8d0d8", 280);
  sprFut.scale.set(7, 1.8, 1);
  sprFut.position.set(COMPASS.x - COMPASS.r - 6, -SCRUNCH_H + 0.4, COMPASS.z);
  scene.add(sprFut);
  sprWin = timeSprite("−2h", "#e8eef4", 200);
  sprWin.scale.set(6.5, 1.7, 1);
  sprWin.position.set(COMPASS.x - COMPASS.r - 6, boundH + 0.4, COMPASS.z);
  scene.add(sprWin);
  sprPast = timeSprite("past", "#c8d0d8", 220);
  sprPast.scale.set(6.5, 1.7, 1);
  sprPast.position.set(COMPASS.x - COMPASS.r - 6, PAST_TOP + 0.4, COMPASS.z);
  scene.add(sprPast);
  nowMark = timeSprite("now", "#f4f1ea", 180);
  nowMark.scale.set(8.5, 2.1, 1);
  nowMark.position.set(COMPASS.x - COMPASS.r - 10.5, 1.35, COMPASS.z);
  scene.add(nowMark);
  timeAxisLabels.length = 0;
  for (let min = 0; min <= DAY_MIN; min += 15) {
    const y = yAt(min);
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    if (mm === 0 && hh % 2 === 0 && min > 0) addPolarGrid(y, 0.22, true, min);
    const hour = mm === 0;
    const half = mm === 30;
    const label = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    const spr = timeSprite(label, hour ? "#eef2f6" : half ? "#b8c0c8" : "#8a929a", hour ? 220 : 170);
    const base = hour ? 8.4 : half ? 5.8 : 4.4;
    spr.position.set(COMPASS.x - COMPASS.r - 3.2, y - 0.35, COMPASS.z);
    spr.userData.min = min;
    spr.userData.yOff = -0.35;
    addTime(spr);
    timeAxisLabels.push({ spr, min, baseX: base, minor: !hour && !half });
  }

  stackSpine(LANDMARKS.cloud.x, LANDMARKS.cloud.z, COL.ops, true);

  buildOutageColumn();
}

function segsForOutage(o) {
  return GRID_SEGS.filter((s) => {
    if (o.xfmrId) return s.xfmrId === o.xfmrId;
    if (o.feederId) return s.feederId === o.feederId;
    return false;
  });
}

function addOutageGridSlice(o, min, color, kind, backbone) {
  let segs = segsForOutage(o);
  if (backbone) segs = segs.filter((s) => s.kind === "primary" || s.kind === "trunk");
  if (!segs.length) return;
  const pos = [];
  for (const s of segs) pos.push(s.ax, 0, s.az, s.bx, 0, s.bz);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const line = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: backbone ? 1 : 0.7 }),
  );
  line.userData = { kind, min, houseId: null, bakedY: false };
  addTime(line);
  eventMeshes.push(line);
}

function buildOutageColumn() {
  for (const o of day.summary.outages || []) {
    const y0 = yAt(o.min);
    const y1 = yAt(o.restore);
    const h = Math.max(0.4, y1 - y0);
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, h, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: COL.outage,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    cyl.position.set(o.x, y0 + h / 2, o.z);
    cyl.userData = { kind: "outage", min: o.min, y1: o.restore, baseH: h, houseId: null };
    addTime(cyl);
    eventMeshes.push(cyl);

    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, h, 8),
      new THREE.MeshBasicMaterial({ color: COL.fault }),
    );
    core.position.set(o.x, y0 + h / 2, o.z);
    core.userData = { kind: "outage", min: o.min, y1: o.restore, baseH: h, houseId: null };
    addTime(core);
    eventMeshes.push(core);

    const faultSpr = timeSprite(`FAULT · ${o.label}`, "#ff6a78", 420);
    faultSpr.position.set(o.x + 2.4, y0 - 0.9, o.z);
    faultSpr.userData = { kind: "outage", min: o.min, yOff: -0.9, houseId: null };
    addTime(faultSpr);
    eventMeshes.push(faultSpr);

    addOutageGridSlice(o, o.min, COL.outage, "outage", false);
    addOutageGridSlice(o, o.min, COL.fault, "outage", true);
    addOutageGridSlice(o, o.restore, COL.restore, "restore", false);
  }
}

function buildWorldlines() {
  const pos = [];
  const col = [];
  const tMin = [];
  const anom = [];
  const hid = [];
  const byHouse = Object.fromEntries(liveHouses.map((h) => [h.id, []]));
  for (const r of day.readings) {
    if (byHouse[r.houseId]) byHouse[r.houseId].push(r);
  }

  liveHouses.forEach((h, hi) => {
    const rows = byHouse[h.id] || [];
    const an = anomalyIds.has(h.id) ? 1 : 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      pos.push(h.x, 0, h.z, h.x, 0, h.z);
      tMin.push(a.min, b.min);
      anom.push(an, an);
      hid.push(hi, hi);
      const c = colorForReading(a);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("tMin", new THREE.Float32BufferAttribute(tMin, 1));
  geo.setAttribute("anom", new THREE.Float32BufferAttribute(anom, 1));
  geo.setAttribute("hid", new THREE.Float32BufferAttribute(hid, 1));
  worldlineMesh = new THREE.LineSegments(geo, makeWorldlineMat());
  worldlineMesh.frustumCulled = false;
  scene.add(worldlineMesh);

  const ops = opsXZ();
  const kiosk = kioskXZ();
  const usb = usbXZ();
  stackSpine(ops.x, ops.z, COL.site);
  stackSpine(kiosk.x, kiosk.z, COL.people);
  stackSpine(usb.x, usb.z, COL.meter);
  if (emptyCanvas) {
    for (const f of liveFeeders) stackSpine(f.x, f.z, COL.site);
  }
}

function buildReadings() {
  const n = day.readings.length;
  if (!n) return;
  readingMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.11, 6, 5),
    makeReadingMat(),
    n,
  );
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const tArr = new Float32Array(n);
  const aArr = new Float32Array(n);
  const hArr = new Float32Array(n);
  day.readings.forEach((r, i) => {
    const h = houseById[r.houseId];
    dummy.position.set(h.x, 0, h.z);
    const s = r.on ? 0.7 + Math.min(r.powerW, 400) / 400 : 0.45;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    readingMesh.setMatrixAt(i, dummy.matrix);
    color.copy(colorForReading(r));
    readingMesh.setColorAt(i, color);
    tArr[i] = r.min;
    aArr[i] = anomalyIds.has(r.houseId) ? 1 : 0;
    hArr[i] = houseIndex[r.houseId];
  });
  readingMesh.geometry.setAttribute("tMin", new THREE.InstancedBufferAttribute(tArr, 1));
  readingMesh.geometry.setAttribute("anom", new THREE.InstancedBufferAttribute(aArr, 1));
  readingMesh.geometry.setAttribute("hid", new THREE.InstancedBufferAttribute(hArr, 1));
  readingMesh.instanceColor.needsUpdate = true;
  readingMesh.userData.kind = "reading";
  readingMesh.frustumCulled = false;
  scene.add(readingMesh);
}

function buildDisconnectKnobs() {
  const dummy = new THREE.Object3D();
  const xs = [];
  const zs = [];
  const mins = [];
  const hids = [];
  for (const h of liveHouses) {
    const hi = houseIndex[h.id];
    for (let min = KNOB_STEP; min < DAY_MIN; min += KNOB_STEP) {
      if (!outageHit(h, min)) continue;
      xs.push(h.x);
      zs.push(h.z);
      mins.push(min);
      hids.push(hi);
    }
  }
  const n = mins.length;
  if (!n) return;
  knobMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.18, 8, 6),
    makeKnobMat(),
    n,
  );
  const tArr = new Float32Array(n);
  const hArr = new Float32Array(n);
  const red = new THREE.Color(COL.outage);
  for (let i = 0; i < n; i++) {
    dummy.position.set(xs[i], 0, zs[i]);
    dummy.scale.set(1, 0.82, 1);
    dummy.updateMatrix();
    knobMesh.setMatrixAt(i, dummy.matrix);
    knobMesh.setColorAt(i, red);
    tArr[i] = mins[i];
    hArr[i] = hids[i];
  }
  knobMesh.geometry.setAttribute("tMin", new THREE.InstancedBufferAttribute(tArr, 1));
  knobMesh.geometry.setAttribute("hid", new THREE.InstancedBufferAttribute(hArr, 1));
  knobMesh.instanceColor.needsUpdate = true;
  knobMesh.userData.kind = "knob";
  scene.add(knobMesh);
}

function curve(a, b, lift, color, dashed) {
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= lift;
  const pts = new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(12);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.45, gapSize: 0.25 })
    : new THREE.LineBasicMaterial({ color });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  if (dashed) line.computeLineDistances();
  return line;
}

function vendorOf(h) {
  return liveVendors.find((v) => v.id === h.vendorId) || kioskXZ();
}

function payOrigin(h) {
  if ((h.payVia || "vendor") === "vendor") {
    const v = vendorOf(h);
    return { x: v.x, z: v.z };
  }
  return { x: h.x, z: h.z };
}

function mark(kind, min, houseId, color, radius = 0.22) {
  const h = houseId ? houseById[houseId] : opsXZ();
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshLambertMaterial({ color }),
  );
  const cloud = cloudXZ();
  const x = kind === "sync" ? cloud.x : h.x;
  const z = kind === "sync" ? cloud.z : h.z;
  m.position.set(x, yAt(min), z);
  m.userData = { kind, min, houseId };
  addTime(m);
  eventMeshes.push(m);
  return m;
}

function buildEvents() {
  for (const e of day.events) {
    if (e.kind === "reading" || e.kind === "off") continue;
    const h = e.houseId ? houseById[e.houseId] : null;
    const y = yAt(e.min);
    if (e.kind === "pay" && h) {
      const via = e.via || h.payVia || "vendor";
      const origin = via === "vendor" ? payOrigin({ ...h, payVia: "vendor" }) : { x: h.x, z: h.z };
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 12, 12),
        new THREE.MeshLambertMaterial({ color: COL.money }),
      );
      bead.position.set(origin.x, y, origin.z);
      bead.userData = { kind: "pay", min: e.min, houseId: e.houseId };
      addTime(bead);
      eventMeshes.push(bead);
      const opsAt = opsXZ();
      const ops = new THREE.Vector3(opsAt.x, y, opsAt.z);
      const src = new THREE.Vector3(origin.x, y, origin.z);
      if (via === "vendor") {
        const walk = curve(new THREE.Vector3(h.x, y, h.z), src, 0.55, COL.people, true);
        walk.userData = { kind: "pay", min: e.min, houseId: e.houseId };
        addTime(walk);
        eventMeshes.push(walk);
        const http = curve(src, ops, 1.15, COL.money, false);
        http.userData = { kind: "pay", min: e.min, houseId: e.houseId };
        addTime(http);
        eventMeshes.push(http);
      } else if (via === "phone") {
        const cloudAt = cloudXZ();
        const cloud = new THREE.Vector3(cloudAt.x, y, cloudAt.z);
        const up = curve(src, cloud, 0.9, COL.money, true);
        up.userData = { kind: "pay", min: e.min, houseId: e.houseId };
        addTime(up);
        eventMeshes.push(up);
        const down = curve(cloud, ops, 0.7, COL.money, false);
        down.userData = { kind: "pay", min: e.min, houseId: e.houseId };
        addTime(down);
        eventMeshes.push(down);
      } else {
        const radio = curve(src, ops, 0.75, COL.money, true);
        radio.userData = { kind: "pay", min: e.min, houseId: e.houseId };
        addTime(radio);
        eventMeshes.push(radio);
      }
    }
    if (e.kind === "credit" && h) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        new THREE.MeshLambertMaterial({ color: COL.money }),
      );
      m.position.set(h.x, y, h.z);
      m.userData = { kind: "pay", min: e.min, houseId: e.houseId };
      addTime(m);
      eventMeshes.push(m);
      const path = meshPath(h.id, "down", e.min);
      if (path) addMeshPacket(path, e.min, COL.money, "pay", h.id, false, 0.95, 1);
    }
    if ((e.kind === "disconnect" || e.kind === "overload") && h) {
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32),
        new THREE.MeshLambertMaterial({ color: e.kind === "overload" ? COL.overload : COL.disconnect }),
      );
      m.position.set(h.x, y, h.z);
      m.userData = { kind: e.kind, min: e.min, houseId: e.houseId };
      addTime(m);
      eventMeshes.push(m);
      if (!houseDark(h.id, e.min)) drawPath(meshPath(h.id, "down", e.min), e.min, e.kind === "overload" ? COL.overload : COL.disconnect, h.id);
    }
    if ((e.kind === "cap_warn" || e.kind === "pf_warn") && h) {
      const m = mark(e.kind, e.min, e.houseId, COL[e.kind], 0.18);
      m.position.x += e.kind === "pf_warn" ? -0.65 : 0.55;
    }
    if (e.kind === "sms" && h) {
      const m = mark("sms", e.min, e.houseId, COL.sms, 0.2);
      m.position.x += 0.7;
    }
    if (e.kind === "sync") {
      mark("sync", e.min, null, COL.ops, 0.24);
      const opsAt = opsXZ();
      const cloudAt = cloudXZ();
      const a = new THREE.Vector3(opsAt.x, y, opsAt.z);
      const b = new THREE.Vector3(cloudAt.x, y, cloudAt.z);
      const line = curve(a, b, 0.8, COL.ops, true);
      line.userData = { kind: "sync", min: e.min, houseId: null };
      addTime(line);
      eventMeshes.push(line);
    }
    if (e.kind === "outage" || e.kind === "repair" || e.kind === "shed" || e.kind === "restore") {
      const color = e.kind === "outage" ? COL.fault : COL[e.kind];
      const o = liveOutages.find((x) => x.id === e.outageId);
      const px = o?.x ?? LANDMARKS.xfmr.x;
      const pz = o?.z ?? LANDMARKS.xfmr.z;
      const m = new THREE.Mesh(
        e.kind === "outage" ? new THREE.OctahedronGeometry(0.82) : new THREE.SphereGeometry(0.32, 12, 12),
        e.kind === "outage"
          ? new THREE.MeshBasicMaterial({ color })
          : new THREE.MeshLambertMaterial({ color }),
      );
      m.position.set(px, y, pz);
      m.userData = { kind: e.kind, min: e.min, houseId: null };
      addTime(m);
      eventMeshes.push(m);
      if (e.kind === "repair") {
        const opsAt = opsXZ();
        const a = new THREE.Vector3(opsAt.x, y, opsAt.z);
        const b = new THREE.Vector3(px, y, pz);
        const line = curve(a, b, 1.1, COL.repair, false);
        line.userData = { kind: "repair", min: e.min, houseId: null };
        addTime(line);
        eventMeshes.push(line);
      }
    }
    if (e.kind === "phase_xfer" && h) {
      const dtm = liveDtms.find((d) => d.feederId === e.feederId) || { x: h.x, z: h.z };
      const bead = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28),
        new THREE.MeshLambertMaterial({ color: COL.phase_xfer }),
      );
      bead.position.set(h.x, y, h.z);
      bead.userData = { kind: "phase_xfer", min: e.min, houseId: e.houseId };
      addTime(bead);
      eventMeshes.push(bead);
      const line = curve(
        new THREE.Vector3(h.x, y, h.z),
        new THREE.Vector3(dtm.x, y, dtm.z),
        0.7,
        COL.phase_xfer,
        true,
      );
      line.userData = { kind: "phase_xfer", min: e.min, houseId: e.houseId };
      addTime(line);
      eventMeshes.push(line);
      const dest = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.18, 0.28),
        new THREE.MeshLambertMaterial({ color: COL.dtm }),
      );
      dest.position.set(dtm.x, y, dtm.z);
      dest.userData = { kind: "phase_xfer", min: e.min, houseId: e.houseId };
      addTime(dest);
      eventMeshes.push(dest);
    }
    if (e.kind === "leak" || e.kind === "leak_clear") {
      const lk = liveLeaks.find((x) => x.id === e.leakId);
      if (!lk) continue;
      const hex = e.kind === "leak" ? COL.leak : COL.restore;
      const mid = new THREE.Mesh(
        e.kind === "leak" ? new THREE.OctahedronGeometry(0.48) : new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshBasicMaterial({ color: hex }),
      );
      mid.position.set(lk.x, y, lk.z);
      mid.userData = { kind: e.kind, min: e.min, houseId: null };
      addTime(mid);
      eventMeshes.push(mid);
      if (e.kind === "leak") {
        const line = curve(
          new THREE.Vector3(lk.ax, y, lk.az),
          new THREE.Vector3(lk.bx, y, lk.bz),
          0.15,
          COL.leak,
          true,
        );
        line.userData = { kind: "leak", min: e.min, houseId: null };
        addTime(line);
        eventMeshes.push(line);
      }
    }
  }
}

function nodeXZ(id) {
  if (id === "usb") return usbXZ();
  if (id === "ops") return opsXZ();
  return houseById[id] || usbXZ();
}

function addMeshPacket(ids, min, color, kind, houseId, dashed, opacity = 0.9, dyScale = 1) {
  const dy = HOP_DY * dyScale;
  const pts = ids.map((id, i) => {
    const p = nodeXZ(id);
    return new THREE.Vector3(p.x, yAt(min) - i * dy, p.z);
  });
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.22, transparent: true, opacity })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  if (dashed) line.computeLineDistances();
  line.userData = { kind, min, houseId, lineHops: ids.length, dyScale };
  line.frustumCulled = false;
  addTime(line);
  eventMeshes.push(line);
  ids.forEach((id, i) => {
    if (i === 0 || i === ids.length - 1) return;
    const p = nodeXZ(id);
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(opacity < 0.5 ? 0.09 : 0.12, 8, 8),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity }),
    );
    bead.position.set(p.x, yAt(min) - i * dy, p.z);
    bead.userData = { kind, min, houseId, hopI: i, dyScale, hops: ids.length };
    bead.frustumCulled = false;
    addTime(bead);
    eventMeshes.push(bead);
  });
}

function addLastBreathPacket(ids, min, color, kind, houseId, dashed, opacity = 1, dyScale = 1.45) {
  if (!ids || ids.length < 2) return;
  const pts = ids.map((id, i) => {
    const p = nodeXZ(id);
    return new THREE.Vector3(p.x, lastBreathY(min, i), p.z);
  });
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.45, gapSize: 0.2, transparent: true, opacity })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  if (dashed) line.computeLineDistances();
  line.userData = { kind, min, houseId };
  line.frustumCulled = false;
  scene.add(line);
  eventMeshes.push(line);
  stackEvents.push({ mesh: line, min, hops: ids.length, line: true });
  ids.forEach((id, i) => {
    const p = nodeXZ(id);
    const end = i === 0 || i === ids.length - 1;
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(end ? 0.26 : 0.18, 10, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
    );
    bead.position.set(p.x, lastBreathY(min, i, ids.length), p.z);
    bead.userData = { kind, min, houseId };
    bead.frustumCulled = false;
    scene.add(bead);
    eventMeshes.push(bead);
    stackEvents.push({ mesh: bead, min, hopI: i, hops: ids.length, line: false });
  });
}

function restackLastBreath() {
  for (const item of stackEvents) {
    const hops = item.hops || 1;
    if (item.line) {
      const pos = item.mesh.geometry.getAttribute("position");
      for (let i = 0; i < hops; i++) pos.setY(i, lastBreathY(item.min, i, hops));
      pos.needsUpdate = true;
      item.mesh.geometry.computeBoundingSphere();
      item.mesh.geometry.computeBoundingBox();
    } else {
      item.mesh.position.y = lastBreathY(item.min, item.hopI, hops);
    }
  }
}

function restackTimeStack() {
  if (!timeGroup) return;
  const now = state.nowMin;
  const v2 = isV2();
  timeGroup.traverse((o) => {
    const min = o.userData?.min;
    if (min == null) return;
    const yOff = o.userData.yOff || 0;
    if (o.userData.lineHops) {
      const pos = o.geometry.getAttribute("position");
      const hops = o.userData.lineHops;
      const dyScale = o.userData.dyScale || 1;
      for (let i = 0; i < hops; i++) {
        const worldY = stackHopWorldY(min, i, dyScale, hops);
        pos.setY(i, v2 ? yAt(now) - worldY : worldY);
      }
      pos.needsUpdate = true;
      o.geometry.computeBoundingSphere();
      o.geometry.computeBoundingBox();
      return;
    }
    if (o.userData.y1 != null) {
      const yTop = yWorldAt(min, now);
      const yBot = yWorldAt(o.userData.y1, now);
      const h = Math.max(0.35, Math.abs(yTop - yBot));
      o.scale.y = h / o.userData.baseH;
      o.position.y = v2 ? yAt(now) - (yTop + yBot) / 2 : (yTop + yBot) / 2;
      return;
    }
    const hop = o.userData.hopI || 0;
    const dyScale = o.userData.dyScale || 1;
    const hops = o.userData.hops || hop + 1;
    const worldY = stackHopWorldY(min, hop, dyScale, hops) + yOff;
    if (v2) {
      if (o.userData.bakedY) o.position.y = yAt(now) - worldY - yAt(min);
      else o.position.y = yAt(now) - worldY;
    } else if (o.userData.bakedY) o.position.y = worldY - yAt(min);
    else o.position.y = worldY;
    if (o.isSprite) {
      const ay = Math.abs(o.scale.y) || 1.4;
      o.scale.y = v2 ? -ay : ay;
    }
  });
}

function restackTimeLabels() {
  for (const item of timeAxisLabels) {
    const age = Math.abs(state.nowMin - item.min);
    let k = item.minor ? 0.28 : 0.52;
    if (age < 5) k = item.minor ? 2.1 : 3.1;
    else if (age < 14) k = item.minor ? 1.55 : 2.25;
    else if (age < 28) k = item.minor ? 1.05 : 1.7;
    else if (age < 50) k = item.minor ? 0.7 : 1.25;
    else if (age < 90) k = item.minor ? 0.38 : 0.95;
    else if (age < 140) k = item.minor ? 0.2 : 0.68;
    item.spr.visible = !item.minor || age < 55;
    item.spr.scale.set(item.baseX * k, (isV2() ? -1.7 : 1.7) * k, 1);
    if (item.spr.material) {
      item.spr.material.transparent = true;
      item.spr.material.opacity = age < 12 ? 1 : age < 150 ? 0.92 : 0.3;
      item.spr.material.depthTest = age > 18;
    }
  }
}

function drawPath(ids, min, color, houseId) {
  if (!ids || ids.length < 2) return;
  addMeshPacket(ids, min, color, "mesh", houseId, false, 0.9, 1);
}

function buildMeshFloor() {
  const same = [];
  const choke = [];
  for (const [from, to] of rfEdges()) {
    const a = nodeXZ(from);
    const b = nodeXZ(to);
    const ca = from === "usb" ? "usb" : houseById[from]?.cluster;
    const cb = to === "usb" ? "usb" : houseById[to]?.cluster;
    const pair = [new THREE.Vector3(a.x, Y_RF, a.z), new THREE.Vector3(b.x, Y_RF, b.z)];
    if (ca !== cb) choke.push(...pair);
    else same.push(...pair);
  }
  if (same.length) {
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(same),
      new THREE.LineDashedMaterial({ color: COL.meter, dashSize: 0.45, gapSize: 0.22, transparent: true, opacity: 0.45 }),
    );
    line.computeLineDistances();
    scene.add(line);
    rfFloorMeshes.push(line);
  }
  if (choke.length) {
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(choke),
      new THREE.LineDashedMaterial({ color: COL.shed, dashSize: 0.55, gapSize: 0.18, transparent: true, opacity: 0.9 }),
    );
    line.computeLineDistances();
    scene.add(line);
    rfFloorMeshes.push(line);
  }
}

function houseDark(houseId, min) {
  return !!outageHit(houseById[houseId], min);
}

function buildMeshPackets() {
  if (!HOUSE_N) return;
  for (let slot = 0; slot < SLOTS; slot += 8) {
    const min = slot * SLOT_MIN;
    const wave = (slot / 8) | 0;
    const a = wave % HOUSE_N;
    for (const idx of [a, (a + 8) % HOUSE_N, (a + 16) % HOUSE_N]) {
      if (houseDark(liveHouses[idx].id, min)) continue;
      drawPath(meshPath(liveHouses[idx].id, "up", min), min, COL.reading, liveHouses[idx].id);
    }
  }
}

function buildLastBreaths() {
  for (const o of day.summary.outages || []) {
    const slot = o.min / SLOT_MIN;
    const arrived = [];
    const lost = [];
    for (let i = 0; i < HOUSE_N; i++) {
      const r = day.readings[slot * HOUSE_N + i];
      if (!r?.lastBreath || (r.outageId && r.outageId !== o.id)) continue;
      if (r.lastBreathArrived) arrived.push(r);
      else lost.push(r);
    }
    const showArrived = arrived.slice(0, 6);
    const showLost = [
      ...lost.filter((r) => r.lastBreathReason === "channel").slice(0, 3),
      ...lost.filter((r) => r.lastBreathReason !== "channel").slice(0, 3),
    ];
    for (const r of showArrived) {
      const path = meshPath(r.houseId, "up", r.min);
      if (path) addLastBreathPacket(path, r.min, COL.lastbreath, "lastbreath", r.houseId, false, 1, 1.45);
      const h = houseById[r.houseId];
      const m = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.55),
        new THREE.MeshBasicMaterial({ color: COL.lastbreath }),
      );
      m.position.set(h.x, lastBreathY(r.min, 0), h.z);
      m.userData = { kind: "lastbreath", min: r.min, houseId: r.houseId };
      scene.add(m);
      eventMeshes.push(m);
      stackEvents.push({ mesh: m, min: r.min, hopI: 0, line: false });
    }
    for (const r of showLost) {
      const path = meshPath(r.houseId, "up", r.min);
      if (!path) continue;
      const stub = r.lastBreathReason === "channel" ? path : path.slice(0, LAST_BREATH_MAX_HOPS + 1);
      addLastBreathPacket(stub, r.min, COL.lastbreath_lost, "lastbreath_lost", r.houseId, true, 0.9, 1.45);
    }
  }
}

function buildNowPlane() {
  const { x: cx, z: cz, r } = COMPASS;
  nowPlane = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(2, r - 1.2), r + 0.55, 72),
    new THREE.MeshBasicMaterial({
      color: COL.reading,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  nowPlane.rotation.x = -Math.PI / 2;
  nowPlane.position.set(cx, Y_NOW, cz);
  scene.add(nowPlane);

  const band = (y, opacity) => {
    const p = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(2, r - 1.2), r + 0.45, 48),
      new THREE.MeshBasicMaterial({
        color: 0x2a3040,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    p.rotation.x = -Math.PI / 2;
    p.position.set(cx, y, cz);
    scene.add(p);
    return p;
  };
  futBand = band(-SCRUNCH_H, 0.05);
  winBand = band(boundH, 0.04);
  pastBand = band(PAST_TOP, 0.05);
}

/** Physical equipment offsets are schematic, independent of the time axis. */
function buildInfrastructureDetails() {
  for (const k of Object.keys(infraDetailByLayer)) infraDetailByLayer[k].length = 0;
  const supports = [LANDMARKS.xfmr, ...POLES, ...TRANSFORMERS, ...FEEDERS];
  /** @param {string} layer poles|xfmr|ems|homes */
  const batch = (layer, geometry, color, poses) => {
    if (!poses.length) return;
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color }), poses.length);
    const d = new THREE.Object3D();
    poses.forEach(([x, y, z], i) => {
      d.position.set(x, y, z);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.castShadow = true;
    mesh.userData.infraLayer = layer;
    scene.add(mesh);
    if (infraDetailByLayer[layer]) infraDetailByLayer[layer].push(mesh);
  };
  // Crossarms + insulators ride with poles.
  batch("poles", new THREE.BoxGeometry(0.85, 0.1, 0.12), 0x78634d,
    supports.map(p => [p.x, LINE_HANG - 0.12, p.z]));
  batch("poles", new THREE.CylinderGeometry(0.065, 0.09, 0.18, 6), 0xd6e7dd,
    supports.flatMap(p => [-0.32, 0, 0.32].map(dx => [p.x + dx, LINE_HANG + 0.02, p.z])));
  // Transformer shelf and bushings connect the tank to its pole.
  batch("xfmr", new THREE.BoxGeometry(0.72, 0.07, 0.58), 0x485763,
    TRANSFORMERS.map(t => [t.x + 0.22, HANG.xfmr - 0.36, t.z]));
  batch("xfmr", new THREE.CylinderGeometry(0.045, 0.07, 0.2, 6), 0xe4ddd0,
    TRANSFORMERS.flatMap(t => [-0.13, 0.13].map(dx => [t.x + 0.32 + dx, HANG.xfmr + 0.42, t.z])));
  // Each EMS has a dedicated mounting post, door, latch and RF enclosure/whip.
  batch("ems", new THREE.CylinderGeometry(0.055, 0.075, 2.35, 6), 0x71818a,
    liveBoards.map(b => [b.x, 1.175, b.z - 0.19]));
  batch("ems", new THREE.BoxGeometry(0.38, 0.50, 0.025), 0xc7d5db,
    liveBoards.map(b => [b.x, HANG.ems, b.z + 0.15]));
  batch("ems", new THREE.BoxGeometry(0.035, 0.13, 0.035), 0x293d47,
    liveBoards.map(b => [b.x + 0.13, HANG.ems, b.z + 0.18]));
  batch("ems", new THREE.BoxGeometry(0.18, 0.24, 0.12), 0x26b9ba,
    liveBoards.map(b => [b.x, 2.25, b.z - 0.12]));
  batch("ems", new THREE.CylinderGeometry(0.018, 0.025, 0.58, 5), 0x293d47,
    liveBoards.map(b => [b.x, 2.65, b.z - 0.12]));
  // Intermediate service supports make secondary endpoints visibly grounded.
  batch("homes", new THREE.CylinderGeometry(0.035, 0.05, HANG.secondary, 5), 0x79624b,
    liveHouses.map(h => [h.x, HANG.secondary / 2, h.z]));
}

function buildPowerLines() {
  lvSegMeta = GRID_SEGS.map((s) => ({
    a: { x: s.ax, z: s.az },
    b: { x: s.bx, z: s.bz },
    kind: s.kind,
    feederId: s.feederId,
    xfmrId: s.xfmrId,
    houseId: s.houseId,
    capW: s.capW || XFMR_CAPACITY_W,
  }));
  const barGeo = new THREE.BoxGeometry(1, 1, 1);
  const barMat = glowLambert(0.72);
  powerLineMesh = new THREE.InstancedMesh(barGeo, barMat, lvSegMeta.length * WIRE_STEPS);
  const lineDummy = new THREE.Object3D();
  const lineCol = new THREE.Color(0x3b6d11);
  lvSegMeta.forEach((s, i) => {
    const y = HANG[s.kind];
    const dx = s.b.x - s.a.x;
    const dz = s.b.z - s.a.z;
    const len = Math.hypot(dx, dz) || 0.2;
    const thick = s.kind === "secondary" ? 0.035 : 0.065;
    const sag = Math.min(0.36, len * 0.035);
    const point = (t) => new THREE.Vector3(s.a.x + dx * t, y - 4 * sag * t * (1 - t), s.a.z + dz * t);
    for (let j = 0; j < WIRE_STEPS; j++) {
      const a = point(j / WIRE_STEPS);
      const b = point((j + 1) / WIRE_STEPS);
      const direction = b.clone().sub(a);
      lineDummy.position.copy(a).add(b).multiplyScalar(0.5);
      lineDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
      lineDummy.scale.set(thick, thick, direction.length());
      lineDummy.updateMatrix();
      powerLineMesh.setMatrixAt(i * WIRE_STEPS + j, lineDummy.matrix);
      powerLineMesh.setColorAt(i * WIRE_STEPS + j, lineCol);
    }
  });
  powerLineMesh.castShadow = true;
  powerLineMesh.receiveShadow = true;
  powerLineMesh.userData.pickLines = true;
  scene.add(powerLineMesh);

  const poleGeo = new THREE.CylinderGeometry(0.075, 0.12, LINE_HANG, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x79624b });
  poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, POLES.length + TRANSFORMERS.length + liveFeeders.length + 1);
  polePick = [];
  const dummy = new THREE.Object3D();
  let pi = 0;
  const plant = (x, z, scope) => {
    dummy.position.set(x, LINE_HANG / 2, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(pi++, dummy.matrix);
    polePick.push(scope);
  };
  plant(LANDMARKS.xfmr.x, LANDMARKS.xfmr.z, STATIONS[0] ? { kind: "station", id: STATIONS[0].id } : { kind: "village" });
  for (const p of POLES) plant(p.x, p.z, p.feederId ? { kind: "feeder", id: p.feederId } : { kind: "village" });
  for (const t of TRANSFORMERS) plant(t.x, t.z, { kind: "feeder", id: t.feederId });
  for (const f of liveFeeders) plant(f.x, f.z, { kind: "feeder", id: f.id });
  poleMesh.count = pi;
  poleMesh.castShadow = true;
  poleMesh.receiveShadow = true;
  poleMesh.userData.pickPoles = true;
  scene.add(poleMesh);
  buildStreetLamps();
  buildInfrastructureDetails();

  const xfmrGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.65, 10);
  xfmrMesh = new THREE.InstancedMesh(xfmrGeo, glowLambert(0.42), TRANSFORMERS.length);
  const xfmrCol = new THREE.Color(0xc9a227);
  TRANSFORMERS.forEach((t, i) => {
    dummy.position.set(t.x + 0.32, HANG.xfmr, t.z);
    dummy.rotation.set(0, (i * 0.7) % 1.2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    xfmrMesh.setMatrixAt(i, dummy.matrix);
    xfmrMesh.setColorAt(i, xfmrCol);
  });
  xfmrMesh.castShadow = true;
  xfmrMesh.receiveShadow = true;
  xfmrMesh.userData.pickXfmr = true;
  scene.add(xfmrMesh);
  buildBreakers();
  buildFeederBuffers();

  for (const f of liveFeeders) {
    const spr = timeSprite(f.label, "#c9a227", 320);
    spr.scale.set(7.2, 1.5, 1);
    spr.position.set(f.x, 2.1, f.z);
    spr.userData.scope = { kind: "feeder", id: f.id };
    scene.add(spr);
  }
  const mainSpr = timeSprite("main LV xfmr", "#e8d48a", 280);
  mainSpr.position.set(LANDMARKS.xfmr.x, 2.4, LANDMARKS.xfmr.z);
  if (STATIONS[0]) mainSpr.userData.scope = { kind: "station", id: STATIONS[0].id };
  scene.add(mainSpr);
}

const PHASE_COL = { A: 0xe6c84a, B: 0x3d8bfd, C: 0x9b4dca };

function buildBreakers() {
  const n = 1 + liveFeeders.length + TRANSFORMERS.length;
  breakerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.28, 0.12), glowLambert(0.62), n);
  const dummy = new THREE.Object3D();
  const c = new THREE.Color(ASSET.breaker);
  let i = 0;
  breakerPick = [];
  const plant = (x, z, y, scope) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    breakerMesh.setMatrixAt(i, dummy.matrix);
    breakerMesh.setColorAt(i, c);
    breakerPick.push(scope);
    i += 1;
  };
  plant(
    LANDMARKS.xfmr.x + 0.58,
    LANDMARKS.xfmr.z - 0.24,
    0.92,
    STATIONS[0] ? { kind: "station", id: STATIONS[0].id } : { kind: "village" },
  );
  for (const f of liveFeeders) plant(f.x - 0.52, f.z - 0.22, LINE_HANG + 0.22, { kind: "feeder", id: f.id });
  for (const t of TRANSFORMERS) plant(t.x + 0.44, t.z - 0.22, LINE_HANG + 0.22, { kind: "feeder", id: t.feederId });
  breakerMesh.count = i;
  breakerMesh.castShadow = true;
  breakerMesh.visible = false;
  breakerMesh.userData.pickBreakers = true;
  scene.add(breakerMesh);
}

function feederBufWidth(kind) {
  if (kind === "trunk") return 2.55;
  if (kind === "primary") return 1.95;
  return 1.2;
}

function buildFeederBuffers() {
  feederBufById = {};
  const bufMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const pickMat = new THREE.MeshBasicMaterial({
    color: ASSET.feeder,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const barGeo = new THREE.BoxGeometry(1, 1, 1);
  const capGeo = new THREE.CircleGeometry(1, 16);
  const dummy = new THREE.Object3D();
  const pickSegs = GRID_SEGS.filter((s) => s.feederId);
  feederPickMesh = new THREE.InstancedMesh(barGeo, pickMat, Math.max(1, pickSegs.length));
  pickSegs.forEach((s, i) => {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len = Math.hypot(dx, dz) || 0.2;
    const w = feederBufWidth(s.kind) * 0.72;
    dummy.position.set((s.ax + s.bx) / 2, Y_FEEDER, (s.az + s.bz) / 2);
    dummy.rotation.set(0, Math.atan2(dx, dz), 0);
    dummy.scale.set(w, 0.04, len + w * 0.35);
    dummy.updateMatrix();
    feederPickMesh.setMatrixAt(i, dummy.matrix);
  });
  feederPickMesh.count = pickSegs.length;
  feederPickMesh.userData.pickFeeders = true;
  feederPickMesh.userData.pickSegs = pickSegs;
  feederPickMesh.frustumCulled = false;
  scene.add(feederPickMesh);

  for (const f of liveFeeders) {
    const segs = GRID_SEGS.filter((s) => s.feederId === f.id);
    const g = new THREE.Group();
    g.visible = false;
    g.userData.feederId = f.id;
    if (segs.length) {
      const ribbon = new THREE.InstancedMesh(barGeo, bufMat.clone(), segs.length);
      ribbon.userData.scope = { kind: "feeder", id: f.id };
      ribbon.userData.segs = segs;
      const idle = capacityColor(0);
      segs.forEach((s, i) => {
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const len = Math.hypot(dx, dz) || 0.2;
        const w = feederBufWidth(s.kind);
        dummy.position.set((s.ax + s.bx) / 2, Y_FEEDER, (s.az + s.bz) / 2);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.set(w, 0.045, len + w * 0.28);
        dummy.updateMatrix();
        ribbon.setMatrixAt(i, dummy.matrix);
        ribbon.setColorAt(i, idle);
      });
      ribbon.frustumCulled = false;
      g.add(ribbon);
      const seen = new Set();
      const joints = [];
      const add = (x, z, kind) => {
        const k = `${x.toFixed(2)},${z.toFixed(2)}`;
        if (seen.has(k)) return;
        seen.add(k);
        joints.push({ x, z, r: feederBufWidth(kind) * 0.52 });
      };
      for (const s of segs) {
        add(s.ax, s.az, s.kind);
        add(s.bx, s.bz, s.kind);
      }
      const caps = new THREE.InstancedMesh(capGeo, bufMat.clone(), Math.max(1, joints.length));
      caps.userData.scope = { kind: "feeder", id: f.id };
      joints.forEach((j, i) => {
        dummy.position.set(j.x, Y_FEEDER + 0.004, j.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(j.r, j.r, 1);
        dummy.updateMatrix();
        caps.setMatrixAt(i, dummy.matrix);
        caps.setColorAt(i, idle);
      });
      caps.count = joints.length;
      caps.frustumCulled = false;
      g.add(caps);
    }
    scene.add(g);
    feederBufById[f.id] = g;
  }
}

function liveFeederIdForBuild(p) {
  if (!p) return null;
  if (p.feederId && liveFeeders.some((f) => f.id === p.feederId)) return p.feederId;
  if (p.runId) {
    const hit = liveFeeders.find((f) => f.runId === p.runId || f.id === `f-${p.runId}`);
    if (hit) return hit.id;
  }
  if (p.kind === "line") {
    const h = liveHouses.find((x) => x.lineId === p.id);
    if (h?.feederId) return h.feederId;
    const byLine = liveFeeders.find((f) => f.id === `f-${p.id}`);
    if (byLine) return byLine.id;
  }
  return p.runId ? `f-${p.runId}` : null;
}

function activeFeederId() {
  const s = state.scope || {};
  if (s.kind === "feeder") return s.id;
  if (s.kind === "board") return boardById[s.id]?.feederId || null;
  if (s.kind === "house") return houseById[s.id]?.feederId || null;
  return null;
}

function updateFeederHighlight() {
  if (emptyCanvas) {
    for (const g of Object.values(feederBufById)) if (g) g.visible = false;
    return;
  }
  const fid = activeFeederId();
  for (const [id, g] of Object.entries(feederBufById)) {
    g.visible = id === fid;
  }
  const stage = document.getElementById("wl-stage-grid");
  if (stage) stage.classList.toggle("has-feeder", !!(fid && state.role !== "customer"));
}

function buildDtms() {
  dtmBars = [];
  dtmParts = [];
  for (const d of liveDtms) {
    const scope = { kind: "feeder", id: d.feederId };
    const body = box(0.62, 0.16, 0.48, 0x1a3340, d.x, LINE_HANG + 0.5, d.z);
    const lid = box(0.5, 0.05, 0.36, 0x2bb6a3, d.x, LINE_HANG + 0.6, d.z);
    body.userData.scope = scope;
    lid.userData.scope = scope;
    dtmParts.push({ body, lid });
    const spr = timeSprite(d.label, "#7ee0d0", 220);
    spr.scale.set(5.4, 1.2, 1);
    spr.position.set(d.x, LINE_HANG + 1.35, d.z);
    spr.userData.scope = scope;
    scene.add(spr);
    PHASES.forEach((ph, i) => {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1, 0.12),
        new THREE.MeshLambertMaterial({ color: PHASE_COL[ph] }),
      );
      bar.position.set(d.x + (i - 1) * 0.16, LINE_HANG + 0.85, d.z + 0.3);
      bar.userData = { feederId: d.feederId, phase: ph, scope };
      scene.add(bar);
      dtmBars.push(bar);
    });
  }
}

const EMS_BODY_Y = HANG.ems;
const EMS_HALF_H = 0.30;

function poseEmsCabinet(i, b, sc) {
  poseDummy.position.set(b.x, EMS_BODY_Y, b.z);
  poseDummy.rotation.set(0, 0, 0);
  poseDummy.scale.set(sc, sc, sc);
  poseDummy.updateMatrix();
  emsMesh.setMatrixAt(i, poseDummy.matrix);
}

function poseEmsPv(i, b, sc) {
  if (!emsPvMesh) return;
  poseDummy.position.set(b.x, EMS_BODY_Y + EMS_HALF_H * sc + 0.04 * sc, b.z);
  poseDummy.rotation.set(SUN_TILT, 0, 0);
  poseDummy.scale.set(0.55 * sc, sc, 0.4 * sc);
  poseDummy.updateMatrix();
  emsPvMesh.setMatrixAt(i, poseDummy.matrix);
}

function buildEmsBoards() {
  if (!liveBoards.length) return;
  const geo = new THREE.BoxGeometry(0.46, 0.60, 0.28);
  emsMesh = new THREE.InstancedMesh(geo, glowLambert(0.55), liveBoards.length);
  emsMesh.userData.pickBoards = true;
  const boardCol = new THREE.Color(ASSET.board);
  const pvGeo = new THREE.BoxGeometry(1, 0.045, 0.72);
  const pvM = new THREE.MeshLambertMaterial({
    color: PV_COL,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  emsPvMesh = new THREE.InstancedMesh(pvGeo, pvM, liveBoards.length);
  emsPvMesh.userData.pickBoards = true;
  emsPvMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  emsPvMesh.castShadow = true;
  emsPvMesh.receiveShadow = true;
  liveBoards.forEach((b, i) => {
    poseEmsCabinet(i, b, 1);
    emsMesh.setColorAt(i, boardCol);
    poseEmsPv(i, b, 1);
  });
  emsMesh.castShadow = true;
  emsMesh.instanceMatrix.needsUpdate = true;
  emsPvMesh.instanceMatrix.needsUpdate = true;
  scene.add(emsMesh);
  scene.add(emsPvMesh);
}

function leakKindLabel(kind) {
  if (kind === "tap") return "illegal tap";
  if (kind === "earth") return "earth leak";
  if (kind === "unmetered") return "unmetered load";
  return kind || "leak";
}

function leakBetween(a, b) {
  if (!a || !b) return null;
  return (
    liveLeaks.find(
      (lk) =>
        (lk.fromBoardId === a.id && lk.toBoardId === b.id) ||
        (lk.fromBoardId === b.id && lk.toBoardId === a.id),
    ) || null
  );
}

function quietClockMode() {
  return appMode === "build" || appMode === "maintenance" || appMode === "productive" || appMode === "energy";
}

/** Playhead sample for ops only; build/maint freeze midday (no scrub feeds). */
function feedSampleMin() {
  return quietClockMode() ? 720 : state.nowMin;
}

function leakLive(lk) {
  if (quietClockMode()) return false;
  return !!(lk && state.nowMin >= lk.min && state.nowMin < lk.restore);
}

function leakScope(lk) {
  return { kind: "feeder", id: lk.feederId, boardId: lk.fromBoardId };
}

function leakMark(mesh, lk, layer) {
  mesh.userData = { kind: "leak", leakId: lk.id, leakLayer: layer, scope: leakScope(lk) };
  mesh.renderOrder = layer === "pick" ? 1 : layer === "ground" ? 3 : 4;
  mesh.raycast = layer === "label" ? () => {} : THREE.Mesh.prototype.raycast;
  scene.add(mesh);
  leakMeshes.push(mesh);
}

function buildLeaks() {
  leakMeshes = [];
  for (const lk of liveLeaks) {
    const dx = lk.bx - lk.ax;
    const dz = lk.bz - lk.az;
    const len = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(dx, dz);
    const mx = (lk.ax + lk.bx) / 2;
    const mz = (lk.az + lk.bz) / 2;
    const corridorW = Math.max(2.6, feederBufWidth("primary") * 1.35);
    const pickH = LINE_HANG + 0.85;
    const pick = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: COL.leak,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    pick.position.set(mx, pickH / 2, mz);
    pick.rotation.y = yaw;
    pick.scale.set(corridorW, pickH, len + 1.4);
    leakMark(pick, lk, "pick");
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: COL.leak,
        transparent: true,
        opacity: 0.95,
        depthWrite: true,
      }),
    );
    ground.position.set(mx, Y_FEEDER + 0.14, mz);
    ground.rotation.y = yaw;
    ground.scale.set(corridorW, 0.18, len);
    leakMark(ground, lk, "ground");
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: COL.leak }),
    );
    bar.position.set(mx, LINE_HANG + 0.4, mz);
    bar.rotation.y = yaw;
    bar.scale.set(0.55, 0.72, len);
    leakMark(bar, lk, "span");
    for (const [x, z] of [
      [lk.ax, lk.az],
      [lk.bx, lk.bz],
    ]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.14, 10, 22),
        new THREE.MeshBasicMaterial({ color: COL.leak }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, LINE_HANG + 0.5, z);
      leakMark(ring, lk, "ring");
    }
    const spr = timeSprite(`ΔP ${lk.leakW} W`, "#ffb8ff", 280);
    spr.scale.set(8.4, 1.8, 1);
    spr.position.set(lk.x, LINE_HANG + 2.15, lk.z);
    leakMark(spr, lk, "label");
  }
  updateLeakViz();
}

function updateLeakViz() {
  const fid = state.role === "customer" ? null : activeFeederId();
  const showAll = appMode !== "build" && !state.hide.leak;
  const liveCol = new THREE.Color(0xff4dff);
  const mapCol = new THREE.Color(0xd24ae0);
  for (const m of leakMeshes) {
    const lk = liveLeaks.find((x) => x.id === m.userData.leakId);
    if (!lk) {
      m.visible = false;
      continue;
    }
    const layer = m.userData.leakLayer;
    m.visible = showAll && (fid ? lk.feederId === fid : layer !== "ground" && layer !== "pick");
    if (!m.visible) continue;
    const live = leakLive(lk);
    if (m.material?.color) m.material.color.copy(live ? liveCol : mapCol);
    if (!m.material || !("opacity" in m.material)) continue;
    if (layer === "pick") {
      m.material.transparent = true;
      m.material.opacity = 0;
      m.material.depthWrite = false;
    } else if (layer === "ground") {
      m.material.transparent = true;
      m.material.opacity = live ? 0.98 : 0.88;
      m.material.depthWrite = true;
    } else if (layer === "label") {
      m.material.transparent = true;
      m.material.opacity = 1;
      const k = fid ? 1.35 : 1.12;
      m.scale.set(8.4 * k, 1.8 * k, 1);
    } else {
      m.material.transparent = false;
      m.material.opacity = 1;
    }
  }
}

function updateDtmBars() {
  if (!dtmBars.length) return;
  if (quietClockMode()) return;
  const { last } = loadsAt(state.nowMin);
  const by = {};
  const perF = {};
  for (const h of liveHouses) {
    const r = last[h.id];
    if (!r || !r.on || r.feederOut) continue;
    const ph = r.phase || h.phase || "A";
    const key = `${h.feederId}:${ph}`;
    by[key] = (by[key] || 0) + r.powerW;
  }
  for (const bar of dtmBars) {
    const p = by[`${bar.userData.feederId}:${bar.userData.phase}`] || 0;
    bar.userData.p = p;
    (perF[bar.userData.feederId] ||= []).push(p);
  }
  for (const bar of dtmBars) {
    const mx = Math.max(40, ...(perF[bar.userData.feederId] || [40]));
    const h = 0.22 + 1.15 * (bar.userData.p / mx);
    bar.scale.y = h;
    bar.position.y = LINE_HANG + 0.7 + h / 2;
  }
}

function addPQ(map, id, p, q, thd) {
  const cur = map[id] || (map[id] = { p: 0, q: 0, thdP: 0 });
  cur.p += p;
  cur.q += q;
  cur.thdP += (thd || 0) * p;
}

function loadsAt(min) {
  const slot = Math.min(SLOTS - 1, Math.max(0, Math.floor(min / SLOT_MIN)));
  const last = {};
  const L = { west: 0, market: 0, clinic: 0, south: 0, east: 0 };
  const byFeeder = {};
  const byXfmr = {};
  let out = false;
  for (let i = 0; i < HOUSE_N; i++) {
    const r = day.readings[slot * HOUSE_N + i];
    const h = liveHouses[i];
    if (!h) continue;
    last[h.id] = r;
    if (r?.feederOut) out = true;
    if (r && r.on && !r.feederOut) {
      L[h.cluster] += r.powerW;
      addPQ(byFeeder, h.feederId, r.powerW, r.varQ || 0, r.thd || 0);
      addPQ(byXfmr, h.xfmrId, r.powerW, r.varQ || 0, r.thd || 0);
    }
  }
  return { L, last, out, byFeeder, byXfmr };
}

function tintInstanced(mesh, hex) {
  if (!mesh) return;
  const c = new THREE.Color(hex);
  dimForUseClassFocus(c);
  if (mesh.instanceColor) {
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, c);
    mesh.instanceColor.needsUpdate = true;
  } else if (mesh.material?.color) {
    mesh.material.color.copy(c);
  }
}

/** Multiply plant colors while a use class or energy class is solo-focused. */
function dimForUseClassFocus(c) {
  if (appMode === "productive" && state.activeUseClass) c.multiplyScalar(0.22);
  else if (appMode === "energy" && state.activeEnergyClass) c.multiplyScalar(0.22);
  return c;
}

function assetLineKind(s) {
  if (s.houseId || s.kind === "secondary") return "lateral";
  if (s.kind === "primary" || s.feederId) return "feeder";
  return "station";
}

function houseSelectRank(h) {
  const fid = state.role === "customer" ? null : activeFeederId();
  if (!fid || !h) return 0;
  if (h.feederId !== fid) return 0;
  if (state.focus && h.id === state.focus) return 4;
  if (state.scopeBoard && h.boardId === state.scopeBoard) return 3;
  if (state.scopeBoard || state.focus) return 2;
  return 1;
}

function boardSelectRank(b) {
  const fid = state.role === "customer" ? null : activeFeederId();
  if (!fid || !b) return 0;
  if (b.feederId !== fid) return 0;
  if (state.scopeBoard && b.id === state.scopeBoard) return 3;
  if (state.scopeBoard || state.focus) return 2;
  return 1;
}

function tintSelectRank(c, rank) {
  if (rank <= 0) c.multiplyScalar(0.16);
  else if (rank === 2) c.multiplyScalar(0.4);
  else if (rank === 3) c.lerp(SEL_EMS, 0.3);
  else if (rank === 4) c.lerp(SEL_METER, 0.55);
  else c.lerp(SEL_FEEDER, 0.12);
  return c;
}

function houseSelectScale(rank) {
  if (rank === 4) return 1.22;
  if (rank === 3) return 1.1;
  if (rank === 0) return 0.9;
  return 1;
}

function buildSelectHalos() {
  houseHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.52, 0.055, 8, 28),
    new THREE.MeshBasicMaterial({ color: SEL_METER, transparent: true, opacity: 0.95 }),
  );
  houseHalo.rotation.x = Math.PI / 2;
  houseHalo.visible = false;
  houseHalo.renderOrder = 4;
  scene.add(houseHalo);
  emsHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.92, 0.09, 8, 28),
    new THREE.MeshBasicMaterial({ color: SEL_EMS, transparent: true, opacity: 0.92 }),
  );
  emsHalo.rotation.x = Math.PI / 2;
  emsHalo.visible = false;
  emsHalo.renderOrder = 4;
  scene.add(emsHalo);
}

function updateSelectHalos() {
  const h = state.role !== "customer" && state.focus ? houseById[state.focus] : null;
  if (houseHalo) {
    houseHalo.visible = !!h;
    if (h) houseHalo.position.set(h.x, 0.1, h.z);
  }
  const b = state.role !== "customer" && state.scopeBoard ? boardById[state.scopeBoard] : null;
  if (emsHalo) {
    emsHalo.visible = !!b;
    if (b) emsHalo.position.set(b.x, LINE_HANG + 0.64, b.z);
  }
}

function colorHardware(loads) {
  if (emptyCanvas) return;
  const asset = state.scheme === "asset" || appMode === "build";
  const maint = appMode === "maintenance";
  const fid = activeFeederId();
  const last = loads?.last;
  const byXfmr = loads?.byXfmr || {};
  const byFeeder = loads?.byFeeder || {};
  if (fid && last && emsMesh?.instanceColor) {
    liveBoards.forEach((b, i) => {
      let c;
      const rank = state.role === "customer" ? (b.feederId === fid ? 1 : 0) : boardSelectRank(b);
      if (rank <= 0) {
        c = new THREE.Color(asset ? ASSET.board : 0xff6a2a);
      } else if (maint) {
        c = healthColor(boardDayHealth(b.id).stress).clone();
        const leakHit = liveLeaks.find(
          (lk) => lk.feederId === fid && (lk.fromBoardId === b.id || lk.toBoardId === b.id),
        );
        if (leakHit) c.lerp(new THREE.Color(COL.leak), 0.24);
      } else {
        c = state.scheme === "feeder" ? feederColorForHouse(b.houseIds?.[0], last) : houseIdsMetricColor(b.houseIds, last);
        const leakHit = liveLeaks.find(
          (lk) => lk.feederId === fid && (lk.fromBoardId === b.id || lk.toBoardId === b.id),
        );
        if (leakHit) c.lerp(new THREE.Color(COL.leak), leakLive(leakHit) ? 0.58 : 0.24);
      }
      tintSelectRank(c, rank);
      dimForUseClassFocus(c);
      emsMesh.setColorAt(i, c);
      const sc = rank === 3 ? 1.45 : rank === 2 ? 0.9 : 1;
      poseEmsCabinet(i, b, sc);
      poseEmsPv(i, b, sc);
    });
    emsMesh.instanceColor.needsUpdate = true;
    emsMesh.instanceMatrix.needsUpdate = true;
    if (emsPvMesh) emsPvMesh.instanceMatrix.needsUpdate = true;
  } else {
    tintInstanced(emsMesh, asset ? ASSET.board : 0xff6a2a);
    if (emsMesh) {
      liveBoards.forEach((b, i) => {
        poseEmsCabinet(i, b, 1);
        poseEmsPv(i, b, 1);
      });
      emsMesh.instanceMatrix.needsUpdate = true;
      if (emsPvMesh) emsPvMesh.instanceMatrix.needsUpdate = true;
    }
  }
  if (fid && xfmrMesh?.instanceColor) {
    TRANSFORMERS.forEach((t, i) => {
      let c;
      if (t.feederId !== fid) {
        c = new THREE.Color(asset ? ASSET.xfmr : 0xc9a227).multiplyScalar(0.28);
      } else {
        const pq = byXfmr[t.id];
        c = state.scheme === "feeder"
          ? (feederAllotColors(last)[t.feederId] || feederAllotColors(last)._village).clone()
          : flowMetricColor(pq?.p || 0, pq?.q || 0, t.capW || 1200, aggThd(pq));
      }
      dimForUseClassFocus(c);
      xfmrMesh.setColorAt(i, c);
    });
    xfmrMesh.instanceColor.needsUpdate = true;
  } else {
    tintInstanced(xfmrMesh, asset ? ASSET.xfmr : 0xc9a227);
  }
  tintInstanced(breakerMesh, ASSET.breaker);
  if (breakerMesh) breakerMesh.visible = asset;
  const trunk = lvSegMeta.find((s) => s.feederId === fid && s.kind === "trunk");
  const dtmCap = trunk?.capW || 8000;
  const dtmLoad = fid && byFeeder[fid] ? byFeeder[fid].p || 0 : 0;
  for (const p of dtmParts) {
    const onThis = fid && p.body.userData.scope?.id === fid;
    if (fid && onThis) {
      const pq = byFeeder[fid];
      const c = flowMetricColor(dtmLoad, pq?.q || 0, dtmCap, aggThd(pq));
      p.body.material.color.copy(c).multiplyScalar(0.45);
      p.lid.material.color.copy(c);
    } else {
      p.body.material.color.setHex(asset ? 0x145048 : 0x1a3340);
      p.lid.material.color.setHex(asset ? ASSET.dtm : 0x2bb6a3);
      if (fid) {
        p.body.material.color.multiplyScalar(0.35);
        p.lid.material.color.multiplyScalar(0.35);
      }
    }
    if (appMode === "productive" && state.activeUseClass) {
      p.body.material.color.multiplyScalar(0.22);
      p.lid.material.color.multiplyScalar(0.22);
    } else if (appMode === "energy" && state.activeEnergyClass) {
      p.body.material.color.multiplyScalar(0.22);
      p.lid.material.color.multiplyScalar(0.22);
    }
  }
  for (const m of stationMeshes) {
    m.material.color.setHex(asset ? ASSET.station : m.userData.baseHex);
    if (appMode === "productive" && state.activeUseClass) m.material.color.multiplyScalar(0.22);
    else if (appMode === "energy" && state.activeEnergyClass) m.material.color.multiplyScalar(0.22);
  }
}

function buildHouseLamps() {
  const geo = new THREE.PlaneGeometry(0.3, 0.22);
  windowMesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    }),
    HOUSE_N,
  );
  windowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  dummy.scale.set(0.001, 0.001, 1);
  dummy.updateMatrix();
  for (let i = 0; i < HOUSE_N; i++) {
    windowMesh.setMatrixAt(i, dummy.matrix);
    windowMesh.setColorAt(i, lampDark);
  }
  windowMesh.visible = false;
  windowMesh.frustumCulled = false;
  scene.add(windowMesh);
}

function buildStreetLamps() {
  const n = POLES.length;
  if (!n) return;
  const geo = new THREE.SphereGeometry(0.12, 8, 8);
  streetLampMesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xffe7b0 }),
    n,
  );
  const dummy = new THREE.Object3D();
  POLES.forEach((p, i) => {
    dummy.position.set(p.x, LINE_HANG + 0.1, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    streetLampMesh.setMatrixAt(i, dummy.matrix);
  });
  streetLampMesh.visible = false;
  streetLampMesh.castShadow = false;
  scene.add(streetLampMesh);
}

function updateLampWindows(last) {
  if (!windowMesh || !hutPose.length) return;
  const lamps = state.light === "lamps";
  windowMesh.visible = lamps;
  if (streetLampMesh) streetLampMesh.visible = lamps;
  if (!lamps) return;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const n = Math.min(HOUSE_N, windowMesh.count, liveHouses.length, hutPose.length);
  for (let i = 0; i < n; i++) {
    const p = hutPose[i];
    const h = liveHouses[i];
    if (!p || !h) continue;
    const r = last?.[h.id];
    const on = !!(r?.on && !r?.feederOut);
    const face = 0.58 * p.s;
    dummy.position.set(
      p.x + Math.sin(p.yaw) * face,
      p.bh * 0.52,
      p.z + Math.cos(p.yaw) * face,
    );
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(on ? 1 : 0.001, on ? 1 : 0.001, 1);
    dummy.updateMatrix();
    windowMesh.setMatrixAt(i, dummy.matrix);
    if (on) {
      const t = Math.min(1, (r.powerW || 40) / 180);
      col.copy(lampWarm).lerp(new THREE.Color(0xfff6d2), t);
    } else {
      col.copy(lampDark);
    }
    windowMesh.setColorAt(i, col);
  }
  windowMesh.instanceMatrix.needsUpdate = true;
  if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
}

function houseHitByAnyOutage(h) {
  if (!h) return false;
  for (const o of liveOutages) {
    if (o.feederId && h.feederId === o.feederId) return true;
    if (o.xfmrId && h.xfmrId === o.xfmrId) return true;
  }
  return false;
}

function segHitByAnyOutage(s) {
  if (!s) return false;
  for (const o of liveOutages) {
    if (o.xfmrId && s.xfmrId === o.xfmrId) return true;
    if (o.feederId && s.feederId === o.feederId) return true;
  }
  return false;
}

function colorHouses(last) {
  if (!hutMesh || !roofMesh || emptyCanvas) return;
  const maint = appMode === "maintenance";
  const quiet = quietClockMode();
  const healthMap = maint ? ensureHouseHealth() : null;
  const src = last || loadsAt(feedSampleMin()).last;
  const red = new THREE.Color(COL.outage);
  const roof = new THREE.Color();
  const lamps = state.light === "lamps";
  const fid = activeFeederId();
  const dayOut = !quiet && !!state.dayOutages && appMode === "operations";
  const n = Math.min(HOUSE_N, hutMesh.count, liveHouses.length);
  for (let i = 0; i < n; i++) {
    const h = liveHouses[i];
    if (!h) continue;
    const r = src[h.id];
    const out = !quiet && !!(r?.feederOut || outageHit(h, state.nowMin));
    const outDay = dayOut && houseHitByAnyOutage(h);
    let c;
    if (maint) {
      const hh = healthMap[h.id] || computeHouseDayHealth(h.id);
      c = healthColor(hh.stress).clone();
    } else if (dayOut) {
      if (outDay) {
        c = red.clone();
        c.offsetHSL(0, 0.08, 0.1);
      } else {
        c = new THREE.Color(isLightTheme() ? 0xb8b6ae : 0x18181c);
        c.multiplyScalar(0.55);
      }
    } else if (out) c = red.clone();
    else if (state.scheme === "useclass" || appMode === "productive") {
      c = new THREE.Color(useClassColor(h.useClass));
      if (state.activeUseClass) {
        if (useClassMatchesFocus(h.useClass, state.activeUseClass)) {
          c.offsetHSL(0, 0.1, 0.12);
        } else {
          // Keep silhouette, strongly quiet vs focused class / tier.
          c.lerp(new THREE.Color(isLightTheme() ? 0xb8b6ae : 0x18181c), 0.88);
          c.multiplyScalar(0.55);
        }
      }
    } else if (state.scheme === "feeder") c = feederColorForHouse(h.id, src);
    else c = readingMetricColor(r);
    if (!quiet && lamps && !out && !outDay) {
      const on = !!(r?.on && !r?.feederOut);
      if (on) c = c.clone().lerp(lampWarm, 0.28);
      else c = lampDark.clone();
    }
    const pick = state.role !== "customer" && !!fid && !dayOut;
    const rank = pick ? houseSelectRank(h) : 1;
    if (pick) tintSelectRank(c, rank);
    hutMesh.setColorAt(i, c);
    roof.copy(c).multiplyScalar(!quiet && lamps && !out && !(r?.on) ? 0.45 : 0.78);
    roofMesh.setColorAt(i, roof);
    const p = hutPose[i];
    if (p) {
      const k = pick ? houseSelectScale(rank) : 1;
      poseDummy.position.set(p.x, (p.bh * k) / 2 + 0.02, p.z);
      poseDummy.rotation.set(0, p.yaw, 0);
      poseDummy.scale.set(1.02 * p.s * k, p.bh * k, 0.9 * p.s * k);
      poseDummy.updateMatrix();
      hutMesh.setMatrixAt(i, poseDummy.matrix);
      poseDummy.position.set(p.x, p.bh * k + 0.24, p.z);
      poseDummy.rotation.set(0, p.yaw + Math.PI / 4, 0);
      poseDummy.scale.set(p.s * k, k, p.s * k);
      poseDummy.updateMatrix();
      roofMesh.setMatrixAt(i, poseDummy.matrix);
    }
  }
  hutMesh.instanceColor.needsUpdate = true;
  roofMesh.instanceColor.needsUpdate = true;
  hutMesh.instanceMatrix.needsUpdate = true;
  roofMesh.instanceMatrix.needsUpdate = true;
  if (!quietClockMode()) updateLampWindows(src);
}

function colorPowerLines() {
  if (!powerLineMesh || emptyCanvas) return;
  _feederColMin = -1;
  const sample = feedSampleMin();
  const quiet = quietClockMode();
  const { last, byFeeder, byXfmr } = loadsAt(sample);
  const feederCols = state.scheme === "feeder" ? feederAllotColors(last) : null;
  const civic = civicW(sample);
  const civicQ = civic * Math.tan(Math.acos(CIVIC_PF));
  const asset = state.scheme === "asset" || appMode === "build";
  const fid = activeFeederId();
  const dayOut = !quiet && !!state.dayOutages && appMode === "operations";
  lvSegMeta.forEach((s, i) => {
    const hit = quiet ? false : outageCovers(s, state.nowMin);
    const hitDay = dayOut && segHitByAnyOutage(s);
    let p = 0;
    let q = 0;
    let thd = 0;
    let cap = s.capW || XFMR_CAPACITY_W;
    if (s.houseId) {
      const r = last[s.houseId];
      if (r && r.on && !r.feederOut) {
        p = r.powerW;
        q = r.varQ || 0;
        thd = r.thd || 0;
      }
      cap = Math.max(1, houseById[s.houseId]?.loadLimitW || cap);
    } else if (s.xfmrId) {
      const pq = byXfmr[s.xfmrId];
      p = pq?.p || 0;
      q = pq?.q || 0;
      thd = aggThd(pq);
    } else if (s.feederId) {
      const pq = byFeeder[s.feederId];
      p = pq?.p || 0;
      q = pq?.q || 0;
      thd = aggThd(pq);
    } else {
      let thdP = 0;
      for (const pq of Object.values(byFeeder)) {
        p += pq.p;
        q += pq.q;
        thdP += pq.thdP || 0;
      }
      p += civic;
      q += civicQ;
      thdP += civic * CIVIC_THD;
      thd = p > 0 ? thdP / p : 0;
      cap = XFMR_CAPACITY_W;
    }
    let c;
    if (!fid && asset) c = new THREE.Color(ASSET[assetLineKind(s)]);
    else if (hit || hitDay) c = new THREE.Color(COL.outage);
    else if (dayOut) c = flowMetricColor(p, q, cap, thd).multiplyScalar(0.22);
    else if (feederCols) c = (s.feederId && feederCols[s.feederId] ? feederCols[s.feederId] : feederCols._village).clone();
    else c = flowMetricColor(p, q, cap, thd);
    if (!dayOut && state.role !== "customer" && fid) {
      if (s.houseId) tintSelectRank(c, houseSelectRank(houseById[s.houseId]));
      else if (s.feederId !== fid) c.multiplyScalar(0.12);
      else c.lerp(SEL_FEEDER, state.scopeBoard || state.focus ? 0.2 : 0.08);
    } else if (!dayOut && fid && s.feederId !== fid) {
      c.multiplyScalar(0.18);
    }
    dimForUseClassFocus(c);
    for (let j = 0; j < WIRE_STEPS; j++) powerLineMesh.setColorAt(i * WIRE_STEPS + j, c);
  });
  if (powerLineMesh.instanceColor) powerLineMesh.instanceColor.needsUpdate = true;
  colorFeederBuffers(last, byFeeder, byXfmr);
  colorHouses(last);
  colorHardware({ last, byFeeder, byXfmr });
  updateSelectHalos();
}

function colorFeederBuffers(last, byFeeder, byXfmr) {
  const fid = activeFeederId();
  if (!fid) return;
  const g = feederBufById[fid];
  if (!g) return;
  const deep = !!(state.scopeBoard || state.focus);
  for (const child of g.children) {
    if (child.material && "opacity" in child.material) child.material.opacity = deep ? 0.58 : 0.44;
  }
  const ribbon = g.children.find((m) => m.userData.segs);
  const caps = g.children.find((m) => m.geometry?.type === "CircleGeometry");
  if (ribbon?.userData.segs && ribbon.instanceColor) {
    ribbon.userData.segs.forEach((s, i) => {
      const hit = quietClockMode() ? false : outageCovers(s, state.nowMin);
      let p = 0;
      let cap = s.capW || XFMR_CAPACITY_W;
      let q = 0;
      let thd = 0;
      if (s.houseId) {
        const r = last[s.houseId];
        if (r && r.on && !r.feederOut) {
          p = r.powerW;
          q = r.varQ || 0;
          thd = r.thd || 0;
        }
        cap = Math.max(1, houseById[s.houseId]?.loadLimitW || cap);
      } else if (s.xfmrId) {
        const pq = byXfmr[s.xfmrId];
        p = pq?.p || 0;
        q = pq?.q || 0;
        thd = aggThd(pq);
      } else if (s.feederId) {
        const pq = byFeeder[s.feederId];
        p = pq?.p || 0;
        q = pq?.q || 0;
        thd = aggThd(pq);
      }
      const c = hit
        ? new THREE.Color(COL.outage)
        : state.scheme === "feeder"
          ? s.houseId
            ? feederColorForHouse(s.houseId, last)
            : (feederAllotColors(last)[s.feederId] || feederAllotColors(last)._village).clone()
          : flowMetricColor(p, q, cap, thd);
      if (s.houseId) tintSelectRank(c, houseSelectRank(houseById[s.houseId]));
      else c.lerp(SEL_FEEDER, state.scopeBoard || state.focus ? 0.24 : 0.1);
      ribbon.setColorAt(i, c);
    });
    ribbon.instanceColor.needsUpdate = true;
  }
  if (caps?.instanceColor) {
    const pq = byFeeder[fid];
    const trunk = lvSegMeta.find((s) => s.feederId === fid && s.kind === "trunk");
    const c = flowMetricColor(pq?.p || 0, pq?.q || 0, trunk?.capW || 8000, aggThd(pq));
    c.lerp(SEL_FEEDER, state.scopeBoard || state.focus ? 0.24 : 0.1);
    for (let i = 0; i < caps.count; i++) caps.setColorAt(i, c);
    caps.instanceColor.needsUpdate = true;
  }
}

function applyLineLegend() {
  const g = state.lineGrad;
  const lo = document.getElementById("wl-line-lo");
  const mid = document.getElementById("wl-line-mid");
  const hi = document.getElementById("wl-line-hi");
  const bar = document.querySelector("#wl-line-legend .cap-bar");
  if (lo) lo.textContent = g === "pf" ? "PF 1.0" : g === "harmonics" ? "THD 0%" : "0% idle";
  if (mid) mid.textContent = g === "pf" ? "0.78" : g === "harmonics" ? "~8%" : "50% mid";
  if (hi) hi.textContent = g === "pf" ? "PF ≤ 0.55" : g === "harmonics" ? `≥${THD_HI}% THD` : "100% at cap";
  if (bar) {
    bar.classList.toggle("is-harm", g === "harmonics");
    bar.title =
      g === "pf"
        ? "line PF = P / S from end-use mix (schematic)"
        : g === "harmonics"
          ? "current THD % from end-use mix (schematic · IEEE 519-ish)"
          : "true_power_inst / line or meter cap";
  }
  const lvLo = document.getElementById("wl-lv-lo");
  const lvHi = document.getElementById("wl-lv-hi");
  if (lvLo?.lastChild) lvLo.lastChild.textContent = g === "pf" ? "LV PF ~1.0" : g === "harmonics" ? "LV THD clean" : "LV flow idle";
  if (lvHi?.lastChild) lvHi.lastChild.textContent = g === "pf" ? "LV PF ≤ 0.55" : g === "harmonics" ? `LV THD ≥${THD_HI}%` : "LV flow at xfmr cap";
}

let lastUiMin = -1;

function setNow(min) {
  state.nowMin = Math.max(0, Math.min(DAY_MIN, min));
  if (quietClockMode()) {
    lastUiMin = Math.floor(state.nowMin);
    return;
  }
  if (timeGroup) timeGroup.position.y = isV2() ? yAt(state.nowMin) : 0;
  timeUniforms.uNow.value = state.nowMin;
  placeSun(state.nowMin);
  if (nowPlane) nowPlane.position.y = Y_NOW;
  placePlayheadRing();
  if (nowMark) nowMark.position.y = isV2() ? 1.35 : 1.2;
  restackTimeStack();
  restackLastBreath();
  restackTimeLabels();
  const imin = Math.floor(state.nowMin);
  if (imin === lastUiMin) return;
  lastUiMin = imin;
  productiveUseApi?.update?.(state.nowMin);
  colorPowerLines();
  updateDtmBars();
  updateLeakViz();
  const clock = document.getElementById("wl-clock");
  if (clock) clock.textContent = fmtClock(state.nowMin);
  const scrub = document.getElementById("wl-scrub");
  if (scrub && document.activeElement !== scrub) scrub.value = String(imin);
  fillLog();
  fillHouses();
}

function applyVisibility() {
  if (emptyCanvas) hideSchematicMeshes();
  const hasLive = liveHouses.length > 0 && !(emptyCanvas && liveHouses === HOUSES);
  const noWorldlines = appMode === "build" || appMode === "maintenance" || appMode === "productive" || appMode === "energy";
  const hideStack = noWorldlines || state.hide.worldline || !hasLive;

  if (worldlineMesh) worldlineMesh.visible = hasLive && !noWorldlines && !state.hide.worldline;
  if (readingMesh) readingMesh.visible = hasLive && !noWorldlines && !state.hide.reading;
  if (timeGroup) timeGroup.visible = !hideStack;
  if (nowPlane) nowPlane.visible = hasLive && !noWorldlines;
  if (winBand) winBand.visible = hasLive && !noWorldlines && isV2();
  if (pastBand) pastBand.visible = hasLive && !noWorldlines && isV2();
  if (futBand) futBand.visible = hasLive && !noWorldlines && isV2();
  if (sprWin) sprWin.visible = hasLive && !noWorldlines && isV2();
  if (sprPast) sprPast.visible = hasLive && !noWorldlines && isV2();
  if (sprFut) sprFut.visible = hasLive && !noWorldlines && isV2();
  for (const line of spineMeshes) if (line) line.visible = !hideStack;

  if (knobMesh) knobMesh.visible = hasLive && appMode !== "build" && !state.hide.disconnect;
  for (const m of rfFloorMeshes) m.visible = hasLive && appMode !== "build" && !state.hide.rf;
  timeUniforms.uAnomalyOnly.value = appMode === "build" ? 0 : state.anomalyOnly ? 1 : 0;
  timeUniforms.uFocusHid.value = state.focus == null ? -1 : houseIndex[state.focus];

  for (const m of eventMeshes) {
    if (!hasLive || (noWorldlines && appMode === "build")) {
      m.visible = false;
      continue;
    }
    const kind = m.userData.kind;
    if (!kind) continue;
    // Build/Maintenance: never show time-axis crumbs (they ride the worldline stack).
    if (
      noWorldlines &&
      (kind === "pay" ||
        kind === "sms" ||
        kind === "reading" ||
        kind === "credit" ||
        kind === "sync" ||
        kind === "phase_xfer")
    ) {
      m.visible = false;
      continue;
    }
    const hideType =
      !!state.hide[kind] ||
      ((kind === "leak" || kind === "leak_clear") && state.hide.leak) ||
      (kind === "outage" && state.hide.disconnect) ||
      (kind === "lastbreath" && state.hide.disconnect) ||
      (kind === "lastbreath_lost" && state.hide.disconnect) ||
      (kind === "repair" && state.hide.disconnect) ||
      (kind === "shed" && state.hide.disconnect) ||
      (kind === "restore" && state.hide.disconnect) ||
      (kind === "knob" && state.hide.disconnect);
    const hideRoutine = state.anomalyOnly && !OPS_CRITICAL_KIND.has(kind);
    const dim = state.focus && m.userData.houseId && m.userData.houseId !== state.focus;
    m.visible = !hideType && !hideRoutine;
    if (m.material && "opacity" in m.material) {
      m.material.transparent = true;
      const base = m.userData.baseOpacity ?? (kind === "sync" ? 0.7 : 1);
      m.material.opacity = dim ? 0.18 : base;
    }
  }
  updateLeakViz();
  updateFeederHighlight();
  applyLayers();
}

/** Last basemap style before Layers → Basemap was unchecked. */
let layersBasemapPrev = "nature";

const LAYER_SCENE_MESH = {
  poles: () => [poleMesh, ...(infraDetailByLayer.poles || [])],
  lines: () => [powerLineMesh],
  homes: () => [hutMesh, roofMesh, pvMesh, windowMesh, homeBattMesh, ...(infraDetailByLayer.homes || [])],
  ems: () => [emsMesh, emsPvMesh, ...(infraDetailByLayer.ems || [])],
  xfmr: () => [xfmrMesh, ...(infraDetailByLayer.xfmr || [])],
  station: () => stationMeshes,
  breakers: () => [breakerMesh],
  lamps: () => [streetLampMesh],
};

const UN_KEY_TO_GROUP = {
  un_structure: "structure",
  un_device: "device",
  un_junction: "junction",
  un_line: "line",
  un_subnetwork: "subnetwork",
};

/** Procedural scene stand-ins so Open UN solo focus is never an empty void. */
const UN_KEY_TO_SCENE = {
  un_structure: ["poles"],
  un_device: ["ems", "xfmr", "breakers"],
  un_junction: ["poles"],
  un_line: ["lines"],
  un_subnetwork: ["station", "lines"],
};

function setMeshVisible(mesh, on) {
  if (!mesh) return;
  if (Array.isArray(mesh)) {
    for (const m of mesh) if (m) m.visible = !!on;
    return;
  }
  mesh.visible = !!on;
}

function isLightTheme() {
  return document.documentElement.getAttribute("data-theme") === "light";
}

function setMeshHighlight(mesh, mode) {
  // mode: 'full' | 'soft' | 'dim' | 'hot' | 'gone'
  if (!mesh) return;
  const list = Array.isArray(mesh) ? mesh : [mesh];
  for (const m of list) {
    if (!m?.material) continue;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (!mat) continue;
      if (!mat.userData) mat.userData = {};
      if (mat.userData._hlBaseOp == null) mat.userData._hlBaseOp = mat.opacity ?? 1;
      if (mat.userData._hlBaseEmInt == null && "emissiveIntensity" in mat) {
        mat.userData._hlBaseEmInt = mat.emissiveIntensity ?? 0;
      }
      mat.transparent = true;
      if (mode === "gone") {
        mat.opacity = 0;
        if (mat.emissive) mat.emissive.setHex(0x000000);
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0;
      } else if (mode === "dim") {
        mat.opacity = 0.04;
        if (mat.emissive) mat.emissive.setHex(0x000000);
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0;
      } else if (mode === "soft") {
        mat.opacity = Math.min(mat.userData._hlBaseOp, 0.38);
        if (mat.emissive) mat.emissive.setHex(0x000000);
        if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0;
      } else if (mode === "hot") {
        mat.opacity = 1;
        if (mat.emissive) {
          mat.emissive.setHex(isLightTheme() ? 0x2f6b14 : 0x7cff3a);
          if ("emissiveIntensity" in mat) mat.emissiveIntensity = isLightTheme() ? 0.55 : 0.95;
        }
      } else {
        mat.opacity = mat.userData._hlBaseOp;
        if (mat.emissive) mat.emissive.setHex(0x000000);
        if ("emissiveIntensity" in mat) {
          mat.emissiveIntensity = mat.userData._hlBaseEmInt ?? 0;
        }
      }
    }
  }
}

/** Theme-solid backdrop so focused layer reads alone (covers MapLibre bleed). */
let layerSoloVeil = null;

function ensureLayerSoloVeil() {
  if (layerSoloVeil || !scene) return layerSoloVeil;
  const geo = new THREE.SphereGeometry(900, 24, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x0a0a0c,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  layerSoloVeil = new THREE.Mesh(geo, mat);
  layerSoloVeil.name = "layer-solo-veil";
  layerSoloVeil.renderOrder = -20;
  layerSoloVeil.frustumCulled = false;
  layerSoloVeil.visible = false;
  scene.add(layerSoloVeil);
  return layerSoloVeil;
}

/** Cover MapLibre bleed with soft mid-tone (never void black). */
function setFocusBackdrop(on) {
  const stage = document.getElementById("wl-stage");
  if (!scene) return;
  const light = isLightTheme();
  stage?.classList.remove(
    "layer-solo",
    "layer-solo-light",
    "layer-solo-dark",
    "focus-soft",
    "focus-soft-light",
    "focus-soft-dark",
    "use-class-soft",
    "use-class-soft-light",
    "use-class-soft-dark",
  );
  if (!on) {
    scene.background = null;
    if (layerSoloVeil) layerSoloVeil.visible = false;
    return;
  }
  const hex = light ? 0xd4d0c4 : 0x18181e;
  scene.background = new THREE.Color(hex);
  const veil = ensureLayerSoloVeil();
  if (veil) {
    veil.material.color.setHex(hex);
    veil.visible = true;
  }
  stage?.classList.add("focus-soft", light ? "focus-soft-light" : "focus-soft-dark");
}

function setLayerSoloBackdrop(on) {
  if (on) setFocusBackdrop(true);
  else if (appMode === "productive" && state.activeUseClass) setFocusBackdrop(true);
  else if (appMode === "energy" && state.activeEnergyClass) setFocusBackdrop(true);
  else setFocusBackdrop(false);
}

/** Hide ops / time clutter while a layer is solo-focused. */
function setOpsClutterVisible(on) {
  if (on) return; // restore happens in applyVisibility before applyLayers
  if (worldlineMesh) worldlineMesh.visible = false;
  if (readingMesh) readingMesh.visible = false;
  if (knobMesh) knobMesh.visible = false;
  if (nowPlane) nowPlane.visible = false;
  if (winBand) winBand.visible = false;
  if (pastBand) pastBand.visible = false;
  if (futBand) futBand.visible = false;
  if (sprWin) sprWin.visible = false;
  if (sprPast) sprPast.visible = false;
  if (sprFut) sprFut.visible = false;
  if (feederPickMesh) feederPickMesh.visible = false;
  if (sky) sky.visible = false;
  if (sunBead) sunBead.visible = false;
  if (groundMesh) groundMesh.visible = false;
  for (const m of rfFloorMeshes) m.visible = false;
  for (const m of eventMeshes) m.visible = false;
  for (const m of leakMeshes) m.visible = false;
  for (const p of dtmParts) {
    if (p?.body) p.body.visible = false;
    if (p?.lid) p.lid.visible = false;
  }
  for (const b of dtmBars) if (b) b.visible = false;
  for (const g of Object.values(feederBufById)) if (g) g.visible = false;
}

/** Hide untracked scene junk (civic props, orphan batches) during solo focus. */
function applySoloOrphanCull(solo, keepRoots, allowBuild) {
  if (!scene) return;
  if (!solo) {
    scene.traverse((o) => {
      if (o.userData) delete o.userData._soloPrevVis;
    });
    return;
  }
  const keep = new Set();
  for (const root of keepRoots) {
    if (!root) continue;
    keep.add(root);
    root.traverse?.((c) => keep.add(c));
  }
  if (layerSoloVeil) keep.add(layerSoloVeil);

  scene.traverse((o) => {
    if (
      !(
        o.isMesh ||
        o.isInstancedMesh ||
        o.isLine ||
        o.isLineSegments ||
        o.isSprite ||
        o.isPoints
      )
    ) {
      return;
    }
    if (keep.has(o)) return;
    if (allowBuild) {
      let p = o.parent;
      while (p) {
        if (p.name === "build-layer") return;
        p = p.parent;
      }
    }
    if (!o.userData) o.userData = {};
    if (o.userData._soloPrevVis == null) o.userData._soloPrevVis = o.visible;
    o.visible = false;
  });
}

function applyLayerHighlight() {
  const active = state.activeLayer;
  const sceneKeys = Object.keys(LAYER_SCENE_MESH);
  const highlightingScene = !!(active && sceneKeys.includes(active));
  const highlightingUn = !!(active && UN_KEY_TO_GROUP[active]);
  const highlightingBuild = active === "build";
  const solo = highlightingScene || highlightingUn || highlightingBuild;
  const companion = new Set(highlightingUn ? UN_KEY_TO_SCENE[active] || [] : []);

  setLayerSoloBackdrop(solo);

  if (!solo) {
    for (const key of sceneKeys) {
      setMeshHighlight(LAYER_SCENE_MESH[key]() || [], "full");
    }
    buildMode?.setHighlightGroup?.(null);
    applySoloOrphanCull(false, [], false);
    // Productive / Energy class focus: soft plant dim + mid-tone veil (map covered).
    if (appMode === "productive" && state.activeUseClass) applyUseClassSceneDim();
    else if (appMode === "energy" && state.activeEnergyClass) applyEnergyClassPlantDim();
    else setFocusBackdrop(false);
    return;
  }

  // Soft solo: focused layer hot; rest soft-dim + still visible (no void black).
  for (const key of sceneKeys) {
    const meshes = LAYER_SCENE_MESH[key]() || [];
    const show =
      (highlightingScene && key === active) || (highlightingUn && companion.has(key));
    if (show) setMeshHighlight(meshes, "hot");
    else setMeshHighlight(meshes, "soft");
  }

  setOpsClutterVisible(false);

  if (highlightingUn) {
    buildMode?.setOverlayVisible?.(true);
    const g = UN_KEY_TO_GROUP[active];
    for (const group of Object.values(UN_KEY_TO_GROUP)) {
      buildMode?.setAssetGroupVisible?.(group, group === g);
    }
    buildMode?.setHighlightGroup?.(g);
  } else if (highlightingBuild) {
    buildMode?.setOverlayVisible?.(true);
    for (const group of Object.values(UN_KEY_TO_GROUP)) {
      buildMode?.setAssetGroupVisible?.(group, true);
    }
    buildMode?.setHighlightGroup?.("__all__");
  } else {
    // Scene layer focus — park BUILD overlay so it does not compete.
    buildMode?.setOverlayVisible?.(false);
    buildMode?.setHighlightGroup?.(null);
  }

  // No hard orphan cull — that emptied the scene into black.
  applySoloOrphanCull(false, [], false);
}

function hideSchematicMeshes() {
  if (demoVillageRoot) demoVillageRoot.visible = false;
  const off = [
    hutMesh, roofMesh, pvMesh, homeBattMesh, poleMesh, powerLineMesh,
    xfmrMesh, emsMesh, emsPvMesh, breakerMesh, feederPickMesh,
    groundMesh, windowMesh, streetLampMesh,
    houseHalo, emsHalo, pvFarmSpr,
  ];
  for (const m of off) if (m) m.visible = false;
  for (const m of stationMeshes || []) if (m) m.visible = false;
  for (const g of Object.values(feederBufById || {})) if (g) g.visible = false;
  for (const arr of Object.values(infraDetailByLayer || {})) {
    for (const m of arr || []) if (m) m.visible = false;
  }
  for (const m of compassMeshes) m.visible = false;
  for (const s of compassSprites) s.visible = false;
  if (packLayer?.root) packLayer.root.visible = false;
  productiveUseApi?.setVisible?.(false);
  energyAssetsApi?.setVisible?.(false);
}

/** Reparent demo plant (roads, clinic, BESS, water, DTMs, …) under one hide switch. */
function gatherDemoVillage() {
  if (!demoVillageRoot || !scene) return;
  const keep = new Set([
    demoVillageRoot,
    ambientLight,
    hemiLight,
    sunLight,
    sunLight?.target,
    fillLight,
    fillLight?.target,
    moonLight,
    moonLight?.target,
    sunMesh,
    sky,
    timeGroup,
    sprWin,
    sprPast,
    sprFut,
    nowMark,
  ]);
  for (const l of civicLights) keep.add(l);
  for (const m of eventMeshes) keep.add(m);
  for (const m of rfFloorMeshes) keep.add(m);
  for (const m of spineMeshes) keep.add(m);
  for (const child of [...scene.children]) {
    if (!child || keep.has(child)) continue;
    if (child.isLight) continue;
    if (child.name === "build-layer" || child.name === "demo-village") continue;
    demoVillageRoot.add(child);
  }
}

function applyLayers() {
  const L = state.layers || {};
  if (emptyCanvas) {
    hideSchematicMeshes();
    const showBuild = L.build !== false || appMode === "productive" || appMode === "energy";
    buildMode?.setOverlayVisible?.(showBuild);
    if (showBuild) {
      buildMode?.setAssetGroupVisible?.("structure", L.un_structure !== false);
      buildMode?.setAssetGroupVisible?.("device", L.un_device !== false);
      buildMode?.setAssetGroupVisible?.("junction", appMode === "productive" || L.un_junction !== false);
      buildMode?.setAssetGroupVisible?.("line", L.un_line !== false);
      buildMode?.setAssetGroupVisible?.("subnetwork", L.un_subnetwork !== false);
    }
    applyLayerHighlight();
    const basemapEl = document.getElementById("wl-basemap");
    if (basemapEl && L.basemap === false && basemapEl.value !== "none") {
      layersBasemapPrev = basemapEl.value || layersBasemapPrev;
      basemapEl.value = "none";
      basemapEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  setMeshVisible(poleMesh, L.poles !== false);
  setMeshVisible(infraDetailByLayer.poles, L.poles !== false);
  setMeshVisible(powerLineMesh, L.lines !== false);
  if (packLayer) {
    packLayer.linesG.visible = L.lines !== false;
    packLayer.polesG.visible = L.poles !== false;
    packLayer.devicesG.visible = L.station !== false;
  }
  setMeshVisible(hutMesh, L.homes !== false);
  setMeshVisible(roofMesh, L.homes !== false);
  setMeshVisible(pvMesh, L.homes !== false);
  setMeshVisible(homeBattMesh, L.homes !== false);
  setMeshVisible(infraDetailByLayer.homes, L.homes !== false);
  if (windowMesh) windowMesh.visible = L.homes !== false && state.light === "lamps";
  if (streetLampMesh) streetLampMesh.visible = L.lamps !== false && state.light === "lamps";
  setMeshVisible(emsMesh, L.ems !== false);
  setMeshVisible(emsPvMesh, L.ems !== false);
  setMeshVisible(infraDetailByLayer.ems, L.ems !== false);
  setMeshVisible(xfmrMesh, L.xfmr !== false);
  setMeshVisible(infraDetailByLayer.xfmr, L.xfmr !== false);
  setMeshVisible(stationMeshes, L.station !== false);
  setMeshVisible(breakerMesh, L.breakers !== false && (state.scheme === "asset" || appMode === "build"));

  buildMode?.setOverlayVisible?.(L.build !== false);
  if (L.build !== false) {
    buildMode?.setAssetGroupVisible?.("structure", L.un_structure !== false);
    buildMode?.setAssetGroupVisible?.("device", L.un_device !== false);
    buildMode?.setAssetGroupVisible?.("junction", L.un_junction !== false);
    buildMode?.setAssetGroupVisible?.("line", L.un_line !== false);
    buildMode?.setAssetGroupVisible?.("subnetwork", L.un_subnetwork !== false);
  }

  const basemapEl = document.getElementById("wl-basemap");
  if (basemapEl) {
    if (L.basemap === false) {
      if (basemapEl.value !== "none") {
        layersBasemapPrev = basemapEl.value || layersBasemapPrev;
        basemapEl.value = "none";
        basemapEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else if (basemapEl.value === "none" && layersBasemapPrev && layersBasemapPrev !== "none") {
      basemapEl.value = layersBasemapPrev;
      basemapEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  if (candidateOverlay && L.candidates === false) {
    candidateOverlay.setVisible(false);
  }

  applyLayerHighlight();
}

function selectLayer(layerId) {
  const next = state.activeLayer === layerId ? null : layerId;
  state.activeLayer = next;
  const unGroup = next ? UN_KEY_TO_GROUP[next] : null;
  if (unGroup) {
    if (appMode !== "build") applyAppMode("build");
    buildMode?.setPlaceGroupFilter?.(unGroup);
    state.layers[next] = true;
    state.layers.build = true;
  } else {
    buildMode?.setPlaceGroupFilter?.(null);
  }
  applyLayers();
  const panel = document.getElementById("wl-layers-panel");
  if (panel && layersPanelOpen()) paintLayersPanel();
  const hint = document.getElementById("wl-build-hint");
  if (hint && (appMode === "build" || unGroup)) {
    if (!state.activeLayer) hint.textContent = "Layer selection cleared";
    else if (unGroup) hint.textContent = `Editing UN · ${unGroup} — place / click assets · UID in right panel`;
    else hint.textContent = `Layer focused: ${state.activeLayer}`;
  }
}

function paintLayersPanel() {
  const body = document.getElementById("wl-layers-body");
  if (!body) return;

  const SCENE = [
    { key: "basemap", label: "Basemap", file: "MapLibre style (Nature / map / …)" },
    { key: "candidates", label: "Africa candidates", file: "data/africa-minigrid-candidates.geojson" },
    { key: "poles", label: "Poles / structures", file: "scene poles" },
    { key: "lines", label: "Conductors", file: "LV / secondary spans" },
    { key: "homes", label: "Homes + meters", file: "service points" },
    { key: "ems", label: "EMS cabinets", file: "MeshEMS" },
    { key: "xfmr", label: "Transformers", file: "pole xfmr" },
    { key: "station", label: "Station", file: "island head" },
    { key: "breakers", label: "Breakers", file: "feeder protection" },
    { key: "lamps", label: "Street lamps", file: "when Light: lamps" },
    { key: "build", label: "BUILD overlay", file: "placed assets" },
  ];
  const UN = [
    { key: "un_structure", label: "Structure", file: "network/structure.geojson" },
    { key: "un_device", label: "Electric devices", file: "network/electric-devices.geojson" },
    { key: "un_junction", label: "Electric junctions", file: "network/electric-junctions.geojson" },
    { key: "un_line", label: "Electric lines", file: "network/electric-lines.geojson" },
    { key: "un_subnetwork", label: "Subnetworks", file: "network/subnetworks.geojson" },
  ];
  const OPS = [
    { hide: "leak", label: "Leakage", file: "ΔP spans" },
    { hide: "disconnect", label: "Cutoffs / faults", file: "disconnect + outage" },
    { hide: "pay", label: "Payments", file: "prepaid" },
    { hide: "sms", label: "SMS tokens", file: "token events" },
    { hide: "worldline", label: "Worldlines", file: "time stack" },
    { hide: "reading", label: "Readings", file: "meter crumbs" },
    { hide: "rf", label: "RF mesh", file: "NAN floor" },
  ];

  function rowHtml(id, checked, label, file, selectable) {
    const active = state.activeLayer === id ? " is-active" : "";
    const pick = selectable
      ? `<button type="button" class="wl-layers-pick" data-select-layer="${esc(id)}">${esc(label)}<code>${esc(file)}</code></button>`
      : `<span>${esc(label)}<code>${esc(file)}</code></span>`;
    const rowSel = selectable ? ` data-select-layer="${esc(id)}"` : "";
    return `<div class="wl-layers-row${active}"${rowSel} role="${selectable ? "menuitem" : "presentation"}">
      <input type="checkbox" data-layer-id="${esc(id)}" ${checked ? "checked" : ""} title="Visibility" />
      ${pick}
    </div>`;
  }

  const parts = [];
  parts.push(`<div class="wl-layers-sec">Map &amp; scene</div>`);
  parts.push(`<p class="wl-layers-note">Checkbox = show/hide. Click name = select + highlight (edit when UN).</p>`);
  for (const L of SCENE) {
    const selectable = !["basemap", "candidates"].includes(L.key);
    parts.push(rowHtml(L.key, state.layers[L.key] !== false, L.label, L.file, selectable));
  }
  parts.push(`<div class="wl-layers-sec">Open UN (BUILD overlay)</div>`);
  for (const L of UN) {
    parts.push(rowHtml(L.key, state.layers[L.key] !== false, L.label, L.file, true));
  }
  parts.push(`<div class="wl-layers-sec">Ops overlays</div>`);
  for (const L of OPS) {
    const on = !state.hide[L.hide];
    parts.push(rowHtml(`hide:${L.hide}`, on, L.label, L.file, false));
  }

  // Edit strip for active layer
  const active = state.activeLayer;
  if (active && !String(active).startsWith("hide:")) {
    const unGroup = UN_KEY_TO_GROUP[active];
    const meta =
      SCENE.find((x) => x.key === active) ||
      UN.find((x) => x.key === active);
    parts.push(`<div class="wl-layers-edit">`);
    parts.push(`<h3>${esc(meta?.label || active)}</h3>`);
    if (unGroup) {
      const items = buildMode?.listByGroup?.(unGroup) || [];
      const sel = buildMode?.getSelectedAssetId?.();
      const sceneHint = (UN_KEY_TO_SCENE[active] || []).join(", ") || "none";
      parts.push(
        `<p>Selected for edit · ${items.length} BUILD asset(s). Scene stand-in: ${esc(sceneHint)}. Place with BUILD tools (filtered). Click row → UID panel.</p>`,
      );
      parts.push(`<div class="wl-layers-edit-actions">
        <button type="button" data-layer-act="clear">Clear selection</button>
        <button type="button" data-layer-act="build">Open BUILD mode</button>
      </div>`);
      if (items.length) {
        parts.push(`<ul class="wl-layers-assets">`);
        for (const rec of items.slice(0, 40)) {
          const on = sel === rec.id ? " is-on" : "";
          const uid = rec.uid ? ` · ${esc(rec.uid)}` : " · no UID";
          parts.push(`<li><button type="button" class="${on.trim()}" data-edit-asset="${esc(rec.id)}">
            ${esc(rec.assetClass)} <span class="meta">${esc(rec.id)}${uid}</span>
          </button></li>`);
        }
        parts.push(`</ul>`);
      } else {
        parts.push(`<p>No placed assets yet — use Dist run / palette while this layer is selected.</p>`);
      }
    } else if (active === "build") {
      const n = buildMode?.getPlaced?.()?.length || 0;
      parts.push(`<p>Whole BUILD overlay (${n} assets). Pick an Open UN class below to filter + edit.</p>`);
      parts.push(`<div class="wl-layers-edit-actions"><button type="button" data-layer-act="clear">Clear selection</button></div>`);
    } else {
      parts.push(`<p>Scene layer highlighted. Procedural mesh — edit via BUILD overlay / Dist run for pack assets.</p>`);
      parts.push(`<div class="wl-layers-edit-actions"><button type="button" data-layer-act="clear">Clear selection</button></div>`);
    }
    parts.push(`</div>`);
  }

  body.innerHTML = parts.join("");
}

function layersPanelOpen() {
  return !!document.getElementById("wl-theater")?.classList.contains("layers-open");
}

function bindLayersMenu() {
  const rail = document.getElementById("wl-layers-rail");
  const panel = document.getElementById("wl-layers-panel");
  const closeBtn = document.getElementById("wl-layers-close");
  const theater = document.getElementById("wl-theater");
  if (!rail || !panel || !theater) return;

  // Theme flip → refresh solo backdrop + hot colors.
  if (!bindLayersMenu._themeWatch) {
    bindLayersMenu._themeWatch = true;
    const mo = new MutationObserver(() => {
      if (state.activeLayer) applyLayerHighlight();
      else if (appMode === "productive" && state.activeUseClass) applyUseClassPlantDim();
      else if (appMode === "energy" && state.activeEnergyClass) applyEnergyClassPlantDim();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function setLayersOpen(open) {
    theater.classList.toggle("layers-open", !!open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    rail.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) paintLayersPanel();
    // Workspace width changes — resize during + after slide.
    requestAnimationFrame(() => {
      resize();
      window.setTimeout(resize, 240);
    });
  }

  function closeLayers() {
    setLayersOpen(false);
  }

  rail.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById("wl-file-drop")?.setAttribute("hidden", "");
    document.getElementById("wl-file-btn")?.setAttribute("aria-expanded", "false");
    setLayersOpen(!layersPanelOpen());
  });

  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLayers();
  });

  panel.addEventListener("click", (e) => {
    e.stopPropagation();
    // Checkbox owns visibility; do not treat as layer select.
    if (e.target.closest("input[data-layer-id]")) return;
    if (e.target.closest("[data-layer-act]") || e.target.closest("[data-edit-asset]")) {
      /* handled below */
    } else {
      const pick = e.target.closest("[data-select-layer]");
      if (pick) {
        e.preventDefault();
        selectLayer(pick.getAttribute("data-select-layer"));
        return;
      }
    }
    const clear = e.target.closest("[data-layer-act='clear']");
    if (clear) {
      if (state.activeLayer) selectLayer(state.activeLayer); // toggle off
      return;
    }
    const toBuild = e.target.closest("[data-layer-act='build']");
    if (toBuild) {
      if (appMode !== "build") applyAppMode("build");
      return;
    }
    const assetBtn = e.target.closest("[data-edit-asset]");
    if (assetBtn) {
      const id = assetBtn.getAttribute("data-edit-asset");
      if (appMode !== "build") applyAppMode("build");
      buildMode?.selectAsset?.(id);
      buildMode?.setHighlightGroup?.(UN_KEY_TO_GROUP[state.activeLayer] || null);
      fillBuildPanel();
      paintLayersPanel();
      document.getElementById("wl-build-cfg-uid")?.focus?.();
    }
  });

  panel.addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-layer-id]");
    if (!inp) return;
    const id = inp.getAttribute("data-layer-id");
    const on = inp.checked;
    if (id.startsWith("hide:")) {
      const k = id.slice(5);
      state.hide[k] = !on;
      document.querySelectorAll(`[data-hide="${k}"]`).forEach((b) => b.classList.toggle("off", !on));
      applyVisibility();
      return;
    }
    state.layers[id] = on;
    applyLayers();
  });

  // Panel stays open until rail / × — no outside-click dismiss.

  const basemapEl = document.getElementById("wl-basemap");
  basemapEl?.addEventListener("change", () => {
    if (basemapEl.value && basemapEl.value !== "none") {
      layersBasemapPrev = basemapEl.value;
      state.layers.basemap = true;
    } else {
      state.layers.basemap = false;
    }
    if (layersPanelOpen()) paintLayersPanel();
  });
}

function geoidBlocksForScope(scope) {
  const s = scope || state.scope || { kind: "village" };
  const hid = s.kind === "house" ? s.id : s.houseId;
  if (hid && houseById[hid]) {
    const h = houseById[hid];
    return {
      label: `home ${h.name} · ${h.id}`,
      blocks: [
        geoidBlock(h.id, "house", h.x, h.z, HANG.ground, {
          name: h.name,
          feederId: h.feederId,
          boardId: h.boardId,
          xfmrId: h.xfmrId,
        }),
      ],
    };
  }
  const bid = s.kind === "board" ? s.id : s.boardId;
  if (bid && boardById[bid] && !hid) {
    const b = boardById[bid];
    const homes = liveHouses.filter((h) => h.boardId === b.id);
    return {
      label: `${b.label} · ${homes.length} meters`,
      blocks: [
        geoidBlock(b.id, "ems", b.x, b.z, HANG.ems, { feederId: b.feederId, xfmrId: b.xfmrId }),
        ...homes.map((h) =>
          geoidBlock(h.id, "house", h.x, h.z, HANG.ground, { name: h.name, boardId: h.boardId }),
        ),
      ],
    };
  }
  if (s.kind === "feeder" && s.id) {
    const f = liveFeeders.find((x) => x.id === s.id);
    if (!f) return { label: "feeder missing", blocks: [] };
    const homes = liveHouses.filter((h) => h.feederId === f.id);
    const poles = POLES.filter((p) => p.feederId === f.id);
    const xfmrs = TRANSFORMERS.filter((t) => t.feederId === f.id);
    const boards = liveBoards.filter((b) => b.feederId === f.id);
    const dtm = liveDtms.find((d) => d.feederId === f.id);
    const blocks = [
      geoidBlock(f.id, "feeder", f.x, f.z, HANG.pole, { label: f.label, cluster: f.cluster }),
    ];
    if (dtm) blocks.push(geoidBlock(dtm.id, "dtm", dtm.x, dtm.z, HANG.dtm, { label: dtm.label }));
    poles.forEach((p, i) =>
      blocks.push(geoidBlock(`${f.id}-pole-${i}`, "pole", p.x, p.z, HANG.pole, { feederId: f.id })),
    );
    for (const t of xfmrs) {
      blocks.push(geoidBlock(t.id, "xfmr", t.x, t.z, HANG.xfmr, { label: t.label, n: t.n }));
    }
    for (const b of boards) {
      blocks.push(geoidBlock(b.id, "ems", b.x, b.z, HANG.ems, { label: b.label, n: b.houseIds.length }));
    }
    for (const h of homes) {
      blocks.push(
        geoidBlock(h.id, "house", h.x, h.z, HANG.ground, {
          name: h.name,
          boardId: h.boardId,
          xfmrId: h.xfmrId,
        }),
      );
    }
    return { label: `${f.label} · ${blocks.length} pts`, blocks };
  }
  if (s.kind === "station") {
    const st = STATIONS.find((x) => x.id === s.id) || STATIONS[0];
    const xf = LANDMARKS.xfmr;
    const gen = LANDMARKS.gen;
    return {
      label: st?.label || "Village station",
      blocks: [
        geoidBlock("gen", "gen", gen.x, gen.z, HANG.ground, { label: gen.label }),
        geoidBlock(st?.id || "st-main", "station", xf.x, xf.z, HANG.xfmr, { label: xf.label }),
        ...liveFeeders.map((f) => geoidBlock(f.id, "feeder", f.x, f.z, HANG.pole, { label: f.label })),
      ],
    };
  }
  return {
    label: "village",
    blocks: [
      geoidBlock("gen", "gen", LANDMARKS.gen.x, LANDMARKS.gen.z, HANG.ground, { label: LANDMARKS.gen.label }),
      geoidBlock("xfmr-main", "station", LANDMARKS.xfmr.x, LANDMARKS.xfmr.z, HANG.xfmr, {
        label: LANDMARKS.xfmr.label,
      }),
    ],
  };
}

function fillGeoid() {
  const sub = document.getElementById("wl-geoid-sub");
  const pre = document.getElementById("wl-geoid-json");
  if (!pre) return;
  const { label, blocks } = geoidBlocksForScope(state.scope);
  const fc = geoidCollection(blocks, label);
  if (sub) {
    sub.textContent = `${label} · ${blocks.length} feature${blocks.length === 1 ? "" : "s"}`;
  }
  pre.textContent = JSON.stringify(fc, null, 2);
}

function normalizeScope(scope) {
  const raw = scope && scope.kind ? { ...scope } : { kind: "village" };
  if (raw.kind === "house") {
    const h = houseById[raw.id];
    if (!h) return { kind: "village" };
    return { kind: "feeder", id: h.feederId, houseId: h.id, boardId: h.boardId };
  }
  if (raw.kind === "board") {
    const b = boardById[raw.id];
    if (!b) return { kind: "village" };
    return { kind: "feeder", id: b.feederId, boardId: b.id };
  }
  if (raw.kind === "feeder") {
    const houseId = raw.houseId || null;
    const boardId = raw.boardId || (houseId && houseById[houseId]?.boardId) || null;
    return { kind: "feeder", id: raw.id, houseId, boardId };
  }
  return raw;
}

function setScope(scope, opts = {}) {
  if (state.role === "customer") {
    state.scope = { kind: "house", id: state.you };
    state.focus = state.you;
    state.scopeBoard = houseById[state.you]?.boardId || null;
    applyVisibility();
    colorPowerLines();
    fillHouses();
    fillGeoid();
    return;
  }
  const prevFocus = state.focus;
  const prevBoard = state.scopeBoard;
  const next = normalizeScope(scope);
  state.scope = next;
  if (next.kind === "feeder") {
    state.focus = next.houseId || null;
    state.scopeBoard = next.boardId || (state.focus && houseById[state.focus]?.boardId) || null;
  } else if (next.kind === "house") {
    state.focus = next.id;
    state.scopeBoard = houseById[next.id]?.boardId || null;
  } else {
    state.focus = null;
    state.scopeBoard = null;
  }
  if (!opts.fromEms) {
    if (state.role === "tech" && scope?.kind === "board" && state.scopeBoard) {
      openEms(state.scopeBoard, !!opts.fly);
    } else if (state.role !== "tech" || next.kind === "village") {
      closeEms();
    }
  }
  applyVisibility();
  colorPowerLines();
  if (emptyCanvas && appMode !== "build") {
    const run = next.kind === "feeder" ? liveFeeders.find((f) => f.id === next.id) : null;
    if (run?.runId) buildMode?.selectRun?.(run.runId);
    else if (next.kind === "village") buildMode?.selectRun?.(null);
  }
  fillHouses(true);
  fillGeoid();
  writeQuery({
    feeder: next.kind === "feeder" ? next.id : "",
    board: state.emsId || "",
  });
  syncFeederSelect();
  if (opts.cam) progressCamera(next, { ...opts, prevFocus, prevBoard });
}

function pickList() {
  const leaks = leakMeshes.filter((m) => m.visible && m.userData.leakLayer !== "label");
  const list = [...leaks, hutMesh, roofMesh];
  if (emsMesh) list.push(emsMesh);
  if (emsPvMesh) list.push(emsPvMesh);
  if (xfmrMesh) list.push(xfmrMesh);
  if (poleMesh) list.push(poleMesh);
  if (powerLineMesh) list.push(powerLineMesh);
  if (feederPickMesh) list.push(feederPickMesh);
  if (breakerMesh && breakerMesh.visible) list.push(breakerMesh);
  for (const g of Object.values(feederBufById)) {
    if (g.visible) list.push(...g.children);
  }
  for (const o of scene.children) {
    if (o.userData.houseId || (o.userData.scope && !o.userData.leakId)) list.push(o);
  }
  return list.filter(Boolean);
}

function preferLeakHit(hits) {
  if (!hits.length) return null;
  const closest = hits[0].distance;
  const leak = hits.find((h) => h.object.userData.leakId && h.distance <= closest + 3.4);
  return leak || hits[0];
}

function scopeFromHit(hit) {
  if (!hit) return { kind: "village" };
  const o = hit.object;
  const i = hit.instanceId;
  if (o.userData.leakId) {
    const lk = liveLeaks.find((x) => x.id === o.userData.leakId);
    return lk ? leakScope(lk) : { kind: "village" };
  }
  if (o.userData.pickHuts && i != null) {
    const h = liveHouses[i];
    return h ? { kind: "house", id: h.id } : { kind: "village" };
  }
  if (o.userData.houseId) return { kind: "house", id: o.userData.houseId };
  if (o.userData.pickBoards && i != null) {
    const b = liveBoards[i];
    return b ? { kind: "board", id: b.id } : { kind: "village" };
  }
  if (o.userData.pickXfmr && i != null) {
    const t = TRANSFORMERS[i];
    if (!t) return { kind: "village" };
    const nb = nearestBoardOnFeeder(t.feederId, t.x, t.z);
    return { kind: "feeder", id: t.feederId, boardId: nb?.id || null };
  }
  if (o.userData.pickPoles && i != null) return polePick[i] || { kind: "village" };
  if (o.userData.pickBreakers && i != null) return breakerPick[i] || { kind: "village" };
  if (o.userData.pickLines && i != null) {
    const s = lvSegMeta[Math.floor(i / WIRE_STEPS)];
    if (s?.houseId) return { kind: "house", id: s.houseId };
    if (s?.feederId) {
      const mx = (s.a.x + s.b.x) / 2;
      const mz = (s.a.z + s.b.z) / 2;
      const nb = nearestBoardOnFeeder(s.feederId, mx, mz);
      return { kind: "feeder", id: s.feederId, boardId: nb?.id || null };
    }
    return STATIONS[0] ? { kind: "station", id: STATIONS[0].id } : { kind: "village" };
  }
  if (o.userData.pickFeeders && i != null) {
    const s = o.userData.pickSegs?.[i];
    if (s?.feederId) return { kind: "feeder", id: s.feederId };
  }
  if (o.userData.scope) return o.userData.scope;
  return { kind: "village" };
}

function abortCamFly() {
  locusMap?.map.stop();
  if (!camFly) return;
  camFly = null;
  if (controls) {
    controls.enabled = true;
    controls.enableDamping = true;
  }
}

function distPointSeg2(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const ab2 = abx * abx + abz * abz;
  const t = ab2 < 1e-8 ? 0 : Math.max(0, Math.min(1, (apx * abx + apz * abz) / ab2));
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return dx * dx + dz * dz;
}

function nearestScopeAt(x, z, maxD = 2.6) {
  let best = null;
  let bestD = maxD * maxD;
  const consider = (d2, scope, weight = 1) => {
    const score = d2 / weight;
    if (score < bestD) {
      bestD = score;
      best = scope;
    }
  };
  // Prefer meters / EMS over long feeder lines when distances are close.
  for (const h of liveHouses) consider((h.x - x) ** 2 + (h.z - z) ** 2, { kind: "house", id: h.id }, 1.35);
  for (const b of liveBoards) consider((b.x - x) ** 2 + (b.z - z) ** 2, { kind: "board", id: b.id }, 1.25);
  for (const t of TRANSFORMERS) consider((t.x - x) ** 2 + (t.z - z) ** 2, { kind: "feeder", id: t.feederId }, 1.1);
  for (const f of liveFeeders) consider((f.x - x) ** 2 + (f.z - z) ** 2, { kind: "feeder", id: f.id });
  for (const p of POLES) {
    if (p.feederId) consider((p.x - x) ** 2 + (p.z - z) ** 2, { kind: "feeder", id: p.feederId });
  }
  for (const s of GRID_SEGS) {
    if (!s.feederId) continue;
    consider(distPointSeg2(x, z, s.ax, s.az, s.bx, s.bz), { kind: "feeder", id: s.feederId }, 0.85);
  }
  for (const lk of liveLeaks) consider((lk.x - x) ** 2 + (lk.z - z) ** 2, leakScope(lk), 1.15);
  return best || { kind: "village" };
}

function bindStagePick() {
  const map = locusMap.map;

  // MapLibre: left-drag pan, right-drag rotate, wheel zoom. App: click → hop.
  const enableGestures = () => {
    map.dragPan.enable();
    map.dragRotate.enable();
    map.touchPitch?.enable?.();
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();
    map.keyboard.disable(); // WASD via panLook
    map.boxZoom.disable();
    map.doubleClickZoom.enable();
    map.resize();
  };
  enableGestures();

  const canvas = map.getCanvas();
  /** Right-drag rotates map — only open pole menu on a click (little movement). */
  let rightPtr = /** @type {{ x: number, y: number } | null} */ (null);
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 2) rightPtr = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (buildMode?.isActive()) buildMode.handleMapMove?.(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.button !== 2) return;
    // keep rightPtr until contextmenu
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const start = rightPtr;
    rightPtr = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
    if (buildMode?.isActive() && buildMode.handleMapContextMenu(e.clientX, e.clientY)) return;
  });

  const onMapClick = (event) => {
    if (event.originalEvent?.defaultPrevented) return;
    const rect = canvas.getBoundingClientRect();
    const pt = event.point || { x: event.clientX - rect.left, y: event.clientY - rect.top };
    applyPickOnce(rect.left + pt.x, rect.top + pt.y);
  };
  map.on("click", onMapClick);
  // Backup: container height bugs can swallow MapLibre click; canvas still gets DOM clicks.
  canvas.addEventListener("click", (e) => {
    if (e.detail === 0) return; // ignore synthetic non-user
    applyPickOnce(e.clientX, e.clientY);
  });

  map.on("style.load", enableGestures);
  map.on("moveend", syncThreeCamFromMap);
  syncThreeCamFromMap();
}

/** Keep legacy camera/controls pose aligned with the visible MapLibre view. */
function syncThreeCamFromMap() {
  if (!locusMap || !camera || !controls) return;
  const v = locusMap.camera.getView();
  const tx = v.x / GROUND_SCALE;
  const tz = v.z / GROUND_SCALE;
  controls.target.set(tx, 0.4, tz);
  const pitch = ((v.pitch ?? 55) * Math.PI) / 180;
  const bearing = ((v.bearing ?? 0) * Math.PI) / 180;
  const heightPx = locusMap.map.getCanvas().clientHeight || 600;
  const mpp =
    (40075016.686 * Math.cos((ORIGIN.lat * Math.PI) / 180)) / (512 * 2 ** (v.zoom ?? 18));
  const distM = (mpp * heightPx) / (2 * Math.tan(((camera.fov || 42) * Math.PI) / 360));
  const dist = Math.max(8, distM / GROUND_SCALE);
  const horiz = dist * Math.cos(pitch);
  const hy = Math.max(3.5, dist * Math.sin(pitch) + 1.2);
  camera.position.set(tx - Math.sin(bearing) * horiz, hy, tz - Math.cos(bearing) * horiz);
  camera.lookAt(controls.target);
}

function showCandidatePopup(lngLat, feature) {
  if (!candidateOverlay || !locusMap) return;
  candidatePopupEl?.remove();
  const el = document.createElement("div");
  el.className = "mg-dom-pop";
  el.innerHTML = candidateOverlay.popupHtml(feature) + '<button type="button" class="mg-dom-pop-x" aria-label="Close">×</button>';
  el.querySelector(".mg-dom-pop-x")?.addEventListener("click", (e) => {
    e.stopPropagation();
    el.remove();
    candidatePopupEl = null;
  });
  const stage = document.getElementById("wl-stage");
  if (!stage) return;
  stage.appendChild(el);
  candidatePopupEl = el;
  const point = locusMap.map.project(lngLat);
  el.style.left = `${Math.min(stage.clientWidth - 200, Math.max(8, point.x + 12))}px`;
  el.style.top = `${Math.min(stage.clientHeight - 120, Math.max(8, point.y + 12))}px`;
}

/** @type {HTMLDivElement | null} */
let candidatePopupEl = null;

function handleAfricaPick(clientX, clientY) {
  const map = locusMap.map;
  const rect = map.getCanvas().getBoundingClientRect();
  const point = { x: clientX - rect.left, y: clientY - rect.top };
  const layerIds = [candidateOverlay.layerIds.home, candidateOverlay.layerIds.circle].filter((id) =>
    map.getLayer(id),
  );
  const hits = layerIds.length ? map.queryRenderedFeatures(point, { layers: layerIds }) : [];
  const homeHit = hits.find((f) => f.layer?.id === candidateOverlay.layerIds.home);
  if (homeHit) {
    if (emptyCanvas) return;
    setScope({ kind: "village" }, { cam: true, from: "map" });
    return;
  }
  const candHit = hits.find((f) => f.layer?.id === candidateOverlay.layerIds.circle);
  if (candHit) {
    if (emptyCanvas) {
      const coords = candHit.geometry?.coordinates;
      if (coords) adoptMapOrigin(coords[0], coords[1], candHit.properties?.name);
    }
    showCandidatePopup(map.unproject(point), candHit);
    return;
  }
  if (emptyCanvas) return;
  setScope({ kind: "village" }, { cam: true, from: "map" });
}

function groundAtClient(clientX, clientY) {
  if (!locusMap) return null;
  const map = locusMap.map;
  const rect = map.getCanvas().getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const lngLat = map.unproject([clientX - rect.left, clientY - rect.top]);
  const enu = lonLatToEnu(lngLat.lng, lngLat.lat, 0, ORIGIN);
  return { x: enu.x / GROUND_SCALE, z: enu.z / GROUND_SCALE };
}

/** Project schematic XZ → canvas pixel for hit-testing. */
function projectSchematic(x, z) {
  const [lon, lat] = enuToLonLat(x * GROUND_SCALE, z * GROUND_SCALE, 0, ORIGIN);
  return locusMap.map.project([lon, lat]);
}

/**
 * Screen-space pick — MapLibre-native. Avoids broken THREE rays on custom-layer matrix.
 * Prefer houses / EMS over long feeder spans when distances are close.
 */
function scopeAt(clientX, clientY) {
  if (!locusMap) return { kind: "village" };
  const map = locusMap.map;
  const rect = map.getCanvas().getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return { kind: "village" };
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  // Hit radius: tight when zoomed in so empty ground is easy to click.
  const zoom = map.getZoom();
  const hitPx = Math.max(12, Math.min(34, 9 + (19.5 - zoom) * 4.5));
  let best = null;
  let bestD = hitPx * hitPx;

  const consider = (x, z, scope, weight = 1, maxPx = hitPx) => {
    const p = projectSchematic(x, z);
    const dx = p.x - px;
    const dy = p.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > maxPx * maxPx) return;
    const score = d2 / weight;
    if (score < bestD) {
      bestD = score;
      best = scope;
    }
  };

  const linePx = Math.max(10, hitPx * 0.55);
  for (const h of liveHouses) consider(h.x, h.z, { kind: "house", id: h.id }, 1.35);
  for (const b of liveBoards) consider(b.x, b.z, { kind: "board", id: b.id }, 1.25);
  if (!emptyCanvas) {
    for (const t of TRANSFORMERS) {
      const nb = nearestBoardOnFeeder(t.feederId, t.x, t.z);
      consider(t.x, t.z, { kind: "feeder", id: t.feederId, boardId: nb?.id || null }, 1.1);
    }
  }
  for (const f of liveFeeders) consider(f.x, f.z, { kind: "feeder", id: f.id });
  const overlay = buildMode?.getPlaced?.() || [];
  for (const p of overlay) {
    if (p.seeded && (p.assetClass === "service" || p.assetClass === "customer")) continue;
    const fid = liveFeederIdForBuild(p);
    if (!fid) continue;
    if (p.kind === "line" && p.bx != null) {
      consider((p.x + p.bx) / 2, (p.z + p.bz) / 2, { kind: "feeder", id: fid }, 0.75, linePx);
      consider(p.x, p.z, { kind: "feeder", id: fid }, 1.05);
      consider(p.bx, p.bz, { kind: "feeder", id: fid }, 1.05);
    } else if (p.assetClass === "pole" || p.assetClass === "gen" || p.assetClass === "station" || p.assetClass === "xfmr") {
      consider(p.x, p.z, { kind: "feeder", id: fid }, 1.2);
    }
  }
  if (!emptyCanvas) {
    for (const p of POLES) {
      if (p.feederId) {
        const nb = nearestBoardOnFeeder(p.feederId, p.x, p.z);
        consider(p.x, p.z, { kind: "feeder", id: p.feederId, boardId: nb?.id || null });
      }
    }
  }
  for (const lk of liveLeaks) consider(lk.x, lk.z, leakScope(lk), 1.15);

  if (!emptyCanvas) {
    for (const s of GRID_SEGS) {
      if (!s.feederId) continue;
      const mx = (s.ax + s.bx) / 2;
      const mz = (s.az + s.bz) / 2;
      if (s.houseId) consider(mx, mz, { kind: "house", id: s.houseId }, 0.85, linePx);
      else {
        const nb = nearestBoardOnFeeder(s.feederId, mx, mz);
        consider(mx, mz, { kind: "feeder", id: s.feederId, boardId: nb?.id || null }, 0.7, linePx);
      }
    }
  }

  return best || { kind: "village" };
}

function applyPick(clientX, clientY) {
  if (buildMode?.isActive() && buildMode.handleMapClick(clientX, clientY)) {
    const rid = buildMode.getEditRunId?.();
    const fid = rid && liveFeeders.find((f) => f.runId === rid || f.id === `f-${rid}`)?.id;
    if (fid) setScope({ kind: "feeder", id: fid }, { cam: false, from: "map" });
    return;
  }
  const scope = scopeAt(clientX, clientY);
  if (scope.kind !== "village") {
    if (state.role === "customer") {
      const hid = scope.kind === "house" ? scope.id : null;
      if (hid === state.you) setScope({ kind: "house", id: hid }, { cam: true, from: "map" });
      return;
    }
    setScope(scope, { cam: true, from: "map" });
    const rid = liveFeeders.find((f) => f.id === scope.id)?.runId;
    if (appMode === "build" && rid) buildMode?.selectRun?.(rid);
    return;
  }
  if (candidateOverlay?.isVisible()) {
    handleAfricaPick(clientX, clientY);
    return;
  }
  setScope(scope, { cam: true, from: "map" });
}

let lastPickAt = 0;
function applyPickOnce(clientX, clientY) {
  const now = performance.now();
  if (now - lastPickAt < 280) return;
  lastPickAt = now;
  applyPick(clientX, clientY);
}

function tick(ts) {
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  if (state.playing && !quietClockMode()) {
    const next = state.nowMin + dt * state.speed * state.dir;
    if (next >= DAY_MIN) {
      setNow(DAY_MIN);
      state.playing = false;
      syncPlayBtn();
    } else if (next <= 0) {
      setNow(0);
      state.playing = false;
      syncPlayBtn();
    } else {
      setNow(next);
    }
  }
  stepCamFly(dt);
  panLook(dt);
  controls.update();
  scaleCompassCards();
  locusMap.map.triggerRepaint();
  requestAnimationFrame(tick);
}

function scaleCompassCards() {
  if (!camera || !controls || !compassSprites.length) return;
  const d = camera.position.distanceTo(controls.target);
  const k = Math.min(1.65, Math.max(1, d / 160));
  for (const spr of compassSprites) {
    const s = spr.userData.s * k;
    spr.scale.set(s, s, 1);
  }
}

function panLook(dt) {
  if (locusMap) {
    if (panKeys.size) {
      const dx = (panKeys.has('d') || panKeys.has('ArrowRight') ? 1 : 0) - (panKeys.has('a') || panKeys.has('ArrowLeft') ? 1 : 0);
      const dy = (panKeys.has('s') || panKeys.has('ArrowDown') ? 1 : 0) - (panKeys.has('w') || panKeys.has('ArrowUp') ? 1 : 0);
      locusMap.map.panBy([dx*dt*200,dy*dt*200],{duration:0});
    }
    return;
  }
  if (!panKeys.size || !camera || !controls) return;
  if (camFly) camFly = null;
  if (controls) {
    controls.enabled = true;
    controls.enableDamping = true;
  }
  camera.getWorldDirection(panFwd);
  panFwd.y = 0;
  if (panFwd.lengthSq() < 1e-6) panFwd.set(0, 0, NORTH.z || -1);
  else panFwd.normalize();
  panRight.set(-panFwd.z, 0, panFwd.x);
  if (panRight.lengthSq() < 1e-6) panRight.set(1, 0, 0);
  else panRight.normalize();
  let dx = 0;
  let dz = 0;
  if (panKeys.has("w")) {
    dx += panFwd.x;
    dz += panFwd.z;
  }
  if (panKeys.has("s")) {
    dx -= panFwd.x;
    dz -= panFwd.z;
  }
  if (panKeys.has("d")) {
    dx += panRight.x;
    dz += panRight.z;
  }
  if (panKeys.has("a")) {
    dx -= panRight.x;
    dz -= panRight.z;
  }
  const len = Math.hypot(dx, dz);
  if (len < 1e-8) return;
  const step = (PAN_SPEED * dt) / len;
  dx *= step;
  dz *= step;
  const tx = Math.max(PAN_X[0], Math.min(PAN_X[1], controls.target.x + dx));
  const tz = Math.max(PAN_Z[0], Math.min(PAN_Z[1], controls.target.z + dz));
  camera.position.x += tx - controls.target.x;
  camera.position.z += tz - controls.target.z;
  controls.target.x = tx;
  controls.target.z = tz;
}

function syncPlayBtn() {
  const fwd = document.getElementById("wl-play");
  const rev = document.getElementById("wl-rev");
  const going = state.playing;
  if (fwd) {
    fwd.classList.toggle("primary", going && state.dir > 0);
    fwd.setAttribute("aria-pressed", going && state.dir > 0 ? "true" : "false");
  }
  if (rev) {
    rev.classList.toggle("primary", going && state.dir < 0);
    rev.setAttribute("aria-pressed", going && state.dir < 0 ? "true" : "false");
  }
}

function togglePlay(dir) {
  if (state.playing && state.dir === dir) {
    state.playing = false;
  } else {
    state.dir = dir;
    if (dir > 0 && state.nowMin >= DAY_MIN) setNow(0);
    if (dir < 0 && state.nowMin <= 0) setNow(DAY_MIN);
    state.playing = true;
  }
  syncPlayBtn();
}

function writeQuery(patch, reload) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch || {})) {
    if (v == null || v === "") q.delete(k);
    else q.set(k, String(v));
  }
  if (!q.has("homes")) q.set("homes", String(TARGET_HOMES));
  const next = `?${q.toString()}`;
  if (reload) {
    location.search = q.toString();
    return;
  }
  history.replaceState(null, "", next);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function nearestBoardOnFeeder(fid, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const b of liveBoards) {
    if (b.feederId !== fid) continue;
    const d = (b.x - x) ** 2 + (b.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function resolveBoardId(target) {
  if (target?.bid) return target.bid;
  if (target?.hid) return houseById[target.hid]?.boardId || null;
  if (!target?.fid) return null;
  const boards = liveBoards.filter((b) => b.feederId === target.fid);
  if (!boards.length) return null;
  return boards.slice().sort(
    (a, b) => (a.boardIdx ?? 0) - (b.boardIdx ?? 0) || String(a.id).localeCompare(String(b.id)),
  )[0].id;
}

function feederPoints(fid) {
  const pts = [];
  const f = liveFeeders.find((x) => x.id === fid);
  if (f) pts.push([f.x, f.z]);
  const d = liveDtms.find((x) => x.feederId === fid);
  if (d) pts.push([d.x, d.z]);
  for (const h of liveHouses) if (h.feederId === fid) pts.push([h.x, h.z]);
  for (const t of TRANSFORMERS) if (t.feederId === fid) pts.push([t.x, t.z]);
  for (const p of POLES) if (p.feederId === fid) pts.push([p.x, p.z]);
  for (const b of liveBoards) if (b.feederId === fid) pts.push([b.x, b.z]);
  return pts;
}

function boardPoints(bid) {
  const b = boardById[bid];
  const pts = [];
  if (!b) return pts;
  pts.push([b.x, b.z]);
  for (const h of liveHouses) if (h.boardId === bid) pts.push([h.x, h.z]);
  for (const t of TRANSFORMERS) {
    if (t.feederId === b.feederId && nearestBoardOnFeeder(t.feederId, t.x, t.z)?.id === bid) {
      pts.push([t.x, t.z]);
    }
  }
  if (pts.length < 2) {
    pts.push([b.x + 4, b.z], [b.x - 4, b.z], [b.x, b.z + 4], [b.x, b.z - 4]);
  }
  return pts;
}

/** Side view: power flow along screen L→R (incoming / src on left). */
function sideCamPose(pts, src, { maxDist = 78, minDist = 16, pad = 1.22, elev = 0.38 } = {}) {
  if (!camera || !pts.length) return null;
  let lookX = 0;
  let lookZ = 0;
  for (const [x, z] of pts) {
    lookX += x;
    lookZ += z;
  }
  lookX /= pts.length;
  lookZ /= pts.length;
  let ax = lookX - src.x;
  let az = lookZ - src.z;
  const alen = Math.hypot(ax, az) || 1;
  ax /= alen;
  az /= alen;
  let minA = Infinity;
  let maxA = -Infinity;
  let minP = Infinity;
  let maxP = -Infinity;
  for (const [x, z] of pts) {
    const a = (x - lookX) * ax + (z - lookZ) * az;
    const p = (x - lookX) * -az + (z - lookZ) * ax;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minP = Math.min(minP, p);
    maxP = Math.max(maxP, p);
  }
  const alongSpan = Math.max(10, maxA - minA);
  const perpSpan = Math.max(8, maxP - minP);
  const vFov = (camera.fov * Math.PI) / 180;
  const aspect = Math.max(0.55, camera.aspect || 1.35);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distH = (alongSpan * pad) / 2 / Math.tan(hFov / 2);
  const distV = (perpSpan * pad) / 2 / Math.tan(vFov / 2);
  const dist = Math.min(maxDist, Math.max(minDist, distH, distV));
  const horiz = dist * Math.cos(elev);
  const height = Math.max(7, dist * Math.sin(elev));
  // Perp offset so along (src→loads) maps to screen-right → src on left.
  const ox = -az;
  const oz = ax;
  const pos = new THREE.Vector3(lookX + ox * horiz, height, lookZ + oz * horiz);
  const look = new THREE.Vector3(lookX, 0.42, lookZ);
  return { pos, look, bearing: bearingFromPose(pos, look) };
}

function bearingFromPose(pos, look) {
  const fx = look.x - pos.x;
  const fz = look.z - pos.z;
  // MapLibre: 0 = north (−Z), clockwise degrees.
  return (Math.atan2(fx, -fz) * 180) / Math.PI;
}

function feederCamPose(fid) {
  const pts = feederPoints(fid);
  if (!pts.length) return null;
  const f = liveFeeders.find((x) => x.id === fid);
  const d = liveDtms.find((x) => x.feederId === fid);
  const src = d || f || LANDMARKS.xfmr;
  return sideCamPose(pts, src, { maxDist: 78, minDist: 16, pad: 1.22, elev: 0.38 });
}

function boardCamPose(bid) {
  const b = boardById[bid];
  if (!b) return null;
  const pts = boardPoints(bid);
  const f = liveFeeders.find((x) => x.id === b.feederId);
  const d = liveDtms.find((x) => x.feederId === b.feederId);
  const src = d || f || LANDMARKS.xfmr;
  return sideCamPose(pts, src, { maxDist: 42, minDist: 12, pad: 1.35, elev: 0.42 });
}

function startCamFly(toPos, toLook, dur = 0.95, extra = {}) {
  if (locusMap) {
    camFly = null;
    locusMap.map.stop();
    hopToSchematic(toLook.x, toLook.z, {
      zoom: extra.zoom ?? zoomForDistance(toPos.distanceTo(toLook)),
      pitch: extra.pitch ?? 55,
      bearing: extra.bearing ?? bearingFromPose(toPos, toLook),
      duration: dur,
    });
    camera.position.copy(toPos);
    controls.target.copy(toLook);
    return;
  }
  if (!camera || !controls) return;
  camFly = {
    t: 0,
    dur,
    fromPos: camera.position.clone(),
    fromLook: controls.target.clone(),
    toPos: toPos.clone(),
    toLook: toLook.clone(),
  };
  controls.enabled = false;
  controls.enableDamping = false;
}

function stepCamFly(dt) {
  if (!camFly || !camera || !controls) return;
  camFly.t += dt;
  const u = easeInOutCubic(Math.min(1, camFly.t / camFly.dur));
  camera.position.lerpVectors(camFly.fromPos, camFly.toPos, u);
  controls.target.lerpVectors(camFly.fromLook, camFly.toLook, u);
  if (camFly.t >= camFly.dur) {
    camera.position.copy(camFly.toPos);
    controls.target.copy(camFly.toLook);
    camFly = null;
    controls.enabled = true;
    controls.enableDamping = true;
  }
}

function flyToFeeder(fid) {
  if (!fid || state.role === "customer") return;
  const pose = feederCamPose(fid);
  if (!pose) return;
  camFeederId = fid;
  camBoardId = null;
  camMag = 1;
  startCamFly(pose.pos, pose.look, 0.95, { pitch: 52, bearing: pose.bearing });
}

function flyToBoardZone(bid) {
  const b = boardById[bid];
  if (!b || state.role === "customer") return;
  const pose = boardCamPose(bid);
  if (!pose) {
    framePoint(b.x, b.z, 26);
    camFeederId = b.feederId;
    camBoardId = bid;
    camMag = 2;
    return;
  }
  camFeederId = b.feederId;
  camBoardId = bid;
  camMag = 2;
  startCamFly(pose.pos, pose.look, 0.85, { pitch: 56, bearing: pose.bearing });
}

function flyToAfrica() {
  camFeederId = null;
  camBoardId = null;
  camMag = -1;
  candidatePopupEl?.remove();
  candidatePopupEl = null;
  if (!candidateOverlay || !locusMap) {
    flyToVillage();
    return;
  }
  candidateOverlay.flyToRegion();
  const home = camHome(isV2());
  camera.position.set(...home.pos);
  controls.target.set(...home.look);
}

function setPinBar(on) {
  const bar = document.getElementById("wl-site-pin");
  if (bar) bar.hidden = !on;
}

function setPinStatus(text) {
  const el = document.getElementById("wl-pin-status");
  if (el) el.textContent = text || "";
}

function fillPinInputs(lat, lon, label) {
  const el = document.getElementById("wl-pin-place");
  if (el) el.value = label || `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
}

async function cachePinnedSite(lon, lat, name) {
  setPinStatus("Fetching OSM…");
  let osm = null;
  try {
    osm = await fetchSiteOsm(lat, lon);
    addSiteOsmLayers(locusMap?.map, osm);
    if (projectDoc) {
      projectDoc.osm = { featureCount: osm.features.length, url: null };
    }
    setPinStatus(`OSM ${osm.features.length} features · caching tiles…`);
  } catch (err) {
    setPinStatus(`OSM skip: ${err.message || err}`);
  }
  try {
    const pack = await cacheSitePack({ lon, lat, name, km: 2, osm });
    if (projectDoc) {
      projectDoc.mapPack = pack;
      if (osm) projectDoc.osm = { featureCount: osm.features.length, url: pack.osmUrl };
    }
    await locusMap?.useLocalStyle?.(pack.styleUrl);
    if (osm) addSiteOsmLayers(locusMap?.map, osm);
    setPinStatus(`Offline pack saved · ${pack.id}`);
    locusMap?.refreshStatus?.();
  } catch (err) {
    setPinStatus(`Tiles: ${err.message || err} · satellite still on`);
  }
  syncProjectChip();
}

function adoptMapOrigin(lon, lat, name) {
  setVillageOrigin(lon, lat, name || "New village");
  rebindMapOrigin(locusMap, ORIGIN);
  candidateOverlay?.setHomePoint?.(lon, lat, ORIGIN.name);
  candidateOverlay?.setHomeVisible?.(true);
  fillPinInputs(lat, lon, name);
  if (projectDoc) {
    projectDoc.origin = { lon, lat, name: ORIGIN.name };
    projectDoc.emptyScene = true;
    projectDoc.siteId = "blank";
    syncProjectChip();
  }
  locusMap?.map?.flyTo?.({
    center: [lon, lat],
    zoom: 16.2,
    pitch: 52,
    bearing: 0,
    duration: 1400,
  });
  cachePinnedSite(lon, lat, ORIGIN.name);
}

function enterEmptyCanvas(origin) {
  const already = emptyCanvas;
  emptyCanvas = true;
  disposePackLayer(packLayer);
  packLayer = null;
  clearSiteOsmLayers(locusMap?.map);
  if (demoVillageRoot) demoVillageRoot.visible = false;
  hideSchematicMeshes();
  setScope({ kind: "village" }, { cam: false, from: "clear" });
  applyVisibility();
  applyLayers();
  candidateOverlay?.setHomeVisible?.(false);
  candidateOverlay?.setVisible?.(true);
  setPinBar(true);
  if (origin && Number.isFinite(origin.lon) && Number.isFinite(origin.lat)) {
    adoptMapOrigin(origin.lon, origin.lat, origin.name);
  } else if (!already) {
    setPinStatus("Punch place or lat,lon, or click a candidate.");
    flyToAfrica();
  }
  const hint = document.getElementById("wl-mode-hint");
  if (hint) hint.textContent = "Empty project — town / address / lat,lon, or click a candidate.";
  syncLiveFromBuild();
}

function leaveEmptyCanvas() {
  emptyCanvas = false;
  if (demoVillageRoot) demoVillageRoot.visible = true;
  for (const line of spineMeshes) if (line) line.visible = true;
  resetVillageOrigin();
  rebindMapOrigin(locusMap, ORIGIN);
  locusMap?.clearSiteStyle?.();
  candidateOverlay?.setHomePoint?.(ORIGIN.lon, ORIGIN.lat, ORIGIN.name);
  candidateOverlay?.setHomeVisible?.(true);
  setPinBar(false);
  setPinStatus("");
  applyVisibility();
  applyLayers();
  restoreDemoLive();
}

function flyToVillage() {
  if (emptyCanvas) return;
  camFeederId = null;
  camBoardId = null;
  camMag = 0;
  candidatePopupEl?.remove();
  candidatePopupEl = null;
  candidateOverlay?.setVisible(false);
  const home = camHome(isV2());
  startCamFly(new THREE.Vector3(...home.pos), new THREE.Vector3(...home.look), 0.85, {
    pitch: 48,
    bearing: 0,
    zoom: 16.2,
  });
}

/** Ultimate depth for a scope: 1 feeder · 2 EMS zone · 3 asset. */
function pickCamTarget(scope) {
  const n = normalizeScope(scope);
  if (!n || n.kind === "village" || n.kind === "station") {
    return { mag: 0, fid: null, bid: null, hid: null };
  }
  if (n.kind === "house") {
    const h = houseById[n.id];
    if (!h) return { mag: 0, fid: null, bid: null, hid: null };
    return { mag: 3, fid: h.feederId, bid: h.boardId, hid: h.id };
  }
  if (n.kind === "board") {
    const b = boardById[n.id];
    if (!b) return { mag: 0, fid: null, bid: null, hid: null };
    return { mag: 3, fid: b.feederId, bid: b.id, hid: null };
  }
  if (n.kind === "feeder") {
    if (n.houseId) {
      const h = houseById[n.houseId];
      return { mag: 3, fid: n.id, bid: n.boardId || h?.boardId || null, hid: n.houseId };
    }
    if (n.boardId) return { mag: 3, fid: n.id, bid: n.boardId, hid: null };
    return { mag: 1, fid: n.id, bid: null, hid: null };
  }
  return { mag: 0, fid: null, bid: null, hid: null };
}

function applyCamMag(mag, target) {
  if (mag < 0) {
    flyToAfrica();
    return;
  }
  if (mag === 0 || !target?.fid) {
    if (camMag === 0 && mag === 0) return;
    flyToVillage();
    return;
  }
  candidateOverlay?.setVisible(false);

  if (mag >= 3 && target.hid) {
    const h = houseById[target.hid];
    if (h) {
      camFeederId = target.fid;
      camBoardId = h.boardId || target.bid || null;
      camMag = 3;
      framePoint(h.x, h.z, 14);
      return;
    }
  }
  if (mag >= 3 && target.bid) {
    const b = boardById[target.bid];
    if (b) {
      camFeederId = target.fid;
      camBoardId = b.id;
      camMag = 3;
      framePoint(b.x, b.z, 16);
      return;
    }
  }

  if (mag >= 2) {
    const bid = resolveBoardId(target);
    if (bid && boardById[bid]) {
      flyToBoardZone(bid);
      return;
    }
  }

  flyToFeeder(target.fid);
}

function progressCamera(next, opts = {}) {
  if (state.role === "customer") return;
  const target = pickCamTarget(next);
  const from = opts.from || "map";

  if (from === "clear") {
    applyCamMag(0, target);
    return;
  }

  // UI panels / KPI / grid: jump to meaningful depth (not progressive).
  if (from !== "map") {
    if (from.includes("home")) applyCamMag(3, target);
    else if (from.includes("ems") || from.includes("board")) applyCamMag(2, target);
    else if (target.mag >= 1) applyCamMag(Math.min(target.mag, 3), target);
    else applyCamMag(0, target);
    return;
  }

  // Empty ground / miss: jump straight to full village (unselected).
  if (target.mag === 0) {
    if (from === "map") applyCamMag(0, target);
    return;
  }

  const sameFeeder = !!(target.fid && target.fid === camFeederId);

  // Village (or other feeder) → full feeder side view first.
  if (!sameFeeder || camMag <= 0) {
    applyCamMag(1, target);
    return;
  }

  // Feeder overview → EMS / comparable zone.
  if (camMag === 1) {
    const bid = resolveBoardId(target);
    if (bid) applyCamMag(2, { ...target, bid });
    else applyCamMag(1, target);
    return;
  }

  // EMS zone → asset (or switch zone).
  if (camMag === 2) {
    const bid = resolveBoardId(target);
    if (target.hid) {
      applyCamMag(3, target);
      return;
    }
    if (bid && bid !== camBoardId) {
      applyCamMag(2, { ...target, bid });
      return;
    }
    if (bid) {
      applyCamMag(3, { ...target, bid, hid: null });
      return;
    }
    applyCamMag(1, target);
    return;
  }

  // Asset level (mag ≥ 3): re-click same house → EMS; else reframe asset / zone.
  if (target.hid && target.hid === opts.prevFocus && target.fid === camFeederId) {
    applyCamMag(2, target);
    return;
  }
  if (target.hid) {
    applyCamMag(3, target);
    return;
  }
  if (target.bid && target.bid !== camBoardId) {
    applyCamMag(2, target);
    return;
  }
  applyCamMag(3, target);
}


function framePoint(x, z, dist = 22) {
  if (!locusMap) return;
  const zoom = dist <= 14 ? 20.6 : dist <= 18 ? 20.2 : dist <= 24 ? 19.4 : 18.2;
  hopToSchematic(x, z, {
    zoom,
    pitch: 58,
    duration: 0.75,
    bearing: locusMap.map.getBearing(),
  });
  controls.target.set(x, 0.45, z);
  camera.position.set(x + dist * 0.55, Math.max(5.5, dist * 0.58), z + dist * 0.72);
}

/** Direct MapLibre fly — schematic coords in, lon/lat out. No GROUND_SCALE wrapper games. */
function hopToSchematic(x, z, { zoom = 19, pitch = 55, bearing, duration = 0.8 } = {}) {
  if (!locusMap) return;
  const [lon, lat] = enuToLonLat(x * GROUND_SCALE, z * GROUND_SCALE, 0, ORIGIN);
  locusMap.map.stop();
  locusMap.map.flyTo({
    center: [lon, lat],
    zoom,
    pitch,
    bearing: bearing ?? locusMap.map.getBearing(),
    duration: duration * 1000,
    essential: true,
  });
}

function zoomForDistance(schematicDist) {
  if (schematicDist <= 16) return 20.4;
  if (schematicDist <= 22) return 19.6;
  if (schematicDist <= 40) return 18.4;
  return 17.2;
}

function frameSelection() {
  if (state.role === "customer") {
    const you = houseById[state.you];
    if (you) {
      camFeederId = you.feederId;
      camBoardId = you.boardId || null;
      camMag = 3;
      framePoint(you.x, you.z, 14);
    }
    return;
  }
  if (state.focus) {
    const h = houseById[state.focus];
    if (h) {
      camFeederId = h.feederId;
      camBoardId = h.boardId || null;
      camMag = 3;
      framePoint(h.x, h.z, 14);
      return;
    }
  }
  const bid = state.scopeBoard || state.emsId;
  if (bid && boardById[bid]) {
    flyToBoardZone(bid);
    return;
  }
  const s = state.scope || {};
  if (s.kind === "station") {
    flyToVillage();
    return;
  }
  const fid = activeFeederId();
  if (fid) {
    flyToFeeder(fid);
    return;
  }
  flyToVillage();
}

function flyToXZ(x, z, dist = 14) {
  if (locusMap) { startCamFly(new THREE.Vector3(x+dist*.55, Math.max(5.5,dist*.58), z+dist*.72),new THREE.Vector3(x,.4,z)); return; }
  if (!camera || !controls) return;
  camFly = null;
  controls.enabled = true;
  controls.enableDamping = true;
  controls.target.set(x, 0.4, z);
  camera.position.set(x + dist * 0.55, Math.max(5.5, dist * 0.58), z + dist * 0.72);
}

function sizeSelectValue() {
  if (TARGET_HOMES <= 150) return "100";
  if (TARGET_HOMES >= 700) return "1000";
  return String(TARGET_HOMES);
}

function houseOutage(h) {
  return (day.summary.outages || []).find(
    (x) =>
      state.nowMin >= x.min &&
      state.nowMin < x.restore &&
      (x.xfmrId ? h.xfmrId === x.xfmrId : h.feederId === x.feederId),
  );
}

function areaStatus(h) {
  const o = houseOutage(h);
  if (o) return { tone: "bad", label: "Outage in your area", detail: `${o.label} · ${fmtClock(o.min)}–${fmtClock(o.restore)}` };
  const feederW = liveHouses.filter((x) => x.feederId === h.feederId).reduce((s, x) => {
    const r = readingAt(x.id, state.nowMin);
    return s + (r?.powerW || 0);
  }, 0);
  const peak = day.summary.peakFeederW || 1;
  if (feederW > peak * 0.75) return { tone: "warn", label: "Grid is busy", detail: "Large loads may trip. Wait if you can." };
  return { tone: "ok", label: "Your area is on", detail: "Mini-grid operating. No home-by-home list." };
}

function fillCustomer() {
  const card = document.getElementById("wl-cust-card");
  const body = document.getElementById("wl-cust-body");
  const youEl = document.getElementById("wl-you");
  if (!card || !body) return;
  const show = state.role === "customer";
  card.hidden = !show;
  if (!show) return;
  if (youEl && !youEl.dataset.ready) {
    youEl.innerHTML = liveHouses.map((h) => `<option value="${h.id}">${esc(h.name)} · ${esc(h.serial)}</option>`).join("");
    youEl.dataset.ready = "1";
  }
  if (youEl) youEl.value = state.you;
  const h = houseById[state.you] || liveHouses[0];
  if (!h) return;
  const r = readingAt(h.id, state.nowMin);
  const wallet = r ? r.wallet : h.startCredit;
  const on = r ? r.on && !r.feederOut : h.startCredit > 0;
  const watts = r?.powerW || 0;
  const kWh = (function () {
    const hi = houseIndex[h.id];
    const last = Math.min(SLOTS - 1, Math.floor(state.nowMin / SLOT_MIN));
    let wh = 0;
    for (let s = 0; s <= last; s++) wh += day.readings[s * HOUSE_N + hi]?.energyWh || 0;
    return wh / 1000;
  })();
  const area = areaStatus(h);
  const sms = day.events.filter((e) => e.houseId === h.id && e.kind === "sms" && e.min <= state.nowMin);
  const nextPay = (h.payments || []).find((p) => p.min > state.nowMin);
  const load = LOAD_TYPES[r?.loadType]?.label || "standby";
  const hoursLeft =
    watts > 0 && wallet > 0 ? (wallet / TARIFF_PER_KWH) / (watts / 1000) : wallet > 0 ? Infinity : 0;
  const hoursTxt =
    hoursLeft === Infinity ? "credit held (no load)" : hoursLeft <= 0 ? "no credit" : `~${hoursLeft.toFixed(1)} h at this load`;
  body.innerHTML = `
    <div class="wl-ov-grid">
      <div class="wl-ov-stat ${on ? "ok" : "bad"}"><span>Service</span><b>${on ? "ON" : "OFF"}</b></div>
      <div class="wl-ov-stat ${wallet <= LOW_BALANCE ? "warn" : ""}"><span>Credit</span><b>${wallet.toFixed(0)}</b></div>
      <div class="wl-ov-stat"><span>Using now</span><b>${Math.round(watts)} W</b></div>
      <div class="wl-ov-stat"><span>Today so far</span><b>${kWh.toFixed(2)} kWh</b></div>
    </div>
    <p class="wl-ov-k">Tariff</p>
    <p class="wl-ov-note">${TARIFF_PER_KWH} / kWh (abstract units) · AUTO relay off at 0 credit · low-balance SMS at ${LOW_BALANCE}</p>
    <p class="wl-ov-note">${esc(h.name)} · ${esc(h.serial)} · ${esc(load)} · ${hoursTxt}</p>
    <p class="wl-ov-k">Your area</p>
    <div class="wl-ov-stat ${area.tone}"><span>${esc(area.label)}</span><b>${esc(area.detail)}</b></div>
    <p class="wl-ov-note">Site solar ${Math.round((PV_FARM.nameplateW || 0) / 1000)} kW nameplate · now ${Math.round(pvFarmW(state.nowMin) / 1000)} kW. Village-wide, not your roof.</p>
    <p class="wl-ov-k">Messages</p>
    <p class="wl-ov-note">${
      sms.length
        ? sms
            .slice(-3)
            .map((e) => `${fmtClock(e.min)} · low credit`)
            .join(" · ")
        : "No SMS yet."
    }</p>
    <p class="wl-ov-k">Buy credit</p>
    <p class="wl-ov-note">Kiosk, phone, or CIU — then the meter gets set_balance before watts resume. ${
      nextPay ? `Next schematic top-up at ${fmtClock(nextPay.min)} (${nextPay.amount}).` : "No more top-ups in this day."
    }</p>
    <p class="wl-ov-note">Neighbor meters stay private. You see your wallet and whether your area is on, busy, or dark.</p>
  `;
}

function fillEms() {
  const card = document.getElementById("wl-ems-card");
  const body = document.getElementById("wl-ems-body");
  const title = document.getElementById("wl-ems-title");
  const sub = document.getElementById("wl-ems-sub");
  if (!card || !body) return;
  const id = state.emsId;
  const b = id ? boardById[id] : null;
  card.hidden = !b;
  if (!b) return;
  const houses = (b.houseIds || []).map((hid) => houseById[hid]).filter(Boolean);
  const feeder = liveFeeders.find((f) => f.id === b.feederId);
  const dtm = liveDtms.find((d) => d.feederId === b.feederId);
  const xf = TRANSFORMERS.find((t) => t.id === b.xfmrId);
  const leak = liveLeaks.find((lk) => lk && (lk.fromBoardId === b.id || lk.toBoardId === b.id));
  const idx = liveBoards.findIndex((x) => x.id === b.id);
  if (title) title.textContent = b.label || "MeshEMS";
  if (sub) {
    sub.textContent =
      appMode === "maintenance"
        ? `${idx + 1} / ${liveBoards.length} · day health · ${feeder?.label || b.feederId}`
        : `${idx + 1} / ${liveBoards.length} · ${houses.length} meters · ${feeder?.label || b.feederId}`;
  }

  if (appMode === "maintenance") {
    const healthMap = ensureHouseHealth();
    const bh = boardDayHealth(b.id);
    let badN = 0;
    let warnN = 0;
    const rows = houses.map((h, i) => {
      const hh = healthMap[h.id] || computeHouseDayHealth(h.id);
      if (hh.grade === "bad") badN += 1;
      else if (hh.grade === "warn") warnN += 1;
      return { h, hh, port: i + 1, ph: h.phase || "A" };
    });
    const hops = houses[0] ? hopsToUsb(houses[0].id) : "—";
    const check = [
      { cls: bh.grade === "bad" ? "bad" : bh.grade === "warn" ? "warn" : "done", t: `Board day stress ${Math.round(bh.stress * 100)}% · ${bh.grade}` },
      { cls: leak ? "warn" : "done", t: leak ? `Leak span mapped · ${leak.label} · +${leak.leakW} W ΔP` : "No leak span on this pole pair" },
      { cls: xf ? "done" : "warn", t: xf ? `LV from ${xf.label || xf.id}` : "No xfmr id on this board" },
      { cls: "done", t: `RF hops to USB GW ≈ ${hops} · ${LANDMARKS.usb?.label || "USB GW"}` },
      { cls: "done", t: "No playhead metering in Maintenance — day aggregates only" },
    ];
    body.innerHTML = `
      <div class="wl-ov-grid">
        <div class="wl-ov-stat ${bh.grade === "ok" ? "ok" : bh.grade === "warn" ? "warn" : "bad"}"><span>Day stress</span><b>${Math.round(bh.stress * 100)}%</b></div>
        <div class="wl-ov-stat ${badN ? "bad" : warnN ? "warn" : "ok"}"><span>Meters</span><b>${badN} bad · ${warnN} warn</b></div>
      </div>
      <p class="wl-ov-k">Cabinet ports · day health</p>
      <table class="wl-ports">
        <thead><tr><th>#</th><th>Meter</th><th>φ</th><th>PF</th><th>THD</th><th>Grade</th></tr></thead>
        <tbody>
          ${rows
            .map((row) => {
              const cls = row.hh.grade === "bad" ? "is-out" : row.hh.grade === "warn" ? "is-off" : "";
              return `<tr class="${cls}"><td>${row.port}</td><td>${esc(row.h.name)} <code>${esc(row.h.serial)}</code></td><td>${row.ph}</td><td>${row.hh.avgPf.toFixed(2)}</td><td>${row.hh.avgThd.toFixed(0)}%</td><td>${row.hh.grade.toUpperCase()}</td></tr>`;
            })
            .join("")}
        </tbody>
      </table>
      <p class="wl-ov-k">Health walk</p>
      <ul class="wl-check">${check.map((c) => `<li class="${c.cls}">${esc(c.t)}</li>`).join("")}</ul>
      <p class="wl-ov-note">Day-roll health card. No clock / scrub / live W.</p>
    `;
    return;
  }

  const leakNow = leak && state.nowMin >= leak.min && state.nowMin < leak.restore;
  let boardW = 0;
  let onN = 0;
  let darkN = 0;
  const phases = { A: 0, B: 0, C: 0 };
  const rows = houses.map((h, i) => {
    const r = readingAt(h.id, state.nowMin);
    const o = houseOutage(h);
    const watts = r?.powerW || 0;
    const on = r ? r.on && !r.feederOut : false;
    boardW += watts;
    if (on) onN += 1;
    if (o) darkN += 1;
    const ph = r?.phase || h.phase || "A";
    phases[ph] = (phases[ph] || 0) + 1;
    return { h, r, o, watts, on, ph, port: i + 1 };
  });
  const hops = houses[0] ? hopsToUsb(houses[0].id) : "—";
  const check = [
    { cls: "done", t: `Pole label ${b.id} · feeder ${b.feederId} · ${b.cluster}` },
    { cls: "done", t: "Seat NESL 865B · ext 5 V / 3.3 V (workshop schematic)" },
    { cls: houses.length ? "done" : "bad", t: `Map ports 1–${houses.length} to meter serials on this pole` },
    { cls: "done", t: `Phase split A ${phases.A} · B ${phases.B} · C ${phases.C} from ${dtm?.label || "DTM"}` },
    { cls: "done", t: `Heartbeat ${SLOT_MIN} min · MQTT northbound (OpenAMI)` },
    { cls: xf ? "done" : "warn", t: xf ? `LV from ${xf.label || xf.id}` : "No xfmr id on this board" },
    {
      cls: leakNow ? "bad" : leak ? "warn" : "done",
      t: leak
        ? leakNow
          ? `Leak live on span · ${leak.label} · +${leak.leakW} W ΔP`
          : `Leak span mapped · ${leak.label} (not now)`
        : "No leak span on this pole pair",
    },
    { cls: darkN ? "bad" : "done", t: darkN ? `${darkN} meters dark from feeder/xfmr outage` : "No outage on these laterals" },
    { cls: "done", t: `RF hops to USB GW ≈ ${hops} · ${LANDMARKS.usb?.label || "USB GW"}` },
    { cls: "done", t: "SSR / AUTO disconnect is per-meter credit, not a board kill switch" },
  ];
  body.innerHTML = `
    <div class="wl-ov-grid">
      <div class="wl-ov-stat"><span>Board load</span><b>${Math.round(boardW)} W</b></div>
      <div class="wl-ov-stat ${onN === houses.length ? "ok" : "warn"}"><span>Meters on</span><b>${onN} / ${houses.length}</b></div>
    </div>
    <p class="wl-ov-k">Cabinet ports</p>
    <table class="wl-ports">
      <thead><tr><th>#</th><th>Meter</th><th>φ</th><th>W</th><th>Credit</th><th>State</th></tr></thead>
      <tbody>
        ${rows
          .map((row) => {
            const st = row.o ? "OUT" : row.on ? "ON" : "OFF";
            const cls = row.o ? "is-out" : row.on ? "" : "is-off";
            return `<tr class="${cls}"><td>${row.port}</td><td>${esc(row.h.name)} <code>${esc(row.h.serial)}</code></td><td>${row.ph}</td><td>${Math.round(row.watts)}</td><td>${(row.r?.wallet ?? 0).toFixed(0)}</td><td>${st}</td></tr>`;
          })
          .join("")}
      </tbody>
    </table>
    <p class="wl-ov-k">Install walk</p>
    <ul class="wl-check">${check.map((c) => `<li class="${c.cls}">${esc(c.t)}</li>`).join("")}</ul>
    <p class="wl-ov-note">Schematic cabinet card for workshop walk-through. Not a live ICD. Meters here are SparkMeter-class prepaid (no STS token decode).</p>
  `;
}

function openEms(id, fly, camOpts) {
  const b = boardById[id] || liveBoards[0];
  if (!b) return;
  state.emsId = b.id;
  if (state.role !== "customer") {
    setScope({ kind: "feeder", id: b.feederId, boardId: b.id }, {
      fromEms: true,
      cam: !!camOpts?.cam,
      from: camOpts?.from || "grid-ems",
    });
  }
  fillEms();
  if (fly && !camOpts?.cam) flyToXZ(b.x, b.z, 11);
  writeQuery({ board: b.id, feeder: b.feederId });
}

function closeEms() {
  state.emsId = null;
  const card = document.getElementById("wl-ems-card");
  if (card) card.hidden = true;
  writeQuery({ board: "" });
}

function stepEms(dir) {
  if (!liveBoards.length) return;
  const i = Math.max(0, liveBoards.findIndex((b) => b.id === state.emsId));
  const next = liveBoards[(i + dir + liveBoards.length) % liveBoards.length];
  openEms(next.id, false, { cam: true, from: "grid-ems" });
}

function applyRole() {
  document.documentElement.dataset.role = state.role;
  const roleEl = document.getElementById("wl-role");
  if (roleEl) roleEl.value = state.role;
  if (state.role === "customer") {
    if (!houseById[state.you]) state.you = liveHouses[0]?.id || "h0";
    state.focus = state.you;
    state.scope = { kind: "house", id: state.you };
    closeEms();
    fillCustomer();
  } else {
    const card = document.getElementById("wl-cust-card");
    if (card) card.hidden = true;
    // Do not auto-open EMS overlay — it covers the map and blocks pan/zoom.
    if (state.emsId) fillEms();
    else closeEms();
  }
  applyVisibility();
  fillHouses();
  fillGeoid();
  writeQuery({ role: state.role, you: state.role === "customer" ? state.you : "" });
}

function fillRolePanels() {
  if (state.role === "customer") fillCustomer();
  if (state.emsId) fillEms();
}

function applyQuery() {
  const q = new URLSearchParams(location.search);
  const light = q.get("light");
  if (light === "lamps" || light === "sun" || light === "fill") {
    state.light = light;
    const el = document.getElementById("wl-light");
    if (el) el.value = light;
  }
  const role = q.get("role");
  if (role === "tech" || role === "customer" || role === "ops") state.role = role;
  const you = q.get("you");
  if (you && houseById[you]) state.you = you;
  const board = q.get("board");
  if (board && boardById[board]) state.emsId = board;
  const lines = q.get("lines") || q.get("linegrad");
  if (lines) {
    state.lineGrad = parseLineGrad(lines);
    const gEl = document.getElementById("wl-linegrad");
    if (gEl) gEl.value = state.lineGrad;
  }
  const feeder = q.get("feeder");
  if (feeder && liveFeeders.some((f) => f.id === feeder) && state.role !== "customer") {
    const b = state.emsId && boardById[state.emsId]?.feederId === feeder ? state.emsId : null;
    state.scope = { kind: "feeder", id: feeder, boardId: b };
    state.scopeBoard = b;
  } else if (state.emsId && boardById[state.emsId] && state.role !== "customer") {
    const b = boardById[state.emsId];
    state.scope = { kind: "feeder", id: b.feederId, boardId: b.id };
    state.scopeBoard = b.id;
  }
  const homesEl = document.getElementById("wl-homes");
  if (homesEl) {
    const v = sizeSelectValue();
    if (![...homesEl.options].some((o) => o.value === v)) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = `Size: ${TARGET_HOMES} homes`;
      homesEl.appendChild(opt);
    }
    homesEl.value = v;
  }
  writeQuery({ homes: TARGET_HOMES, light: state.light, role: state.role });
  applyLineLegend();
  const t = Number(q.get("t"));
  return Number.isFinite(t) ? Math.max(0, Math.min(DAY_MIN, t)) : 0;
}

function bindUi() {
  fillFeederSelect();
  document.getElementById("wl-geoid-copy")?.addEventListener("click", () => {
    const pre = document.getElementById("wl-geoid-json");
    const txt = pre?.textContent || "[]";
    navigator.clipboard?.writeText(txt);
  });
  document.getElementById("wl-frame")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    frameSelection();
  });
  document.getElementById("wl-frame")?.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.getElementById("wl-play")?.addEventListener("click", () => togglePlay(1));
  document.getElementById("wl-rev")?.addEventListener("click", () => togglePlay(-1));
  document.getElementById("wl-scrub")?.addEventListener("input", (e) => {
    state.playing = false;
    syncPlayBtn();
    setNow(Number(e.target.value));
  });
  const winEl = document.getElementById("wl-window");
  winEl?.addEventListener("input", (e) => {
    boundH = Number(e.target.value);
    applyWindow();
  });
  document.getElementById("wl-win")?.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.getElementById("wl-speed")?.addEventListener("change", (e) => {
    state.speed = Number(e.target.value);
  });
  document.getElementById("wl-scheme")?.addEventListener("change", (e) => {
    state.scheme = e.target.value;
    const m = document.getElementById("wl-scheme-maint");
    if (m) m.value = state.scheme;
    applySchemeColors();
  });
  document.getElementById("wl-scheme-maint")?.addEventListener("change", (e) => {
    state.scheme = e.target.value;
    const o = document.getElementById("wl-scheme");
    if (o && [...o.options].some((opt) => opt.value === state.scheme)) o.value = state.scheme;
    applySchemeColors();
  });
  document.getElementById("wl-linegrad")?.addEventListener("change", (e) => {
    state.lineGrad = parseLineGrad(e.target.value);
    const m = document.getElementById("wl-linegrad-maint");
    if (m) m.value = state.lineGrad;
    applyLineLegend();
    colorPowerLines();
    fillHouses(true);
  });
  document.getElementById("wl-linegrad-maint")?.addEventListener("change", (e) => {
    state.lineGrad = parseLineGrad(e.target.value);
    const o = document.getElementById("wl-linegrad");
    if (o) o.value = state.lineGrad;
    applyLineLegend();
    colorPowerLines();
    fillHouses(true);
  });
  document.getElementById("wl-viz")?.addEventListener("change", (e) => {
    state.viz = e.target.value === "v1" ? "v1" : "v2";
    applyVizMode();
  });
  document.getElementById("wl-sky")?.addEventListener("change", (e) => {
    state.sky = e.target.value === "bright" ? "bright" : "dark";
    placeSun(state.nowMin);
  });
  document.getElementById("wl-light")?.addEventListener("change", (e) => {
    const v = e.target.value;
    state.light = v === "lamps" || v === "sun" ? v : "fill";
    placeSun(state.nowMin);
    colorPowerLines();
    writeQuery({ light: state.light });
  });
  document.getElementById("wl-homes")?.addEventListener("change", (e) => {
    const n = Number(e.target.value);
    if (!Number.isFinite(n) || n === TARGET_HOMES) return;
    writeQuery({ homes: n, light: state.light, role: state.role, t: Math.round(state.nowMin) }, true);
  });
  document.getElementById("wl-role")?.addEventListener("change", (e) => {
    const v = e.target.value;
    state.role = v === "tech" || v === "customer" ? v : "ops";
    applyRole();
  });
  document.getElementById("wl-ems-open")?.addEventListener("click", () => {
    if (state.role === "customer") return;
    const id = state.emsId || (state.scope?.kind === "feeder" ? state.scopeBoard : null) || liveBoards[0]?.id;
    openEms(id, false, { cam: true, from: "grid-ems" });
  });
  document.getElementById("wl-ems-open-maint")?.addEventListener("click", () => {
    document.getElementById("wl-ems-open")?.click();
  });
  document.getElementById("wl-ems-close")?.addEventListener("click", () => closeEms());
  document.getElementById("wl-ems-prev")?.addEventListener("click", () => stepEms(-1));
  document.getElementById("wl-ems-next")?.addEventListener("click", () => stepEms(1));
  document.getElementById("wl-you")?.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!houseById[id]) return;
    state.you = id;
    state.focus = id;
    state.scope = { kind: "house", id };
    fillCustomer();
    writeQuery({ you: id, role: "customer" });
  });
  document.querySelectorAll("[data-hide]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-hide");
      state.hide[k] = !state.hide[k];
      btn.classList.toggle("off", state.hide[k]);
      applyVisibility();
    });
  });
  const anomBtn = document.getElementById("wl-anomaly");
  const anomMaint = document.getElementById("wl-anomaly-maint");
  function toggleAnomaly() {
    state.anomalyOnly = !state.anomalyOnly;
    anomBtn?.classList.toggle("on", state.anomalyOnly);
    anomMaint?.classList.toggle("on", state.anomalyOnly);
    applyVisibility();
    fillHouses(true);
  }
  anomBtn?.addEventListener("click", toggleAnomaly);
  anomMaint?.addEventListener("click", toggleAnomaly);
  const dayOutBtn = document.getElementById("wl-day-outages");
  dayOutBtn?.addEventListener("click", () => {
    state.dayOutages = !state.dayOutages;
    dayOutBtn.classList.toggle("on", state.dayOutages);
    const hint = document.getElementById("wl-mode-hint");
    if (hint) {
      hint.textContent = state.dayOutages
        ? `Day outages on — ${liveOutages.length} event(s); red = any home/line dark sometime today. Click again to clear.`
        : MODE_META.operations?.hint || "";
    }
    colorPowerLines();
  });
  const qEl = document.getElementById("wl-house-q");
  qEl?.addEventListener("input", () => {
    state.houseQ = qEl.value || "";
    fillHouses(true);
  });
  document.getElementById("wl-feeder-clear")?.addEventListener("click", () => {
    setScope({ kind: "village" }, { cam: true, from: "clear" });
  });
  const chips = document.getElementById("wl-house-clusters");
  if (chips && !chips.dataset.ready) {
    chips.innerHTML = ["all", ...CLUSTERS.map((c) => c.id)]
      .map((id) => {
        const label = id === "all" ? "all" : CLUSTERS.find((c) => c.id === id)?.label || id;
        return `<button type="button" data-cl="${id}">${label}</button>`;
      })
      .join("");
    chips.dataset.ready = "1";
    chips.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cl]");
      if (!btn) return;
      state.houseCluster = btn.getAttribute("data-cl");
      fillHouses(true);
    });
  }
  const fsBtn = document.getElementById("wl-fs");
  const theater = document.getElementById("wl-theater");
  function fsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function syncFsBtn() {
    if (fsBtn) fsBtn.textContent = fsEl() === theater ? "Exit" : "Fullscreen";
  }
  function toggleFs() {
    if (!theater) return;
    if (fsEl() === theater) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    } else {
      const req = theater.requestFullscreen || theater.webkitRequestFullscreen;
      if (req) req.call(theater);
    }
  }
  fsBtn?.addEventListener("click", toggleFs);
  const panCode = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" };
  document.addEventListener("keydown", (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === "KeyF") {
      e.preventDefault();
      toggleFs();
      return;
    }
    // Esc → full village (ground click does the same). Build owns Esc while placing.
    if (e.key === "Escape") {
      if (appMode === "build" && buildMode?.isActive()) return;
      if (camMag !== 0 || (state.scope && state.scope.kind !== "village")) {
        e.preventDefault();
        setScope({ kind: "village" }, { cam: true, from: "clear" });
      }
      return;
    }
    const pan = panCode[e.code];
    if (!pan) return;
    panKeys.add(pan);
    e.preventDefault();
  });
  document.addEventListener("keyup", (e) => {
    const pan = panCode[e.code];
    if (pan) panKeys.delete(pan);
  });
  window.addEventListener("blur", () => panKeys.clear());
  function afterFs() {
    syncFsBtn();
    resize();
    requestAnimationFrame(() => {
      resize();
      drawFsLoad();
    });
  }
  document.addEventListener("fullscreenchange", afterFs);
  document.addEventListener("webkitfullscreenchange", afterFs);
}

function svgDonut(segments, size = 88) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  let off = 0;
  const arcs = segments
    .map((seg) => {
      const len = (Math.max(0, seg.value) / total) * c;
      const dash = `${len} ${c - len}`;
      const el = `<circle cx="44" cy="44" r="${r}" fill="none" stroke="${seg.color}" stroke-width="10"
        stroke-dasharray="${dash}" stroke-dashoffset="${-off}" transform="rotate(-90 44 44)"/>`;
      off += len;
      return el;
    })
    .join("");
  return `<svg viewBox="0 0 88 88" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="44" cy="44" r="${r}" fill="none" stroke="#2a2a2e" stroke-width="10"/>
    ${arcs}
  </svg>`;
}

function svgScoreRing(hit, miss, size = 64) {
  const total = Math.max(1, hit + miss);
  const r = 24;
  const c = 2 * Math.PI * r;
  const hitLen = (hit / total) * c;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#2a2a2e" stroke-width="7"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#b42318" stroke-width="7"
      stroke-dasharray="${c}" stroke-dashoffset="0" transform="rotate(-90 32 32)" opacity="0.35"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#3b6d11" stroke-width="7"
      stroke-dasharray="${hitLen} ${c - hitLen}" stroke-dashoffset="0" transform="rotate(-90 32 32)"/>
  </svg>`;
}

function kpiGaugeHtml(r) {
  const hit = kpiHit(r);
  const scale = Math.max(Math.abs(r.actual), Math.abs(r.target), 1) * 1.12;
  const fillPct = Math.min(100, (Math.abs(r.actual) / scale) * 100);
  const markPct = Math.min(100, (Math.abs(r.target) / scale) * 100);
  const actualTxt = `${fmtKpi(r, "actual")}${r.uom === "#" || r.uom === "$" ? "" : ` ${r.uom}`}`;
  const uomSuffix = r.uom === "#" ? "" : ` ${r.uom}`;
  return `<button type="button" class="kpi-gauge${kpiUi.focusId === r.id ? " is-focus" : ""}" role="listitem"
    data-kpi="${esc(r.id)}" data-focus="${esc(r.focus || "")}" title="Focus: ${esc(r.focus || r.id)}">
    <div class="kpi-gauge-top">
      <span class="kpi-name">${esc(r.label)}</span>
      <span class="kpi-actual ${hit ? "is-hit" : "is-miss"}">${esc(actualTxt)}</span>
    </div>
    <div class="kpi-track" aria-hidden="true">
      <div class="kpi-fill ${hit ? "" : "is-miss"}" style="width:${fillPct.toFixed(1)}%"></div>
      <div class="kpi-mark" style="left:${markPct.toFixed(1)}%"></div>
    </div>
    <div class="kpi-gauge-meta">
      <span>target ${esc(fmtKpi(r, "target"))}${esc(uomSuffix)}</span>
      <span>${hit ? "on target" : r.better === "higher" ? "below" : "above"}</span>
    </div>
  </button>`;
}

function fillStats() {
  const s = day.summary;
  const el = document.getElementById("wl-stats");
  if (!el) return;
  const pvKWh = s.pvKWh ?? 0;
  const loadKWh = s.kWh ?? 0;
  const dieselKWh = Math.max(0, Math.round((loadKWh - pvKWh) * 10) / 10);
  const outN = (s.outages || []).length;
  const leakN = s.leaks ?? liveLeaks.length;
  const cap80 = s.cap80 ?? 0;
  const cap100 = s.cap100 ?? 0;
  const pfN = s.pfWarns ?? 0;
  const smsN = s.sms ?? 0;
  const barMax = Math.max(1, outN, leakN, cap80 + cap100, pfN, smsN);
  const bars = [
    { lab: "Outages", n: outN, tone: "is-bad" },
    { lab: "Leak spans", n: leakN, tone: "is-warn" },
    { lab: "Cap warn", n: cap80 + cap100, tone: "is-warn" },
    { lab: "PF warn", n: pfN, tone: "is-info" },
    { lab: "SMS", n: smsN, tone: "" },
  ];
  el.innerHTML = `
    <div class="dt-hero">
      <div class="dt-metric">
        <strong class="dt-v">${s.customers}</strong>
        <span class="dt-k">homes</span>
        <span class="dt-s">${liveHouses.length * PEOPLE_PER_HOME} people</span>
      </div>
      <div class="dt-metric">
        <strong class="dt-v">${s.kWh}</strong>
        <span class="dt-k">kWh used</span>
        <span class="dt-s">billed ${s.billed}</span>
      </div>
      <div class="dt-metric">
        <strong class="dt-v">${s.payments}</strong>
        <span class="dt-k">payments</span>
        <span class="dt-s">${s.paymentSum}</span>
      </div>
    </div>
    <div class="dt-row">
      <div class="dt-donut-wrap">
        ${svgDonut([
          { value: pvKWh, color: "#e6c84a" },
          { value: dieselKWh, color: "#8a8a82" },
          { value: Math.max(0.01, loadKWh * 0.02), color: "#b42318" },
        ])}
        <div class="dt-donut-center">
          <strong>${loadKWh}</strong>
          <span>kWh</span>
        </div>
      </div>
      <ul class="dt-leg">
        <li><i style="background:#e6c84a"></i><span>Solar day</span><b>${pvKWh} kWh</b></li>
        <li><i style="background:#8a8a82"></i><span>Diesel fill</span><b>${dieselKWh} kWh</b></li>
        <li><i style="background:#175cd3"></i><span>Peak live</span><b>${s.peakFeederW} W</b></li>
        <li><i style="background:#2bb6a3"></i><span>PV nameplate</span><b>${Math.round((s.pvNameplateW || 0) / 1000)} kW</b></li>
      </ul>
    </div>
    <p class="dt-sec">Anomalies today</p>
    <div class="dt-bars">
      ${bars
        .map(
          (b) => `<div class="dt-bar-row">
        <span>${b.lab}</span>
        <div class="dt-bar-track"><div class="dt-bar-fill ${b.tone}" style="width:${((b.n / barMax) * 100).toFixed(1)}%"></div></div>
        <span>${b.n}</span>
      </div>`,
        )
        .join("")}
    </div>
    <div class="dt-meta">
      <span><b>${liveDtms.length}</b> DTMs · <b>${liveFeeders.length}</b> feeders</span>
      <span>heartbeat <b>${s.heartbeatMin} min</b></span>
      <span>cuts <b>${s.cutoffs}</b> · overload <b>${s.overloads ?? 0}</b></span>
      <span>GB <b>${s.lastBreathArrived}</b> / silent <b>${s.lastBreathSilent}</b></span>
    </div>
    ${s.faultAt ? `<p class="dt-note">${esc(s.faultAt)}</p>` : ""}
  `;
  const note = document.getElementById("wl-fault-note");
  if (note && s.outages?.length) {
    note.textContent =
      " Outages (schematic): " +
      s.outages
        .map(
          (o) =>
            `${fmtClock(o.min)}–${fmtClock(o.restore)} ${o.label} (${o.nDark} meters; last breath ${o.lastBreathArrived} GB / ${o.lastBreathSilent} silent)`,
        )
        .join("; ") +
      `. Last breath needs ≤${LAST_BREATH_MAX_HOPS} hops; RF channel cap ${RF_CHANNEL_CAP}.`;
  }
}

/** @type {{ cat: string, missOnly: boolean, focusId: string | null, report: ReturnType<typeof buildKpiReport> | null }} */
const kpiUi = { cat: "all", missOnly: false, focusId: null, report: null };

function fillKpi() {
  const board = document.getElementById("wl-kpi-board");
  const head = document.getElementById("wl-kpi-head");
  const catEl = document.getElementById("wl-kpi-cat");
  if (!board) return;
  const report = buildKpiReport(day, { houseN: liveHouses.length, scopeFeederId: activeFeederId() });
  kpiUi.report = report;
  const groups = kpiGroupsForMode(report.groups, appMode);
  const { hitN, missN } = kpiScore(groups);
  if (catEl) {
    const prev = kpiUi.cat;
    catEl.innerHTML =
      `<option value="all">All categories</option>` +
      groups.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join("");
    const still = prev === "all" || groups.some((g) => g.id === prev);
    kpiUi.cat = still ? prev : "all";
    catEl.value = kpiUi.cat;
  }
  const total = hitN + missN;
  const pct = total ? Math.round((hitN / total) * 100) : 0;
  if (head) {
    head.hidden = total === 0;
    head.innerHTML = `
      <div class="kpi-score-ring">
        ${svgScoreRing(hitN, missN)}
        <div class="kpi-score-lab"><strong>${pct}%</strong><span>hit</span></div>
      </div>
      <p id="wl-kpi-sum">${hitN} on target · ${missN} miss · ${esc(report.periodLabel)}</p>
    `;
  }
  const parts = [];
  for (const g of groups) {
    if (kpiUi.cat !== "all" && g.id !== kpiUi.cat) continue;
    const rows = g.rows.filter((r) => !kpiUi.missOnly || !kpiHit(r));
    if (!rows.length) continue;
    parts.push(`<section>
      <h3 class="kpi-group-title">${esc(g.label)}</h3>
      <div class="kpi-gauges">${rows.map(kpiGaugeHtml).join("")}</div>
    </section>`);
  }
  board.innerHTML = parts.join("") || `<p class="dt-note">No metrics in this filter.</p>`;
}

function focusKpiRow(focusKey, kpiId) {
  kpiUi.focusId = kpiId || null;
  const key = focusKey || "";
  if (key === "production") {
    state.anomalyOnly = false;
    state.scheme = "capacity";
    state.hide.leak = true;
    state.hide.disconnect = true;
    setScope({ kind: "village" }, { cam: true, from: "kpi" });
  } else if (key === "customer") {
    state.anomalyOnly = false;
    state.scheme = "messages";
    if (!activeFeederId() && liveFeeders[0]) {
      setScope({ kind: "feeder", id: liveFeeders[0].id }, { cam: true, from: "kpi" });
    } else {
      setScope(state.scope?.kind === "feeder" ? state.scope : { kind: "village" }, { cam: true, from: "kpi" });
    }
  } else if (key === "losses") {
    state.anomalyOnly = true;
    state.hide.leak = false;
    state.hide.disconnect = true;
    const lk = liveLeaks[0];
    if (lk) setScope({ kind: "feeder", id: lk.feederId, boardId: lk.fromBoardId }, { cam: true, from: "kpi" });
  } else if (key === "battery") {
    state.anomalyOnly = false;
    state.scheme = "asset";
    setScope({ kind: "village" }, { cam: true, from: "kpi" });
  } else if (key === "generator") {
    state.anomalyOnly = false;
    state.scheme = "capacity";
    setScope({ kind: "village" }, { cam: true, from: "kpi" });
  } else if (key === "outages" || key === "uptime") {
    state.anomalyOnly = true;
    state.hide.disconnect = false;
    state.hide.leak = true;
    const o = (day.summary.outages || [])[0];
    if (o?.feederId) setScope({ kind: "feeder", id: o.feederId }, { cam: true, from: "kpi" });
    else setScope({ kind: "village" }, { cam: true, from: "kpi" });
  } else if (key === "operations") {
    state.anomalyOnly = false;
    state.scheme = "messages";
    document.getElementById("wl-kpi-board")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  document.getElementById("wl-anomaly")?.classList.toggle("on", state.anomalyOnly);
  document.getElementById("wl-anomaly-maint")?.classList.toggle("on", state.anomalyOnly);
  document.querySelectorAll("[data-hide]").forEach((btn) => {
    const k = btn.getAttribute("data-hide");
    if (!k) return;
    btn.classList.toggle("off", !!state.hide[k]);
  });
  applySchemeColors();
  applyVisibility();
  fillKpi();
  fillHouses(true);
}

function bindKpiUi() {
  const catEl = document.getElementById("wl-kpi-cat");
  catEl?.addEventListener("change", () => {
    kpiUi.cat = catEl.value || "all";
    fillKpi();
  });
  const missBtn = document.getElementById("wl-kpi-miss-only");
  missBtn?.addEventListener("click", () => {
    kpiUi.missOnly = !kpiUi.missOnly;
    missBtn.classList.toggle("on", kpiUi.missOnly);
    fillKpi();
  });
  document.getElementById("wl-kpi-board")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".kpi-gauge[data-kpi]");
    if (!btn) return;
    focusKpiRow(btn.getAttribute("data-focus") || "", btn.getAttribute("data-kpi") || "");
  });
  document.getElementById("wl-kpi-open")?.addEventListener("click", () => {
    const panel = document.querySelector(".panel-kpi");
    panel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    fillKpi();
  });
  document.getElementById("wl-kpi-open-maint")?.addEventListener("click", () => {
    const panel = document.querySelector(".panel-kpi");
    panel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    fillKpi();
  });
}

function fillLedger() {
  const el = document.getElementById("wl-ledger");
  if (!el) return;
  const rows = day.events.filter((e) => e.kind !== "reading" && e.kind !== "off" && e.kind !== "credit");
  const keep = rows.length > 80 ? rows.slice(-80) : rows;
  el.innerHTML = keep
    .map((e) => {
      const name = e.houseId ? houseById[e.houseId]?.name || e.houseId : "site";
      return `<tr class="k-${e.kind}"><td>${fmtClock(e.min)}</td><td>${e.kind}</td><td>${name}</td><td>${e.note}</td></tr>`;
    })
    .join("");
}

function fillLog() {
  const el = document.getElementById("wl-log");
  if (!el) return;
  const rows = day.events.filter(
    (e) => e.min <= state.nowMin && e.kind !== "reading" && e.kind !== "off" && (!state.focus || e.houseId === state.focus || !e.houseId),
  );
  const last = rows.slice(-8).reverse();
  el.innerHTML = last
    .map((e) => {
      const name = e.houseId ? houseById[e.houseId]?.name || e.houseId : "site";
      return `<li class="k-${e.kind}"><time>${fmtClock(e.min)}</time> <b>${e.kind}</b> ${name} — ${e.note}</li>`;
    })
    .join("");
}

function boardsOnFeeder(fid) {
  return liveBoards.filter((b) => b.feederId === fid).sort(
    (a, b) => (a.boardIdx ?? 0) - (b.boardIdx ?? 0) || String(a.id).localeCompare(String(b.id)),
  );
}

function onFeederGridClick(e) {
  const cell = e.target.closest("button.feeder-cell[data-h]");
  if (cell) {
    const id = cell.getAttribute("data-h");
    const h = houseById[id];
    if (!h) return;
    if (state.focus === id && camMag >= 3) {
      setScope({ kind: "feeder", id: h.feederId, boardId: h.boardId }, { cam: true, from: "grid-ems" });
    } else {
      setScope({ kind: "feeder", id: h.feederId, houseId: id, boardId: h.boardId }, { cam: true, from: "grid-home" });
    }
    return;
  }
  const leakBtn = e.target.closest("button.feeder-leak[data-leak]");
  if (leakBtn) {
    const bid = leakBtn.getAttribute("data-board");
    const b = boardById[bid];
    if (b) setScope({ kind: "feeder", id: b.feederId, boardId: b.id }, { cam: true, from: "grid-ems" });
    return;
  }
  const lab = e.target.closest("button.feeder-row-lab[data-board]");
  if (!lab) return;
  const bid = lab.getAttribute("data-board");
  const b = boardById[bid];
  if (!b) return;
  if (state.role === "tech") openEms(bid, false, { cam: true, from: "grid-ems" });
  else {
    setScope({ kind: "feeder", id: b.feederId, boardId: b.id }, { cam: true, from: "grid-ems" });
  }
}

function onBuildFeederGridClick(e) {
  if (!buildMode) return;
  const cell = e.target.closest("button.feeder-cell[data-h]");
  if (cell) {
    const id = cell.getAttribute("data-h");
    const h = houseById[id];
    if (!h) return;
    buildMode.focusHouse(id);
    setScope({ kind: "feeder", id: h.feederId, houseId: id, boardId: h.boardId }, { cam: true, from: "grid-home" });
    return;
  }
  const lab = e.target.closest("button.feeder-row-lab[data-board]");
  if (!lab) return;
  const bid = lab.getAttribute("data-board");
  const b = boardById[bid];
  if (!b) return;
  buildMode.focusBoard(bid);
  setScope({ kind: "feeder", id: b.feederId, boardId: b.id }, { cam: true, from: "grid-ems" });
}

function xsectSeg(kind) {
  return `<span class="wl-xsect-seg" aria-hidden="true">${buildSvgIcon(kind, 16)}</span>`;
}

function xsectNodeBtn({ asset, label, title, status, pending, on, attrs }) {
  const cls = [
    "wl-xsect-btn",
    status === "green" ? "build-green" : status === "red" ? "build-red" : "",
    pending ? "build-pending" : "",
    on ? "on" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const attrStr = Object.entries(attrs || {})
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(" ");
  return `<button type="button" class="${cls}" title="${esc(title || label)}" ${attrStr}>
    ${buildSvgIcon(asset, 18)}
  </button>
  <span class="wl-xsect-lab">${esc(label)}</span>`;
}

function fillBuildCrossSection() {
  const wrap = document.getElementById("wl-build-xsect");
  const spine = document.getElementById("wl-build-xsect-spine");
  const sub = document.getElementById("wl-build-xsect-sub");
  if (!wrap || !spine) return;
  const show = appMode === "build" && !!buildMode && !!activeFeederId();
  wrap.hidden = !show;
  wrap.setAttribute("aria-hidden", show ? "false" : "true");
  if (!show) {
    spine.innerHTML = "";
    if (sub) sub.textContent = "Select a feeder";
    return;
  }
  const fid = activeFeederId();
  const f = liveFeeders.find((x) => x.id === fid);
  const dtm = liveDtms.find((d) => d.feederId === fid);
  const boards = boardsOnFeeder(fid);
  const pendingH = buildMode.getPendingHouseId();
  const pendingB = buildMode.getPendingBoardId();
  const focusH = state.focus;
  const focusB = state.scopeBoard;
  if (sub) {
    sub.textContent = `${f?.label || fid} · station → DTM → EMS poles → meters`;
  }
  const parts = [];
  const st = STATIONS[0];
  if (st) {
    parts.push(`<div class="wl-xsect-node is-head" role="listitem">
      ${xsectNodeBtn({
        asset: "station",
        label: "Station",
        title: st.label || "Village station",
        attrs: { "data-xsect": "station", "data-id": st.id },
      })}
    </div>`);
    parts.push(xsectSeg("trunk"));
  }
  parts.push(`<div class="wl-xsect-node" role="listitem">
    ${xsectNodeBtn({
      asset: "dtm",
      label: "DTM",
      title: dtm?.label || `DTM · ${fid}`,
      attrs: { "data-xsect": "dtm", "data-feeder": fid },
    })}
  </div>`);
  let lastXfmr = null;
  for (const b of boards) {
    parts.push(xsectSeg("primary"));
    const xf = TRANSFORMERS.find((t) => t.id === b.xfmrId);
    if (xf && xf.id !== lastXfmr) {
      lastXfmr = xf.id;
      parts.push(`<div class="wl-xsect-node" role="listitem">
        ${xsectNodeBtn({
          asset: "xfmr",
          label: "Xfmr",
          title: xf.label || xf.id,
          attrs: { "data-xsect": "xfmr", "data-id": xf.id },
        })}
      </div>`);
      parts.push(xsectSeg("secondary"));
    }
    const stBoard = buildMode.boardStatus(b.id);
    const lab = String(b.id || "").replace(/^ems-/, "E");
    const homes = (b.houseIds || []).map((hid) => houseById[hid]).filter(Boolean);
    const drops = homes
      .map((h) => {
        const hs = buildMode.houseStatus(h.id);
        const dcls = [
          "wl-xsect-drop",
          hs === "green" ? "build-green" : "build-red",
          pendingH === h.id ? "build-pending" : "",
          focusH === h.id ? "on" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<button type="button" class="${dcls}" data-xsect="meter" data-h="${esc(h.id)}" title="${esc(h.name)} · ${esc(h.serial)} · ${hs === "green" ? "configured" : "unmapped"}">
          ${buildSvgIcon("meter", 12)}
        </button>`;
      })
      .join("");
    parts.push(`<div class="wl-xsect-node" role="listitem">
      ${xsectNodeBtn({
        asset: "ems",
        label: lab,
        title: `${b.label} · ${stBoard === "green" ? "EMS configured" : "map EMS + set API"}`,
        status: stBoard,
        pending: pendingB === b.id,
        on: focusB === b.id,
        attrs: { "data-xsect": "ems", "data-board": b.id },
      })}
      <div class="wl-xsect-drops">${drops}</div>
    </div>`);
  }
  spine.innerHTML = parts.join("");
  if (!spine.dataset.bound) {
    spine.dataset.bound = "1";
    spine.addEventListener("click", onBuildXsectClick);
  }
}

function onBuildXsectClick(e) {
  if (!buildMode || appMode !== "build") return;
  const meter = e.target.closest("button[data-xsect='meter'][data-h]");
  if (meter) {
    const id = meter.getAttribute("data-h");
    const h = houseById[id];
    if (!h) return;
    buildMode.focusHouse(id);
    setScope({ kind: "feeder", id: h.feederId, houseId: id, boardId: h.boardId }, { cam: true, from: "xsect-home" });
    return;
  }
  const ems = e.target.closest("button[data-xsect='ems'][data-board]");
  if (ems) {
    const bid = ems.getAttribute("data-board");
    const b = boardById[bid];
    if (!b) return;
    buildMode.focusBoard(bid);
    setScope({ kind: "feeder", id: b.feederId, boardId: b.id }, { cam: true, from: "xsect-ems" });
    return;
  }
  const dtm = e.target.closest("button[data-xsect='dtm'][data-feeder]");
  if (dtm) {
    const fid = dtm.getAttribute("data-feeder");
    if (fid) setScope({ kind: "feeder", id: fid }, { cam: true, from: "xsect-dtm" });
    return;
  }
  const xf = e.target.closest("button[data-xsect='xfmr'][data-id]");
  if (xf) {
    const id = xf.getAttribute("data-id");
    const t = TRANSFORMERS.find((x) => x.id === id);
    if (t?.feederId) setScope({ kind: "feeder", id: t.feederId, boardId: state.scopeBoard }, { cam: true, from: "xsect-xfmr" });
    return;
  }
  const st = e.target.closest("button[data-xsect='station']");
  if (st) {
    setScope({ kind: "village" }, { cam: true, from: "xsect-station" });
  }
}

function currentSiteId() {
  return document.getElementById("wl-site")?.value || "voundou";
}

function syncProjectChip() {
  const chip = document.getElementById("wl-project-chip");
  if (!chip || !projectDoc) return;
  const n = buildMode?.getPlaced?.()?.length || 0;
  chip.textContent = projectDoc.name || "Untitled";
  chip.title = `${projectDoc.name} · ${n} build asset(s) · ${projectDoc.id}`;
}

function captureProjectDoc() {
  if (!projectDoc) {
    projectDoc = blankProject({
      name: "Untitled village",
      siteId: currentSiteId(),
      homes: TARGET_HOMES,
    });
  }
  projectDoc.siteId = emptyCanvas ? "blank" : currentSiteId();
  projectDoc.homes = TARGET_HOMES;
  projectDoc.emptyScene = emptyCanvas;
  projectDoc.origin = emptyCanvas
    ? { lon: ORIGIN.lon, lat: ORIGIN.lat, name: ORIGIN.name }
    : projectDoc.origin || null;
  projectDoc.build = buildMode?.getSnapshot?.() || {
    placed: [],
    configs: {},
    houseMap: {},
    boardMap: {},
    seq: 0,
    batchSeq: 0,
  };
  if (liveHouses.length && liveHouses !== HOUSES) {
    projectDoc.homes = liveHouses.length;
    projectDoc.sampleDay = {
      customers: day.summary.customers,
      kWh: day.summary.kWh,
      billed: day.summary.billed,
      outages: liveOutages.map((o) => ({ id: o.id, min: o.min, restore: o.restore, note: o.note })),
      leaks: liveLeaks.map((lk) => ({ id: lk.id, leakW: lk.leakW, kind: lk.kind, note: lk.note })),
      payments: day.summary.payments,
      sms: day.summary.sms,
      cutoffs: day.summary.cutoffs,
    };
  } else {
    projectDoc.sampleDay = null;
  }
  return projectDoc;
}

function applyProjectDoc(doc, { switchSite = false } = {}) {
  projectDoc = doc;
  if (buildMode && doc.build) buildMode.loadSnapshot(doc.build);
  syncProjectChip();
  if (appMode === "build") fillBuildPanel();
  const hint = document.getElementById("wl-build-hint");
  if (hint && appMode === "build") {
    hint.textContent = `Project “${doc.name}” · ${doc.build?.placed?.length || 0} assets`;
  }
  const blank = !!(doc.emptyScene || doc.siteId === "blank");
  if (blank) {
    enterEmptyCanvas(doc.origin);
    syncLiveFromBuild();
    if (doc.mapPack?.styleUrl) {
      locusMap?.useLocalStyle?.(doc.mapPack.styleUrl).then(async () => {
        const url = doc.osm?.url || doc.mapPack?.osmUrl;
        if (!url) return;
        const r = await fetch(url);
        if (r.ok) addSiteOsmLayers(locusMap.map, await r.json());
      }).catch(() => {});
    }
    return;
  }
  if (emptyCanvas) leaveEmptyCanvas();
  if (switchSite && doc.siteId && doc.siteId !== currentSiteId()) {
    const siteEl = document.getElementById("wl-site");
    if (siteEl && [...siteEl.options].some((o) => o.value === doc.siteId)) {
      siteEl.value = doc.siteId;
      writeQuery({ site: doc.siteId === "voundou" ? "" : doc.siteId });
      mountPackForSite(doc.siteId);
    }
  }
}

function closeFileMenu() {
  const drop = document.getElementById("wl-file-drop");
  const btn = document.getElementById("wl-file-btn");
  if (drop) drop.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function closeProjectModal() {
  const modal = document.getElementById("wl-proj-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
}

function openProjectModal({ title, sub, bodyHtml, actions }) {
  const modal = document.getElementById("wl-proj-modal");
  const titleEl = document.getElementById("wl-proj-modal-title");
  const subEl = document.getElementById("wl-proj-modal-sub");
  const body = document.getElementById("wl-proj-modal-body");
  const acts = document.getElementById("wl-proj-modal-actions");
  if (!modal || !body || !acts) return;
  if (titleEl) titleEl.textContent = title || "Project";
  if (subEl) subEl.textContent = sub || "";
  body.innerHTML = bodyHtml || "";
  acts.innerHTML = "";
  for (const a of actions || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.label;
    if (a.primary) b.className = "primary";
    b.addEventListener("click", () => a.onClick?.());
    acts.appendChild(b);
  }
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  body.querySelector("input")?.focus?.();
}

function projectSave(asNewName = false) {
  const doc = captureProjectDoc();
  if (asNewName || !doc.name || doc.name === "Untitled village") {
    openProjectModal({
      title: asNewName ? "Save as" : "Save project",
      sub: "Stored in this browser (localStorage). Also downloads a JSON backup.",
      bodyHtml: `<label for="wl-proj-name">Project name</label>
        <input id="wl-proj-name" type="text" value="${esc(doc.name)}" maxlength="80" />`,
      actions: [
        { label: "Cancel", onClick: closeProjectModal },
        {
          label: "Save",
          primary: true,
          onClick: () => {
            const name = document.getElementById("wl-proj-name")?.value?.trim() || "Untitled village";
            if (asNewName) {
              projectDoc = {
                ...captureProjectDoc(),
                id: blankProject().id,
                name,
                createdAt: new Date().toISOString(),
              };
            } else {
              projectDoc.name = name;
            }
            const saved = saveProject(captureProjectDoc());
            downloadJson(saved, `${slugName(saved.name)}.village.json`);
            syncProjectChip();
            closeProjectModal();
          },
        },
      ],
    });
    return;
  }
  const saved = saveProject(doc);
  downloadJson(saved, `${slugName(saved.name)}.village.json`);
  syncProjectChip();
}

function projectNew() {
  openProjectModal({
    title: "New project",
    sub: "Empty map. Town, address, or lat, lon — or leave blank and pick on the map.",
    bodyHtml: `<label for="wl-proj-name">Project name</label>
      <input id="wl-proj-name" type="text" value="Untitled village" maxlength="80" />
      <label for="wl-proj-place">Place</label>
      <input id="wl-proj-place" type="text" placeholder="Voundou, Cameroon  ·  or  4.792, 11.534" autocomplete="off" />`,
    actions: [
      { label: "Cancel", onClick: closeProjectModal },
      {
        label: "Create",
        primary: true,
        onClick: async () => {
          const name = document.getElementById("wl-proj-name")?.value?.trim() || "Untitled village";
          const q = document.getElementById("wl-proj-place")?.value?.trim();
          let pin = null;
          if (q) {
            try {
              pin = await resolvePlace(q);
            } catch (err) {
              alert(err?.message || String(err));
              return;
            }
          }
          const placeName = pin?.label || name;
          buildMode?.clearAll?.();
          projectDoc = blankProject({
            name,
            siteId: "blank",
            homes: TARGET_HOMES,
            emptyScene: true,
            origin: pin ? { lon: pin.lon, lat: pin.lat, name: placeName } : null,
          });
          enterEmptyCanvas(pin ? { lon: pin.lon, lat: pin.lat, name: placeName } : null);
          syncProjectChip();
          if (appMode === "build") fillBuildPanel();
          closeProjectModal();
        },
      },
    ],
  });
}

function projectOpen() {
  const rows = listProjects();
  const listHtml = rows.length
    ? `<ul class="wl-proj-list">${rows
        .map(
          (p) => `<li>
        <button type="button" class="pick" data-open-id="${esc(p.id)}">
          <strong>${esc(p.name)}</strong>
          <span class="meta">${p.assetCount} assets · ${esc((p.updatedAt || "").slice(0, 19).replace("T", " "))}${p.recent ? " · recent" : ""}</span>
        </button>
        <button type="button" class="del" data-del-id="${esc(p.id)}" title="Delete">✕</button>
      </li>`,
        )
        .join("")}</ul>`
    : `<p>No saved projects in this browser yet. Use Save, or Import a JSON/GeoJSON file.</p>`;
  openProjectModal({
    title: "Open project",
    sub: "Projects saved in this browser.",
    bodyHtml: listHtml,
    actions: [{ label: "Close", onClick: closeProjectModal }],
  });
  const body = document.getElementById("wl-proj-modal-body");
  body?.querySelectorAll("[data-open-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-open-id");
      const doc = getProject(id);
      if (!doc) return;
      applyProjectDoc(doc);
      closeProjectModal();
    });
  });
  body?.querySelectorAll("[data-del-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-del-id");
      if (!id || !confirm("Delete this saved project?")) return;
      deleteProject(id);
      projectOpen();
    });
  });
}

async function projectImportFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  let lastDoc = null;
  for (const file of files) {
    const data = await readJsonFile(file);
    lastDoc = normalizeImport(data, {
      siteId: emptyCanvas ? "blank" : currentSiteId(),
      homes: TARGET_HOMES,
      fileName: file.name,
      origin: emptyCanvas && projectDoc?.origin ? projectDoc.origin : null,
    });
  }
  if (lastDoc) {
    applyProjectDoc(lastDoc);
    saveProject(lastDoc);
  }
}

function projectExportJson() {
  const doc = captureProjectDoc();
  downloadJson(doc, `${slugName(doc.name)}.village.json`);
}

function projectExportGeo() {
  const doc = captureProjectDoc();
  const fc = placedToGeoJSON(doc.build?.placed || [], {
    name: doc.name,
    siteId: doc.siteId,
    emptyScene: doc.emptyScene,
    origin: doc.origin,
  });
  downloadJson(fc, `${slugName(doc.name)}.geojson`);
}

function bindProjectMenu() {
  projectDoc = blankProject({
    name: "Untitled village",
    siteId: currentSiteId(),
    homes: TARGET_HOMES,
  });
  syncProjectChip();

  const pinGo = async () => {
    const q = document.getElementById("wl-pin-place")?.value?.trim();
    if (!q) {
      setPinStatus("Need a place or lat, lon");
      return;
    }
    setPinStatus("Looking up place…");
    try {
      const pin = await resolvePlace(q);
      adoptMapOrigin(pin.lon, pin.lat, pin.label || projectDoc?.name || "New village");
    } catch (err) {
      setPinStatus(err?.message || String(err));
    }
  };
  document.getElementById("wl-pin-go")?.addEventListener("click", pinGo);
  document.getElementById("wl-pin-place")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pinGo();
  });

  const btn = document.getElementById("wl-file-btn");
  const drop = document.getElementById("wl-file-drop");
  const importEl = document.getElementById("wl-file-import");
  const modal = document.getElementById("wl-proj-modal");

  btn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!drop) return;
    document.getElementById("wl-layers-panel")?.setAttribute("aria-hidden", "true");
    document.getElementById("wl-layers-rail")?.setAttribute("aria-expanded", "false");
    document.getElementById("wl-theater")?.classList.remove("layers-open");
    requestAnimationFrame(() => {
      resize();
      window.setTimeout(resize, 240);
    });
    const open = drop.hidden;
    drop.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  drop?.addEventListener("click", (e) => {
    const act = e.target.closest("[data-file-act]")?.getAttribute("data-file-act");
    if (!act) return;
    e.preventDefault();
    closeFileMenu();
    if (act === "new") projectNew();
    else if (act === "open") projectOpen();
    else if (act === "import") importEl?.click();
    else if (act === "save") projectSave(false);
    else if (act === "save-as") projectSave(true);
    else if (act === "export") projectExportJson();
    else if (act === "export-geo") projectExportGeo();
  });

  importEl?.addEventListener("change", async () => {
    try {
      await projectImportFiles(importEl.files);
    } catch (err) {
      alert(err?.message || String(err));
    }
    importEl.value = "";
  });

  document.addEventListener("pointerdown", (e) => {
    const menu = document.getElementById("wl-file-menu");
    if (menu && !menu.contains(/** @type {Node} */ (e.target))) closeFileMenu();
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeProjectModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden) {
      closeProjectModal();
      e.preventDefault();
    }
  });
}

function bindBuildConfigForm() {
  const kindEl = document.getElementById("wl-build-cfg-kind");
  if (kindEl && !kindEl.dataset.ready) {
    kindEl.dataset.ready = "1";
    kindEl.innerHTML = Object.entries(FEED_KINDS)
      .map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`)
      .join("");
    kindEl.addEventListener("change", () => paintBuildConfigFields(kindEl.value, {}));
  }
  document.getElementById("wl-build-cfg-save")?.addEventListener("click", () => {
    if (!buildMode) return;
    const assetId = document.getElementById("wl-build-cfg-asset-id")?.value;
    const kind = document.getElementById("wl-build-cfg-kind")?.value;
    if (!assetId) return;
    const uid = document.getElementById("wl-build-cfg-uid")?.value?.trim() || "";
    buildMode.setUid(assetId, uid);
    if (kind) {
      const cfg = { kind };
      const meta = FEED_KINDS[kind];
      for (const f of meta?.fields || []) {
        const inp = document.getElementById(`wl-build-cfg-${f.key}`);
        if (inp) cfg[f.key] = inp.value.trim();
      }
      buildMode.setFeedConfig(assetId, cfg);
    }
    fillBuildConfigForm();
  });
}

function paintBuildConfigFields(kind, values) {
  const box = document.getElementById("wl-build-cfg-fields");
  if (!box) return;
  const meta = FEED_KINDS[kind];
  if (!meta) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = meta.fields
    .map(
      (f) => `<div class="wl-build-cfg-row">
      <label for="wl-build-cfg-${esc(f.key)}">${esc(f.label)}</label>
      <input id="wl-build-cfg-${esc(f.key)}" type="text" placeholder="${esc(f.placeholder || "")}" value="${esc(values[f.key] || "")}" />
    </div>`,
    )
    .join("");
}

function fillBuildConfigForm() {
  const wrap = document.getElementById("wl-build-config");
  const intro = document.getElementById("wl-build-cfg-intro");
  if (!buildMode || !wrap) return;
  const aid = buildMode.getSelectedAssetId();
  const rec = aid ? buildMode.findPlaced(aid) : null;
  const uidEl = document.getElementById("wl-build-cfg-uid");
  const kindEl = document.getElementById("wl-build-cfg-kind");
  const saveEl = document.getElementById("wl-build-cfg-save");
  const idEl = document.getElementById("wl-build-cfg-asset-id");
  const assetEl = document.getElementById("wl-build-cfg-asset");
  const st = document.getElementById("wl-build-cfg-status");
  const prevId = idEl?.value || "";

  wrap.hidden = false;
  wrap.classList.toggle("is-empty", !rec);
  wrap.classList.toggle("is-active", !!rec);

  const kvBox = document.getElementById("wl-build-cfg-kv");
  const kvIn = document.getElementById("wl-build-cfg-kv-input");
  const kvPresets = document.getElementById("wl-build-cfg-kv-presets");
  const plantBox = document.getElementById("wl-build-cfg-plant");

  if (!rec) {
    if (kvBox) kvBox.hidden = true;
    if (plantBox) plantBox.hidden = true;
    if (intro) {
      const ph = buildMode.getPendingHouseId();
      const pb = buildMode.getPendingBoardId();
      if (ph) intro.textContent = `House ${ph} armed — place Meter / Service pt on the map.`;
      else if (pb) intro.textContent = `EMS ${pb} armed — place EMS cabinet on the map.`;
      else intro.textContent = "Place or click an asset on the map — UID + API feed edit here (right sidebar).";
    }
    if (idEl) idEl.value = "";
    if (assetEl) assetEl.value = "";
    if (uidEl) {
      uidEl.value = "";
      uidEl.disabled = true;
    }
    if (kindEl) kindEl.disabled = true;
    if (saveEl) saveEl.disabled = true;
    paintBuildConfigFields("sim", {});
    if (st) {
      st.textContent = "No asset selected";
      st.classList.remove("is-ok", "is-bad");
    }
    return;
  }

  const uidLabel = rec.uid ? ` · UID ${rec.uid}` : " · enter UID below";
  if (intro) {
    const kvBit = rec.kind === "line" && rec.nominalKv != null ? ` · ${rec.nominalKv} kV` : "";
    const plantBit =
      rec.kva != null || rec.primaryKv != null
        ? ` · ${rec.kva ?? "—"} kVA ${rec.primaryKv ?? "—"}/${rec.secondaryKv ?? "—"} kV`
        : "";
    intro.textContent = `Editing ${rec.assetClass}${kvBit}${plantBit}${uidLabel}`;
  }
  if (plantBox) {
    const plant = rec.assetClass === "station" || rec.assetClass === "xfmr" || rec.assetClass === "gen";
    plantBox.hidden = !plant;
    if (plant) {
      const kvaEl = document.getElementById("wl-build-cfg-kva");
      const priEl = document.getElementById("wl-build-cfg-pri-kv");
      const secEl = document.getElementById("wl-build-cfg-sec-kv");
      if (kvaEl && document.activeElement !== kvaEl) kvaEl.value = rec.kva != null ? String(rec.kva) : "";
      if (priEl && document.activeElement !== priEl) priEl.value = rec.primaryKv != null ? String(rec.primaryKv) : "";
      if (secEl && document.activeElement !== secEl) secEl.value = rec.secondaryKv != null ? String(rec.secondaryKv) : "";
      if (!plantBox.dataset.ready) {
        plantBox.dataset.ready = "1";
        const savePlant = () => {
          const id = document.getElementById("wl-build-cfg-asset-id")?.value;
          if (!id) return;
          buildMode.setPlantRating(id, {
            kva: document.getElementById("wl-build-cfg-kva")?.value,
            primaryKv: document.getElementById("wl-build-cfg-pri-kv")?.value,
            secondaryKv: document.getElementById("wl-build-cfg-sec-kv")?.value,
          });
        };
        plantBox.addEventListener("change", savePlant);
      }
    }
  }
  if (kvBox && kvIn && kvPresets) {
    const isLine = rec.kind === "line";
    kvBox.hidden = !isLine;
    if (isLine) {
      const kv = rec.nominalKv != null ? rec.nominalKv : defaultLineKv(rec.assetClass);
      if (document.activeElement !== kvIn) kvIn.value = String(kv);
      const presets = LINE_KV_PRESETS[rec.assetClass] || [defaultLineKv(rec.assetClass)];
      kvPresets.innerHTML = presets
        .map((v) => `<button type="button" class="wl-build-kv-btn${Number(v) === Number(kv) ? " on" : ""}" data-kv="${v}">${v}</button>`)
        .join("");
      if (!kvBox.dataset.ready) {
        kvBox.dataset.ready = "1";
        kvPresets.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-kv]");
          const id = document.getElementById("wl-build-cfg-asset-id")?.value;
          if (!btn || !id) return;
          buildMode.setNominalKv(id, btn.getAttribute("data-kv"));
          fillBuildConfigForm();
        });
        kvIn.addEventListener("change", () => {
          const id = document.getElementById("wl-build-cfg-asset-id")?.value;
          if (!id) return;
          buildMode.setNominalKv(id, kvIn.value);
          fillBuildConfigForm();
        });
      }
    }
  }
  if (idEl) idEl.value = rec.id;
  if (assetEl) assetEl.value = `${rec.assetClass} · ${rec.id}`;
  if (uidEl) {
    uidEl.disabled = false;
    uidEl.value = rec.uid || "";
  }
  if (kindEl) kindEl.disabled = false;
  if (saveEl) saveEl.disabled = false;
  const cfg = buildMode.getConfig(rec.id) || { kind: rec.assetClass === "ems" ? "mqtt_sunspec" : "sim" };
  if (kindEl) kindEl.value = cfg.kind && FEED_KINDS[cfg.kind] ? cfg.kind : "sim";
  paintBuildConfigFields(kindEl?.value || "sim", cfg);
  if (st) {
    const ok = feedConfigComplete(cfg);
    const hasUid = !!(rec.uid && String(rec.uid).trim());
    st.textContent = [hasUid ? "UID set" : "UID missing", ok ? "feed OK" : "feed incomplete"].join(" · ");
    st.classList.toggle("is-ok", hasUid && ok);
    st.classList.toggle("is-bad", !hasUid || !ok);
  }

  // New selection → bring inspector into view; focus UID unless mid Dist-run.
  if (rec.id !== prevId) {
    wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const midRun = buildMode.isActive?.() && document.querySelector(
      ".wl-build-tool.on[data-build-asset='dist_run'], .wl-build-tool.on[data-build-asset='dist_run_primary'], .wl-build-tool.on[data-build-asset='dist_run_lv_primary'], .wl-build-tool.on[data-build-asset='dist_run_lv_secondary'], .wl-build-tool.on[data-build-asset='gen_feeder']",
    );
    if (!midRun) {
      requestAnimationFrame(() => {
        uidEl?.focus?.();
        uidEl?.select?.();
      });
    }
  }
}

function fillBuildPanel() {
  syncFeederSelect();
  fillBuildConfigForm();
  fillBuildCrossSection();
  const view = document.getElementById("wl-build-feeder-view");
  const empty = document.getElementById("wl-build-empty");
  const sub = document.getElementById("wl-build-sub");
  const title = document.getElementById("wl-build-title");
  const grid = document.getElementById("wl-build-feeder-grid");
  const fid = activeFeederId();
  if (!fid || !buildMode) {
    if (view) view.hidden = true;
    if (empty) empty.hidden = false;
    if (title) title.textContent = "Build completion";
    return;
  }
  if (empty) empty.hidden = true;
  if (view) view.hidden = false;
  const f = liveFeeders.find((x) => x.id === fid);
  const boards = boardsOnFeeder(fid);
  const homes = liveHouses.filter((h) => h.feederId === fid);
  let green = 0;
  for (const h of homes) if (buildMode.houseStatus(h.id) === "green") green += 1;
  let boardsOk = 0;
  for (const b of boards) if (buildMode.boardStatus(b.id) === "green") boardsOk += 1;
  if (title) title.textContent = f?.label || fid;
  if (sub) {
    sub.textContent = `${boardsOk}/${boards.length} EMS configured · ${green}/${homes.length} meters configured · click cell to map`;
  }
  if (!grid) return;
  const cols = Math.max(HOMES_PER_BOARD, 1, ...boards.map((b) => (b.houseIds || []).length));
  grid.style.setProperty("--feeder-cols", String(cols));
  const pendingH = buildMode.getPendingHouseId();
  const pendingB = buildMode.getPendingBoardId();
  const ids = `build|${fid}|${boards.map((b) => b.id).join(",")}|${cols}|${Object.keys(buildMode.houseMap()).join(",")}|${Object.keys(buildMode.boardMap()).join(",")}`;
  if (grid.dataset.ids !== ids) {
    grid.dataset.ids = ids;
    const parts = [];
    for (const b of boards) {
      const lab = String(b.id || "").replace(/^ems-/, "E");
      const cells = (b.houseIds || [])
        .map((hid) => {
          const h = houseById[hid];
          return `<button type="button" class="feeder-cell" data-h="${esc(hid)}" title="${esc(h?.name)} · ${esc(h?.serial)}"></button>`;
        })
        .join("");
      const pad = Math.max(0, cols - (b.houseIds || []).length);
      const emptyCells = Array.from(
        { length: pad },
        () => `<span class="feeder-cell" style="visibility:hidden;pointer-events:none"></span>`,
      ).join("");
      parts.push(`<div class="feeder-row" data-board="${esc(b.id)}" style="--feeder-cols:${cols}">
        <button type="button" class="feeder-row-lab" data-board="${esc(b.id)}" title="${esc(b.label)}">${esc(lab)}</button>
        ${cells}${emptyCells}
      </div>`);
    }
    grid.innerHTML = parts.join("");
    if (!grid.dataset.bound) {
      grid.dataset.bound = "1";
      grid.addEventListener("click", onBuildFeederGridClick);
    }
  }
  grid.querySelectorAll(".feeder-row").forEach((row) => {
    const bid = row.getAttribute("data-board");
    const st = buildMode.boardStatus(bid);
    const lab = row.querySelector(".feeder-row-lab");
    if (lab) {
      lab.classList.toggle("build-red", st === "red");
      lab.classList.toggle("build-green", st === "green");
      lab.classList.toggle("build-pending", pendingB === bid);
      lab.title = `${boardById[bid]?.label || bid} · ${st === "green" ? "EMS configured" : "map EMS + set API"}`;
    }
  });
  grid.querySelectorAll("button.feeder-cell[data-h]").forEach((btn) => {
    const id = btn.getAttribute("data-h");
    const h = houseById[id];
    const st = buildMode.houseStatus(id);
    btn.classList.toggle("build-red", st === "red");
    btn.classList.toggle("build-green", st === "green");
    btn.classList.toggle("build-pending", pendingH === id);
    btn.classList.toggle("focus", state.focus === id);
    const mapped = buildMode.houseMap()[id];
    btn.title = `${h?.name || id} · ${st === "green" ? "OK" : mapped ? "needs API config" : "unmapped"}`;
  });
}

function fillFeederSelect() {
  const opts =
    `<option value="">Feeder: village</option>` +
    liveFeeders.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  for (const id of ["wl-feeder", "wl-feeder-maint", "wl-feeder-build", "wl-feeder-prod"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    const keep = el.value;
    el.innerHTML = opts;
    if (keep && [...el.options].some((o) => o.value === keep)) el.value = keep;
    if (el.dataset.ready) continue;
    el.dataset.ready = "1";
    el.addEventListener("change", () => {
      const fid = el.value;
      if (!fid) setScope({ kind: "village" }, { cam: true, from: "clear" });
      else setScope({ kind: "feeder", id: fid }, { cam: true, from: "map" });
      if (appMode === "build") fillBuildPanel();
    });
  }
}

function syncFeederSelect() {
  const fid = state.role === "customer" ? "" : activeFeederId() || "";
  for (const id of ["wl-feeder", "wl-feeder-maint", "wl-feeder-build", "wl-feeder-prod"]) {
    const el = document.getElementById(id);
    if (el && el.value !== fid) el.value = fid;
  }
}

function fillUseClassLegend() {
  const el = document.getElementById("wl-use-legend");
  if (!el) return;
  const houses = emptyCanvas && liveHouses === HOUSES ? [] : liveHouses;
  const counts = Object.create(null);
  let nCrit = 0;
  let nNon = 0;
  for (const h of houses) {
    const k = h.useClass || "residential";
    counts[k] = (counts[k] || 0) + 1;
    if (USE_CLASSES[k]?.critical) nCrit += 1;
    else nNon += 1;
  }
  if (!houses.length) {
    el.innerHTML = `<li class="wl-layers-note" role="presentation">Seed customers in Build — legend lists classes in the live pack.</li>`;
    return;
  }
  const row = (id, label, hex, n) => {
    const on = state.activeUseClass === id ? " is-active" : "";
    const sw = hex != null ? `<span class="wl-use-swatch" style="background:#${hex.toString(16).padStart(6, "0")}"></span>` : `<span class="wl-use-swatch wl-use-swatch-tier"></span>`;
    return `<li class="${on.trim()}" data-use-class="${esc(id)}" role="button" tabindex="0">
      ${sw}
      <span>${esc(label)}</span>
      <span class="n">${n}</span>
    </li>`;
  };
  const tierRow = (id, label, n) => {
    const on = state.activeUseClass === id ? " is-active" : "";
    return `<li class="wl-use-tier${on}" data-use-class="${esc(id)}" role="button" tabindex="0">
      <span class="wl-use-swatch wl-use-swatch-tier" aria-hidden="true"></span>
      <span>${esc(label)}</span>
      <span class="n">${n}</span>
    </li>`;
  };
  const parts = [];
  if (nCrit) {
    parts.push(`<li class="wl-layers-note" role="presentation">Critical — shed last / priority circuits</li>`);
    parts.push(tierRow("critical", USE_TIER.critical.label, nCrit));
    for (const id of CRITICAL_ORDER) {
      const n = counts[id] || 0;
      if (!n) continue;
      const meta = USE_CLASSES[id];
      parts.push(row(id, meta.label, meta.hex, n));
    }
  }
  if (nNon) {
    parts.push(`<li class="wl-layers-note" role="presentation">Non-critical — shed first when curtailing</li>`);
    parts.push(tierRow("noncritical", USE_TIER.noncritical.label, nNon));
    for (const id of NONCRITICAL_ORDER) {
      const n = counts[id] || 0;
      if (!n) continue;
      const meta = USE_CLASSES[id];
      parts.push(row(id, meta.label, meta.hex, n));
    }
  }
  el.innerHTML = parts.join("");
}

/** Soft plant opacity + mid-tone veil while a use class is focused. */
function applyUseClassPlantDim() {
  setFocusBackdrop(true);
  for (const key of Object.keys(LAYER_SCENE_MESH)) {
    if (key === "homes") setMeshHighlight(LAYER_SCENE_MESH[key]() || [], "full");
    else setMeshHighlight(LAYER_SCENE_MESH[key]() || [], "soft");
  }
  // Kill glow bleed on plant so soft opacity reads.
  const muteGlow = (mesh) => {
    if (!mesh?.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat?.userData?.glowUniform && mat.userData.baseEmit != null) {
        mat.userData.glowUniform.value = mat.userData.baseEmit * 0.08;
      }
    }
  };
  muteGlow(poleMesh);
  muteGlow(streetLampMesh);
  muteGlow(powerLineMesh);
  muteGlow(emsMesh);
  muteGlow(xfmrMesh);
  for (const list of Object.values(infraDetailByLayer)) {
    for (const m of list) {
      setMeshHighlight(m, "soft");
      muteGlow(m);
    }
  }
  if (sky) sky.visible = false;
  if (groundMesh) groundMesh.visible = false;
}

/** Soft plant dim while an energy asset class is focused — homes soft too. */
function applyEnergyClassPlantDim() {
  setFocusBackdrop(true);
  const focus = state.activeEnergyClass;
  for (const key of Object.keys(LAYER_SCENE_MESH)) {
    setMeshHighlight(LAYER_SCENE_MESH[key]() || [], "soft");
  }
  // Site PV farm + roof PV live on plant `pvMesh`, not energy-assets stand-ins.
  if (focus === "solar") {
    setMeshHighlight([pvMesh], "hot");
    if (pvFarmSpr) {
      pvFarmSpr.visible = true;
      if (pvFarmSpr.material) {
        pvFarmSpr.material.transparent = true;
        pvFarmSpr.material.opacity = 1;
      }
    }
  } else if (focus === "battery") {
    setMeshHighlight([homeBattMesh], "hot");
  } else if (pvFarmSpr) {
    pvFarmSpr.visible = true;
    if (pvFarmSpr.material) {
      pvFarmSpr.material.transparent = true;
      pvFarmSpr.material.opacity = 0.2;
    }
  }
  const muteGlow = (mesh) => {
    if (!mesh?.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat?.userData?.glowUniform && mat.userData.baseEmit != null) {
        mat.userData.glowUniform.value = mat.userData.baseEmit * 0.08;
      }
    }
  };
  muteGlow(poleMesh);
  muteGlow(streetLampMesh);
  muteGlow(powerLineMesh);
  muteGlow(emsMesh);
  muteGlow(xfmrMesh);
  for (const list of Object.values(infraDetailByLayer)) {
    for (const m of list) {
      setMeshHighlight(m, "soft");
      muteGlow(m);
    }
  }
  energyAssetsApi?.setFocusClass?.(focus);
  if (sky) sky.visible = false;
  if (groundMesh) groundMesh.visible = false;
}

/** Soft-dim plant (not black) while a use class is focused. */
function applyUseClassSceneDim() {
  const soft = appMode === "productive" && !!state.activeUseClass;
  if (emptyCanvas) {
    buildMode?.setOverlayVisible?.(true);
    if (soft) {
      buildMode?.setHighlightGroup?.(null);
      setFocusBackdrop(true);
    } else if (!state.activeLayer) {
      setFocusBackdrop(false);
    }
    buildMode?.setUseClassFocus?.(soft ? state.activeUseClass : null);
    return;
  }
  buildMode?.setUseClassFocus?.(null);
  if (soft) applyUseClassPlantDim();
  else if (!state.activeLayer) {
    setFocusBackdrop(false);
    for (const key of Object.keys(LAYER_SCENE_MESH)) {
      setMeshHighlight(LAYER_SCENE_MESH[key]() || [], "full");
    }
  }
  // Instance colors: plant ×0.22, focused houses bright.
  colorPowerLines();
}

/** Soft-dim plant while energy asset class focused. */
function applyEnergyClassSceneDim() {
  if (emptyCanvas) return;
  const soft = appMode === "energy" && !!state.activeEnergyClass;
  if (soft) applyEnergyClassPlantDim();
  else if (!state.activeLayer) {
    setFocusBackdrop(false);
    for (const key of Object.keys(LAYER_SCENE_MESH)) {
      setMeshHighlight(LAYER_SCENE_MESH[key]() || [], "full");
    }
    energyAssetsApi?.setFocusClass?.(null);
    if (pvFarmSpr) {
      pvFarmSpr.visible = true;
      if (pvFarmSpr.material) {
        pvFarmSpr.material.opacity = 1;
        pvFarmSpr.material.transparent = true;
      }
    }
  }
  colorPowerLines();
}

function bindUseClassLegend() {
  const el = document.getElementById("wl-use-legend");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const activate = (id) => {
    if (!id || appMode !== "productive") return;
    if (id === "presentation") return;
    state.activeUseClass = state.activeUseClass === id ? null : id;
    fillUseClassLegend();
    applyUseClassSceneDim();
    const hint = document.getElementById("wl-mode-hint");
    if (hint) {
      if (!state.activeUseClass) hint.textContent = MODE_META.productive?.hint || "";
      else if (state.activeUseClass === "critical") {
        hint.textContent = "Highlighting all critical loads — shed last. Click again to clear.";
      } else if (state.activeUseClass === "noncritical") {
        hint.textContent = "Highlighting all non-critical loads — shed first. Click again to clear.";
      } else {
        const lab = USE_CLASSES[state.activeUseClass]?.label || state.activeUseClass;
        hint.textContent = `Highlighting ${lab} — click class again or another to change.`;
      }
    }
  };
  el.addEventListener("click", (e) => {
    const row = e.target.closest("[data-use-class]");
    if (!row) return;
    e.preventDefault();
    activate(row.getAttribute("data-use-class"));
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-use-class]");
    if (!row) return;
    e.preventDefault();
    activate(row.getAttribute("data-use-class"));
  });
}

function fillEnergyClassLegend() {
  const el = document.getElementById("wl-energy-legend");
  if (!el) return;
  const counts = countEnergyByClass();
  el.innerHTML = ENERGY_CLASS_ORDER.map((id) => {
    const meta = ENERGY_CLASSES[id];
    const hex = `#${meta.hex.toString(16).padStart(6, "0")}`;
    const on = state.activeEnergyClass === id ? " is-active" : "";
    const lab = meta.group ? `${meta.label} · ${meta.group}` : meta.label;
    return `<li class="${on.trim()}" data-energy-class="${esc(id)}" role="button" tabindex="0">
      <span class="wl-use-swatch" style="background:${hex}"></span>
      <span>${esc(lab)}</span>
      <span class="n">${counts[id] || 0}</span>
    </li>`;
  }).join("");
}

function bindEnergyClassLegend() {
  const el = document.getElementById("wl-energy-legend");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  const activate = (id) => {
    if (!id || appMode !== "energy") return;
    state.activeEnergyClass = state.activeEnergyClass === id ? null : id;
    fillEnergyClassLegend();
    applyEnergyClassSceneDim();
    const hint = document.getElementById("wl-mode-hint");
    if (hint) {
      if (!state.activeEnergyClass) hint.textContent = MODE_META.energy?.hint || "";
      else {
        const lab = ENERGY_CLASSES[state.activeEnergyClass]?.label || state.activeEnergyClass;
        hint.textContent = `Highlighting ${lab} — click class again or another to change.`;
      }
    }
  };
  el.addEventListener("click", (e) => {
    const row = e.target.closest("[data-energy-class]");
    if (!row) return;
    e.preventDefault();
    activate(row.getAttribute("data-energy-class"));
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-energy-class]");
    if (!row) return;
    e.preventDefault();
    activate(row.getAttribute("data-energy-class"));
  });
}

function applyAppMode(mode) {
  if (!MODE_META[mode]) mode = "operations";
  appMode = mode;
  const meta = MODE_META[mode];
  Object.assign(state.hide, MODE_HIDE[mode]);
  if (mode === "build" || mode === "maintenance" || mode === "productive" || mode === "energy") {
    state.hide.worldline = true;
  } else {
    state.hide.worldline = false;
  }
  applyModeAnomalyFilter();
  state.scheme = meta.scheme;
  state.lineGrad = meta.lineGrad;
  state.role = meta.role;

  document.querySelectorAll("[data-hide]").forEach((btn) => {
    const k = btn.getAttribute("data-hide");
    if (!k) return;
    btn.classList.toggle("off", !!state.hide[k]);
  });
  if (mode !== "operations") state.dayOutages = false;
  document.getElementById("wl-day-outages")?.classList.toggle("on", !!state.dayOutages);

  const schemeOps = document.getElementById("wl-scheme");
  if (schemeOps && [...schemeOps.options].some((o) => o.value === state.scheme)) schemeOps.value = state.scheme;
  const schemeM = document.getElementById("wl-scheme-maint");
  if (schemeM && [...schemeM.options].some((o) => o.value === state.scheme)) schemeM.value = state.scheme;
  const gradOps = document.getElementById("wl-linegrad");
  if (gradOps) gradOps.value = state.lineGrad;
  const gradM = document.getElementById("wl-linegrad-maint");
  if (gradM) gradM.value = state.lineGrad;

  buildMode?.setActive(mode === "build");
  // Demo mill/pump props sit on Voundou coords — keep off empty-canvas projects.
  productiveUseApi?.setVisible?.(mode === "productive" && !emptyCanvas);
  energyAssetsApi?.setVisible?.(mode === "energy" && !emptyCanvas);
  if (emptyCanvas && (mode === "productive" || mode === "energy")) {
    buildMode?.setOverlayVisible?.(true);
  }
  if (mode !== "productive") {
    state.activeUseClass = null;
    applyUseClassSceneDim();
  }
  if (mode !== "energy") {
    state.activeEnergyClass = null;
    applyEnergyClassSceneDim();
  }
  if (mode === "build" || mode === "maintenance" || mode === "productive" || mode === "energy") {
    if (state.playing) {
      state.playing = false;
      syncPlayBtn();
    }
    const cust = document.getElementById("wl-cust-card");
    if (cust) cust.hidden = true;
    const stream = document.getElementById("wl-stream-panel");
    if (stream) stream.hidden = true;
  }
  if ((!emptyCanvas || liveFeeders.length) && (mode === "build" || mode === "operations" || mode === "productive" || mode === "maintenance")) {
    if (mode === "build") closeEms();
    if (!activeFeederId() && liveFeeders[0]) {
      setScope({ kind: "feeder", id: liveFeeders[0].id }, { cam: false, from: "clear" });
    }
  }
  if (mode === "productive") {
    fillUseClassLegend();
    bindUseClassLegend();
    applyUseClassSceneDim();
  }
  if (mode === "energy") {
    fillEnergyClassLegend();
    bindEnergyClassLegend();
    applyEnergyClassSceneDim();
  }
  applyRole();
  applySchemeColors();
  applyLineLegend();
  colorPowerLines();
  applyVisibility();
  writeQuery({ mode, role: state.role });
  if (mode === "build") fillBuildPanel();
  else {
    fillBuildCrossSection();
    fillHouses(true);
  }
  fillKpi();
}

function bindAppModes() {
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "build" || q === "maintenance" || q === "operations" || q === "productive" || q === "energy") {
    appMode = q;
  }
  bindModeSwitcher({
    getMode: () => appMode,
    setMode: (m) => applyAppMode(m),
  });
  applyAppMode(appMode);
}

function fillFeederGrid() {
  syncFeederSelect();
  const view = document.getElementById("wl-feeder-view");
  const houseView = document.getElementById("wl-house-view");
  const title = document.getElementById("wl-play-title");
  const sub = document.getElementById("wl-feeder-sub");
  const grid = document.getElementById("wl-feeder-grid");
  const fid = state.role === "customer" ? null : activeFeederId();
  const show = !!fid && (state.scope?.kind === "feeder" || state.scope?.kind === "board");
  if (view) view.hidden = !show;
  if (houseView) houseView.hidden = !!show;
  const maint = appMode === "maintenance";
  const loads = appMode === "productive";
  if (!show) {
    if (title) {
      if (loads) title.textContent = "Meters";
      else if (maint) title.textContent = "Asset health";
      else title.textContent = "Feeder grid";
    }
    return;
  }
  const f = liveFeeders.find((x) => x.id === fid);
  const d = liveDtms.find((x) => x.feederId === fid);
  const boards = boardsOnFeeder(fid);
  const homes = liveHouses.filter((h) => h.feederId === fid);
  const leaks = liveLeaks.filter((lk) => lk.feederId === fid);
  const q = state.houseQ.trim().toLowerCase();
  if (title) {
    if (maint) title.textContent = `${f?.label || fid} · health`;
    else if (loads) title.textContent = `${f?.label || fid} · loads`;
    else title.textContent = f?.label || fid;
  }
  if (sub) {
    if (maint) {
      const map = ensureHouseHealth();
      let bad = 0;
      let warn = 0;
      for (const h of homes) {
        const g = map[h.id]?.grade;
        if (g === "bad") bad += 1;
        else if (g === "warn") warn += 1;
      }
      const n = leaks.length;
      const leakBit = n ? ` · ${n} leak span${n === 1 ? "" : "s"}` : "";
      sub.textContent = `Day asset health · ${bad} fault · ${warn} warn · ${homes.length - bad - warn} ok · row = EMS, cell = meter${leakBit}`;
    } else if (loads) {
      sub.textContent = `${d?.label || "DTM"} · ${boards.length} EMS · ${homes.length} loads · row = MeshEMS, cell = meter`;
    } else {
      const n = leaks.length;
      const leakBit = n ? ` · ${n} leak span${n === 1 ? "" : "s"} between EMS` : "";
      sub.textContent = `${d?.label || "DTM"} · ${boards.length} EMS · ${homes.length} customers · row = MeshEMS, cell = meter${leakBit}`;
    }
  }
  if (!grid) return;
  const cols = Math.max(HOMES_PER_BOARD, 1, ...boards.map((b) => (b.houseIds || []).length));
  grid.style.setProperty("--feeder-cols", String(cols));
  const ids = `${fid}|${boards.map((b) => b.id).join(",")}|${cols}|${leaks.map((lk) => lk.id).join(",")}|${maint ? "h" : "o"}`;
  if (grid.dataset.ids !== ids) {
    grid.dataset.ids = ids;
    const parts = [];
    boards.forEach((b, i) => {
      const lab = String(b.id || "").replace(/^ems-/, "E");
      const cells = (b.houseIds || [])
        .map((hid) => {
          const h = houseById[hid];
          return `<button type="button" class="feeder-cell" data-h="${esc(hid)}" title="${esc(h?.name)} · ${esc(h?.serial)}"></button>`;
        })
        .join("");
      const pad = Math.max(0, cols - (b.houseIds || []).length);
      const empty = Array.from(
        { length: pad },
        () => `<span class="feeder-cell" style="visibility:hidden;pointer-events:none"></span>`,
      ).join("");
      parts.push(`<div class="feeder-row" data-board="${esc(b.id)}" style="--feeder-cols:${cols}">
        <button type="button" class="feeder-row-lab" data-board="${esc(b.id)}" title="${esc(b.label)}">${esc(lab)}</button>
        ${cells}${empty}
      </div>`);
      const lk = leakBetween(b, boards[i + 1]);
      if (lk) {
        parts.push(`<button type="button" class="feeder-leak" data-leak="${esc(lk.id)}" data-board="${esc(lk.fromBoardId)}" title="${esc(lk.note || lk.label)}">
          <span class="feeder-leak-k">ΔP</span>
          <span class="feeder-leak-txt"></span>
        </button>`);
      }
    });
    grid.innerHTML = parts.join("");
    if (!grid.dataset.bound) {
      grid.dataset.bound = "1";
      grid.addEventListener("click", onFeederGridClick);
    }
  }
  const leakEnds = new Set();
  for (const lk of leaks) {
    leakEnds.add(lk.fromBoardId);
    leakEnds.add(lk.toBoardId);
  }
  grid.querySelectorAll(".feeder-leak").forEach((el) => {
    const lk = liveLeaks.find((x) => x.id === el.getAttribute("data-leak"));
    const live = leakLive(lk);
    el.classList.toggle("is-live", live);
    el.classList.toggle("is-idle", !live);
    const txt = el.querySelector(".feeder-leak-txt");
    if (txt && lk) {
      txt.textContent = `${lk.leakW} W · ${leakKindLabel(lk.kind)} · ${live ? "LIVE" : "mapped"} · ${lk.label}`;
    }
  });
  const healthMap = maint ? ensureHouseHealth() : null;
  grid.querySelectorAll(".feeder-row").forEach((row) => {
    const bid = row.getAttribute("data-board");
    row.classList.toggle("is-on", bid === state.scopeBoard);
    row.classList.toggle("is-leak", leakEnds.has(bid));
    row.classList.toggle("is-dim", !!state.scopeBoard && bid !== state.scopeBoard);
    const b = boardById[bid];
    const lab = row.querySelector(".feeder-row-lab");
    if (lab) {
      if (maint) {
        const bh = boardDayHealth(bid);
        const hex = `#${healthColor(bh.stress).getHexString()}`;
        lab.style.borderColor = bid === state.scopeBoard ? "#5ee0ff" : hex;
        lab.classList.toggle("health-ok", bh.grade === "ok");
        lab.classList.toggle("health-warn", bh.grade === "warn");
        lab.classList.toggle("health-bad", bh.grade === "bad");
        lab.title = `${b?.label || bid} · day health ${bh.grade} · stress ${Math.round(bh.stress * 100)}%`;
      } else {
        const metric = houseIdsMetricColor(b?.houseIds);
        lab.style.borderColor = bid === state.scopeBoard
          ? "#5ee0ff"
          : leakEnds.has(bid)
            ? "#e85dff"
            : `#${metric.getHexString()}`;
        lab.classList.remove("health-ok", "health-warn", "health-bad");
      }
    }
  });
  grid.querySelectorAll("button.feeder-cell[data-h]").forEach((btn) => {
    const id = btn.getAttribute("data-h");
    const h = houseById[id];
    btn.classList.toggle("focus", state.focus === id);
    btn.classList.toggle("on-ems", !!state.scopeBoard && h?.boardId === state.scopeBoard);
    if (maint) {
      const hh = healthMap[id] || computeHouseDayHealth(id);
      const hex = `#${healthColor(hh.stress).getHexString()}`;
      btn.style.background = hex;
      btn.style.borderColor = hex;
      btn.classList.toggle("out", hh.grade === "bad");
      btn.classList.toggle("health-ok", hh.grade === "ok");
      btn.classList.toggle("health-warn", hh.grade === "warn");
      btn.classList.toggle("health-bad", hh.grade === "bad");
      const bits = [
        `PF ${hh.avgPf.toFixed(2)}`,
        `THD ${hh.avgThd.toFixed(0)}%`,
        `cap ${Math.round(hh.avgCap * 100)}%`,
        hh.outFrac > 0.02 ? `out ${Math.round(hh.outFrac * 100)}%` : null,
        hh.nBreathLost ? "last-breath lost" : hh.nBreath ? "last-breath" : null,
        hh.disconnects ? `${hh.disconnects} cutoff` : null,
      ].filter(Boolean);
      btn.title = `${h?.name || id} · ${h?.serial || ""} · ${hh.grade} · ${bits.join(" · ")}`;
    } else {
      const r = readingAt(id, state.nowMin);
      const o = h ? houseOutage(h) : null;
      const on = r ? r.on && !r.feederOut : false;
      const watts = on ? r.powerW || 0 : 0;
      const cap = r?.capacity || (on && h?.loadLimitW ? watts / h.loadLimitW : 0);
      btn.classList.toggle("out", !!o);
      btn.classList.remove("health-ok", "health-warn", "health-bad");
      const c = o
        ? new THREE.Color(COL.outage)
        : loads
          ? new THREE.Color(useClassColor(h?.useClass))
          : state.scheme === "feeder"
            ? feederColorForHouse(id)
            : readingMetricColor(r);
      const hex = `#${c.getHexString()}`;
      btn.style.background = hex;
      btn.style.borderColor = hex;
      const thdTxt = on ? ` · THD ${(r?.thd || 0).toFixed(0)}%` : "";
      btn.title = `${h?.name || id} · ${h?.serial || ""} · ${o ? "OUTAGE" : on ? `${Math.round(watts)} W · ${Math.round(cap * 100)}%${thdTxt}` : "OFF · 0 W"}`;
    }
    const match =
      !!q &&
      !!h &&
      (h.name.toLowerCase().includes(q) || h.serial.toLowerCase().includes(q) || h.id.toLowerCase() === q);
    btn.classList.toggle("match", match);
  });
}

/** Ops attention rank at playhead (1 = most urgent). */
function houseAttentionRank(h, min) {
  const r = readingAt(h.id, min);
  const wallet = r ? r.wallet : h.startCredit;
  let on = r ? r.on : h.startCredit > 0;
  const o = (day.summary.outages || []).find(
    (x) =>
      min >= x.min &&
      min < x.restore &&
      (x.xfmrId ? h.xfmrId === x.xfmrId : h.feederId === x.feederId),
  );
  const feederOut = !!r?.feederOut || (!!o && min > o.min);
  if (feederOut) return { rank: 1, label: "outage" };
  if (!on) return { rank: 2, label: "cutoff" };
  if (wallet <= LOW_BALANCE) return { rank: 3, label: "low credit" };
  const capacity = r?.capacity || 0;
  const pf = r?.pf ?? 1;
  if (capacity >= 0.8 || pf < PF_POOR) return { rank: 4, label: "warn" };
  return { rank: 5, label: "ok" };
}

const ATTENTION_LIST_CAP = 25;

function listedHouses() {
  const q = state.houseQ.trim().toLowerCase();
  let list = liveHouses;
  if (state.role === "tech" && state.scope?.kind === "board") list = scopeHouses();
  if (state.houseCluster !== "all") list = list.filter((h) => h.cluster === state.houseCluster);
  if (q) {
    list = list.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.serial.toLowerCase().includes(q) ||
        h.id.toLowerCase() === q ||
        h.cluster.toLowerCase().includes(q),
    );
  }

  // Maintenance: keep geographic / search dump (day-health on rows, not playhead rank).
  if (appMode === "maintenance") {
    if (state.focus) {
      const f = houseById[state.focus];
      if (f && !list.some((h) => h.id === f.id)) list = [f, ...list];
    }
    const rows = list.slice(0, ATTENTION_LIST_CAP);
    return { total: list.length, rows, shown: rows.length, needing: list.length, searching: !!q };
  }

  const min = state.nowMin;
  const ranked = list.map((h) => {
    const att = houseAttentionRank(h, min);
    return { h, rank: att.rank, label: att.label };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.h.name.localeCompare(b.h.name));
  const needing = ranked.reduce((n, x) => n + (x.rank < 5 ? 1 : 0), 0);
  let filtered = state.anomalyOnly ? ranked.filter((x) => x.rank < 5) : ranked;

  if (state.focus) {
    const fi = filtered.findIndex((x) => x.h.id === state.focus);
    if (fi > 0) {
      const [item] = filtered.splice(fi, 1);
      filtered.unshift(item);
    } else if (fi < 0) {
      const f = houseById[state.focus];
      if (f) {
        const att = houseAttentionRank(f, min);
        filtered.unshift({ h: f, rank: att.rank, label: att.label });
      }
    }
  }

  const rows = filtered.slice(0, ATTENTION_LIST_CAP).map((x) => x.h);
  return {
    total: filtered.length,
    rows,
    shown: rows.length,
    needing,
    searching: !!q,
  };
}

function fillHouses(rebuild) {
  if (appMode === "build") {
    fillBuildPanel();
    return;
  }
  fillFeederGrid();
  const el = document.getElementById("wl-houses");
  if (!el) return;
  const { total, rows, shown, needing, searching } = listedHouses();
  const count = document.getElementById("wl-house-count");
  if (count) {
    if (appMode === "maintenance") {
      count.textContent = `${shown} of ${liveHouses.length}${total > ATTENTION_LIST_CAP ? ` · ${total} match` : ""}`;
    } else if (searching) {
      count.textContent = `${shown} of ${total} match`;
    } else {
      count.textContent = `${needing} needing attention · showing ${shown}`;
    }
  }
  document.querySelectorAll("#wl-house-clusters [data-cl]").forEach((btn) => {
    btn.classList.toggle("on", btn.getAttribute("data-cl") === state.houseCluster);
  });
  const ids = rows.map((h) => h.id).join(",");
  if (rebuild || el.dataset.ids !== ids) {
    el.dataset.ids = ids;
    el.innerHTML = rows
      .map(
        (h) => `<button type="button" class="house" data-h="${h.id}">
      <b>${h.name}</b> <code>${h.serial}</code>
      <span data-st></span>
    </button>`,
      )
      .join("");
    if (!el.dataset.bound) {
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-h]");
        if (!btn) return;
        const id = btn.getAttribute("data-h");
        setScope(state.focus === id ? { kind: "village" } : { kind: "house", id }, {
          cam: true,
          from: state.focus === id ? "clear" : "map",
        });
      });
    }
  }
  el.querySelectorAll("button").forEach((btn) => {
    const id = btn.getAttribute("data-h");
    const h = houseById[id];
    if (!h) return;
    btn.classList.toggle("active", state.focus === id);
    const st = btn.querySelector("[data-st]");
    if (appMode === "maintenance") {
      const hh = ensureHouseHealth()[id] || computeHouseDayHealth(id);
      btn.classList.toggle("is-off", hh.grade === "bad");
      btn.classList.toggle("is-outage", hh.grade === "bad");
      if (st) {
        const bits = [
          hh.grade.toUpperCase(),
          `stress ${Math.round(hh.stress * 100)}%`,
          hh.nBreathLost ? "last-breath lost" : hh.nBreath ? "last-breath" : null,
          hh.disconnects ? `${hh.disconnects} cutoff` : null,
        ].filter(Boolean);
        st.textContent = bits.join(" · ");
      }
      return;
    }
    const r = readingAt(id, state.nowMin);
    let wallet = r ? r.wallet : h.startCredit;
    let on = r ? r.on : h.startCredit > 0;
    const loadType = r?.loadType || "idle";
    const capacity = r?.capacity || 0;
    const limit = r?.loadLimitW || h.loadLimitW;
    const o = (day.summary.outages || []).find(
      (x) =>
        state.nowMin >= x.min &&
        state.nowMin < x.restore &&
        (x.xfmrId ? h.xfmrId === x.xfmrId : h.feederId === x.feederId),
    );
    const breath = o ? readingAt(id, o.min) : r;
    const feederOut = !!r?.feederOut || (!!o && state.nowMin > o.min);
    const lastBreath = !!breath?.lastBreath;
    const lastBreathArrived = !!breath?.lastBreathArrived;
    const lastBreathChannel = breath?.lastBreathReason === "channel";
    if (feederOut) on = false;
    btn.classList.toggle("is-off", !on);
    btn.classList.toggle("is-outage", feederOut);
    if (st) {
      st.textContent = feederOut
        ? lastBreathArrived
          ? `OUTAGE · last breath @ ${fmtClock(o.min)} · ${wallet.toFixed(0)}`
          : lastBreathChannel
            ? `OUTAGE · silent (RF channel) · ${wallet.toFixed(0)}`
            : lastBreath
              ? `OUTAGE · silent (mesh) · ${wallet.toFixed(0)}`
              : `OUTAGE · ${wallet.toFixed(0)}`
        : on
          ? `ON · ${wallet.toFixed(0)} · ${LOAD_TYPES[loadType]?.label || loadType} · ${Math.round(capacity * 100)}% of ${limit} W · PF ${(r?.pf ?? 1).toFixed(2)} · THD ${(r?.thd || 0).toFixed(0)}%`
          : `OFF · ${wallet.toFixed(0)}`;
    }
  });
  if (appMode !== "maintenance") {
    drawStream();
    drawFsLoad();
  }
  fillRolePanels();
}

function hexCss(n) {
  return `#${n.toString(16).padStart(6, "0")}`;
}

function drawStream() {
  const panel = document.getElementById("wl-stream-panel");
  const svg = document.getElementById("wl-stream");
  const nameEl = document.getElementById("wl-stream-name");
  const legend = document.getElementById("wl-stream-legend");
  if (!panel || !svg) return;
  if (!state.focus) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const house = houseById[state.focus];
  if (nameEl) nameEl.textContent = house ? `${house.name} · ${house.serial}` : state.focus;

  const W = 720;
  const H = 168;
  const padL = 44;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xAt = (min) => padL + (min / DAY_MIN) * innerW;

  const hi = houseIndex[state.focus];
  if (hi == null || !house) {
    panel.hidden = true;
    return;
  }
  const rows = [];
  const lastSlot = Math.min(SLOTS - 1, Math.floor(state.nowMin / SLOT_MIN));
  for (let s = 0; s <= lastSlot; s++) rows.push(day.readings[s * HOUSE_N + hi]);
  const layers = STREAM_KEYS.map((k) => ({
    k,
    tops: [],
    bots: [],
    used: false,
  }));

  let yMin = 0;
  let yMax = 1;
  for (const r of rows) {
    const mix = r?.mix || {};
    let total = 0;
    for (const k of STREAM_KEYS) total += mix[k] || 0;
    let y0 = -total / 2;
    if (y0 < yMin) yMin = y0;
    if (y0 + total > yMax) yMax = y0 + total;
    let run = y0;
    for (const layer of layers) {
      const v = mix[layer.k] || 0;
      if (v > 0) layer.used = true;
      layer.bots.push(run);
      run += v;
      layer.tops.push(run);
    }
  }
  const span = yMax - yMin || 1;
  const ySvg = (w) => padT + innerH - ((w - yMin) / span) * innerH;

  function area(layer) {
    if (rows.length < 2) return "";
    const top = rows.map((r, i) => `${i === 0 ? "M" : "L"}${xAt(r.min).toFixed(1)},${ySvg(layer.tops[i]).toFixed(1)}`);
    const bot = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      bot.push(`L${xAt(rows[i].min).toFixed(1)},${ySvg(layer.bots[i]).toFixed(1)}`);
    }
    return `${top.join(" ")} ${bot.join(" ")} Z`;
  }

  const ticks = [0, 6, 12, 18, 24].map((hr) => {
    const x = xAt(hr * 60);
    return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - padB}" stroke="#2a2a2e"/>
      <text x="${x}" y="${H - 6}" fill="#9a9990" font-size="10" text-anchor="middle">${String(hr).padStart(2, "0")}:00</text>`;
  });
  const yTicks = [yMin, 0, yMax].map((w) => {
    const y = ySvg(w);
    return `<text x="${padL - 6}" y="${y + 3}" fill="#9a9990" font-size="9" text-anchor="end">${Math.round(w)} W</text>`;
  });
  const playX = xAt(state.nowMin);
  const paths = layers
    .filter((l) => l.used)
    .map((l) => {
      const spec = LOAD_TYPES[l.k];
      return `<path d="${area(l)}" fill="${hexCss(spec.hex)}" fill-opacity="0.88" stroke="${hexCss(spec.hex)}" stroke-opacity="0.4" stroke-width="0.6"/>`;
    });

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <rect width="${W}" height="${H}" fill="#121214"/>
    ${ticks.join("")}
    ${yTicks.join("")}
    ${paths.join("")}
    <line x1="${playX}" y1="${padT}" x2="${playX}" y2="${H - padB}" stroke="#2aa8b8" stroke-width="1.2"/>
  `;

  if (legend) {
    legend.innerHTML = layers
      .filter((l) => l.used)
      .map((l) => {
        const spec = LOAD_TYPES[l.k];
        return `<span><i style="background:${hexCss(spec.hex)}"></i>${spec.label}</span>`;
      })
      .join("");
  }
}

function theaterFs() {
  const t = document.getElementById("wl-theater");
  return (document.fullscreenElement || document.webkitFullscreenElement) === t;
}

function scopeHouses() {
  const s = state.scope || { kind: "village" };
  if (s.kind === "house") {
    const h = houseById[s.id];
    return h ? [h] : [];
  }
  if (s.kind === "board") {
    const b = boardById[s.id];
    return (b?.houseIds || []).map((id) => houseById[id]).filter(Boolean);
  }
  if (s.kind === "feeder") return liveHouses.filter((h) => h.feederId === s.id);
  if (s.kind === "station") {
    const st = STATIONS.find((x) => x.id === s.id);
    const ids = new Set(st?.feederIds || liveFeeders.map((f) => f.id));
    return liveHouses.filter((h) => ids.has(h.feederId));
  }
  return liveHouses;
}

function scopeCaption(houses) {
  const s = state.scope || { kind: "village" };
  const n = houses.length;
  if (s.kind === "house") {
    const h = houseById[s.id];
    return { title: h ? h.name : s.id, sub: h ? `${h.serial} · 1 home · ${h.cluster}` : "1 home" };
  }
  if (s.kind === "board") {
    const b = boardById[s.id];
    return { title: b?.label || "MeshEMS", sub: `${n} homes on this board · ${HOMES_PER_BOARD} / board` };
  }
  if (s.kind === "feeder") {
    const f = liveFeeders.find((x) => x.id === s.id);
    const d = liveDtms.find((x) => x.feederId === s.id);
    return { title: f?.label || s.id, sub: `${d?.label || "DTM"} · ${n} homes` };
  }
  if (s.kind === "station") {
    const st = STATIONS.find((x) => x.id === s.id);
    return { title: st?.label || "Station", sub: `${n} homes on station` };
  }
  return { title: "Village load", sub: `${n} homes · none selected` };
}

function fmtLoadW(w) {
  if (w >= 10000) return `${Math.round(w / 1000)} kW`;
  if (w >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

function houseLineHue(i) {
  return (i * 137.508) % 360;
}

function drawFsLoad() {
  const cv = document.getElementById("wl-fs-load-cv");
  const titleEl = document.getElementById("wl-fs-load-title");
  const subEl = document.getElementById("wl-fs-load-sub");
  const legEl = document.getElementById("wl-fs-load-leg");
  if (!cv || !theaterFs()) return;
  const houses = scopeHouses();
  const cap = scopeCaption(houses);
  if (titleEl) titleEl.textContent = cap.title;
  if (subEl) subEl.textContent = cap.sub;

  const kind = state.scope?.kind || "village";
  const lines = kind === "board" || kind === "feeder" || kind === "station";
  const rect = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(320, Math.floor(rect.width * dpr));
  const H = Math.max(80, Math.floor(rect.height * dpr));
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
  }
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#121214";
  ctx.fillRect(0, 0, W, H);

  const padL = 52 * dpr;
  const padR = 12 * dpr;
  const padT = 8 * dpr;
  const padB = 20 * dpr;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const last = Math.min(SLOTS - 1, Math.floor(state.nowMin / SLOT_MIN));
  const xAt = (min) => padL + (min / DAY_MIN) * innerW;

  const series = houses.map((h) => {
    const hi = houseIndex[h.id];
    const pts = [];
    for (let s = 0; s <= last; s++) {
      const r = day.readings[s * HOUSE_N + hi];
      pts.push({
        min: r.min,
        w: r.on && !r.feederOut ? r.powerW : 0,
        mix: r.mix || {},
      });
    }
    return { house: h, pts };
  });

  let yMax = 1;
  let stacked = null;
  if (!lines) {
    stacked = STREAM_KEYS.map((k) => ({ k, vals: [] }));
    for (let s = 0; s <= last; s++) {
      const acc = Object.fromEntries(STREAM_KEYS.map((k) => [k, 0]));
      for (const row of series) {
        const mix = row.pts[s]?.mix || {};
        for (const k of STREAM_KEYS) acc[k] += mix[k] || 0;
      }
      let tot = 0;
      for (const layer of stacked) {
        layer.vals.push(acc[layer.k]);
        tot += acc[layer.k];
      }
      if (tot > yMax) yMax = tot;
    }
  } else {
    for (const row of series) {
      for (const p of row.pts) if (p.w > yMax) yMax = p.w;
    }
  }

  const yAt = (w) => padT + innerH - (w / yMax) * innerH;
  ctx.strokeStyle = "#2a2a2e";
  ctx.lineWidth = 1;
  ctx.font = `${10 * dpr}px sans-serif`;
  ctx.fillStyle = "#9a9990";
  ctx.textAlign = "center";
  for (const hr of [0, 6, 12, 18, 24]) {
    const x = xAt(hr * 60);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, H - padB);
    ctx.stroke();
    ctx.fillText(`${String(hr).padStart(2, "0")}:00`, x, H - 5 * dpr);
  }
  ctx.textAlign = "right";
  for (const w of [0, yMax / 2, yMax]) {
    ctx.fillText(fmtLoadW(w), padL - 6 * dpr, yAt(w) + 3 * dpr);
  }

  if (!lines && stacked) {
    const mins = series[0] ? series[0].pts.map((p) => p.min) : [];
    let run = new Array(mins.length).fill(0);
    for (const layer of stacked) {
      if (!layer.vals.some((v) => v > 0)) continue;
      const spec = LOAD_TYPES[layer.k];
      ctx.beginPath();
      mins.forEach((min, i) => {
        const y = yAt(run[i] + layer.vals[i]);
        if (i === 0) ctx.moveTo(xAt(min), y);
        else ctx.lineTo(xAt(min), y);
      });
      for (let i = mins.length - 1; i >= 0; i--) {
        ctx.lineTo(xAt(mins[i]), yAt(run[i]));
        run[i] += layer.vals[i];
      }
      ctx.closePath();
      ctx.fillStyle = hexCss(spec.hex);
      ctx.globalAlpha = 0.88;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (legEl) {
      legEl.innerHTML = stacked
        .filter((l) => l.vals.some((v) => v > 0))
        .map((l) => `<span><i style="background:${hexCss(LOAD_TYPES[l.k].hex)}"></i>${LOAD_TYPES[l.k].label}</span>`)
        .join("");
    }
  } else {
    const thin = series.length > 12;
    ctx.lineWidth = thin ? 1 : 1.4 * dpr;
    ctx.globalAlpha = thin ? 0.28 : 0.92;
    series.forEach((row, i) => {
      if (row.pts.length < 2) return;
      ctx.beginPath();
      row.pts.forEach((p, j) => {
        const x = xAt(p.min);
        const y = yAt(p.w);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = `hsl(${houseLineHue(i)}, 62%, 58%)`;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    if (legEl) {
      const shown = series.slice(0, 10);
      const extra = series.length - shown.length;
      legEl.innerHTML =
        shown
          .map(
            (row, i) =>
              `<span><i style="background:hsl(${houseLineHue(i)}, 62%, 58%)"></i>${row.house.name}</span>`,
          )
          .join("") + (extra > 0 ? `<span>+${extra} more</span>` : "");
    }
  }

  const playX = xAt(state.nowMin);
  ctx.strokeStyle = "#2aa8b8";
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  ctx.moveTo(playX, padT);
  ctx.lineTo(playX, H - padB);
  ctx.stroke();
}

boot().catch(error => { console.error(error); document.getElementById("wl-map-status").textContent = "Unable to initialize village map: " + error.message; });
