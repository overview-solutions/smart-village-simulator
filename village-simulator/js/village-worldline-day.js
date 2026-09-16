import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
} from "./village-worldline-sim.js";
import { HANG, geoidBlock } from "./geo.js";
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
const Y_GRID = 0.16;
const Y_NOW = 0.28;
const Y_RF = 0.22;
/** Ground corridor around selected feeder traces — between polar grid and RF. */
const Y_FEEDER = 0.19;
const Y_COMPASS = [0.09, 0.14, 0.2];
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
  day.readings.forEach((r, i) => {
    color.copy(colorForReading(r));
    readingMesh.setColorAt(i, color);
  });
  if (readingMesh.instanceColor) readingMesh.instanceColor.needsUpdate = true;

  const attr = worldlineMesh.geometry.getAttribute("color");
  const byHouse = Object.fromEntries(HOUSES.map((h) => [h.id, []]));
  for (const r of day.readings) byHouse[r.houseId].push(r);
  let k = 0;
  for (const h of HOUSES) {
    const rows = byHouse[h.id];
    for (let i = 0; i < rows.length - 1; i++) {
      const c = colorForReading(rows[i]);
      attr.setXYZ(k, c.r, c.g, c.b);
      attr.setXYZ(k + 1, c.r, c.g, c.b);
      k += 2;
    }
  }
  attr.needsUpdate = true;

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
  if (lineLeg) lineLeg.hidden = state.scheme === "asset";
  const lineGrad = document.getElementById("wl-linegrad");
  if (lineGrad) lineGrad.hidden = state.scheme === "asset";
  colorPowerLines();
  applyVisibility();
}

const day = simulateDay();
const houseById = Object.fromEntries(HOUSES.map((h) => [h.id, h]));
const houseIndex = Object.fromEntries(HOUSES.map((h, i) => [h.id, i]));
const boardById = Object.fromEntries(BOARDS.map((b) => [b.id, b]));
const HOUSE_N = HOUSES.length;

const ANOM_EVENT = new Set(["disconnect", "sms", "reconnect", "cap_warn", "pf_warn", "overload"]);
const anomalyIds = new Set();
for (const e of day.events) {
  if (e.houseId && ANOM_EVENT.has(e.kind)) anomalyIds.add(e.houseId);
}
for (const r of day.readings) {
  if (r.lastBreathArrived || r.lastBreathReason === "channel") anomalyIds.add(r.houseId);
  if (r.lastBreath && houseIndex[r.houseId] % 11 === 0) anomalyIds.add(r.houseId);
  if (r.feederOut) anomalyIds.add(r.houseId);
  if (r.capacity >= 0.8) anomalyIds.add(r.houseId);
  if (r.on && r.pf < PF_POOR) anomalyIds.add(r.houseId);
}

function readingAt(houseId, min) {
  const slot = Math.min(SLOTS - 1, Math.max(0, Math.floor(min / SLOT_MIN)));
  return day.readings[slot * HOUSE_N + houseIndex[houseId]];
}

const state = {
  nowMin: 0,
  playing: false,
  dir: 1,
  speed: 30,
  focus: null,
  scope: { kind: "village" },
  scheme: "messages",
  hide: { reading: true, pay: true, disconnect: false, sms: false, sync: false, mesh: true, worldline: true, rf: true, phase_xfer: false, leak: false },
  anomalyOnly: true,
  houseQ: "",
  houseCluster: "all",
  viz: "v2",
  lineGrad: "capacity",
  sky: "dark",
  light: "fill",
  role: "ops",
  you: HOUSES[0]?.id || "h0",
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
let lvSegMeta = [];
let feederBufById = {};
let feederPickMesh;
let polePick = [];
let breakerPick = [];
let camFly = null;
let camFeederId = null;
let camMag = 0;
const PICK_DRAG_PX = 8;
let pickPtr = null;
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
let pvMat;
let pvMesh;
let hemiLight;
let sky;
let windowMesh;
let streetLampMesh;
let groundMesh;
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

function stackSpine(x, z, color, dashed) {
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

function boot() {
  const stage = document.getElementById("wl-stage");
  if (!stage) return;

  scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(COL.bg, 220, 780);

  camera = new THREE.PerspectiveCamera(42, 1, 0.4, 1200);
  {
    const home = camHome(true);
    camera.position.set(...home.pos);
  }

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...camHome(true).look);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.88;
  controls.minPolarAngle = 0.06;
  controls.mouseButtons.LEFT = -1;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  controls.mouseButtons.RIGHT = -1;
  controls.touches.ONE = -1;
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

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

  timeGroup = new THREE.Group();
  timeGroup.scale.y = -1;
  timeGroup.frustumCulled = false;
  scene.add(timeGroup);

  buildVillage();
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
  fillLedger();
  fillStats();
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
  renderer.setAnimationLoop(tick);
}

function resize() {
  const stage = document.getElementById("wl-stage");
  const w = stage.clientWidth || 640;
  const h = stage.clientHeight || 480;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
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
  sunMesh.visible = y > 3;
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

function buildCompass() {
  const { x: cx, z: cz, r } = COMPASS;
  const rimMat = new THREE.MeshLambertMaterial({ color: 0xeef3f8 });
  const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 1.55, 12, 96), rimMat);
  torus.rotation.x = Math.PI / 2;
  torus.position.set(cx, 1.55, cz);
  torus.castShadow = true;
  torus.receiveShadow = true;
  scene.add(torus);
  const ringDecal = (inner, outer, y, color, segs = 96, thetaLen) => {
    const geo =
      thetaLen != null
        ? new THREE.RingGeometry(inner, outer, segs, 1, Math.PI, thetaLen)
        : new THREE.RingGeometry(inner, outer, segs);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, y, cz);
    scene.add(m);
    return m;
  };
  ringDecal(r - 3.4, r + 3.4, Y_COMPASS[0], 0xf4f7fb);
  ringDecal(r - 3.9, r - 3.4, Y_COMPASS[1], 0x1c2228);
  ringDecal(r + 3.4, r + 6.2, Y_COMPASS[2], 0xe8b060, 64, Math.PI);

  const tickMat = new THREE.MeshLambertMaterial({ color: 0xf4f7fa });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const major = i % 6 === 0;
    const mid = i % 2 === 0;
    const len = major ? 8.4 : mid ? 4.6 : 2.6;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(major ? 1.15 : mid ? 0.55 : 0.32, major ? 1.8 : 0.7, len),
      tickMat,
    );
    tick.position.set(cx + Math.cos(a) * (r + len * 0.38), major ? 0.95 : 0.4, cz + Math.sin(a) * (r + len * 0.38));
    tick.rotation.y = -a;
    tick.castShadow = true;
    scene.add(tick);
  }

  const nArrow = new THREE.Mesh(
    new THREE.ConeGeometry(3.6, 9.4, 3),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
  );
  nArrow.position.set(cx, 2.2, cz - r - 7.2);
  nArrow.rotation.x = Math.PI / 2;
  nArrow.castShadow = true;
  scene.add(nArrow);

  compassSprites.length = 0;
  const cards = [
    { t: "N", x: cx, z: cz - r - 8, s: 6.5, y: 3.2 },
    { t: "E", x: cx + r + 8, z: cz, s: 5.5, y: 2.8 },
    { t: "S", x: cx, z: cz + r + 8, s: 5.5, y: 2.8 },
    { t: "W", x: cx - r - 8, z: cz, s: 5.5, y: 2.8 },
    { t: "NE", x: cx + r * 0.74, z: cz - r * 0.74, s: 3.2, y: 2.4 },
    { t: "SE", x: cx + r * 0.74, z: cz + r * 0.74, s: 3.2, y: 2.4 },
    { t: "SW", x: cx - r * 0.74, z: cz + r * 0.74, s: 3.2, y: 2.4 },
    { t: "NW", x: cx - r * 0.74, z: cz - r * 0.74, s: 3.2, y: 2.4 },
  ];
  for (const c of cards) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.font = `bold ${c.t.length > 1 ? 96 : 140}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 16;
    ctx.strokeStyle = "#141418";
    ctx.fillStyle = c.t === "N" ? "#ffffff" : "#e8eef4";
    ctx.strokeText(c.t, 128, 128);
    ctx.fillText(c.t, 128, 128);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }),
    );
    spr.userData.s = c.s;
    spr.scale.set(c.s, c.s, 1);
    spr.position.set(c.x, c.y, c.z);
    spr.renderOrder = 3;
    scene.add(spr);
    compassSprites.push(spr);
  }
  sunBead = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xffe7a8 }),
  );
  sunBead.position.set(cx + r, 2.2, cz);
  scene.add(sunBead);
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

  HOUSES.forEach((h, i) => {
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
  let bi = 0;
  HOUSES.forEach((h, i) => {
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
  for (const h of HOUSES) {
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
  addPolarGrid(Y_GRID, 0.28, false);

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
  for (const v of VENDORS) {
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
  HOUSES.forEach((h, i) => {
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
  buildCompass();

  stackSpine(COMPASS.x - COMPASS.r - 1.2, COMPASS.z, 0xc5d0dc);
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
  const byHouse = Object.fromEntries(HOUSES.map((h) => [h.id, []]));
  for (const r of day.readings) byHouse[r.houseId].push(r);

  HOUSES.forEach((h, hi) => {
    const rows = byHouse[h.id];
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
  scene.add(worldlineMesh);

  stackSpine(LANDMARKS.ops.x, LANDMARKS.ops.z, COL.site);
  stackSpine(LANDMARKS.kiosk.x, LANDMARKS.kiosk.z, COL.people);
  stackSpine(LANDMARKS.usb.x, LANDMARKS.usb.z, COL.meter);
}

function buildReadings() {
  const n = day.readings.length;
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
  scene.add(readingMesh);
}

function buildDisconnectKnobs() {
  const dummy = new THREE.Object3D();
  const xs = [];
  const zs = [];
  const mins = [];
  const hids = [];
  for (const h of HOUSES) {
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
  return VENDORS.find((v) => v.id === h.vendorId) || LANDMARKS.kiosk;
}

function payOrigin(h) {
  if ((h.payVia || "vendor") === "vendor") {
    const v = vendorOf(h);
    return { x: v.x, z: v.z };
  }
  return { x: h.x, z: h.z };
}

function mark(kind, min, houseId, color, radius = 0.22) {
  const h = houseId ? houseById[houseId] : LANDMARKS.ops;
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshLambertMaterial({ color }),
  );
  const x = kind === "sync" ? LANDMARKS.cloud.x : h.x;
  const z = kind === "sync" ? LANDMARKS.cloud.z : h.z;
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
      const ops = new THREE.Vector3(LANDMARKS.ops.x, y, LANDMARKS.ops.z);
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
        const cloud = new THREE.Vector3(LANDMARKS.cloud.x, y, LANDMARKS.cloud.z);
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
      const a = new THREE.Vector3(LANDMARKS.ops.x, y, LANDMARKS.ops.z);
      const b = new THREE.Vector3(LANDMARKS.cloud.x, y, LANDMARKS.cloud.z);
      const line = curve(a, b, 0.8, COL.ops, true);
      line.userData = { kind: "sync", min: e.min, houseId: null };
      addTime(line);
      eventMeshes.push(line);
    }
    if (e.kind === "outage" || e.kind === "repair" || e.kind === "shed" || e.kind === "restore") {
      const color = e.kind === "outage" ? COL.fault : COL[e.kind];
      const o = OUTAGES.find((x) => x.id === e.outageId);
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
        const a = new THREE.Vector3(LANDMARKS.ops.x, y, LANDMARKS.ops.z);
        const b = new THREE.Vector3(px, y, pz);
        const line = curve(a, b, 1.1, COL.repair, false);
        line.userData = { kind: "repair", min: e.min, houseId: null };
        addTime(line);
        eventMeshes.push(line);
      }
    }
    if (e.kind === "phase_xfer" && h) {
      const dtm = DTMS.find((d) => d.feederId === e.feederId) || { x: h.x, z: h.z };
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
      const lk = LEAKS.find((x) => x.id === e.leakId);
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
  if (id === "usb") return LANDMARKS.usb;
  if (id === "ops") return LANDMARKS.ops;
  return houseById[id];
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
  for (let slot = 0; slot < SLOTS; slot += 8) {
    const min = slot * SLOT_MIN;
    const wave = (slot / 8) | 0;
    const a = wave % HOUSE_N;
    for (const idx of [a, (a + 8) % HOUSE_N, (a + 16) % HOUSE_N]) {
      if (houseDark(HOUSES[idx].id, min)) continue;
      drawPath(meshPath(HOUSES[idx].id, "up", min), min, COL.reading, HOUSES[idx].id);
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
  const supports = [LANDMARKS.xfmr, ...POLES, ...TRANSFORMERS, ...FEEDERS];
  const batch = (geometry, color, poses) => {
    if (!poses.length) return;
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ color }), poses.length);
    const d = new THREE.Object3D();
    poses.forEach(([x, y, z], i) => {
      d.position.set(x, y, z);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.castShadow = true;
    scene.add(mesh);
  };
  batch(new THREE.BoxGeometry(0.85, 0.1, 0.12), 0x78634d,
    supports.map(p => [p.x, LINE_HANG - 0.12, p.z]));
  batch(new THREE.CylinderGeometry(0.065, 0.09, 0.18, 6), 0xd6e7dd,
    supports.flatMap(p => [-0.32, 0, 0.32].map(dx => [p.x + dx, LINE_HANG + 0.02, p.z])));
  // Transformer shelf and bushings connect the tank to its pole.
  batch(new THREE.BoxGeometry(0.72, 0.07, 0.58), 0x485763,
    TRANSFORMERS.map(t => [t.x + 0.22, HANG.xfmr - 0.36, t.z]));
  batch(new THREE.CylinderGeometry(0.045, 0.07, 0.2, 6), 0xe4ddd0,
    TRANSFORMERS.flatMap(t => [-0.13, 0.13].map(dx => [t.x + 0.32 + dx, HANG.xfmr + 0.42, t.z])));
  // Each EMS has a dedicated mounting post, door, latch and RF enclosure/whip.
  batch(new THREE.CylinderGeometry(0.055, 0.075, 2.35, 6), 0x71818a,
    BOARDS.map(b => [b.x, 1.175, b.z - 0.19]));
  batch(new THREE.BoxGeometry(0.38, 0.50, 0.025), 0xc7d5db,
    BOARDS.map(b => [b.x, HANG.ems, b.z + 0.15]));
  batch(new THREE.BoxGeometry(0.035, 0.13, 0.035), 0x293d47,
    BOARDS.map(b => [b.x + 0.13, HANG.ems, b.z + 0.18]));
  batch(new THREE.BoxGeometry(0.18, 0.24, 0.12), 0x26b9ba,
    BOARDS.map(b => [b.x, 2.25, b.z - 0.12]));
  batch(new THREE.CylinderGeometry(0.018, 0.025, 0.58, 5), 0x293d47,
    BOARDS.map(b => [b.x, 2.65, b.z - 0.12]));
  // Intermediate service supports make secondary endpoints visibly grounded.
  batch(new THREE.CylinderGeometry(0.035, 0.05, HANG.secondary, 5), 0x79624b,
    HOUSES.map(h => [h.x, HANG.secondary / 2, h.z]));
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
  poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, POLES.length + TRANSFORMERS.length + FEEDERS.length + 1);
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
  for (const f of FEEDERS) plant(f.x, f.z, { kind: "feeder", id: f.id });
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

  for (const f of FEEDERS) {
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
  const n = 1 + FEEDERS.length + TRANSFORMERS.length;
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
  for (const f of FEEDERS) plant(f.x - 0.52, f.z - 0.22, LINE_HANG + 0.22, { kind: "feeder", id: f.id });
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

  for (const f of FEEDERS) {
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

function activeFeederId() {
  const s = state.scope || {};
  if (s.kind === "feeder") return s.id;
  if (s.kind === "board") return boardById[s.id]?.feederId || null;
  if (s.kind === "house") return houseById[s.id]?.feederId || null;
  return null;
}

function updateFeederHighlight() {
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
  for (const d of DTMS) {
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
  if (!BOARDS.length) return;
  const geo = new THREE.BoxGeometry(0.46, 0.60, 0.28);
  emsMesh = new THREE.InstancedMesh(geo, glowLambert(0.55), BOARDS.length);
  emsMesh.userData.pickBoards = true;
  const boardCol = new THREE.Color(ASSET.board);
  const pvGeo = new THREE.BoxGeometry(1, 0.045, 0.72);
  const pvM = new THREE.MeshLambertMaterial({
    color: PV_COL,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  emsPvMesh = new THREE.InstancedMesh(pvGeo, pvM, BOARDS.length);
  emsPvMesh.userData.pickBoards = true;
  emsPvMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  emsPvMesh.castShadow = true;
  emsPvMesh.receiveShadow = true;
  BOARDS.forEach((b, i) => {
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
    LEAKS.find(
      (lk) =>
        (lk.fromBoardId === a.id && lk.toBoardId === b.id) ||
        (lk.fromBoardId === b.id && lk.toBoardId === a.id),
    ) || null
  );
}

function leakLive(lk) {
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
  for (const lk of LEAKS) {
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
  const showAll = !state.hide.leak;
  const liveCol = new THREE.Color(0xff4dff);
  const mapCol = new THREE.Color(0xd24ae0);
  for (const m of leakMeshes) {
    const lk = LEAKS.find((x) => x.id === m.userData.leakId);
    if (!lk) {
      m.visible = false;
      continue;
    }
    const layer = m.userData.leakLayer;
    m.visible = fid ? lk.feederId === fid : showAll && layer !== "ground" && layer !== "pick";
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
  const { last } = loadsAt(state.nowMin);
  const by = {};
  const perF = {};
  for (const h of HOUSES) {
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
    const h = HOUSES[i];
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
  if (mesh.instanceColor) {
    for (let i = 0; i < mesh.count; i++) mesh.setColorAt(i, c);
    mesh.instanceColor.needsUpdate = true;
  } else if (mesh.material?.color) {
    mesh.material.color.setHex(hex);
  }
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
  const asset = state.scheme === "asset";
  const fid = activeFeederId();
  const last = loads?.last;
  const byXfmr = loads?.byXfmr || {};
  const byFeeder = loads?.byFeeder || {};
  if (fid && last && emsMesh?.instanceColor) {
    BOARDS.forEach((b, i) => {
      let c;
      const rank = state.role === "customer" ? (b.feederId === fid ? 1 : 0) : boardSelectRank(b);
      if (rank <= 0) {
        c = new THREE.Color(asset ? ASSET.board : 0xff6a2a);
      } else {
        c = state.scheme === "feeder" ? feederColorForHouse(b.houseIds?.[0], last) : houseIdsMetricColor(b.houseIds, last);
        const leakHit = LEAKS.find(
          (lk) => lk.feederId === fid && (lk.fromBoardId === b.id || lk.toBoardId === b.id),
        );
        if (leakHit) c.lerp(new THREE.Color(COL.leak), leakLive(leakHit) ? 0.58 : 0.24);
      }
      tintSelectRank(c, rank);
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
      BOARDS.forEach((b, i) => {
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
  }
  for (const m of stationMeshes) {
    m.material.color.setHex(asset ? ASSET.station : m.userData.baseHex);
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
  for (let i = 0; i < HOUSE_N; i++) {
    const p = hutPose[i];
    const r = last[HOUSES[i].id];
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

function colorHouses(last) {
  if (!hutMesh || !roofMesh) return;
  const src = last || loadsAt(state.nowMin).last;
  const red = new THREE.Color(COL.outage);
  const roof = new THREE.Color();
  const lamps = state.light === "lamps";
  const fid = activeFeederId();
  for (let i = 0; i < HOUSE_N; i++) {
    const h = HOUSES[i];
    const r = src[h.id];
    const out = !!(r?.feederOut || outageHit(h, state.nowMin));
    let c;
    if (out) c = red.clone();
    else if (state.scheme === "feeder") c = feederColorForHouse(h.id, src);
    else c = readingMetricColor(r);
    if (lamps && !out) {
      const on = !!(r?.on && !r?.feederOut);
      if (on) c = c.clone().lerp(lampWarm, 0.28);
      else c = lampDark.clone();
    }
    const pick = state.role !== "customer" && !!fid;
    const rank = pick ? houseSelectRank(h) : 1;
    if (pick) tintSelectRank(c, rank);
    hutMesh.setColorAt(i, c);
    roof.copy(c).multiplyScalar(lamps && !out && !(r?.on) ? 0.45 : 0.78);
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
  updateLampWindows(src);
}

function colorPowerLines() {
  if (!powerLineMesh) return;
  _feederColMin = -1;
  const { last, byFeeder, byXfmr } = loadsAt(state.nowMin);
  const feederCols = state.scheme === "feeder" ? feederAllotColors(last) : null;
  const civic = civicW(state.nowMin);
  const civicQ = civic * Math.tan(Math.acos(CIVIC_PF));
  const asset = state.scheme === "asset";
  const fid = activeFeederId();
  lvSegMeta.forEach((s, i) => {
    const hit = outageCovers(s, state.nowMin);
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
      cap = Math.max(1, houseById[s.houseId].loadLimitW);
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
    else if (hit) c = new THREE.Color(COL.outage);
    else if (feederCols) c = (s.feederId && feederCols[s.feederId] ? feederCols[s.feederId] : feederCols._village).clone();
    else c = flowMetricColor(p, q, cap, thd);
    if (state.role !== "customer" && fid) {
      if (s.houseId) tintSelectRank(c, houseSelectRank(houseById[s.houseId]));
      else if (s.feederId !== fid) c.multiplyScalar(0.12);
      else c.lerp(SEL_FEEDER, state.scopeBoard || state.focus ? 0.2 : 0.08);
    } else if (fid && s.feederId !== fid) {
      c.multiplyScalar(0.18);
    }
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
      const hit = outageCovers(s, state.nowMin);
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
  if (lvLo) lvLo.lastChild.textContent = g === "pf" ? "LV PF ~1.0" : g === "harmonics" ? "LV THD clean" : "LV flow idle";
  if (lvHi) lvHi.lastChild.textContent = g === "pf" ? "LV PF ≤ 0.55" : g === "harmonics" ? `LV THD ≥${THD_HI}%` : "LV flow at xfmr cap";
}

let lastUiMin = -1;

function setNow(min) {
  state.nowMin = Math.max(0, Math.min(DAY_MIN, min));
  if (timeGroup) timeGroup.position.y = isV2() ? yAt(state.nowMin) : 0;
  timeUniforms.uNow.value = state.nowMin;
  placeSun(state.nowMin);
  if (nowPlane) nowPlane.position.y = Y_NOW;
  if (nowMark) nowMark.position.y = isV2() ? 1.35 : 1.2;
  restackTimeStack();
  restackLastBreath();
  restackTimeLabels();
  const imin = Math.floor(state.nowMin);
  if (imin === lastUiMin) return;
  lastUiMin = imin;
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
  const hideStack = state.hide.worldline;
  readingMesh.visible = !state.hide.reading;
  if (worldlineMesh) worldlineMesh.visible = !hideStack;
  for (const m of rfFloorMeshes) m.visible = !state.hide.rf;
  timeUniforms.uAnomalyOnly.value = state.anomalyOnly ? 1 : 0;
  timeUniforms.uFocusHid.value = state.focus == null ? -1 : houseIndex[state.focus];

  for (const m of eventMeshes) {
    const kind = m.userData.kind;
    if (!kind) continue;
    const hideType = !!state.hide[kind] || ((kind === "leak" || kind === "leak_clear") && state.hide.leak);
    const dim = state.focus && m.userData.houseId && m.userData.houseId !== state.focus;
    m.visible = !hideType;
    if (m.material && "opacity" in m.material) {
      m.material.transparent = true;
      const base = m.userData.baseOpacity ?? (kind === "sync" ? 0.7 : 1);
      m.material.opacity = dim ? 0.18 : base;
    }
  }
  updateLeakViz();
  updateFeederHighlight();
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
    const homes = HOUSES.filter((h) => h.boardId === b.id);
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
    const f = FEEDERS.find((x) => x.id === s.id);
    if (!f) return { label: "feeder missing", blocks: [] };
    const homes = HOUSES.filter((h) => h.feederId === f.id);
    const poles = POLES.filter((p) => p.feederId === f.id);
    const xfmrs = TRANSFORMERS.filter((t) => t.feederId === f.id);
    const boards = BOARDS.filter((b) => b.feederId === f.id);
    const dtm = DTMS.find((d) => d.feederId === f.id);
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
        ...FEEDERS.map((f) => geoidBlock(f.id, "feeder", f.x, f.z, HANG.pole, { label: f.label })),
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
  fillHouses(true);
  fillGeoid();
  writeQuery({
    feeder: next.kind === "feeder" ? next.id : "",
    board: state.emsId || "",
  });
  syncFeederSelect();
  if (opts.cam) progressCamera(next, opts);
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
    const lk = LEAKS.find((x) => x.id === o.userData.leakId);
    return lk ? leakScope(lk) : { kind: "village" };
  }
  if (o.userData.pickHuts && i != null) {
    const h = HOUSES[i];
    return h ? { kind: "house", id: h.id } : { kind: "village" };
  }
  if (o.userData.houseId) return { kind: "house", id: o.userData.houseId };
  if (o.userData.pickBoards && i != null) {
    const b = BOARDS[i];
    return b ? { kind: "board", id: b.id } : { kind: "village" };
  }
  if (o.userData.pickXfmr && i != null) {
    const t = TRANSFORMERS[i];
    return t ? { kind: "feeder", id: t.feederId } : { kind: "village" };
  }
  if (o.userData.pickPoles && i != null) return polePick[i] || { kind: "village" };
  if (o.userData.pickBreakers && i != null) return breakerPick[i] || { kind: "village" };
  if (o.userData.pickLines && i != null) {
    const s = lvSegMeta[Math.floor(i / WIRE_STEPS)];
    if (s?.feederId) return { kind: "feeder", id: s.feederId };
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
  const consider = (d2, scope) => {
    if (d2 < bestD) {
      bestD = d2;
      best = scope;
    }
  };
  for (const b of BOARDS) consider((b.x - x) ** 2 + (b.z - z) ** 2, { kind: "board", id: b.id });
  for (const t of TRANSFORMERS) consider((t.x - x) ** 2 + (t.z - z) ** 2, { kind: "feeder", id: t.feederId });
  for (const f of FEEDERS) consider((f.x - x) ** 2 + (f.z - z) ** 2, { kind: "feeder", id: f.id });
  for (const h of HOUSES) consider((h.x - x) ** 2 + (h.z - z) ** 2, { kind: "house", id: h.id });
  for (const p of POLES) {
    if (p.feederId) consider((p.x - x) ** 2 + (p.z - z) ** 2, { kind: "feeder", id: p.feederId });
  }
  for (const s of GRID_SEGS) {
    if (!s.feederId) continue;
    consider(distPointSeg2(x, z, s.ax, s.az, s.bx, s.bz), { kind: "feeder", id: s.feederId });
  }
  for (const lk of LEAKS) consider((lk.x - x) ** 2 + (lk.z - z) ** 2, leakScope(lk));
  return best || { kind: "village" };
}

function bindStagePick() {
  const el = renderer.domElement;
  el.addEventListener("pointerdown", onStagePointerDown, true);
  window.addEventListener("pointermove", onStagePointerMove);
  el.addEventListener("pointerup", onStagePointerUp);
  window.addEventListener("pointerup", onStagePointerUp);
}

function orbitByPixels(dxPx, dyPx) {
  if (!camera || !controls || !renderer) return;
  if (camFly) camFly = null;
  const h = Math.max(1, renderer.domElement.clientHeight);
  orbitOffset.copy(camera.position).sub(controls.target);
  orbitSpherical.setFromVector3(orbitOffset);
  orbitSpherical.theta -= (2 * Math.PI * dxPx) / h;
  orbitSpherical.phi -= (2 * Math.PI * dyPx) / h;
  const minP = controls.minPolarAngle ?? 0.06;
  const maxP = controls.maxPolarAngle ?? Math.PI * 0.88;
  orbitSpherical.phi = Math.max(minP, Math.min(maxP, orbitSpherical.phi));
  orbitSpherical.makeSafe();
  orbitOffset.setFromSpherical(orbitSpherical);
  camera.position.copy(controls.target).add(orbitOffset);
  camera.lookAt(controls.target);
}

/** Right-drag: grab the scene (same feel as OrbitControls pan). */
function panByPixels(dxPx, dyPx) {
  if (!camera || !controls || !renderer) return;
  if (camFly) camFly = null;
  const h = Math.max(1, renderer.domElement.clientHeight);
  orbitOffset.copy(camera.position).sub(controls.target);
  const step = (orbitOffset.length() * Math.tan((camera.fov / 2) * (Math.PI / 180)) * 2) / h;
  panAxis.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(-dxPx * step);
  panDelta.copy(panAxis);
  panAxis.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(dyPx * step);
  panDelta.add(panAxis);
  camera.position.add(panDelta);
  controls.target.add(panDelta);
  const tx = Math.max(PAN_X[0], Math.min(PAN_X[1], controls.target.x));
  const tz = Math.max(PAN_Z[0], Math.min(PAN_Z[1], controls.target.z));
  const cx = tx - controls.target.x;
  const cz = tz - controls.target.z;
  if (cx || cz) {
    controls.target.x = tx;
    controls.target.z = tz;
    camera.position.x += cx;
    camera.position.z += cz;
  }
}

function applyPick(clientX, clientY) {
  const scope = scopeAt(clientX, clientY);
  if (state.role === "customer") {
    const hid = scope.kind === "house" ? scope.id : null;
    if (hid === state.you) setScope({ kind: "house", id: hid }, { cam: true, from: "map" });
    return;
  }
  setScope(scope, { cam: true, from: "map" });
}

function onStagePointerDown(ev) {
  abortCamFly();
  const mouse = ev.pointerType === "mouse";
  if (mouse && ev.button !== 0 && ev.button !== 2) return;
  if (pickPtr && ev.pointerId !== pickPtr.id) return;
  ev.stopImmediatePropagation();
  pickPtr = {
    id: ev.pointerId,
    button: ev.button,
    x: ev.clientX,
    y: ev.clientY,
    lx: ev.clientX,
    ly: ev.clientY,
    dragged: false,
  };
  try {
    renderer.domElement.setPointerCapture(ev.pointerId);
  } catch {
    /* ignore */
  }
}

function onStagePointerMove(ev) {
  if (!pickPtr || ev.pointerId !== pickPtr.id) return;
  const ox = ev.clientX - pickPtr.x;
  const oy = ev.clientY - pickPtr.y;
  if (ox * ox + oy * oy >= PICK_DRAG_PX * PICK_DRAG_PX) pickPtr.dragged = true;
  if (!pickPtr.dragged) return;
  const dx = ev.clientX - pickPtr.lx;
  const dy = ev.clientY - pickPtr.ly;
  if (pickPtr.button === 2) panByPixels(dx, dy);
  else orbitByPixels(dx, dy);
  pickPtr.lx = ev.clientX;
  pickPtr.ly = ev.clientY;
}

function onStagePointerUp(ev) {
  if (!pickPtr || ev.pointerId !== pickPtr.id) return;
  const g = pickPtr;
  pickPtr = null;
  try {
    renderer.domElement.releasePointerCapture(g.id);
  } catch {
    /* ignore */
  }
  if (g.dragged || g.button === 2) return;
  applyPick(g.x, g.y);
}

function scopeAt(clientX, clientY) {
  if (!renderer || !camera) return { kind: "village" };
  const rect = renderer.domElement.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return { kind: "village" };
  const mouse = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.params.Line = { threshold: 0.45 };
  ray.params.Points = { threshold: 0.45 };
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(pickList(), true);
  const hit = preferLeakHit(hits);
  let scope = hit ? scopeFromHit(hit) : { kind: "village" };
  if (scope.kind === "village" || scope.kind === "station") {
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pt = new THREE.Vector3();
    if (ray.ray.intersectPlane(plane, pt)) scope = nearestScopeAt(pt.x, pt.z);
  }
  return scope;
}

function tick(ts) {
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  if (state.playing) {
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
  renderer.render(scene, camera);
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

function feederPoints(fid) {
  const pts = [];
  const f = FEEDERS.find((x) => x.id === fid);
  if (f) pts.push([f.x, f.z]);
  const d = DTMS.find((x) => x.feederId === fid);
  if (d) pts.push([d.x, d.z]);
  for (const h of HOUSES) if (h.feederId === fid) pts.push([h.x, h.z]);
  for (const t of TRANSFORMERS) if (t.feederId === fid) pts.push([t.x, t.z]);
  for (const p of POLES) if (p.feederId === fid) pts.push([p.x, p.z]);
  for (const b of BOARDS) if (b.feederId === fid) pts.push([b.x, b.z]);
  return pts;
}

function feederCamPose(fid) {
  if (!camera) return null;
  const pts = feederPoints(fid);
  if (!pts.length) return null;
  const f = FEEDERS.find((x) => x.id === fid);
  const d = DTMS.find((x) => x.feederId === fid);
  const src = d || f || LANDMARKS.xfmr;
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
  const pad = 1.22;
  const vFov = (camera.fov * Math.PI) / 180;
  const aspect = Math.max(0.55, camera.aspect || 1.35);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const distH = (alongSpan * pad) / 2 / Math.tan(hFov / 2);
  const distV = (perpSpan * pad) / 2 / Math.tan(vFov / 2);
  const dist = Math.min(78, Math.max(16, distH, distV));
  const elev = 0.38;
  const horiz = dist * Math.cos(elev);
  const height = Math.max(7, dist * Math.sin(elev));
  const ox = -az;
  const oz = ax;
  return {
    pos: new THREE.Vector3(lookX + ox * horiz, height, lookZ + oz * horiz),
    look: new THREE.Vector3(lookX, 0.42, lookZ),
  };
}

function startCamFly(toPos, toLook, dur = 0.95) {
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
  camMag = 1;
  startCamFly(pose.pos, pose.look, 0.95);
}

function flyToVillage() {
  camFeederId = null;
  camMag = 0;
  const home = camHome(isV2());
  startCamFly(new THREE.Vector3(...home.pos), new THREE.Vector3(...home.look), 0.85);
}

function pickCamTarget(scope) {
  const n = normalizeScope(scope);
  if (!n || n.kind === "village" || n.kind === "station") {
    return { mag: 0, fid: null, bid: null, hid: null };
  }
  if (n.kind === "house") {
    const h = houseById[n.id];
    if (!h) return { mag: 0, fid: null, bid: null, hid: null };
    return { mag: 2, fid: h.feederId, bid: h.boardId, hid: h.id };
  }
  if (n.kind === "board") {
    const b = boardById[n.id];
    if (!b) return { mag: 0, fid: null, bid: null, hid: null };
    return { mag: 2, fid: b.feederId, bid: b.id, hid: null };
  }
  if (n.kind === "feeder") {
    if (n.houseId) {
      const h = houseById[n.houseId];
      return { mag: 2, fid: n.id, bid: n.boardId || h?.boardId || null, hid: n.houseId };
    }
    if (n.boardId) return { mag: 2, fid: n.id, bid: n.boardId, hid: null };
    return { mag: 1, fid: n.id, bid: null, hid: null };
  }
  return { mag: 0, fid: null, bid: null, hid: null };
}

function applyCamMag(mag, target) {
  if (mag <= 0 || !target?.fid) {
    if (camMag === 0) return;
    flyToVillage();
    return;
  }
  if (mag === 1) {
    flyToFeeder(target.fid);
    return;
  }
  if (target.hid) {
    const h = houseById[target.hid];
    if (h) {
      camFeederId = target.fid;
      camMag = 2;
      framePoint(h.x, h.z, 18);
      return;
    }
  }
  if (target.bid) {
    const b = boardById[target.bid];
    if (b) {
      camFeederId = target.fid;
      camMag = 2;
      framePoint(b.x, b.z, 24);
      return;
    }
  }
  flyToFeeder(target.fid);
}

function progressCamera(next, opts = {}) {
  if (state.role === "customer") return;
  const target = pickCamTarget(next);
  const from = opts.from || "map";
  let mag;
  if (from === "clear" || target.mag === 0) {
    mag = 0;
  } else if (from === "grid-home" && target.hid) {
    mag = 2;
  } else if (camFeederId && target.fid && camFeederId !== target.fid) {
    mag = 1;
  } else if (target.mag > camMag) {
    mag = Math.min(camMag + 1, target.mag);
  } else {
    mag = target.mag;
  }
  applyCamMag(mag, target);
}

function framePoint(x, z, dist = 22) {
  if (!camera || !controls) return;
  const toLook = new THREE.Vector3(x, 0.45, z);
  orbitOffset.copy(camera.position).sub(controls.target);
  if (orbitOffset.lengthSq() < 0.04) orbitOffset.set(dist * 0.55, Math.max(5.5, dist * 0.58), dist * 0.72);
  orbitSpherical.setFromVector3(orbitOffset);
  orbitSpherical.radius = dist;
  orbitSpherical.phi = Math.max(0.32, Math.min(1.2, orbitSpherical.phi));
  orbitSpherical.makeSafe();
  orbitOffset.setFromSpherical(orbitSpherical);
  startCamFly(toLook.clone().add(orbitOffset), toLook, 0.75);
}

function frameSelection() {
  if (state.role === "customer") {
    const you = houseById[state.you];
    if (you) {
      camFeederId = you.feederId;
      camMag = 2;
      framePoint(you.x, you.z, 18);
    }
    return;
  }
  if (state.focus) {
    const h = houseById[state.focus];
    if (h) {
      camFeederId = h.feederId;
      camMag = 2;
      framePoint(h.x, h.z, 18);
      return;
    }
  }
  const bid = state.scopeBoard || state.emsId;
  if (bid && boardById[bid]) {
    const b = boardById[bid];
    camFeederId = b.feederId;
    camMag = 2;
    framePoint(b.x, b.z, 24);
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
  const feederW = HOUSES.filter((x) => x.feederId === h.feederId).reduce((s, x) => {
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
    youEl.innerHTML = HOUSES.map((h) => `<option value="${h.id}">${esc(h.name)} · ${esc(h.serial)}</option>`).join("");
    youEl.dataset.ready = "1";
  }
  if (youEl) youEl.value = state.you;
  const h = houseById[state.you] || HOUSES[0];
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
  const feeder = FEEDERS.find((f) => f.id === b.feederId);
  const dtm = DTMS.find((d) => d.feederId === b.feederId);
  const xf = TRANSFORMERS.find((t) => t.id === b.xfmrId);
  const leak = LEAKS.find((lk) => lk && (lk.fromBoardId === b.id || lk.toBoardId === b.id));
  const leakLive = leak && state.nowMin >= leak.min && state.nowMin < leak.restore;
  const idx = BOARDS.findIndex((x) => x.id === b.id);
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
  if (title) title.textContent = b.label || "MeshEMS";
  if (sub) sub.textContent = `${idx + 1} / ${BOARDS.length} · ${houses.length} meters · ${feeder?.label || b.feederId}`;
  const hops = houses[0] ? hopsToUsb(houses[0].id) : "—";
  const check = [
    { cls: "done", t: `Pole label ${b.id} · feeder ${b.feederId} · ${b.cluster}` },
    { cls: "done", t: "Seat NESL 865B · ext 5 V / 3.3 V (workshop schematic)" },
    { cls: houses.length ? "done" : "bad", t: `Map ports 1–${houses.length} to meter serials on this pole` },
    { cls: "done", t: `Phase split A ${phases.A} · B ${phases.B} · C ${phases.C} from ${dtm?.label || "DTM"}` },
    { cls: "done", t: `Heartbeat ${SLOT_MIN} min · MQTT northbound (OpenAMI)` },
    { cls: xf ? "done" : "warn", t: xf ? `LV from ${xf.label || xf.id}` : "No xfmr id on this board" },
    {
      cls: leakLive ? "bad" : leak ? "warn" : "done",
      t: leak
        ? leakLive
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
  const b = boardById[id] || BOARDS[0];
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
  if (!BOARDS.length) return;
  const i = Math.max(0, BOARDS.findIndex((b) => b.id === state.emsId));
  const next = BOARDS[(i + dir + BOARDS.length) % BOARDS.length];
  openEms(next.id, false, { cam: true, from: "grid-ems" });
}

function applyRole() {
  document.documentElement.dataset.role = state.role;
  const roleEl = document.getElementById("wl-role");
  if (roleEl) roleEl.value = state.role;
  if (state.role === "customer") {
    if (!houseById[state.you]) state.you = HOUSES[0]?.id || "h0";
    state.focus = state.you;
    state.scope = { kind: "house", id: state.you };
    closeEms();
    fillCustomer();
  } else {
    const card = document.getElementById("wl-cust-card");
    if (card) card.hidden = true;
    if (state.role === "tech") {
      if (state.emsId) fillEms();
      else if (state.scope?.kind !== "feeder") openEms(BOARDS[0]?.id, false);
    } else fillEms();
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
  if (feeder && FEEDERS.some((f) => f.id === feeder) && state.role !== "customer") {
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
    applySchemeColors();
  });
  document.getElementById("wl-linegrad")?.addEventListener("change", (e) => {
    state.lineGrad = parseLineGrad(e.target.value);
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
    const id = state.emsId || (state.scope?.kind === "feeder" ? state.scopeBoard : null) || BOARDS[0]?.id;
    openEms(id, false, { cam: true, from: "grid-ems" });
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
  anomBtn?.addEventListener("click", () => {
    state.anomalyOnly = !state.anomalyOnly;
    anomBtn.classList.toggle("on", state.anomalyOnly);
    applyVisibility();
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

const STAT_ICO = {
  home: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M8 2.2 1.8 7.2h1.4V14h4.2V9.4h2.8V14h4.2V7.2h1.4z"/></svg>',
  bolt: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M9.2 1.4 3.6 9.2h3.4L6.2 14.6l6.4-8.4H9.4z"/></svg>',
  coin: '<svg viewBox="0 0 16 16" width="12" height="12"><circle fill="none" stroke="currentColor" stroke-width="1.6" cx="8" cy="8" r="5.4"/><path fill="currentColor" d="M7.4 4.8h1.2v1h1.1v1.2H8.6v1.2h1.1v1.2H8.6v1h-1.2v-1H6.3V8.2h1.1V7h-1.1V5.8h1.1z"/></svg>',
  alert: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M8 1.8 1.5 13.8h13z"/><rect fill="#3a0a08" x="7.3" y="6.4" width="1.4" height="3.8"/><rect fill="#3a0a08" x="7.3" y="11" width="1.4" height="1.3"/></svg>',
  dtm: '<svg viewBox="0 0 16 16" width="12" height="12"><rect fill="currentColor" x="4" y="2" width="8" height="12" rx="1.2"/></svg>',
  xfer: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M3 5h7.2L8.6 3.4 10 2l4 3.6-4 3.6-1.4-1.4L10.2 7H3zm10 6H5.8l1.6 1.6L6 14l-4-3.6 4-3.6 1.4 1.4L5.8 9H13z"/></svg>',
  pulse: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M1.4 8h2.4l1.4-3.4 2.2 7.2L9.4 5.2 11 8h3.6"/></svg>',
  wave: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M1.6 10.2c1.6-3.2 3.2-3.2 4.8 0s3.2 3.2 4.8 0 3.2-3.2 4.8 0"/></svg>',
  sms: '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M2.2 3.2h11.6v8.2H8.4L5.2 13.6V11.4H2.2z"/></svg>',
};

function statCard(tone, ico, label, value, sub) {
  return `<article class="stat ${tone}"><i class="stat-ico" aria-hidden="true">${ico}</i><div><span class="stat-k">${label}</span><strong class="stat-v">${value}</strong>${sub ? `<em class="stat-s">${sub}</em>` : ""}</div></article>`;
}

function fillStats() {
  const s = day.summary;
  const el = document.getElementById("wl-stats");
  if (!el) return;
  el.innerHTML = `
    <div class="stat-hero">
      ${statCard("site", STAT_ICO.home, "homes", s.customers, `${VILLAGE_PEOPLE} people · ${PEOPLE_PER_HOME}/home`)}
      ${statCard("energy", STAT_ICO.bolt, "energy", `${s.kWh} kWh`, `billed ${s.billed}`)}
      ${statCard("money", STAT_ICO.coin, "payments", s.payments, s.paymentSum)}
      ${statCard("fault", STAT_ICO.alert, "overload", s.overloads ?? 0, `${s.cutoffs} credit cut`)}
    </div>
    <h3 class="stat-sec">Grid</h3>
    <div class="stat-grid">
      ${statCard("dtm", STAT_ICO.dtm, "DTMs", DTMS.length, `${FEEDERS.length} feeders`)}
      ${statCard("dtm", STAT_ICO.xfer, "phase xfer", s.phaseXfers ?? 0, `${s.xfmrCapW} W xfmr`)}
      ${statCard("energy", STAT_ICO.bolt, "peak live", `${s.peakFeederW} W`, `${s.tariff} / kWh`)}
      ${statCard("energy", STAT_ICO.bolt, "site PV", `${Math.round((s.pvNameplateW || 0) / 1000)} kW`, `peak ${Math.round((s.pvPeakW || 0) / 1000)} kW · ${s.pvKWh ?? 0} kWh day`)}
      ${statCard("ops", STAT_ICO.pulse, "heartbeat", `${s.heartbeatMin} min`, `${s.readings} readings`)}
    </div>
    <h3 class="stat-sec">Anomalies</h3>
    <div class="stat-grid">
      ${statCard("fault", STAT_ICO.alert, "outages", (s.outages || []).length, `${s.lastBreathArrived} GB · ${s.lastBreathSilent} silent`)}
      ${statCard("fault", STAT_ICO.alert, "leakage", s.leaks ?? LEAKS.length, `${s.leakW ?? 0} W ΔP spans`)}
      ${statCard("fault", STAT_ICO.alert, "cap 80 / 100%", `${s.cap80 ?? 0} / ${s.cap100 ?? 0}`)}
      ${statCard("pf", STAT_ICO.wave, "PF warn", s.pfWarns ?? 0, `&lt; ${PF_POOR}`)}
      ${statCard("mesh", STAT_ICO.sms, "SMS / reconnect", `${s.sms} / ${s.reconnects}`)}
    </div>
    ${s.faultAt ? `<p class="stat-note">${s.faultAt}</p>` : ""}
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

function fillLedger() {
  const el = document.getElementById("wl-ledger");
  if (!el) return;
  const rows = day.events.filter((e) => e.kind !== "reading" && e.kind !== "off" && e.kind !== "credit");
  el.innerHTML = rows
    .map((e) => {
      const name = e.houseId ? houseById[e.houseId].name : "site";
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
      const name = e.houseId ? houseById[e.houseId].name : "site";
      return `<li class="k-${e.kind}"><time>${fmtClock(e.min)}</time> <b>${e.kind}</b> ${name} — ${e.note}</li>`;
    })
    .join("");
}

function boardsOnFeeder(fid) {
  return BOARDS.filter((b) => b.feederId === fid).sort(
    (a, b) => (a.boardIdx ?? 0) - (b.boardIdx ?? 0) || String(a.id).localeCompare(String(b.id)),
  );
}

function onFeederGridClick(e) {
  const cell = e.target.closest("button.feeder-cell[data-h]");
  if (cell) {
    const id = cell.getAttribute("data-h");
    const h = houseById[id];
    if (!h) return;
    if (state.focus === id && camMag >= 2) {
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

function fillFeederSelect() {
  const el = document.getElementById("wl-feeder");
  if (!el || el.dataset.ready) return;
  el.dataset.ready = "1";
  el.innerHTML =
    `<option value="">Feeder: village</option>` +
    FEEDERS.map((f) => `<option value="${esc(f.id)}">${esc(f.label)}</option>`).join("");
  el.addEventListener("change", () => {
    const id = el.value;
    if (!id) setScope({ kind: "village" }, { cam: true, from: "clear" });
    else setScope({ kind: "feeder", id }, { cam: true, from: "map" });
  });
}

function syncFeederSelect() {
  const el = document.getElementById("wl-feeder");
  if (!el) return;
  const fid = state.role === "customer" ? "" : activeFeederId() || "";
  if (el.value !== fid) el.value = fid;
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
  if (!show) {
    if (title) title.textContent = "At playhead";
    return;
  }
  const f = FEEDERS.find((x) => x.id === fid);
  const d = DTMS.find((x) => x.feederId === fid);
  const boards = boardsOnFeeder(fid);
  const homes = HOUSES.filter((h) => h.feederId === fid);
  const leaks = LEAKS.filter((lk) => lk.feederId === fid);
  const q = state.houseQ.trim().toLowerCase();
  if (title) title.textContent = f?.label || fid;
  if (sub) {
    const n = leaks.length;
    const leakBit = n ? ` · ${n} leak span${n === 1 ? "" : "s"} between EMS` : "";
    sub.textContent = `${d?.label || "DTM"} · ${boards.length} EMS · ${homes.length} customers · row = MeshEMS, cell = meter${leakBit}`;
  }
  if (!grid) return;
  const cols = Math.max(HOMES_PER_BOARD, 1, ...boards.map((b) => (b.houseIds || []).length));
  grid.style.setProperty("--feeder-cols", String(cols));
  const ids = `${fid}|${boards.map((b) => b.id).join(",")}|${cols}|${leaks.map((lk) => lk.id).join(",")}`;
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
    const lk = LEAKS.find((x) => x.id === el.getAttribute("data-leak"));
    const live = leakLive(lk);
    el.classList.toggle("is-live", live);
    el.classList.toggle("is-idle", !live);
    const txt = el.querySelector(".feeder-leak-txt");
    if (txt && lk) {
      txt.textContent = `${lk.leakW} W · ${leakKindLabel(lk.kind)} · ${live ? "LIVE" : "mapped"} · ${lk.label}`;
    }
  });
  grid.querySelectorAll(".feeder-row").forEach((row) => {
    const bid = row.getAttribute("data-board");
    row.classList.toggle("is-on", bid === state.scopeBoard);
    row.classList.toggle("is-leak", leakEnds.has(bid));
    row.classList.toggle("is-dim", !!state.scopeBoard && bid !== state.scopeBoard);
    const b = boardById[bid];
    const lab = row.querySelector(".feeder-row-lab");
    if (lab) {
      const metric = houseIdsMetricColor(b?.houseIds);
      lab.style.borderColor = bid === state.scopeBoard
        ? "#5ee0ff"
        : leakEnds.has(bid)
          ? "#e85dff"
          : `#${metric.getHexString()}`;
    }
  });
  grid.querySelectorAll("button.feeder-cell[data-h]").forEach((btn) => {
    const id = btn.getAttribute("data-h");
    const h = houseById[id];
    const r = readingAt(id, state.nowMin);
    const o = h ? houseOutage(h) : null;
    const on = r ? r.on && !r.feederOut : false;
    const watts = on ? r.powerW || 0 : 0;
    const cap = r?.capacity || (on && h?.loadLimitW ? watts / h.loadLimitW : 0);
    btn.classList.toggle("out", !!o);
    btn.classList.toggle("focus", state.focus === id);
    btn.classList.toggle("on-ems", !!state.scopeBoard && h?.boardId === state.scopeBoard);
    const c = o ? new THREE.Color(COL.outage) : state.scheme === "feeder" ? feederColorForHouse(id) : readingMetricColor(r);
    const hex = `#${c.getHexString()}`;
    btn.style.background = hex;
    btn.style.borderColor = hex;
    const thdTxt = on ? ` · THD ${(r?.thd || 0).toFixed(0)}%` : "";
    btn.title = `${h?.name || id} · ${h?.serial || ""} · ${o ? "OUTAGE" : on ? `${Math.round(watts)} W · ${Math.round(cap * 100)}%${thdTxt}` : "OFF · 0 W"}`;
    const match =
      !!q &&
      !!h &&
      (h.name.toLowerCase().includes(q) || h.serial.toLowerCase().includes(q) || h.id.toLowerCase() === q);
    btn.classList.toggle("match", match);
  });
}

function listedHouses() {
  const q = state.houseQ.trim().toLowerCase();
  let list = HOUSES;
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
  if (state.focus) {
    const f = houseById[state.focus];
    if (f && !list.some((h) => h.id === f.id)) list = [f, ...list];
  }
  return { total: list.length, rows: list.slice(0, 40) };
}

function fillHouses(rebuild) {
  fillFeederGrid();
  const el = document.getElementById("wl-houses");
  if (!el) return;
  const { total, rows } = listedHouses();
  const count = document.getElementById("wl-house-count");
  if (count) count.textContent = `${Math.min(40, total)} of ${HOUSES.length}${total > 40 ? ` · ${total} match` : ""}`;
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
    btn.classList.toggle("active", state.focus === id);
    btn.classList.toggle("is-off", !on);
    btn.classList.toggle("is-outage", feederOut);
    btn.querySelector("[data-st]").textContent = feederOut
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
  });
  drawStream();
  drawFsLoad();
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
    const mix = r.mix || {};
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
  if (s.kind === "feeder") return HOUSES.filter((h) => h.feederId === s.id);
  if (s.kind === "station") {
    const st = STATIONS.find((x) => x.id === s.id);
    const ids = new Set(st?.feederIds || FEEDERS.map((f) => f.id));
    return HOUSES.filter((h) => ids.has(h.feederId));
  }
  return HOUSES;
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
    const f = FEEDERS.find((x) => x.id === s.id);
    const d = DTMS.find((x) => x.feederId === s.id);
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

boot();
