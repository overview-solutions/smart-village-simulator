/**
 * Procedural village footprint. Default ~1000 homes.
 * Topology: ~10 homes / MeshEMS board, ~10 boards / feeder (~100 customers).
 * `?homes=N` or `window.WL_SIZE` override. All sites are procedural.
 */

export const PEOPLE_PER_HOME = 5;

function sizeFromPage() {
  const cfg = typeof window !== "undefined" ? window.WL_SIZE : null;
  const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const people = Number(cfg?.people ?? q.get("people"));
  if (Number.isFinite(people) && people > 0) {
    return { people, homes: Math.max(8, Math.round(people / PEOPLE_PER_HOME)) };
  }
  const homes = Number(cfg?.homes ?? q.get("homes"));
  if (Number.isFinite(homes) && homes > 0) {
    const n = Math.max(8, Math.round(homes));
    return { people: n * PEOPLE_PER_HOME, homes: n };
  }
  return { people: 1000 * PEOPLE_PER_HOME, homes: 1000 };
}

const VILLAGE_SIZE = sizeFromPage();
export const TARGET_HOMES = VILLAGE_SIZE.homes;
export const VILLAGE_PEOPLE = VILLAGE_SIZE.people;
export const HOMES_PER_BOARD = 10;
export const BOARDS_PER_FEEDER = 10;
export const HOMES_PER_FEEDER = HOMES_PER_BOARD * BOARDS_PER_FEEDER;

const PROFILES = [
  { nightW: 25, dayW: 70, eveW: 130, loadLimitW: 220, nightLoad: "lighting", dayLoad: "fridge", eveLoad: "lighting" },
  { nightW: 20, dayW: 90, eveW: 200, loadLimitW: 280, nightLoad: "lighting", dayLoad: "pump", eveLoad: "cooking" },
  { nightW: 40, dayW: 80, eveW: 100, loadLimitW: 160, nightLoad: "fridge", dayLoad: "fridge", eveLoad: "fridge" },
  { nightW: 22, dayW: 85, eveW: 170, loadLimitW: 240, nightLoad: "lighting", dayLoad: "lighting", eveLoad: "cooking" },
];

const GIVEN = [
  "Leila", "Musa", "Hope", "Daniel", "Ayo", "Ruth", "Eshe", "Tomas", "Winta", "Juma",
  "Sanaa", "Abel", "Farah", "Kojo", "Dina", "Issa", "Makeda", "Ravi", "Noor", "Taye",
  "Sifiso", "Halima", "Yara", "Biko", "Lina", "Oumar", "Zuri", "Ama", "Sami", "Thea",
  "Ife", "Nuru", "Gita", "Pio", "Selam", "Ada", "Ben", "Cora", "Eli", "Femi",
];

export const CLUSTERS = [
  { id: "west", label: "west farms", x: -48, z: 22, r: 16 },
  { id: "market", label: "market", x: -5, z: 3, r: 9 },
  { id: "clinic", label: "clinic", x: 16, z: -1, r: 6 },
  { id: "south", label: "south", x: 10, z: 52, r: 14 },
  { id: "east", label: "east", x: 40, z: 12, r: 11 },
];

/** Hamlet share of homes (10 parts → 10×100 at default 1000). */
const CLUSTER_WEIGHTS = [3, 2, 1, 2, 2];

/** Matches sim LANDMARKS.xfmr — feeder trunks start here. */
export const MAIN_XFMR = { x: -18.0, z: -6.0 };
export const MAIN_GEN = { x: -26.0, z: -11.0 };

/** Filled by buildSites: feeder heads + board poles. */
const FEEDER_SPECS = [];

function mulberry(seed) {
  let x = seed | 0;
  return () => {
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = x ^ (x >>> 16);
    return (x >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function nearestClusterId(x, z) {
  let best = CLUSTERS[0].id;
  let bd = Infinity;
  for (const c of CLUSTERS) {
    const d = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = c.id;
    }
  }
  return best;
}

function tryAdd(sites, x, z, minD, cluster) {
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    if ((s[0] - x) ** 2 + (s[1] - z) ** 2 < minD * minD) return false;
  }
  sites.push([x, z, cluster || nearestClusterId(x, z)]);
  return true;
}

function splitEven(n, k) {
  const m = Math.max(1, k);
  const base = Math.floor(n / m);
  const extra = n - base * m;
  return Array.from({ length: m }, (_, i) => base + (i < extra ? 1 : 0));
}

function apportion(weights, total) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const floor = raw.map(Math.floor);
  let left = total - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => [r - floor[i], i]).sort((a, b) => b[0] - a[0]);
  for (let i = 0; i < left; i++) floor[order[i][1]] += 1;
  return floor;
}

function feederIdFor(cluster, fi) {
  return fi === 0 ? `f-${cluster}` : `f-${cluster}-${fi + 1}`;
}

function placeHomesAround(sites, bx, bz, n, minD, rand, cluster, feederId, boardIdx) {
  let added = 0;
  let guard = 0;
  while (added < n && guard++ < n * 40) {
    const ang = ((added + rand() * 0.35) / n) * Math.PI * 2;
    const rad = 1.35 + Math.abs(gauss(rand)) * 0.9;
    if (tryAdd(sites, bx + Math.cos(ang) * rad, bz + Math.sin(ang) * rad, minD, cluster)) {
      const s = sites[sites.length - 1];
      s[3] = feederId;
      s[4] = boardIdx;
      added += 1;
    }
  }
  while (added < n) {
    const ang = (added / n) * Math.PI * 2;
    const rad = 1.25 + added * 0.07;
    sites.push([bx + Math.cos(ang) * rad, bz + Math.sin(ang) * rad, cluster, feederId, boardIdx]);
    added += 1;
  }
}

function buildSites() {
  const rand = mulberry(20260813);
  const target = TARGET_HOMES;
  FEEDER_SPECS.length = 0;
  const sites = [];
  const homesByCluster = apportion(CLUSTER_WEIGHTS, target);
  CLUSTERS.forEach((c, ci) => {
    const nHomes = homesByCluster[ci];
    if (nHomes <= 0) return;
    const nFeeders = Math.max(1, Math.round(nHomes / HOMES_PER_FEEDER));
    const feederSizes = splitEven(nHomes, nFeeders);
    const ux = c.x - MAIN_XFMR.x;
    const uz = c.z - MAIN_XFMR.z;
    const len = Math.hypot(ux, uz) || 1;
    const tx = ux / len;
    const tz = uz / len;
    const nx = -tz;
    const nz = tx;
    feederSizes.forEach((nh, fi) => {
      const feederId = feederIdFor(c.id, fi);
      const nBoards = Math.max(1, Math.round(nh / HOMES_PER_BOARD));
      const boardSizes = splitEven(nh, nBoards);
      const spread = (fi - (nFeeders - 1) / 2) * 9.4;
      const headDist = len * 0.2;
      const head = {
        x: MAIN_XFMR.x + tx * headDist + nx * spread,
        z: MAIN_XFMR.z + tz * headDist + nz * spread,
      };
      const span = Math.max(c.r * 1.2, 5.6 * nBoards);
      const boards = [];
      boardSizes.forEach((bn, bi) => {
        const t = (bi + 0.7) / (nBoards + 0.25);
        const wobble = Math.sin(bi * 1.15 + fi * 0.7) * 2.1;
        const bx = head.x + tx * span * t + nx * (spread * 0.12 + wobble);
        const bz = head.z + tz * span * t + nz * (spread * 0.12 + wobble);
        boards.push({ x: bx, z: bz, n: bn });
        placeHomesAround(sites, bx, bz, bn, 1.05, rand, c.id, feederId, bi);
      });
      const base = c.label;
      FEEDER_SPECS.push({
        id: feederId,
        cluster: c.id,
        label: nFeeders <= 1 ? `${base} feeder` : `${base} feeder ${fi + 1}`,
        x: head.x,
        z: head.z,
        boards,
      });
    });
  });
  return sites.slice(0, target);
}

function houseName(i) {
  return GIVEN[i % GIVEN.length];
}

function loadTraits(i, rural) {
  const r = mulberry(0x51ed ^ Math.imul(i + 1, 0x9e3779b9));
  return {
    loadScale: rural ? 0.38 + r() * 1.15 : 0.48 + r() * 1.45,
    fridgeW: rural ? 12 + r() * 22 : 20 + r() * 32,
    cookDinner: r() > 0.14,
    cookBreakfast: r() > 0.48,
    dinnerOff: Math.floor(r() * 110),
    dinnerDur: 35 + Math.floor(r() * 55),
    cookW: rural ? 80 + r() * 90 : 130 + r() * 180,
    laundry: r() > 0.7,
    laundryOff: Math.floor(r() * 280),
    pump: rural && r() > 0.52,
    ag: rural && r() > 0.38,
    ict: !rural && r() > 0.32,
    ictW: 14 + r() * 48,
    awayDay: r() > 0.84,
    tools: r() > 0.92,
    heat: r() > 0.68,
    payVia: r() < 0.5 ? "vendor" : r() < 0.78 ? "phone" : "ciu",
  };
}

function buildHouses() {
  const sites = buildSites();
  return sites.map((site, i) => {
    const p = PROFILES[i % PROFILES.length];
    const name = houseName(i);
    const rural = site[2] === "west" || site[2] === "south";
    const h = {
      id: `h${i}`,
      name,
      serial: `SM-${String(i).padStart(4, "0")}${name.slice(0, 1).toUpperCase()}`,
      x: site[0],
      z: site[1],
      cluster: site[2],
      feederId: site[3] || `f-${site[2]}`,
      boardIdx: site[4] ?? 0,
      startCredit: 0,
      ...p,
      ...loadTraits(i, rural),
      loadLimitW: rural ? 180 : 240,
      payments: [{ min: 6 * 60 + 15 + (i % 22) * 8, amount: rural ? 400 : 640 }],
    };
    return h;
  });
}

export const HOUSES = buildHouses();

function findParent(parent, a) {
  return parent[a] === a ? a : (parent[a] = findParent(parent, parent[a]));
}

function kruskal(nodes) {
  const parent = Object.fromEntries(nodes.map((n) => [n.id, n.id]));
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      edges.push({ a: a.id, b: b.id, ax: a.x, az: a.z, bx: b.x, bz: b.z, d: (a.x - b.x) ** 2 + (a.z - b.z) ** 2 });
    }
  }
  edges.sort((x, y) => x.d - y.d);
  const kept = [];
  for (const e of edges) {
    const pa = findParent(parent, e.a);
    const pb = findParent(parent, e.b);
    if (pa === pb) continue;
    parent[pa] = pb;
    kept.push(e);
    if (kept.length === nodes.length - 1) break;
  }
  return kept;
}

function densifySegs(edges, step, extra) {
  const out = [];
  const poles = [];
  for (const e of edges) {
    const len = Math.sqrt(e.d) || Math.hypot(e.bx - e.ax, e.bz - e.az);
    const n = Math.max(1, Math.round(len / step));
    let px = e.ax;
    let pz = e.az;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = e.ax + (e.bx - e.ax) * t;
      const z = e.az + (e.bz - e.az) * t;
      out.push({ ax: px, az: pz, bx: x, bz: z, ...extra });
      if (i < n) poles.push({ x, z });
      px = x;
      pz = z;
    }
  }
  return { segs: out, poles };
}

function buildGrid(houses) {
  const feeders = [];
  const transformers = [];
  const segs = [];
  const poles = [];

  segs.push({
    ax: MAIN_GEN.x,
    az: MAIN_GEN.z,
    bx: MAIN_XFMR.x,
    bz: MAIN_XFMR.z,
    kind: "trunk",
    feederId: null,
    xfmrId: null,
    capW: 68000,
  });

  const specs = FEEDER_SPECS.length
    ? FEEDER_SPECS
    : CLUSTERS.map((c) => ({
        id: `f-${c.id}`,
        cluster: c.id,
        label: `${c.label} feeder`,
        x: c.x + (MAIN_XFMR.x - c.x) * 0.28,
        z: c.z + (MAIN_XFMR.z - c.z) * 0.28,
        boards: [],
      }));

  for (const spec of specs) {
    const hs = houses.filter((h) => h.feederId === spec.id);
    if (!hs.length) continue;
    const head = { x: spec.x, z: spec.z };
    feeders.push({ id: spec.id, cluster: spec.cluster, label: spec.label, x: head.x, z: head.z });
    segs.push({
      ax: MAIN_XFMR.x,
      az: MAIN_XFMR.z,
      bx: head.x,
      bz: head.z,
      kind: "trunk",
      feederId: spec.id,
      xfmrId: null,
      capW: Math.max(8000, hs.length * 180),
    });

    const byBoard = [];
    for (const h of hs) {
      const i = h.boardIdx ?? 0;
      (byBoard[i] ||= []).push(h);
    }
    const groups = byBoard.filter((g) => g && g.length);
    const xfmrList = [];
    groups.forEach((ghs, i) => {
      const planned = spec.boards[i];
      const mx = planned ? planned.x : ghs.reduce((s, h) => s + h.x, 0) / ghs.length;
      const mz = planned ? planned.z : ghs.reduce((s, h) => s + h.z, 0) / ghs.length;
      const t = {
        id: `t-${spec.id}-${i}`,
        feederId: spec.id,
        cluster: spec.cluster,
        x: mx,
        z: mz,
        n: ghs.length,
        capW: Math.max(1200, ghs.length * 220),
        label: `pole xfmr · ${spec.label} ${i + 1}`,
      };
      transformers.push(t);
      xfmrList.push(t);
      for (const h of ghs) h.xfmrId = t.id;
      const secNodes = [{ id: t.id, x: t.x, z: t.z }, ...ghs.map((h) => ({ id: h.id, x: h.x, z: h.z }))];
      for (const e of kruskal(secNodes)) {
        const houseId = e.a.startsWith("h") ? e.a : e.b.startsWith("h") ? e.b : null;
        segs.push({
          ax: e.ax,
          az: e.az,
          bx: e.bx,
          bz: e.bz,
          kind: "secondary",
          feederId: spec.id,
          xfmrId: t.id,
          houseId,
          capW: t.capW,
        });
      }
    });

    const chain = [{ x: head.x, z: head.z }, ...xfmrList];
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const prim = densifySegs(
        [{ ax: a.x, az: a.z, bx: b.x, bz: b.z, d: (b.x - a.x) ** 2 + (b.z - a.z) ** 2 }],
        7.2,
        { kind: "primary", feederId: spec.id, xfmrId: null, capW: hs.length * 180 },
      );
      segs.push(...prim.segs);
      for (const p of prim.poles) poles.push({ ...p, feederId: spec.id });
    }
  }

  return { feeders, transformers, segs, poles };
}

const GRID = buildGrid(HOUSES);
export const FEEDERS = GRID.feeders;
export const TRANSFORMERS = GRID.transformers;
export const GRID_SEGS = GRID.segs;
export const POLES = GRID.poles;

export const VENDORS = [
  { id: "v-kiosk", label: "market kiosk", x: -3.0, z: 0.2, kind: "kiosk" },
  ...CLUSTERS.map((c) => {
    const f = FEEDERS.find((x) => x.cluster === c.id);
    if (!f) return null;
    return {
      id: `v-agent-${c.id}`,
      label: `${c.label} agent`,
      x: f.x + 1.5,
      z: f.z - 1.2,
      kind: "agent",
      cluster: c.id,
    };
  }).filter(Boolean),
];

for (const h of HOUSES) {
  let best = VENDORS[0];
  let bd = Infinity;
  for (const v of VENDORS) {
    const d = (h.x - v.x) ** 2 + (h.z - v.z) ** 2;
    const w = v.cluster && v.cluster === h.cluster ? d * 0.3 : d;
    if (w < bd) {
      bd = w;
      best = v;
    }
  }
  h.vendorId = best.id;
}

export const PHASES = ["A", "B", "C"];

for (let i = 0; i < HOUSES.length; i++) {
  const h = HOUSES[i];
  let phase = PHASES[i % 3];
  if (h.cluster === "west" && i % 5 === 0) phase = "A";
  if (h.cluster === "market" && i % 4 === 0) phase = "B";
  h.phase = phase;
}

/** One DitroniX DTM (IPEM-class 3φ monitor) at each feeder takeoff. */
export const DTMS = FEEDERS.map((f) => ({
  id: `dtm-${f.id}`,
  feederId: f.id,
  cluster: f.cluster,
  x: f.x + 0.85,
  z: f.z + 0.55,
  label: `DTM · ${f.label.replace(/ feeder$/, "")}`,
}));

function buildBoards(houses) {
  const boards = [];
  const groups = new Map();
  for (const h of houses) {
    const key = `${h.feederId || "_"}:${h.boardIdx ?? 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  let n = 0;
  for (const hs of groups.values()) {
    if (!hs.length) continue;
    n += 1;
    const id = `ems-${n}`;
    const mx = hs.reduce((s, h) => s + h.x, 0) / hs.length;
    const mz = hs.reduce((s, h) => s + h.z, 0) / hs.length;
    const xf = TRANSFORMERS.find((t) => t.id === hs[0].xfmrId);
    let x = mx;
    let z = mz;
    if (xf) {
      const dx = xf.x - mx;
      const dz = xf.z - mz;
      const len = Math.hypot(dx, dz) || 1;
      x = mx + (dx / len) * 0.55;
      z = mz + (dz / len) * 0.55;
    }
    boards.push({
      id,
      feederId: hs[0].feederId,
      xfmrId: hs[0].xfmrId,
      cluster: hs[0].cluster,
      boardIdx: hs[0].boardIdx ?? 0,
      x,
      z,
      houseIds: hs.map((h) => h.id),
      label: `MeshEMS · ${hs[0].cluster} ${n}`,
    });
    for (const h of hs) h.boardId = id;
  }
  return boards;
}

export const BOARDS = buildBoards(HOUSES);

/** One LV station at the main xfmr — all feeders hang off it. */
export const STATIONS = [
  {
    id: "st-main",
    label: "Village station",
    x: MAIN_XFMR.x,
    z: MAIN_XFMR.z,
    feederIds: FEEDERS.map((f) => f.id),
  },
];

/** -Z is north (south hamlet sits at +Z; east at +X). Sun arcs through south. */
export const NORTH = { x: 0, z: -1 };

function pickPvHouses() {
  const ids = [];
  for (const h of HOUSES) {
    const i = Number(String(h.id).replace(/\D/g, "")) || 0;
    const rural = h.cluster === "west" || h.cluster === "south";
    if (h.cluster === "clinic" && i % 6 === 0) ids.push(h.id);
    else if (rural && ((h.pump && i % 3 === 0) || i % 16 === 0)) ids.push(h.id);
    else if (h.cluster === "market" && i % 24 === 0) ids.push(h.id);
    else if (h.cluster === "east" && i % 20 === 0) ids.push(h.id);
  }
  return [...new Set(ids)];
}

export const PV_ROOF_IDS = pickPvHouses();

/** 1000-home mock: 100 kW site array. Smaller mocks keep the same W/meter (10 kW at 100 homes). */
function farmSpec(homes) {
  const nameplateW = homes >= 700 ? 100000 : Math.max(4000, Math.round(100000 * (homes / 1000)));
  const moduleW = 400;
  const modules = Math.max(6, Math.round(nameplateW / moduleW));
  const cols = nameplateW >= 80000 ? 20 : nameplateW >= 20000 ? 10 : 5;
  const rows = Math.ceil(modules / cols);
  const kw = nameplateW / 1000;
  return {
    x: MAIN_GEN.x - 8,
    z: MAIN_GEN.z - 10,
    rows,
    cols,
    modules,
    pitchX: 1.55,
    pitchZ: 1.15,
    nameplateW,
    moduleW,
    label: Number.isInteger(kw) ? `${kw} kW PV` : `${kw.toFixed(1)} kW PV`,
  };
}

export const PV_FARM = farmSpec(TARGET_HOMES);

export const BESS = [
  { id: "bess-main", x: MAIN_GEN.x + 2.4, z: MAIN_GEN.z + 1.6, w: 2.1, h: 1.15, d: 1.2, label: "BESS" },
  { id: "bess-clinic", x: 13.4, z: -5.2, w: 1.15, h: 0.85, d: 0.7, label: "clinic BESS" },
  { id: "bess-ops", x: 18.2, z: -9.6, w: 0.9, h: 0.7, d: 0.55, label: "ops UPS" },
];

export const BESS_HOME_IDS = PV_ROOF_IDS.filter((id) => {
  const h = HOUSES.find((x) => x.id === id);
  if (!h) return false;
  const i = Number(String(id).replace(/\D/g, "")) || 0;
  return h.cluster === "west" || h.cluster === "south" || h.cluster === "clinic" || i % 3 === 0;
}).slice(0, TARGET_HOMES >= 200 ? 18 : 4);

const feederById = Object.fromEntries(FEEDERS.map((f) => [f.id, f]));
const eastTop = TRANSFORMERS.filter((t) => t.cluster === "east").sort((a, b) => b.n - a.n)[0];

export const OUTAGES = [
  {
    id: "o-west",
    min: 8 * 60,
    restore: 9 * 60 + 15,
    feederId: "f-west",
    xfmrId: null,
    kind: "line",
    note: "West feeder spur fault · fuse at takeoff",
    x: feederById["f-west"]?.x ?? -40,
    z: feederById["f-west"]?.z ?? 16,
    label: "west primary",
  },
  {
    id: "o-east",
    min: 11 * 60 + 30,
    restore: 12 * 60 + 45,
    feederId: null,
    xfmrId: eastTop?.id || null,
    kind: "xfmr",
    note: `East pole xfmr over-temp · ${eastTop?.n || 0} customers`,
    x: eastTop?.x ?? 40,
    z: eastTop?.z ?? 12,
    label: eastTop?.label || "east xfmr",
  },
  {
    id: "o-south",
    min: 14 * 60,
    restore: 15 * 60 + 15,
    feederId: "f-south",
    xfmrId: null,
    kind: "line",
    note: "South lateral open · tree on line",
    x: feederById["f-south"]?.x ?? 10,
    z: feederById["f-south"]?.z ?? 40,
    label: "south primary",
  },
  {
    id: "o-market",
    min: 17 * 60,
    restore: 18 * 60 + 30,
    feederId: "f-market",
    xfmrId: null,
    kind: "overload",
    note: "Market feeder overload · evening cooking",
    x: feederById["f-market"]?.x ?? -6,
    z: feederById["f-market"]?.z ?? 2,
    label: "market feeder",
  },
];

function boardsOnFeeder(feederId) {
  return BOARDS.filter((b) => b.feederId === feederId).sort((a, b) => (a.boardIdx ?? 0) - (b.boardIdx ?? 0));
}

/** Hypothetical unmetered span: DTM vs MeshEMS ΔP localizes to the primary between two boards. */
function leakSpan(feederId, i, j, spec) {
  const row = boardsOnFeeder(feederId);
  const a = row[i];
  const b = row[j];
  if (!a || !b) return null;
  return {
    ...spec,
    feederId,
    fromBoardId: a.id,
    toBoardId: b.id,
    fromIdx: a.boardIdx ?? i,
    toIdx: b.boardIdx ?? j,
    ax: a.x,
    az: a.z,
    bx: b.x,
    bz: b.z,
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    label: `${a.label} → ${b.label}`,
  };
}

export const LEAKS = [
  leakSpan("f-west", 3, 4, {
    id: "lk-west",
    min: 9 * 60 + 45,
    restore: 13 * 60 + 20,
    leakW: 420,
    kind: "tap",
    note: "Illegal tap · upstream MeshEMS − downstream MeshEMS − billed laterals = +420 W",
  }),
  leakSpan("f-south", 1, 2, {
    id: "lk-south",
    min: 5 * 60 + 30,
    restore: 8 * 60,
    leakW: 180,
    kind: "earth",
    note: "Earth leak (wet insulation) · ΔP pins south feeder between MeshEMS 2 and 3",
  }),
  leakSpan("f-market", 5, 6, {
    id: "lk-market",
    min: 18 * 60 + 45,
    restore: 21 * 60 + 30,
    leakW: 680,
    kind: "unmetered",
    note: "Unmetered evening load · market feeder MeshEMS 6→7 only (rest of feeder balances)",
  }),
].filter(Boolean);
