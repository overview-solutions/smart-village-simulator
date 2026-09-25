/**
 * BUILD mode — palette of every UN-style asset type; click map to place.
 * Overlay only (does not mutate procedural HOUSES / GRID_SEGS sim state).
 *
 * Dist run: click poles in sequence — each click places pole + splice junction;
 * from the 2nd pole onward, primary or secondary conductor auto-strings (tool pick).
 * First secondary click snaps to a nearby primary structure (pole / station / xfmr).
 */

import * as THREE from "three";
import { useClassMatchesFocus } from "./customer-use.js";
import { planCustomers, useClassHex, lineServeBand } from "./village-seed-customers.js";

/** @typedef {{ id: string, group: string, label: string, kind: 'point'|'line'|'area'|'chain', color: number, hang: number }} AssetDef */

/** Snap radius (ground units ≈ metres) when continuing a run onto an existing build pole. */
const POLE_SNAP_M = 1.35;
/** First secondary click: snap to nearby primary structure. */
const PRIMARY_TAP_SNAP_M = 8;
const PRIMARY_LINE_CLASSES = new Set(["primary", "trunk"]);
const PRIMARY_DEVICE_CLASSES = new Set(["station", "gen", "xfmr"]);
/** Sagged wire segment count for build-layer conductors. */
const WIRE_STEPS = 8;
const DIST_RUN_JUNCTION = "splice";

/** Village-typical nominal kV. Edit any time — schema field `nominalKv`. */
export const LINE_KV_DEFAULT = {
  trunk: 11,
  primary: 11,
  secondary: 0.4,
  service: 0.23,
  neutral: 0,
};

export const LINE_KV_PRESETS = {
  trunk: [11, 33],
  primary: [0.38, 0.4, 11, 12.47, 33],
  secondary: [0.22, 0.23, 0.4, 0.48],
  service: [0.23, 0.12],
  neutral: [0],
};

function isDistTool(id) {
  return (
    id === "dist_run" ||
    id === "dist_run_primary" ||
    id === "dist_run_lv_primary" ||
    id === "dist_run_lv_secondary" ||
    id === "gen_feeder"
  );
}

/** First-class BUILD story: gen→line · gen · station · MV/LV primary · secondary · LV 220. */
const CORE_ORDER = [
  "gen_feeder",
  "gen",
  "switching_assembly",
  "dist_run_primary",
  "dist_run_lv_primary",
  "dist_run",
  "dist_run_lv_secondary",
];
const CORE_IDS = new Set(CORE_ORDER);

/** Cyan / yellow / magenta / orange — read on green-brown satellite. */
export function contrastLineColor(assetClass, kv) {
  const n = Number(kv);
  if (assetClass === "trunk" || (assetClass === "primary" && Number.isFinite(n) && n >= 1)) return 0x00e5ff;
  if (assetClass === "primary") return 0xffe14a;
  if (assetClass === "secondary") return Number.isFinite(n) && n <= 0.25 ? 0xff8a00 : 0xff3d8f;
  if (assetClass === "service") return 0xff8a00;
  if (assetClass === "neutral") return 0xf4f7fb;
  if (assetClass === "dist_run_primary" || assetClass === "gen_feeder") return 0x00e5ff;
  if (assetClass === "dist_run_lv_primary") return 0xffe14a;
  if (assetClass === "dist_run") return 0xff3d8f;
  if (assetClass === "dist_run_lv_secondary") return 0xff8a00;
  return 0x00e5ff;
}

export function contrastLineHexCss(hex) {
  return `#${Number(hex).toString(16).padStart(6, "0")}`;
}

function lineAccentForDef(d) {
  if (!d) return 0x00e5ff;
  if (d.kind === "chain") return contrastLineColor(d.lineClass || "primary", d.defaultKv ?? defaultLineKv(d.lineClass || "primary"));
  if (d.kind === "line") return contrastLineColor(d.id, d.defaultKv ?? defaultLineKv(d.id));
  return d.color ?? 0x00e5ff;
}

function wireMat(hex, { opacity = 1, glow = false } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: glow || opacity < 1,
    opacity,
    depthWrite: !glow,
    toneMapped: false,
  });
  mat.userData._hlBaseColor = hex;
  mat.userData._hlBaseOp = opacity;
  return mat;
}

function isCoreTool(id) {
  return CORE_IDS.has(id);
}

export function defaultLineKv(lineClass) {
  return LINE_KV_DEFAULT[lineClass] ?? 0.4;
}

/** Devices / gear that hang on a pole — right-click menu. */
export const POLE_MOUNT_IDS = [
  "xfmr",
  "ems",
  "dtm",
  "cabinet",
  "enclosure",
  "fuse",
  "disconnect",
  "recloser",
  "breaker",
  "meter",
];

/** Small XZ offset so mounts sit beside the pole shaft, not inside it. */
const MOUNT_OFFSET = {
  xfmr: { x: 0.32, z: 0 },
  ems: { x: 0.28, z: 0.12 },
  dtm: { x: 0.18, z: 0 },
  cabinet: { x: 0.3, z: 0.1 },
  enclosure: { x: 0.3, z: 0.1 },
  fuse: { x: 0.12, z: 0 },
  disconnect: { x: 0.14, z: 0 },
  recloser: { x: 0.2, z: 0 },
  breaker: { x: 0.14, z: 0 },
  meter: { x: 0.22, z: 0.08 },
};

/** Every asset class from villages/_schema/asset-types.json */
export const BUILD_ASSETS = /** @type {AssetDef[]} */ ([
  // structure — Dist run first (fastest path for a feeder spur)
  {
    id: "gen_feeder",
    group: "device",
    tier: "core",
    label: "Gen → Line",
    kind: "chain",
    color: 0xc8ff3d,
    hang: 0.4,
    lineClass: "primary",
    defaultKv: 11,
  },
  {
    id: "dist_run_primary",
    group: "structure",
    tier: "core",
    label: "Primary",
    kind: "chain",
    color: 0x00e5ff,
    hang: 2.8,
    lineClass: "primary",
    defaultKv: 11,
  },
  {
    id: "dist_run_lv_primary",
    group: "structure",
    tier: "core",
    label: "LV Prim",
    kind: "chain",
    color: 0xffe14a,
    hang: 2.2,
    lineClass: "primary",
    defaultKv: 0.38,
  },
  {
    id: "dist_run",
    group: "structure",
    tier: "core",
    label: "Secondary",
    kind: "chain",
    color: 0xff3d8f,
    hang: 1.8,
    lineClass: "secondary",
    defaultKv: 0.4,
  },
  {
    id: "dist_run_lv_secondary",
    group: "structure",
    tier: "core",
    label: "LV 220",
    kind: "chain",
    color: 0xff8a00,
    hang: 1.8,
    lineClass: "secondary",
    defaultKv: 0.22,
  },
  { id: "pole", group: "structure", label: "Pole", kind: "point", color: 0xf4f7fb, hang: 1.4 },
  { id: "cabinet", group: "structure", label: "Cabinet", kind: "point", color: 0x4a5568, hang: 0.55 },
  { id: "pad", group: "structure", label: "Pad", kind: "point", color: 0x6b7280, hang: 0.08 },
  { id: "enclosure", group: "structure", label: "Enclosure", kind: "point", color: 0x374151, hang: 0.7 },
  // electric_device
  { id: "meter", group: "device", label: "Meter", kind: "point", color: 0x6b2d5c, hang: 1.1 },
  { id: "breaker", group: "device", label: "Breaker", kind: "point", color: 0xb42318, hang: 1.2 },
  {
    id: "switching_assembly",
    group: "device",
    tier: "core",
    label: "Station / switch",
    kind: "point",
    color: 0xc9a227,
    hang: 2.0,
  },
  { id: "fuse", group: "device", label: "Fuse", kind: "point", color: 0xba7517, hang: 1.15 },
  { id: "disconnect", group: "device", label: "Disconnect", kind: "point", color: 0xc45b5b, hang: 1.2 },
  { id: "recloser", group: "device", label: "Recloser", kind: "point", color: 0x9b1c1c, hang: 1.35 },
  { id: "inverter", group: "device", label: "Inverter", kind: "point", color: 0x175cd3, hang: 0.45 },
  { id: "bess", group: "device", label: "BESS", kind: "point", color: 0x2bb6a3, hang: 0.5 },
  { id: "ems", group: "device", label: "EMS", kind: "point", color: 0x0b6e4f, hang: 1.3 },
  { id: "dtm", group: "device", label: "DTM", kind: "point", color: 0x2bb6a3, hang: 3.0 },
  { id: "gen", group: "device", tier: "core", label: "Generation", kind: "point", color: 0xc8ff3d, hang: 0.4 },
  { id: "xfmr", group: "device", label: "Xfmr", kind: "point", color: 0xffffff, hang: 2.0 },
  { id: "station", group: "device", label: "Station", kind: "point", color: 0xffffff, hang: 2.0 },
  // electric_junction
  { id: "bus", group: "junction", label: "Bus", kind: "point", color: 0x7a4419, hang: 1.0 },
  { id: "splice", group: "junction", label: "Splice", kind: "point", color: 0x8a8a82, hang: 1.6 },
  { id: "service_point", group: "junction", label: "Service pt", kind: "point", color: 0x5c7cfa, hang: 0.15 },
  { id: "customer", group: "junction", label: "Customer", kind: "point", color: 0x6b8cae, hang: 0.55 },
  { id: "tap", group: "junction", label: "Tap", kind: "point", color: 0xba7517, hang: 1.5 },
  // electric_line
  { id: "trunk", group: "line", label: "Trunk", kind: "line", color: 0x00e5ff, hang: 2.8 },
  { id: "primary", group: "line", label: "Primary", kind: "line", color: 0x00e5ff, hang: 2.8 },
  { id: "secondary", group: "line", label: "Secondary", kind: "line", color: 0xff3d8f, hang: 1.8 },
  { id: "service", group: "line", label: "Service", kind: "line", color: 0xff8a00, hang: 1.8 },
  { id: "neutral", group: "line", label: "Neutral", kind: "line", color: 0xf4f7fb, hang: 1.6 },
  // subnetwork
  { id: "island", group: "subnetwork", label: "Island", kind: "area", color: 0x3d5a3d, hang: 0.05 },
  { id: "feeder", group: "subnetwork", label: "Feeder", kind: "area", color: 0x1d4e89, hang: 0.05 },
]);

const byId = Object.fromEntries(BUILD_ASSETS.map((a) => [a.id, a]));

/** Feed kinds from villages/_schema/feeds.schema.json */
export const FEED_KINDS = {
  mqtt_sunspec: {
    label: "MQTT SunSpec",
    fields: [
      { key: "brokerRef", label: "Broker ref", placeholder: "env:MQTT_URL" },
      { key: "topic", label: "Topic", placeholder: "openami/…/ems" },
      { key: "model", label: "Model", placeholder: "SunSpec" },
    ],
    required: ["topic"],
  },
  rest_json: {
    label: "REST JSON",
    fields: [
      { key: "urlTemplate", label: "URL template", placeholder: "https://…/{id}" },
      { key: "pollSec", label: "Poll (sec)", placeholder: "60" },
      { key: "authRef", label: "Auth ref", placeholder: "env:TOKEN" },
    ],
    required: ["urlTemplate"],
  },
  dlms: {
    label: "DLMS",
    fields: [
      { key: "deviceRef", label: "Device ref", placeholder: "dlms://…" },
      { key: "obis", label: "OBIS", placeholder: "1.8.0" },
      { key: "authRef", label: "Auth ref", placeholder: "env:DLMS" },
    ],
    required: ["deviceRef"],
  },
  openpaygo: {
    label: "OpenPAYGO",
    fields: [
      { key: "deviceId", label: "Device id", placeholder: "meter-id" },
      { key: "tokenApiRef", label: "Token API ref", placeholder: "env:OPENPAYGO" },
    ],
    required: ["deviceId"],
  },
  groundbolt: {
    label: "GroundBolt",
    fields: [
      { key: "siteRef", label: "Site ref", placeholder: "site" },
      { key: "meterRef", label: "Meter ref", placeholder: "m-…" },
    ],
    required: ["meterRef"],
  },
  sim: {
    label: "Sim (local)",
    fields: [{ key: "scenarioId", label: "Scenario id", placeholder: "demo-prepaid" }],
    required: ["scenarioId"],
  },
};

export function feedConfigComplete(cfg) {
  if (!cfg?.kind || !FEED_KINDS[cfg.kind]) return false;
  return FEED_KINDS[cfg.kind].required.every((k) => String(cfg[k] ?? "").trim() !== "");
}

const BUILD_ICONS = {
  dist_run: "M5 19V7M5 7h.01M5 11h14M19 7v12M19 7h.01M9 11l2-2 2 2",
  dist_run_primary: "M5 19V7M5 7h.01M5 9h14M5 13h14M19 7v12M19 7h.01",
  dist_run_lv_primary: "M5 19V7M5 7h.01M5 10h14M19 7v12M19 7h.01M8 14h8",
  dist_run_lv_secondary: "M5 19V7M5 11h14M19 7v12M9 14l3 3 3-3",
  gen_feeder: "M12 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10M12 8v4l2 1M4 20h16",
  switching_assembly: "M5 18V9l7-5 7 5v9H5zM10 18v-5h4v5M8 5h8v3H8z",
  pole: "M12 3v14M9 17h6M12 7h.01",
  cabinet: "M7 4h10v16H7zM7 10h10",
  pad: "M5 16h14v3H5zM7 16V9h10v7",
  enclosure: "M6 5h12v14H6zM9 9h6v6H9z",
  meter: "M8 4h8v16H8zM10 8h4M10 12h4M10 16h3",
  breaker: "M8 5h8v4H8zM12 9v6M9 15h6",
  fuse: "M10 4h4v16h-4zM12 8v8",
  disconnect: "M7 8h10M7 12h10M12 8v8",
  recloser: "M12 4a6 6 0 0 1 0 12 6 6 0 0 1 0-12M12 10v6",
  inverter: "M5 8h14v8H5zM8 12h8M9 8V5h6v3",
  bess: "M7 7h10v12H7zM10 4h4v3h-4z",
  ems: "M6 6h12v12H6zM9 9h6v6H9zM12 3v3",
  dtm: "M12 3v4M8 7h8l-1 12H9L8 7z",
  gen: "M12 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10M12 8v4l2 1",
  xfmr: "M8 6h8v4H8zM9 10v8M15 10v8M7 18h10",
  station: "M5 18V9l7-5 7 5v9H5zM10 18v-5h4v5",
  bus: "M5 11h14M5 14h14M8 8v10M16 8v10",
  splice: "M8 12h8M12 8v8M9 9l6 6M15 9l-6 6",
  service_point: "M12 18V9M9 12l3-3 3 3M8 18h8",
  customer: "M4 20V10l8-6 8 6v10H4zM10 20v-6h4v6",
  tap: "M12 5v14M8 12h8M12 12l4-4",
  trunk: "M4 12h16M6 9l-2 3 2 3M18 9l2 3-2 3",
  primary: "M4 10h16M4 14h16",
  secondary: "M4 12h16M7 9v6M17 9v6",
  service: "M5 12h14M12 8v8",
  neutral: "M5 12h14M8 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  island: "M12 4l7 4v8l-7 4-7-4V8l7-4z",
  feeder: "M6 6h12v4H6zM8 10v8M16 10v8M10 14h4",
};

/** @param {string} assetId @param {number} [size] */
export function buildSvgIcon(assetId, size = 18) {
  const d = BUILD_ICONS[assetId] || BUILD_ICONS.pole;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

const ICONS = BUILD_ICONS;

function svgIcon(pathD) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${pathD}"/></svg>`;
}

/**
 * @param {{
 *   scene: THREE.Scene,
 *   groundAt: (clientX: number, clientY: number) => { x: number, z: number } | null,
 *   toolbarEl: HTMLElement,
 *   hintEl?: HTMLElement | null,
 *   onChange?: () => void,
 *   onSeeded?: (placed: object[]) => void,
 *   extraPoles?: () => { x: number, z: number }[],
 * }} opts
 * extraPoles = procedural scene poles for right-click mount when no build pole yet.
 */
export function createBuildMode(opts) {
  const { scene, groundAt, toolbarEl, hintEl, onChange, onSeeded, extraPoles } = opts;

  const state = {
    active: false,
    tool: /** @type {string | null} */ (null),
    pendingLine: /** @type {{ x: number, z: number } | null} */ (null),
    /** Tail of Dist run — last pole + splice so next click strings a conductor. */
    chainTail: /** @type {{ x: number, z: number, poleId: string, junctionId: string } | null} */ (null),
    /** Active Dist-run id stamped on every asset until End run. */
    runId: /** @type {string | null} */ (null),
    /** Feeder isolated for edit (dim others). */
    editRunId: /** @type {string | null} */ (null),
    _editOn: false,
    /** kV for the next line / Dist-run span. */
    draftKv: 0.4,
    placed: /** @type {any[]} */ ([]),
    seq: 0,
    batchSeq: 0,
    /** houseId → placed asset id */
    houseMap: /** @type {Record<string, string>} */ ({}),
    /** boardId → placed asset id */
    boardMap: /** @type {Record<string, string>} */ ({}),
    /** assetId → feed config */
    configs: /** @type {Record<string, Record<string, string>>} */ ({}),
    selectedAssetId: /** @type {string | null} */ (null),
    pendingHouseId: /** @type {string | null} */ (null),
    pendingBoardId: /** @type {string | null} */ (null),
    /** When set, only place assets in this UN assetGroup (plus Dist run for structure). */
    placeGroupFilter: /** @type {string | null} */ (null),
  };

  const root = new THREE.Group();
  root.name = "build-layer";
  scene.add(root);

  const ghost = new THREE.Group();
  ghost.visible = false;
  root.add(ghost);
  const preview = new THREE.Group();
  preview.name = "build-preview";
  preview.visible = false;
  root.add(preview);

  /** @type {HTMLDivElement | null} */
  let poleMenuEl = null;
  /** @type {{ id: string, x: number, z: number, virtual?: boolean } | null} */
  let poleMenuTarget = null;

  function bump() {
    paintKvStrip();
    syncFeederEdit();
    onChange?.();
  }

  function def() {
    return state.tool ? byId[state.tool] : null;
  }

  function setHint(msg) {
    if (hintEl) hintEl.textContent = msg || "";
  }

  function findPlaced(id) {
    return state.placed.find((p) => p.id === id) || null;
  }

  function ptKey(x, z) {
    return `${Number(x).toFixed(2)},${Number(z).toFixed(2)}`;
  }

  function distPointSeg(px, pz, ax, az, bx, bz) {
    const dx = (bx ?? ax) - ax;
    const dz = (bz ?? az) - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  function beginRun(reuseId) {
    state.runId = reuseId || nextId("run");
    state.editRunId = state.runId;
    return state.runId;
  }

  function toolForRunSpec(lineClass, kv) {
    const n = Number(kv);
    if (lineClass === "primary") return Number.isFinite(n) && n >= 1 ? "dist_run_primary" : "dist_run_lv_primary";
    if (lineClass === "secondary") return Number.isFinite(n) && n <= 0.25 ? "dist_run_lv_secondary" : "dist_run";
    if (lineClass === "trunk") return "dist_run_primary";
    return "dist_run";
  }

  function ensureRunIds() {
    const missing = state.placed.filter((p) => !p.runId && !p.seeded && (p.kind === "line" || p.assetClass === "pole" || p.assetClass === "gen" || p.assetClass === "station"));
    if (!missing.length && state.placed.every((p) => p.runId || p.seeded || (p.kind !== "line" && p.assetClass !== "pole"))) return;
    const parent = Object.create(null);
    const find = (a) => {
      if (parent[a] == null) parent[a] = a;
      return parent[a] === a ? a : (parent[a] = find(parent[a]));
    };
    const union = (a, b) => {
      const pa = find(a);
      const pb = find(b);
      if (pa !== pb) parent[pa] = pb;
    };
    for (const l of state.placed) {
      if (l.kind !== "line" || l.seeded || l.assetClass === "service") continue;
      const band = lineServeBand(l);
      const lid = l.runId || `L:${l.id}`;
      union(lid, `${band}:P:${ptKey(l.x, l.z)}`);
      union(lid, `${band}:P:${ptKey(l.bx, l.bz)}`);
      if (l.fromId) union(lid, `${band}:J:${l.fromId}`);
      if (l.toId) union(lid, `${band}:J:${l.toId}`);
      if (l.runId) union(lid, l.runId);
    }
    for (const p of state.placed) {
      if (p.seeded || p.kind === "line") continue;
      const k = `P:${ptKey(p.x, p.z)}`;
      if (p.runId) union(p.runId, k);
      if (p.id) {
        for (const band of ["mv", "lv380", "lv220"]) union(`${band}:J:${p.id}`, `${band}:${k}`);
      }
      if (p.structureId) {
        for (const band of ["mv", "lv380", "lv220"]) union(`${band}:J:${p.structureId}`, `${band}:${k}`);
      }
    }
    const roots = new Map();
    let n = 0;
    const rootOf = (key) => {
      const r = find(key);
      if (!roots.has(r)) {
        n += 1;
        roots.set(r, `run-auto-${n}`);
      }
      return roots.get(r);
    };
    for (const p of state.placed) {
      if (p.runId || p.seeded) continue;
      if (p.kind === "line" && p.assetClass !== "service") p.runId = rootOf(`L:${p.id}`);
      else if (p.assetClass === "pole" || p.assetGroup === "junction" || p.assetClass === "gen" || p.assetClass === "station" || p.assetClass === "xfmr" || p.assetClass === "breaker") {
        const hit = state.placed.find(
          (l) =>
            l.kind === "line" &&
            !l.seeded &&
            l.assetClass !== "service" &&
            (ptKey(l.x, l.z) === ptKey(p.x, p.z) || ptKey(l.bx, l.bz) === ptKey(p.x, p.z)),
        );
        p.runId = hit ? rootOf(`L:${hit.id}`) : rootOf(`P:${ptKey(p.x, p.z)}`);
      }
    }
    for (const p of state.placed) {
      if (p.runId || p.seeded) continue;
      const host = p.structureId ? findPlaced(p.structureId) : null;
      if (host?.runId) p.runId = host.runId;
    }
  }

  function listRuns() {
    ensureRunIds();
    const by = new Map();
    for (const p of state.placed) {
      if (!p.runId || p.seeded) continue;
      if (!by.has(p.runId)) by.set(p.runId, []);
      by.get(p.runId).push(p);
    }
    const out = [];
    let i = 0;
    for (const [id, recs] of by) {
      const lines = recs.filter((r) => r.kind === "line");
      if (!lines.length && !recs.some((r) => r.assetClass === "gen" || r.assetClass === "station" || r.assetClass === "pole")) continue;
      i += 1;
      const cls = lines[0]?.assetClass || recs.find((r) => r.lineClass)?.lineClass || "primary";
      const kv = lines[0]?.nominalKv ?? defaultLineKv(cls);
      out.push({
        id,
        index: i,
        label: `${i}. ${cls} ${kv} kV · ${lines.length} span${lines.length === 1 ? "" : "s"}`,
        lineClass: cls,
        kv,
        nLines: lines.length,
        nPoles: recs.filter((r) => r.assetClass === "pole").length,
        color: contrastLineColor(cls, kv),
        tail: findRunTail(id),
      });
    }
    return out;
  }

  function findRunTail(runId) {
    const recs = state.placed.filter((p) => p.runId === runId && !p.seeded);
    const lines = recs.filter((p) => p.kind === "line");
    const poles = recs.filter((p) => p.assetClass === "pole");
    const deg = new Map();
    for (const l of lines) {
      const a = ptKey(l.x, l.z);
      const b = ptKey(l.bx, l.bz);
      deg.set(a, (deg.get(a) || 0) + 1);
      deg.set(b, (deg.get(b) || 0) + 1);
    }
    let best = null;
    let bestScore = -1;
    for (const p of poles) {
      const d = deg.get(ptKey(p.x, p.z)) || 0;
      const score = (d <= 1 ? 20 : 4) + (p.assetClass === "pole" ? 2 : 0);
      if (score >= bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best && lines.length) {
      const l = lines[lines.length - 1];
      best = { id: l.toId || l.id, x: l.bx, z: l.bz, assetClass: "pole" };
    }
    if (!best) return null;
    const junc =
      junctionOnPole(best.id) ||
      recs.find((r) => r.assetGroup === "junction" && Math.hypot(r.x - best.x, r.z - best.z) < 0.45);
    return { x: best.x, z: best.z, poleId: best.id, junctionId: junc?.id || best.id };
  }

  function applyEditFocus() {
    const fid = state.editRunId;
    if (!fid && !state._editOn) return;
    state._editOn = !!fid;
    for (const child of root.children) {
      if (child === ghost || child === preview) continue;
      const rec = findPlaced(child.userData?.recordId);
      const mine = !fid || (rec && rec.runId === fid);
      child.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          if (!mat.userData) mat.userData = {};
          if (mat.userData._editBaseOp == null) mat.userData._editBaseOp = mat.opacity ?? 1;
          mat.transparent = true;
          mat.opacity = mine ? (mat.userData._hlBaseOp ?? mat.userData._editBaseOp ?? 1) : 0.16;
        }
      });
    }
  }

  function selectRun(runId) {
    state.editRunId = runId || null;
    if (runId) {
      const recs = state.placed.filter((p) => p.runId === runId);
      const line = recs.find((p) => p.kind === "line");
      if (line) {
        state.selectedAssetId = line.id;
        state.draftKv = Number(line.nominalKv ?? state.draftKv);
      } else if (recs[0]) state.selectedAssetId = recs[0].id;
    }
    applyEditFocus();
    syncFeederEdit();
    paintKvStrip();
    const run = runId ? listRuns().find((r) => r.id === runId) : null;
    setHint(run ? `Editing ${run.label} · Resume to string more · kV chips retag this feeder` : "All feeders");
    bump();
  }

  function resumeRun(runId) {
    const run = listRuns().find((r) => r.id === runId);
    if (!run?.tail) {
      setHint("That feeder has no pole to resume from");
      return false;
    }
    state.editRunId = runId;
    state.runId = runId;
    state.chainTail = { ...run.tail };
    state.tool = toolForRunSpec(run.lineClass, run.kv);
    state.draftKv = Number(run.kv);
    state.pendingLine = null;
    clearPreview();
    applyEditFocus();
    syncTools();
    syncFeederEdit();
    paintKvStrip();
    setHint(`Resume ${run.label} · click next pole · End run when done`);
    bump();
    return true;
  }

  function deleteRun(runId) {
    if (!runId) return 0;
    const ids = state.placed.filter((p) => p.runId === runId && !p.seeded).map((p) => p.id);
    for (const id of ids.reverse()) removeRecordById(id);
    if (state.runId === runId) state.runId = null;
    if (state.editRunId === runId) state.editRunId = null;
    if (state.chainTail && ids.includes(state.chainTail.poleId)) {
      state.chainTail = null;
      clearPreview();
    }
    applyEditFocus();
    syncTools();
    setHint(`Deleted feeder · ${ids.length} asset(s)`);
    bump();
    return ids.length;
  }

  function applyRunKv(runId, kv) {
    const n = Number(kv);
    if (!runId || !Number.isFinite(n) || n < 0) return 0;
    let k = 0;
    for (const rec of state.placed) {
      if (rec.runId !== runId || rec.kind !== "line") continue;
      rec.nominalKv = n;
      remeshRecord(rec);
      k += 1;
    }
    state.draftKv = n;
    return k;
  }

  function syncFeederEdit() {
    const sel = toolbarEl.querySelector(".wl-build-run");
    if (!sel) return;
    const runs = listRuns();
    const ids = runs.map((r) => r.id).join(",");
    if (sel.dataset.ids !== ids) {
      sel.dataset.ids = ids;
      const cur = state.editRunId || "";
      sel.innerHTML =
        `<option value="">All feeders</option>` +
        runs
          .map((r) => `<option value="${r.id}">${r.label}</option>`)
          .join("");
      if (cur && runs.some((r) => r.id === cur)) sel.value = cur;
      else if (cur && !runs.some((r) => r.id === cur)) {
        state.editRunId = null;
        sel.value = "";
      }
    } else if (sel.value !== (state.editRunId || "")) {
      sel.value = state.editRunId || "";
    }
    const resume = toolbarEl.querySelector(".wl-build-resume");
    const del = toolbarEl.querySelector(".wl-build-del-run");
    const on = !!state.editRunId;
    if (resume) resume.hidden = !on;
    if (del) del.hidden = !on;
    applyEditFocus();
  }

  function assetConfigured(assetId) {
    const rec = findPlaced(assetId);
    if (!rec || !String(rec.uid || "").trim()) return false;
    return feedConfigComplete(state.configs[assetId]);
  }

  /** @returns {'red'|'green'} */
  function houseStatus(houseId) {
    const aid = state.houseMap[houseId];
    if (!aid || !findPlaced(aid)) return "red";
    return assetConfigured(aid) ? "green" : "red";
  }

  /** @returns {'red'|'green'} */
  function boardStatus(boardId) {
    const aid = state.boardMap[boardId];
    if (!aid || !findPlaced(aid)) return "red";
    return assetConfigured(aid) ? "green" : "red";
  }

  function syncToggle() {
    toolbarEl.hidden = !state.active;
    toolbarEl.setAttribute("aria-hidden", state.active ? "false" : "true");
    if (hintEl) {
      hintEl.hidden = !state.active;
      hintEl.setAttribute("aria-hidden", state.active ? "false" : "true");
    }
    if (!state.active) {
      state.tool = null;
      state.pendingLine = null;
      state.chainTail = null;
      ghost.visible = false;
      clearPreview();
      hidePoleMenu();
      setHint("");
      syncTools();
    } else {
      setHint(state.tool ? hintForTool() : "Pick asset · Dist run strings poles · right-click pole to mount xfmr/EMS/…");
    }
  }

  function setActive(on) {
    state.active = !!on;
    if (!state.active) {
      state.pendingLine = null;
      state.chainTail = null;
    }
    syncToggle();
    bump();
  }

  function hintForTool() {
    const d = def();
    if (!d) return "Pick an asset, then click the map.";
    if (d.kind === "chain") {
      const cls = d.lineClass || "secondary";
      const kv = state.draftKv ?? d.defaultKv ?? defaultLineKv(cls);
      if (d.id === "gen_feeder" && !state.chainTail) {
        return "Gen → Line: click site — places gen + station + xfmr, then string Primary";
      }
      return state.chainTail
        ? `${d.label}: click next pole (strings ${cls} ${kv} kV · End run / Esc closes)`
        : cls === "secondary"
          ? `${d.label}: click first pole — snaps to nearby primary, then string ${cls} @ ${kv} kV`
          : `${d.label}: click first pole, then each next pole strings ${cls} @ ${kv} kV`;
    }
    if (d.kind === "line") {
      return state.pendingLine
        ? `${d.label}: click end point (Esc cancels)`
        : `${d.label}: click start, then end`;
    }
    if (d.id === "switching_assembly") return "Station / switch: click map — places station + breaker";
    if (d.kind === "area") return `${d.label}: click center on map`;
    return `${d.label}: click map to place`;
  }

  function syncTools() {
    toolbarEl.querySelectorAll("[data-build-asset]").forEach((btn) => {
      const id = btn.getAttribute("data-build-asset");
      const a = byId[id];
      const accent = lineAccentForDef(a);
      const css = contrastLineHexCss(accent);
      btn.style.setProperty("--build-accent", css);
      if (a?.kind === "chain" || a?.kind === "line") {
        btn.style.color = css;
        btn.style.borderColor = css;
      }
      btn.classList.toggle("on", state.active && state.tool === id);
      btn.classList.toggle("is-running", state.active && state.tool === id && !!(state.chainTail || state.pendingLine));
    });
    const endBtn = toolbarEl.querySelector(".wl-build-end");
    if (endBtn) endBtn.hidden = !state.chainTail;
  }

  function endRun() {
    const had = !!state.chainTail || !!state.pendingLine;
    state.chainTail = null;
    state.pendingLine = null;
    state.runId = null;
    clearPreview();
    syncTools();
    const d = def();
    if (had) setHint(`${d?.label || "Run"} closed · pick it in Feeder to edit, or click to start the next`);
    else setHint(hintForTool());
  }

  function remeshRecord(rec) {
    const obj = root.children.find((c) => c.userData?.recordId === rec.id);
    if (obj) disposeObject(obj);
    const d = byId[rec.assetClass];
    if (!d) return;
    const mesh = makeMesh(
      d,
      rec.x,
      rec.z,
      rec.kind === "line"
        ? { bx: rec.bx, bz: rec.bz, nominalKv: rec.nominalKv, hang: rec.hang, seeded: rec.seeded }
        : { useClass: rec.useClass },
    );
    mesh.userData.recordId = rec.id;
    mesh.userData.batchId = rec.batchId ?? null;
    root.add(mesh);
    if (state._useClassFocus) paintUseClassFocus();
  }

  function customerAt(x, z) {
    if (x == null || z == null) return null;
    return state.placed.find((p) => p.assetClass === "customer" && Math.hypot(p.x - x, p.z - z) < 0.25) || null;
  }

  /** Isolate a use class on BUILD overlay (empty-canvas LOADS). */
  function paintUseClassFocus() {
    const focus = state._useClassFocus || null;
    const light =
      typeof document !== "undefined" &&
      document.documentElement.getAttribute("data-theme") === "light";
    for (const child of root.children) {
      if (child === ghost || child === preview) continue;
      const rec = findPlaced(child.userData?.recordId);
      if (!rec) continue;
      const isCust = rec.assetClass === "customer";
      const isService = rec.assetClass === "service";
      let match = true;
      if (focus && isCust) match = useClassMatchesFocus(rec.useClass, focus);
      else if (focus && isService) {
        const cust = customerAt(rec.bx, rec.bz);
        match = cust ? useClassMatchesFocus(cust.useClass, focus) : false;
      }
      if (focus) {
        if (child.userData._ucPrevVis == null) child.userData._ucPrevVis = child.visible;
        if (isCust || isService) child.visible = match;
      } else if (child.userData._ucPrevVis != null) {
        child.visible = child.userData._ucPrevVis;
        delete child.userData._ucPrevVis;
      }
      child.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.transparent = true;
          if (!mat.userData) mat.userData = {};
          if (mat.userData._ucBaseOp == null) mat.userData._ucBaseOp = mat.opacity ?? 1;
          if (mat.userData._ucBaseColor == null && mat.color) {
            mat.userData._ucBaseColor = mat.color.getHex();
          }
          if (!focus) {
            mat.opacity = mat.userData._ucBaseOp;
            if (mat.color && mat.userData._ucBaseColor != null) mat.color.setHex(mat.userData._ucBaseColor);
            continue;
          }
          if ((isCust || isService) && match) {
            mat.opacity = 1;
            if (isCust && mat.color && rec.useClass) mat.color.setHex(useClassHex(rec.useClass));
          } else if ((isCust || isService) && !match) {
            mat.opacity = 0;
          } else {
            mat.opacity = Math.min(mat.userData._ucBaseOp, light ? 0.28 : 0.22);
          }
        }
      });
    }
  }

  function makeMesh(asset, x, z, extra = {}) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.userData = { build: true, assetId: asset.id, ...extra };

    if (asset.kind === "line" && extra.bx != null) {
      const ax = 0;
      const az = 0;
      const bx = extra.bx - x;
      const bz = extra.bz - z;
      const len = Math.hypot(bx - ax, bz - az) || 0.2;
      const y = extra.hang ?? asset.hang;
      const sag = Math.min(0.36, len * 0.035);
      const kv = extra.nominalKv ?? defaultLineKv(asset.id);
      const hex = contrastLineColor(asset.id, kv);
      const lv = asset.id === "secondary" || asset.id === "service" || asset.id === "neutral" || (Number(kv) < 1);
      const thick = lv ? 0.1 : 0.14;
      const core = wireMat(hex);
      const glow = extra.seeded ? null : wireMat(hex, { opacity: 0.42, glow: true });
      const rim = extra.seeded ? null : wireMat(0x0a0c10, { opacity: 0.9 });
      const steps = extra.seeded ? 2 : WIRE_STEPS;
      const point = (t) =>
        new THREE.Vector3(ax + (bx - ax) * t, y - 4 * sag * t * (1 - t), az + (bz - az) * t);
      for (let j = 0; j < steps; j++) {
        const a = point(j / steps);
        const b = point((j + 1) / steps);
        const dir = b.clone().sub(a);
        const segLen = dir.length() || 0.01;
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const addCyl = (r, mat, order) => {
          if (!mat) return;
          const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, segLen, 7), mat);
          mesh.position.copy(mid);
          mesh.quaternion.copy(q);
          mesh.renderOrder = order;
          g.add(mesh);
        };
        addCyl(thick * 2.8, glow, 4);
        addCyl(thick * 1.55, rim, 5);
        addCyl(thick, core, 6);
      }
      return g;
    }

    // Dist run ghost = pole sample
    if (isDistTool(asset.id)) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.1, 2.8, 6),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 1.4;
      mesh.castShadow = true;
      g.add(mesh);
      return g;
    }

    if (asset.kind === "area") {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(asset.id === "island" ? 4.5 : 3.2, 28),
        new THREE.MeshBasicMaterial({
          color: asset.color,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.04;
      g.add(disc);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(asset.id === "island" ? 4.3 : 3.0, asset.id === "island" ? 4.5 : 3.2, 28),
        new THREE.MeshBasicMaterial({ color: asset.color, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      pin.position.y = 0.35;
      g.add(pin);
      return g;
    }

    // point assets
    let mesh;
    if (asset.id === "pole") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.11, 2.8, 6),
        new THREE.MeshBasicMaterial({ color: asset.color }),
      );
      mesh.position.y = 1.4;
    } else if (asset.id === "xfmr" || asset.id === "station") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.65, 10),
        new THREE.MeshBasicMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    } else if (asset.id === "cabinet" || asset.id === "enclosure" || asset.id === "ems" || asset.id === "bess") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.85, 0.4),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 0.45;
    } else if (asset.id === "pad") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.08, 1.4),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 0.04;
    } else if (asset.id === "gen") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.7, 12),
        new THREE.MeshBasicMaterial({ color: asset.color }),
      );
      mesh.position.y = 0.35;
    } else if (asset.id === "dtm") {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.55, 8),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    } else if (asset.id === "customer") {
      const hex = useClassHex(extra.useClass);
      const hut = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.62, 0.82),
        new THREE.MeshBasicMaterial({ color: hex }),
      );
      hut.position.y = 0.34;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.72, 0.38, 4),
        new THREE.MeshBasicMaterial({ color: 0x1a1c20 }),
      );
      roof.position.y = 0.84;
      roof.rotation.y = Math.PI / 4;
      g.add(hut);
      g.add(roof);
      return g;
    } else if (asset.group === "junction") {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    } else {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 10),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    }
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }

  function rebuildGhost() {
    while (ghost.children.length) {
      const c = ghost.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    const d = def();
    if (!d || !state.active) {
      ghost.visible = false;
      return;
    }
    const sample = makeMesh(
      isDistTool(d.id) ? byId.pole : d.id === "switching_assembly" ? byId.station : d,
      0,
      0,
      d.kind === "line" ? { bx: 2, bz: 0 } : {},
    );
    while (sample.children.length) ghost.add(sample.children[0]);
    ghost.visible = false;
  }

  function wipeGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose?.();
        }
      });
    }
  }

  function clearPreview() {
    wipeGroup(preview);
    preview.visible = false;
  }

  function updatePreview(x, z) {
    const start = state.chainTail || state.pendingLine;
    const d = def();
    if (!state.active || !d || !start) {
      clearPreview();
      return;
    }
    wipeGroup(preview);
    const cls = d.lineClass || (d.kind === "line" ? d.id : "secondary");
    const lineDef = byId[cls] || byId.secondary;
    const sample = makeMesh(lineDef, start.x, start.z, {
      bx: x,
      bz: z,
      nominalKv: Number(state.draftKv ?? d.defaultKv ?? defaultLineKv(cls)),
      hang: lineDef.hang,
    });
    sample.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          mat.transparent = true;
          mat.opacity = Math.min(1, (mat.opacity ?? 1) * 0.92);
          mat.depthWrite = false;
        }
      }
    });
    preview.add(sample);
    preview.visible = true;
  }

  function handleMapMove(clientX, clientY) {
    if (!state.active || !state.tool) {
      clearPreview();
      return false;
    }
    const d = def();
    if (!d || (d.kind !== "chain" && d.kind !== "line")) {
      clearPreview();
      return false;
    }
    if (!state.chainTail && !state.pendingLine) {
      clearPreview();
      return false;
    }
    const pt = groundAt(clientX, clientY);
    if (!pt) {
      clearPreview();
      return false;
    }
    updatePreview(pt.x, pt.z);
    return true;
  }

  function nextId(assetClass) {
    state.seq += 1;
    return `build-${assetClass}-${state.seq}`;
  }

  function disposeObject(obj) {
    root.remove(obj);
    obj.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose?.();
      }
    });
  }

  function removeRecordById(id) {
    const idx = state.placed.findIndex((p) => p.id === id);
    if (idx < 0) return;
    state.placed.splice(idx, 1);
    const obj = root.children.find((c) => c.userData?.recordId === id);
    if (obj) disposeObject(obj);
    for (const [hid, aid] of Object.entries(state.houseMap)) {
      if (aid === id) delete state.houseMap[hid];
    }
    for (const [bid, aid] of Object.entries(state.boardMap)) {
      if (aid === id) delete state.boardMap[bid];
    }
    delete state.configs[id];
    if (state.selectedAssetId === id) state.selectedAssetId = null;
  }

  function placeRecord(rec, { silent = false } = {}) {
    if (state.runId && !rec.runId && !rec.seeded) rec.runId = state.runId;
    state.placed.push(rec);
    const d = byId[rec.assetClass];
    const mesh = makeMesh(
      d,
      rec.x,
      rec.z,
      rec.kind === "line"
        ? { bx: rec.bx, bz: rec.bz, nominalKv: rec.nominalKv, hang: rec.hang, seeded: rec.seeded }
        : { useClass: rec.useClass },
    );
    mesh.userData.recordId = rec.id;
    mesh.userData.batchId = rec.batchId ?? null;
    root.add(mesh);
    state.selectedAssetId = rec.id;
    if ((rec.assetClass === "meter" || rec.assetClass === "service_point") && state.pendingHouseId) {
      state.houseMap[state.pendingHouseId] = rec.id;
      setHint(`Mapped ${state.pendingHouseId} → ${rec.assetClass}. Configure API feed.`);
      state.pendingHouseId = null;
    } else if (rec.assetClass === "ems" && state.pendingBoardId) {
      state.boardMap[state.pendingBoardId] = rec.id;
      setHint(`Mapped EMS ${state.pendingBoardId} → placed cabinet. Configure API feed.`);
      state.pendingBoardId = null;
    }
    if (!silent) bump();
  }

  /** Nearest build-layer pole within snap radius, or null. */
  function findNearbyPole(x, z) {
    let best = null;
    let bestD = POLE_SNAP_M;
    for (const p of state.placed) {
      if (p.assetClass !== "pole") continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function isPrimaryLine(rec) {
    return rec?.kind === "line" && PRIMARY_LINE_CLASSES.has(rec.assetClass);
  }

  /** Poles, stations, xfmrs, and primary line ends that a secondary can tap. */
  function collectPrimaryStructures() {
    const out = [];
    const seen = new Set();
    const add = (x, z, rec) => {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const key = rec?.id || `${x.toFixed(3)},${z.toFixed(3)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ x, z, rec });
    };
    for (const p of state.placed) {
      if (PRIMARY_DEVICE_CLASSES.has(p.assetClass) || p.lineClass === "primary" || p.lineClass === "trunk") {
        add(p.x, p.z, p);
      }
      if (!isPrimaryLine(p)) continue;
      add(p.x, p.z, p);
      add(p.bx, p.bz, p);
      for (const jid of [p.fromId, p.toId]) {
        const junc = state.placed.find((q) => q.id === jid);
        if (!junc) continue;
        add(junc.x, junc.z, junc);
        const pole = state.placed.find((q) => q.id === junc.structureId && q.assetClass === "pole");
        if (pole) add(pole.x, pole.z, pole);
      }
    }
    return out;
  }

  function findNearbyPrimaryStructure(x, z, radius = PRIMARY_TAP_SNAP_M) {
    let best = null;
    let bestD = radius;
    for (const s of collectPrimaryStructures()) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  function snapSecondaryStart(x, z) {
    const hit = findNearbyPrimaryStructure(x, z);
    if (!hit) return { x, z, snapped: false };
    return { x: hit.x, z: hit.z, snapped: true, rec: hit.rec };
  }

  function junctionOnPole(poleId) {
    return state.placed.find((p) => p.assetGroup === "junction" && p.structureId === poleId) || null;
  }

  /** Build pole, or virtual handle onto a procedural scene pole. */
  function resolvePoleAt(x, z) {
    const build = findNearbyPole(x, z);
    if (build) return { id: build.id, x: build.x, z: build.z, virtual: false };
    const extras = typeof extraPoles === "function" ? extraPoles() || [] : [];
    let best = null;
    let bestD = POLE_SNAP_M;
    for (const p of extras) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return null;
    const id = `scene-pole-${best.x.toFixed(2)}_${best.z.toFixed(2)}`;
    return { id, x: best.x, z: best.z, virtual: true };
  }

  function hidePoleMenu() {
    if (poleMenuEl) poleMenuEl.hidden = true;
    poleMenuTarget = null;
  }

  function ensurePoleMenu() {
    if (poleMenuEl) return poleMenuEl;
    const el = document.createElement("div");
    el.id = "wl-pole-menu";
    el.className = "wl-pole-menu";
    el.hidden = true;
    el.setAttribute("role", "menu");
    el.setAttribute("aria-label", "Mount asset on pole");
    document.body.appendChild(el);
    poleMenuEl = el;
    document.addEventListener(
      "pointerdown",
      (e) => {
        if (!poleMenuEl || poleMenuEl.hidden) return;
        if (poleMenuEl.contains(/** @type {Node} */ (e.target))) return;
        hidePoleMenu();
      },
      true,
    );
    return el;
  }

  function mountOnPole(pole, assetClass) {
    const defA = byId[assetClass];
    if (!defA || defA.kind !== "point") return;
    const off = MOUNT_OFFSET[assetClass] || { x: 0.2, z: 0 };
    const mx = pole.x + off.x;
    const mz = pole.z + off.z;
    state.batchSeq += 1;
    const batchId = `batch-${state.batchSeq}`;
    const id = nextId(assetClass);
    placeRecord({
      id,
      assetClass,
      assetGroup: defA.group,
      kind: "point",
      x: mx,
      z: mz,
      structureId: pole.id,
      mounted: true,
      batchId,
    });
    hidePoleMenu();
    setHint(`${defA.label} mounted on pole · configure feed if needed`);
  }

  function showPoleMenu(clientX, clientY, pole) {
    const el = ensurePoleMenu();
    poleMenuTarget = pole;
    const items = POLE_MOUNT_IDS.map((aid) => {
      const a = byId[aid];
      if (!a) return "";
      return `<button type="button" class="wl-pole-menu-item" role="menuitem" data-mount="${aid}">
        <span class="wl-pole-menu-ico">${svgIcon(ICONS[aid] || ICONS.pole)}</span>
        <span>${a.label}</span>
      </button>`;
    }).join("");
    el.innerHTML = `<div class="wl-pole-menu-title">Mount on pole</div>${items}`;
    el.querySelectorAll("[data-mount]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const aid = btn.getAttribute("data-mount");
        if (aid && poleMenuTarget) mountOnPole(poleMenuTarget, aid);
      });
    });
    el.hidden = false;
    const pad = 8;
    const w = el.offsetWidth || 180;
    const h = el.offsetHeight || 280;
    let left = clientX + 4;
    let top = clientY + 4;
    if (left + w > window.innerWidth - pad) left = clientX - w - 4;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
  }

  function handleMapContextMenu(clientX, clientY) {
    if (!state.active) return false;
    const pt = groundAt(clientX, clientY);
    if (!pt) {
      hidePoleMenu();
      return false;
    }
    const pole = resolvePoleAt(pt.x, pt.z);
    if (!pole) {
      hidePoleMenu();
      return false;
    }
    showPoleMenu(clientX, clientY, pole);
    return true;
  }

  function lineClassForTool(toolId) {
    const d = byId[toolId];
    if (d?.lineClass) return d.lineClass;
    if (d?.group === "line") return d.id;
    return null;
  }

  function currentLineClass() {
    const fromTool = lineClassForTool(state.tool);
    if (fromTool) return fromTool;
    const rec = findPlaced(state.selectedAssetId);
    if (rec?.kind === "line") return rec.assetClass;
    return null;
  }

  /** One Dist-run click: pole + splice (+ auto conductor from previous pole). */
  function placeDistRunPole(x, z) {
    if (!state.chainTail) beginRun();
    else if (!state.runId) beginRun(state.editRunId);
    const startingSecondary = !state.chainTail && def()?.lineClass === "secondary";
    let snappedPrimary = false;
    if (startingSecondary) {
      const tap = snapSecondaryStart(x, z);
      x = tap.x;
      z = tap.z;
      snappedPrimary = tap.snapped;
    }
    state.batchSeq += 1;
    const batchId = `batch-${state.batchSeq}`;
    const snapped = findNearbyPole(x, z);
    let poleRec = snapped;
    let placedNewPole = false;

    if (!poleRec) {
      const poleId = nextId("pole");
      poleRec = {
        id: poleId,
        assetClass: "pole",
        assetGroup: "structure",
        kind: "point",
        x,
        z,
        batchId,
      };
      placeRecord(poleRec);
      placedNewPole = true;
    } else {
      x = poleRec.x;
      z = poleRec.z;
    }
    const runClass = def()?.lineClass;
    if (runClass && !poleRec.lineClass) poleRec.lineClass = runClass;

    let junc = junctionOnPole(poleRec.id);
    if (!junc) {
      const jDef = byId[DIST_RUN_JUNCTION];
      const juncId = nextId(DIST_RUN_JUNCTION);
      junc = {
        id: juncId,
        assetClass: DIST_RUN_JUNCTION,
        assetGroup: "junction",
        kind: "point",
        x,
        z,
        structureId: poleRec.id,
        batchId,
      };
      placeRecord(junc);
    }

    let strung = false;
    if (state.chainTail && state.chainTail.poleId !== poleRec.id) {
      const lineClass = def()?.lineClass || "secondary";
      const lineDef = byId[lineClass];
      const lineId = nextId(lineClass);
      const kv = Number(state.draftKv ?? defaultLineKv(lineClass));
      placeRecord({
        id: lineId,
        assetClass: lineClass,
        assetGroup: "line",
        kind: "line",
        x: state.chainTail.x,
        z: state.chainTail.z,
        bx: x,
        bz: z,
        fromId: state.chainTail.junctionId,
        toId: junc.id,
        nominalKv: kv,
        hang: lineDef?.hang,
        batchId,
      });
      strung = true;
    }

    state.chainTail = {
      x,
      z,
      poleId: poleRec.id,
      junctionId: junc.id,
    };

    const n = state.placed.filter((p) => p.assetClass === "pole").length;
    const cls = def()?.lineClass || "secondary";
    const kv = state.draftKv ?? defaultLineKv(cls);
    if (strung) {
      setHint(`${def()?.label || "Run"}: pole ${n} · ${cls} ${kv} kV · click next · End run when done`);
    } else if (snappedPrimary) {
      setHint(`${def()?.label || "Run"}: snapped to primary · click next to string ${cls}`);
    } else if (placedNewPole) {
      setHint(`${def()?.label || "Run"}: first pole set · click next to string ${cls}`);
    } else {
      setHint(`${def()?.label || "Run"}: snapped to existing pole · click next to string ${cls}`);
    }
    syncTools();
  }

  function placeGenFeederHead(x, z) {
    beginRun();
    state.batchSeq += 1;
    const batchId = `batch-${state.batchSeq}`;
    const kv = Number(state.draftKv ?? 11);
    placeRecord({
      id: nextId("gen"),
      assetClass: "gen",
      assetGroup: "device",
      kind: "point",
      x,
      z,
      batchId,
    });
    const stationId = nextId("station");
    placeRecord({
      id: stationId,
      assetClass: "station",
      assetGroup: "device",
      kind: "point",
      x: x + 1.55,
      z,
      primaryKv: kv,
      secondaryKv: 0.4,
      kva: 100,
      batchId,
    });
    placeRecord({
      id: nextId("breaker"),
      assetClass: "breaker",
      assetGroup: "device",
      kind: "point",
      x: x + 2.45,
      z,
      structureId: stationId,
      batchId,
    });
    placeRecord({
      id: nextId("xfmr"),
      assetClass: "xfmr",
      assetGroup: "device",
      kind: "point",
      x: x + 1.55,
      z: z + 1.05,
      structureId: stationId,
      primaryKv: kv,
      secondaryKv: 0.4,
      kva: 100,
      batchId,
    });
    const poleId = nextId("pole");
    placeRecord({
      id: poleId,
      assetClass: "pole",
      assetGroup: "structure",
      kind: "point",
      x: x + 2.9,
      z,
      lineClass: "primary",
      batchId,
    });
    const juncId = nextId(DIST_RUN_JUNCTION);
    placeRecord({
      id: juncId,
      assetClass: DIST_RUN_JUNCTION,
      assetGroup: "junction",
      kind: "point",
      x: x + 2.9,
      z,
      structureId: poleId,
      batchId,
    });
    state.chainTail = { x: x + 2.9, z, poleId, junctionId: juncId };
    state.selectedAssetId = stationId;
    state.draftKv = kv;
    setHint(`Gen + station + xfmr (${kv} kV / 100 kVA) · click poles to string Primary · End run when done`);
    syncTools();
    bump();
  }

  function placeSwitchingAssembly(x, z) {
    state.batchSeq += 1;
    const batchId = `batch-${state.batchSeq}`;
    const stationId = nextId("station");
    placeRecord({
      id: stationId,
      assetClass: "station",
      assetGroup: "device",
      kind: "point",
      x,
      z,
      batchId,
    });
    placeRecord({
      id: nextId("breaker"),
      assetClass: "breaker",
      assetGroup: "device",
      kind: "point",
      x: x + 0.95,
      z,
      structureId: stationId,
      batchId,
    });
    setHint("Station + breaker placed · pick Primary and string out");
  }

  function clearSeededCustomers() {
    const ids = state.placed.filter((p) => p.seeded).map((p) => p.id);
    for (const id of ids.reverse()) removeRecordById(id);
    return ids.length;
  }

  function seedExampleCustomers() {
    const planned = planCustomers(state.placed.filter((p) => !p.seeded));
    if (!planned.length) {
      setHint("No LV lines to seed — string 0.38 / 0.22 first");
      return;
    }
    const wiped = clearSeededCustomers();
    state.batchSeq += 1;
    const batchId = `batch-${state.batchSeq}`;
    for (const c of planned) {
      placeRecord({
        id: nextId("customer"),
        assetClass: "customer",
        assetGroup: "junction",
        kind: "point",
        x: c.x,
        z: c.z,
        useClass: c.useClass,
        lineId: c.lineId,
        nominalKv: c.nominalKv,
        seeded: true,
        batchId,
      }, { silent: true });
      placeRecord({
        id: nextId("service"),
        assetClass: "service",
        assetGroup: "line",
        kind: "line",
        x: c.ax,
        z: c.az,
        bx: c.x,
        bz: c.z,
        nominalKv: c.nominalKv,
        hang: 1.4,
        seeded: true,
        batchId,
      }, { silent: true });
    }
    bump();
    const n = planned.length;
    const nPoles = new Set(planned.map((c) => c.poleKey).filter(Boolean)).size;
    const mkt = planned.filter((c) => c.useClass === "market" || c.useClass === "commercial").length;
    const civic = planned.filter((c) =>
      c.useClass === "medical" || c.useClass === "school" || c.useClass === "worship" || c.useClass === "water",
    ).length;
    const shop = planned.filter((c) => c.useClass === "industrial" || c.useClass === "agricultural").length;
    setHint(
      `Seeded ${n} customers` +
        (nPoles ? ` · ${nPoles} LV poles` : "") +
        (wiped ? ` (replaced ${wiped} old)` : "") +
        ` · ${mkt} market/shop · ${civic} civic/water · ${shop} workshop/farm · 1-day sample…`,
    );
    const snap = state.placed.slice();
    requestAnimationFrame(() => {
      onSeeded?.(snap);
    });
  }

  function handleMapClick(clientX, clientY) {
    if (!state.active) return false;
    const pt = groundAt(clientX, clientY);
    if (!pt) return !!state.tool;

    // No tool: click selects a placed asset so UID / feed can be edited.
    if (!state.tool) {
      return selectNearbyAsset(pt.x, pt.z);
    }

    const d = def();
    if (!d) return false;
    if (
      state.placeGroupFilter &&
      d.group !== state.placeGroupFilter &&
      !isCoreTool(d.id) &&
      !(state.placeGroupFilter === "structure" && isDistTool(d.id))
    ) {
      setHint(`Layer filter: place ${state.placeGroupFilter} assets only (Esc clears tool · Layers clears filter)`);
      return true;
    }

    if (d.id === "switching_assembly") {
      placeSwitchingAssembly(pt.x, pt.z);
      return true;
    }

    if (d.id === "gen_feeder") {
      if (!state.chainTail) placeGenFeederHead(pt.x, pt.z);
      else placeDistRunPole(pt.x, pt.z);
      return true;
    }

    if (d.kind === "chain") {
      placeDistRunPole(pt.x, pt.z);
      return true;
    }

    if (d.kind === "line") {
      if (!state.pendingLine) {
        let sx = pt.x;
        let sz = pt.z;
        let snappedPrimary = false;
        if (d.id === "secondary") {
          const tap = snapSecondaryStart(pt.x, pt.z);
          sx = tap.x;
          sz = tap.z;
          snappedPrimary = tap.snapped;
        }
        state.pendingLine = { x: sx, z: sz };
        setHint(snappedPrimary ? `${d.label}: snapped to primary · click end point` : hintForTool());
        return true;
      }
      const a = state.pendingLine;
      state.pendingLine = null;
      placeRecord({
        id: nextId(d.id),
        assetClass: d.id,
        assetGroup: d.group,
        kind: "line",
        x: a.x,
        z: a.z,
        bx: pt.x,
        bz: pt.z,
        nominalKv: Number(state.draftKv ?? defaultLineKv(d.id)),
      });
      setHint(hintForTool());
      return true;
    }

    placeRecord({
      id: nextId(d.id),
      assetClass: d.id,
      assetGroup: d.group,
      kind: d.kind,
      x: pt.x,
      z: pt.z,
    });
    setHint(`${d.label} placed · set UID in right panel`);
    return true;
  }

  function selectNearbyAsset(x, z) {
    let best = null;
    let bestD = 2.2;
    for (const p of state.placed) {
      if (p.seeded && p.assetClass === "service") continue;
      let d;
      if (p.kind === "line" && p.bx != null) {
        d = distPointSeg(x, z, p.x, p.z, p.bx, p.bz);
      } else {
        d = Math.hypot(p.x - x, p.z - z);
      }
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return false;
    if (best.runId) {
      selectRun(best.runId);
      return true;
    }
    state.selectedAssetId = best.id;
    const uidBit = best.uid ? ` · UID ${best.uid}` : " · enter UID in panel";
    setHint(`Selected ${best.assetClass}${uidBit}`);
    bump();
    return true;
  }

  function applyKv(kv) {
    const n = Number(kv);
    if (!Number.isFinite(n) || n < 0) return;
    state.draftKv = n;
    if (state.editRunId) {
      const k = applyRunKv(state.editRunId, n);
      paintKvStrip();
      setHint(k ? `Feeder kV → ${n} · ${k} span(s)` : hintForTool());
      bump();
      return;
    }
    const rec = findPlaced(state.selectedAssetId);
    if (rec?.kind === "line") {
      rec.nominalKv = n;
      remeshRecord(rec);
    }
    paintKvStrip();
    setHint(hintForTool());
    bump();
  }

  function paintKvStrip() {
    const strip = toolbarEl.querySelector(".wl-build-kv");
    if (!strip) return;
    const cls = currentLineClass();
    const show = !!cls;
    strip.hidden = !show;
    if (!show) return;
    const rec = findPlaced(state.selectedAssetId);
    const kv = rec?.kind === "line" && rec.nominalKv != null ? rec.nominalKv : (state.draftKv ?? defaultLineKv(cls));
    const presets = LINE_KV_PRESETS[cls] || [defaultLineKv(cls)];
    strip.querySelectorAll("[data-kv]").forEach((btn) => {
      btn.classList.toggle("on", Number(btn.getAttribute("data-kv")) === Number(kv));
    });
    const inp = strip.querySelector(".wl-build-kv-in");
    if (inp && document.activeElement !== inp) inp.value = String(kv);
    const lab = strip.querySelector(".wl-build-kv-cls");
    if (lab) lab.textContent = `${cls}`;
    if (!strip.dataset.ready) {
      strip.dataset.ready = "1";
      strip.querySelectorAll("[data-kv]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          applyKv(btn.getAttribute("data-kv"));
        });
      });
      inp?.addEventListener("change", () => applyKv(inp.value));
    }
  }

  function renderToolbar() {
    const groups = [
      ["structure", "Structure"],
      ["device", "Devices"],
      ["junction", "Junctions"],
      ["line", "Lines"],
      ["subnetwork", "Subnetworks"],
    ];
    toolbarEl.innerHTML = "";
    toolbarEl.className = "wl-build-bar";

    const addTool = (tools, a, extraClass = "") => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `wl-build-tool${extraClass ? ` ${extraClass}` : ""}`;
      btn.dataset.buildAsset = a.id;
      const tip =
        a.id === "switching_assembly"
          ? " (station + breaker)"
          : a.kind === "chain"
            ? ` (click poles · auto-string ${a.lineClass || "secondary"})`
            : a.kind === "line"
              ? " (2 clicks)"
              : "";
      btn.title = `${a.label}${tip}`;
      btn.setAttribute("aria-label", a.label);
      btn.innerHTML = svgIcon(ICONS[a.id] || ICONS.pole);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!state.active) setActive(true);
        if (state.tool === a.id && (state.chainTail || state.pendingLine)) {
          endRun();
          return;
        }
        state.tool = state.tool === a.id ? null : a.id;
        state.pendingLine = null;
        state.chainTail = null;
        state.runId = null;
        const d = def();
        const cls = lineClassForTool(state.tool);
        if (d?.defaultKv != null) state.draftKv = d.defaultKv;
        else if (cls) state.draftKv = defaultLineKv(cls);
        rebuildGhost();
        syncTools();
        paintKvStrip();
        setHint(hintForTool());
      });
      tools.appendChild(btn);
    };

    const coreRow = document.createElement("div");
    coreRow.className = "wl-build-group wl-build-group-core";
    const coreLab = document.createElement("span");
    coreLab.className = "wl-build-group-lab";
    coreLab.textContent = "Core";
    coreRow.appendChild(coreLab);
    const coreTools = document.createElement("div");
    coreTools.className = "wl-build-tools";
    for (const id of CORE_ORDER) {
      const a = byId[id];
      if (a) addTool(coreTools, a, "is-core");
    }
    coreRow.appendChild(coreTools);
    toolbarEl.appendChild(coreRow);

    const moreWrap = document.createElement("div");
    moreWrap.className = "wl-build-more";
    for (const [gid, title] of groups) {
      const extras = BUILD_ASSETS.filter((x) => x.group === gid && !isCoreTool(x.id));
      if (!extras.length) continue;
      const row = document.createElement("div");
      row.className = "wl-build-group";
      const lab = document.createElement("span");
      lab.className = "wl-build-group-lab";
      lab.textContent = title;
      row.appendChild(lab);
      const tools = document.createElement("div");
      tools.className = "wl-build-tools";
      for (const a of extras) addTool(tools, a);
      row.appendChild(tools);
      moreWrap.appendChild(row);
    }
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "wl-build-more-toggle";
    moreBtn.textContent = "More";
    moreBtn.title = "Poles, meters, 2-click lines, junctions";
    moreBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toolbarEl.classList.toggle("is-more");
      moreBtn.classList.toggle("on", toolbarEl.classList.contains("is-more"));
    });
    toolbarEl.appendChild(moreBtn);
    toolbarEl.appendChild(moreWrap);
    const kv = document.createElement("div");
    kv.className = "wl-build-kv";
    kv.hidden = true;
    kv.innerHTML = `<span class="wl-build-group-lab">kV <span class="wl-build-kv-cls"></span></span>
      <div class="wl-build-kv-row">
        ${[...new Set(Object.values(LINE_KV_PRESETS).flat())]
          .sort((a, b) => a - b)
          .map((v) => `<button type="button" class="wl-build-kv-btn" data-kv="${v}">${v}</button>`)
          .join("")}
        <input class="wl-build-kv-in" type="number" min="0" step="0.01" title="Nominal kV" />
      </div>`;
    toolbarEl.appendChild(kv);
    const feederEdit = document.createElement("div");
    feederEdit.className = "wl-build-feeder-edit";
    feederEdit.innerHTML = `
      <span class="wl-build-kv-cls">Feeder</span>
      <select class="wl-build-run" title="Select a feeder to isolate and edit" aria-label="Edit feeder">
        <option value="">All feeders</option>
      </select>
      <button type="button" class="wl-build-resume" hidden title="Keep stringing this feeder">Resume</button>
      <button type="button" class="wl-build-del-run" hidden title="Remove this feeder only">Delete</button>
    `;
    const runSel = feederEdit.querySelector(".wl-build-run");
    runSel.addEventListener("change", () => {
      selectRun(runSel.value || null);
    });
    feederEdit.querySelector(".wl-build-resume").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.editRunId) resumeRun(state.editRunId);
    });
    feederEdit.querySelector(".wl-build-del-run").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.editRunId) return;
      const run = listRuns().find((r) => r.id === state.editRunId);
      if (!run) return;
      if (!window.confirm(`Delete ${run.label}?`)) return;
      deleteRun(state.editRunId);
    });
    toolbarEl.appendChild(feederEdit);
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "wl-build-undo";
    undo.textContent = "Undo last";
    undo.title = "Remove last placed build asset";
    undo.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const last = state.placed[state.placed.length - 1];
      if (!last) return;
      const batchId = last.batchId || null;
      const removed = [];
      if (batchId) {
        while (state.placed.length) {
          const top = state.placed[state.placed.length - 1];
          if (top.batchId !== batchId) break;
          removed.push(top);
          removeRecordById(top.id);
        }
      } else {
        removed.push(last);
        removeRecordById(last.id);
      }
      if (state.chainTail && removed.some((r) => r.id === state.chainTail.poleId || r.id === state.chainTail.junctionId)) {
        state.chainTail = null;
      }
      const kinds = [...new Set(removed.map((r) => r.assetClass))].join("+");
      setHint(`${kinds} removed`);
      syncTools();
      bump();
    });
    const seed = document.createElement("button");
    seed.type = "button";
    seed.className = "wl-build-seed";
    seed.textContent = "Seed customers";
    seed.title = "Example loads at LV poles — ≥10/pole, denser on 220 V, medium on 380 V, none on 11 kV";
    seed.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      seedExampleCustomers();
    });
    toolbarEl.appendChild(seed);
    const end = document.createElement("button");
    end.type = "button";
    end.className = "wl-build-end";
    end.textContent = "End run";
    end.title = "Close this feeder — next click starts a new one";
    end.hidden = true;
    end.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      endRun();
    });
    toolbarEl.appendChild(end);
    toolbarEl.appendChild(undo);
    paintKvStrip();
    syncTools();
  }

  window.addEventListener("keydown", (e) => {
    if (!state.active || e.key !== "Escape") return;
    if (poleMenuEl && !poleMenuEl.hidden) {
      hidePoleMenu();
      e.preventDefault();
      return;
    }
    if (state.pendingLine) {
      state.pendingLine = null;
      clearPreview();
      setHint(hintForTool());
      e.preventDefault();
      return;
    }
    if (state.chainTail) {
      endRun();
      e.preventDefault();
      return;
    }
    state.tool = null;
    syncTools();
    setHint(hintForTool());
  });

  renderToolbar();
  syncToggle();

  return {
    isActive: () => state.active,
    setActive,
    handleMapClick,
    handleMapMove,
    handleMapContextMenu,
    listRuns,
    getEditRunId: () => state.editRunId,
    selectRun,
    resumeRun,
    deleteRun,
    hidePoleMenu,
    getPlaced: () => state.placed.slice(),
    houseStatus,
    boardStatus,
    houseMap: () => ({ ...state.houseMap }),
    boardMap: () => ({ ...state.boardMap }),
    getConfig: (assetId) => (state.configs[assetId] ? { ...state.configs[assetId] } : null),
    getSelectedAssetId: () => state.selectedAssetId,
    getPendingHouseId: () => state.pendingHouseId,
    getPendingBoardId: () => state.pendingBoardId,
    selectAsset(assetId) {
      state.selectedAssetId = assetId || null;
      bump();
    },
    /** Click grid cell: select mapped asset, or arm pending house for next meter place / link. */
    focusHouse(houseId) {
      state.pendingBoardId = null;
      const aid = state.houseMap[houseId];
      if (aid && findPlaced(aid)) {
        state.selectedAssetId = aid;
        state.pendingHouseId = null;
        setHint(`Selected meter for ${houseId}. Edit API feed.`);
      } else {
        state.pendingHouseId = houseId;
        state.selectedAssetId = null;
        setHint(`House ${houseId} armed · place a Meter (or Service pt) to map.`);
      }
      bump();
    },
    focusBoard(boardId) {
      state.pendingHouseId = null;
      const aid = state.boardMap[boardId];
      if (aid && findPlaced(aid)) {
        state.selectedAssetId = aid;
        state.pendingBoardId = null;
        setHint(`Selected EMS for ${boardId}. Edit API feed.`);
      } else {
        state.pendingBoardId = boardId;
        state.selectedAssetId = null;
        setHint(`EMS ${boardId} armed · place an EMS cabinet to map.`);
      }
      bump();
    },
    linkSelectedToHouse(houseId) {
      if (!state.selectedAssetId) return false;
      const rec = findPlaced(state.selectedAssetId);
      if (!rec || (rec.assetClass !== "meter" && rec.assetClass !== "service_point")) return false;
      state.houseMap[houseId] = state.selectedAssetId;
      state.pendingHouseId = null;
      setHint(`Linked ${houseId} → ${state.selectedAssetId}`);
      bump();
      return true;
    },
    linkSelectedToBoard(boardId) {
      if (!state.selectedAssetId) return false;
      const rec = findPlaced(state.selectedAssetId);
      if (!rec || rec.assetClass !== "ems") return false;
      state.boardMap[boardId] = state.selectedAssetId;
      state.pendingBoardId = null;
      setHint(`Linked EMS ${boardId} → ${state.selectedAssetId}`);
      bump();
      return true;
    },
    setFeedConfig(assetId, cfg) {
      if (!assetId) return;
      state.configs[assetId] = { ...cfg };
      state.selectedAssetId = assetId;
      bump();
    },
    setNominalKv(assetId, kv) {
      const rec = findPlaced(assetId);
      if (!rec || rec.kind !== "line") return false;
      const n = Number(kv);
      if (!Number.isFinite(n) || n < 0) return false;
      state.selectedAssetId = assetId;
      if (rec.runId && (state.editRunId === rec.runId || !state.editRunId)) {
        state.editRunId = rec.runId;
        applyRunKv(rec.runId, n);
      } else {
        rec.nominalKv = n;
        remeshRecord(rec);
        state.draftKv = n;
      }
      paintKvStrip();
      bump();
      return true;
    },
    setPlantRating(assetId, patch) {
      const rec = findPlaced(assetId);
      if (!rec) return false;
      if (rec.assetClass !== "station" && rec.assetClass !== "xfmr" && rec.assetClass !== "gen") return false;
      if (patch.kva != null) {
        const n = Number(patch.kva);
        if (Number.isFinite(n) && n >= 0) rec.kva = n;
      }
      if (patch.primaryKv != null) {
        const n = Number(patch.primaryKv);
        if (Number.isFinite(n) && n >= 0) rec.primaryKv = n;
      }
      if (patch.secondaryKv != null) {
        const n = Number(patch.secondaryKv);
        if (Number.isFinite(n) && n >= 0) rec.secondaryKv = n;
      }
      state.selectedAssetId = assetId;
      bump();
      return true;
    },
    getNominalKv(assetId) {
      const rec = findPlaced(assetId);
      if (!rec || rec.kind !== "line") return null;
      return rec.nominalKv != null ? Number(rec.nominalKv) : defaultLineKv(rec.assetClass);
    },
    setUid(assetId, uid) {
      const rec = findPlaced(assetId);
      if (!rec) return false;
      rec.uid = String(uid ?? "").trim();
      // Mirror schema-friendly alias used in village GeoJSON packs.
      rec.globalId = rec.uid || undefined;
      state.selectedAssetId = assetId;
      bump();
      return true;
    },
    getUid(assetId) {
      const rec = findPlaced(assetId);
      return rec?.uid ? String(rec.uid) : "";
    },
    bindHouse(houseId, assetId) {
      if (!houseId || !assetId) return;
      state.houseMap[houseId] = assetId;
    },
    bindBoard(boardId, assetId) {
      if (!boardId || !assetId) return;
      state.boardMap[boardId] = assetId;
    },
    getSnapshot() {
      const configs = {};
      for (const [k, v] of Object.entries(state.configs)) configs[k] = { ...v };
      return {
        placed: state.placed.map((p) => ({ ...p })),
        configs,
        houseMap: { ...state.houseMap },
        boardMap: { ...state.boardMap },
        seq: state.seq,
        batchSeq: state.batchSeq,
      };
    },
    clearAll() {
      hidePoleMenu();
      state.chainTail = null;
      state.pendingLine = null;
      state.runId = null;
      state.editRunId = null;
      state.tool = null;
      state.pendingHouseId = null;
      state.pendingBoardId = null;
      while (state.placed.length) {
        removeRecordById(state.placed[state.placed.length - 1].id);
      }
      state.houseMap = {};
      state.boardMap = {};
      state.configs = {};
      state.selectedAssetId = null;
      state.seq = 0;
      state.batchSeq = 0;
      clearPreview();
      syncTools();
      setHint("Project cleared");
      bump();
    },
    loadSnapshot(snap) {
      if (!snap) return;
      this.clearAll();
      state.seq = Number(snap.seq) || 0;
      state.batchSeq = Number(snap.batchSeq) || 0;
      for (const rec of snap.placed || []) {
        placeRecord({ ...rec });
      }
      state.configs = {};
      for (const [k, v] of Object.entries(snap.configs || {})) {
        state.configs[k] = { ...v };
      }
      state.houseMap = { ...(snap.houseMap || {}) };
      state.boardMap = { ...(snap.boardMap || {}) };
      state.selectedAssetId = null;
      state.tool = null;
      state.runId = null;
      state.editRunId = null;
      ensureRunIds();
      syncTools();
      setHint(`Loaded ${state.placed.length} build asset(s)`);
      bump();
    },
    /** Show/hide whole BUILD overlay group. */
    setOverlayVisible(on) {
      root.visible = !!on;
    },
    /**
     * Toggle placed assets by UN assetGroup (structure/device/junction/line/subnetwork).
     * @param {string} group
     * @param {boolean} on
     */
    setAssetGroupVisible(group, on) {
      for (const child of root.children) {
        if (child === ghost || child === preview) continue;
        const rec = findPlaced(child.userData?.recordId);
        if (!rec) continue;
        if (rec.assetGroup === group) child.visible = !!on;
      }
    },
    /**
     * Dim non-matching BUILD assets; glow matching group. null = clear highlight.
     * @param {string | null} group
     */
    setHighlightGroup(group) {
      if (group == null && !state._hlOn) return;
      state._hlOn = group != null;
      const all = group === "__all__";
      const light =
        typeof document !== "undefined" &&
        document.documentElement.getAttribute("data-theme") === "light";
      const hotHex = light ? 0x2f6b14 : 0x7cff3a;
      for (const child of root.children) {
        if (child === ghost || child === preview) continue;
        const rec = findPlaced(child.userData?.recordId);
        const isLine = rec?.kind === "line" || rec?.assetGroup === "line";
        const match = !group || all || (rec && rec.assetGroup === group) || isLine;
        const selected = state.selectedAssetId && rec?.id === state.selectedAssetId;
        const lineHex = isLine ? contrastLineColor(rec.assetClass, rec.nominalKv) : null;
        // Solo focus: park non-matching assets. Lines stay — they are the run.
        if (group != null) child.visible = !!(match || selected || isLine);
        child.traverse((o) => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            if (!mat) continue;
            mat.transparent = true;
            if (!mat.userData) mat.userData = {};
            if (mat.userData._hlBaseOp == null) mat.userData._hlBaseOp = mat.opacity ?? 1;
            if (mat.userData._hlBaseColor == null && mat.color) {
              mat.userData._hlBaseColor = mat.color.getHex();
            }
            if (mat.userData._hlBaseEmInt == null && "emissiveIntensity" in mat) {
              mat.userData._hlBaseEmInt = mat.emissiveIntensity ?? 0;
            }
            if (group == null) {
              mat.opacity = mat.userData._hlBaseOp;
              if (mat.color && mat.userData._hlBaseColor != null) mat.color.setHex(mat.userData._hlBaseColor);
              if (mat.emissive) mat.emissive.setHex(0x000000);
              if ("emissiveIntensity" in mat) {
                mat.emissiveIntensity = mat.userData._hlBaseEmInt ?? 0;
              }
            } else if (isLine && lineHex != null) {
              mat.opacity = 1;
              if (mat.color && mat.userData._hlBaseColor !== 0x0a0c10) mat.color.setHex(lineHex);
              if (mat.emissive) {
                mat.emissive.setHex(lineHex);
                if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0.85;
              }
            } else if (selected) {
              mat.opacity = 1;
              if (mat.emissive) {
                mat.emissive.setHex(0xe6c84a);
                if ("emissiveIntensity" in mat) mat.emissiveIntensity = 1.1;
              }
            } else if (match) {
              mat.opacity = 1;
              if (mat.emissive) {
                mat.emissive.setHex(hotHex);
                if ("emissiveIntensity" in mat) mat.emissiveIntensity = light ? 0.55 : 0.95;
              }
            } else {
              mat.opacity = 0;
              if (mat.emissive) mat.emissive.setHex(0x000000);
              if ("emissiveIntensity" in mat) mat.emissiveIntensity = 0;
            }
          }
        });
      }
    },
    listByGroup(group) {
      return state.placed.filter((p) => p.assetGroup === group);
    },
    /** Prefer tools in this UN group when placing (null = any). */
    setPlaceGroupFilter(group) {
      state.placeGroupFilter = group || null;
      if (state.tool) {
        const d = byId[state.tool];
        if (group && d && d.group !== group && !isDistTool(d.id)) {
          state.tool = null;
          syncTools();
        }
      }
      if (group === "structure" && !state.tool) {
        state.tool = "dist_run";
        syncTools();
      }
    },
    getPlaceGroupFilter: () => state.placeGroupFilter || null,
    /**
     * LOADS isolate: keep matching customers, hide others, dim plant.
     * @param {string | null} focus — class id, "critical", "noncritical", or null
     */
    setUseClassFocus(focus) {
      state._useClassFocus = focus || null;
      paintUseClassFocus();
    },
    findPlaced,
  };
}
