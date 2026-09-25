#!/usr/bin/env node
/**
 * Trace Voundou operator schematic → UN pack (local ENU metres).
 * Source: annotated satellite overlay (red 4×70 mm² 2708 m · black 4×25 mm² 3796 m).
 * Not a GPS survey. No house service laterals.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "villages", "voundou-grid");
const ORIGIN = { lon: 11.53412, lat: 4.79209 };
const RED_M = 2708;
const BLACK_M = 3796;
const POLE_STEP = 60;

/** Sketch: +x east, +y north. Hub = village center (white circle). */
const SKETCH = {
  hub: [0, 0],
  j_n_mid: [-48, 78],
  j_n_solar: [-82, 148],
  solar: [-148, 142],
  n_end: [-88, 312],
  n_west: [-248, 318],
  j_s: [-32, -82],
  s_end: [-38, -198],
  j_e: [152, 8],
  e_tee: [228, 18],
  e_end: [348, 32],
  e_south: [168, -78],
  e_n1: [232, 118],
  e_n2: [218, 228],
  j_w: [-158, -6],
  w_bend: [-210, 22],
  w_nw: [-278, 48],
  w_sw: [-238, -58],
  tap_n: [14, 12],
  b_n: [22, 138],
  tap_n2: [8, 52],
  b_n2: [18, 168],
  tap_s: [16, -18],
  b_s: [28, -108],
  b_s_stub: [58, -112],
  tap_se: [48, -8],
  b_se: [78, -62],
  tap_sw: [-28, -28],
  b_sw: [-62, -72],
  tap_w_n: [-72, 8],
  b_w_n: [-88, 68],
};

const RED = [
  ["ln-solar", ["solar", "j_n_solar"]],
  ["ln-north-plant", ["j_n_solar", "n_end"]],
  ["ln-plant-mid", ["j_n_solar", "j_n_mid"]],
  ["ln-mid-hub", ["j_n_mid", "hub"]],
  ["ln-hub-south", ["hub", "j_s"]],
  ["ln-south", ["j_s", "s_end"]],
  ["ln-hub-east", ["hub", "j_e"]],
  ["ln-hub-west", ["hub", "j_w"]],
];

const BLACK = [
  ["ln-n-west", ["n_end", "n_west"]],
  ["ln-e-main", ["j_e", "e_tee", "e_end"]],
  ["ln-e-south", ["j_e", "e_south"]],
  ["ln-e-north", ["e_tee", "e_n1", "e_n2"]],
  ["ln-w-nw", ["j_w", "w_bend", "w_nw"]],
  ["ln-w-sw", ["j_w", "w_sw"]],
  ["ln-lat-n", ["tap_n", "b_n"]],
  ["ln-lat-n2", ["tap_n2", "b_n2"]],
  ["ln-lat-s", ["tap_s", "b_s", "b_s_stub"]],
  ["ln-lat-se", ["tap_se", "b_se"]],
  ["ln-lat-sw", ["tap_sw", "b_sw"]],
  ["ln-lat-wn", ["tap_w_n", "b_w_n"]],
];

/** Taps sit on a red span; listed so we can snap them onto that chord after scale. */
const TAP_ON_RED = {
  tap_n: ["hub", "j_n_mid", 0.18],
  tap_n2: ["j_n_mid", "j_n_solar", 0.22],
  tap_s: ["hub", "j_s", 0.22],
  tap_se: ["hub", "j_e", 0.28],
  tap_sw: ["hub", "j_s", 0.38],
  tap_w_n: ["hub", "j_w", 0.42],
};

function gid(id) {
  const h = createHash("sha1").update(`voundou-grid:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function dist2(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function polyLen(ids, pts) {
  let n = 0;
  for (let i = 1; i < ids.length; i++) n += dist2(pts[ids[i - 1]], pts[ids[i]]);
  return n;
}

function sumEdges(edges, pts) {
  return edges.reduce((s, [, ids]) => s + polyLen(ids, pts), 0);
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function enu(xy) {
  const x = +xy[0].toFixed(2);
  const z = +(-xy[1]).toFixed(2);
  const mLat = 111320;
  const mLon = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
  return {
    x,
    z,
    lon: +(ORIGIN.lon + x / mLon).toFixed(7),
    lat: +(ORIGIN.lat - z / mLat).toFixed(7),
  };
}

function pointFeat(id, assetClass, assetGroup, xy, extra = {}) {
  const { x, z, lon, lat } = enu(xy);
  return {
    type: "Feature",
    id,
    properties: {
      id,
      assetClass,
      assetGroup,
      x,
      z,
      lon,
      lat,
      globalId: gid(id),
      ...extra,
    },
    geometry: { type: "Point", coordinates: [x, z] },
  };
}

function lineFeat(id, assetClass, ids, pts, extra = {}) {
  const coords = ids.map((k) => {
    const { x, z } = enu(pts[k]);
    return [x, z];
  });
  const lengthM = +polyLen(ids, pts).toFixed(1);
  return {
    type: "Feature",
    id,
    properties: {
      id,
      assetClass,
      assetGroup: "electric_line",
      lengthM,
      globalId: gid(id),
      ...extra,
    },
    geometry: { type: "LineString", coordinates: coords },
  };
}

function fc(name, features) {
  return { type: "FeatureCollection", name, features };
}

function densify(a, b, step) {
  const d = dist2(a, b);
  const n = Math.max(0, Math.floor(d / step) - 1);
  const out = [];
  for (let i = 1; i <= n; i++) out.push(lerp(a, b, i / (n + 1)));
  return out;
}

function scalePts(pts, s) {
  const out = {};
  for (const [k, v] of Object.entries(pts)) out[k] = [v[0] * s, v[1] * s];
  return out;
}

function snapTaps(pts) {
  const out = { ...pts };
  for (const [tap, [a, b, t]] of Object.entries(TAP_ON_RED)) {
    out[tap] = lerp(out[a], out[b], t);
  }
  return out;
}

function stretchBlack(pts, target) {
  const cur = sumEdges(BLACK, pts);
  if (cur < 1) return pts;
  const k = target / cur;
  const out = { ...pts };
  const redIds = new Set(RED.flatMap(([, ids]) => ids));
  for (const [, ids] of BLACK) {
    const tap = ids[0];
    const origin = out[tap];
    for (let i = 1; i < ids.length; i++) {
      const id = ids[i];
      if (redIds.has(id) && id !== tap) continue;
      const [x, y] = pts[id];
      out[id] = [origin[0] + (x - pts[tap][0]) * k, origin[1] + (y - pts[tap][1]) * k];
    }
  }
  return snapTaps(out);
}

function bboxPoly(keys, pts, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of keys) {
    const [x, y] = pts[k];
    minX = Math.min(minX, x - pad);
    maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad);
    maxY = Math.max(maxY, y + pad);
  }
  const ring = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
    [minX, minY],
  ].map(([x, y]) => {
    const p = enu([x, y]);
    return [p.x, p.z];
  });
  const c = enu([(minX + maxX) / 2, (minY + maxY) / 2]);
  return { ring, c };
}

function main() {
  let pts = snapTaps({ ...SKETCH });
  const red0 = sumEdges(RED, pts);
  pts = scalePts(pts, RED_M / red0);
  pts = snapTaps(pts);
  pts = stretchBlack(pts, BLACK_M);
  pts = snapTaps(pts);

  const redM = sumEdges(RED, pts);
  const blackM = sumEdges(BLACK, pts);
  const allXY = Object.values(pts);
  const xs = allXY.map((p) => p[0]);
  const ys = allXY.map((p) => p[1]);

  const structure = [];
  const junctions = [];
  const devices = [];
  const lines = [];
  const attachment = [];
  const connectivity = [];
  const containment = [];

  const nodeMeta = {
    hub: { j: "bus", label: "Village hub", sn: "f-voundou" },
    j_n_mid: { j: "tap", label: "North mid T", sn: "f-voundou" },
    j_n_solar: { j: "tap", label: "Plant T · 380 V", sn: "island-1" },
    solar: { j: "bus", label: "Solar plant bus", sn: "island-1" },
    n_end: { j: "tap", label: "North terminus", sn: "f-voundou" },
    n_west: { j: "splice", label: "NW 220 V end", sn: "f-voundou" },
    j_s: { j: "tap", label: "South Y", sn: "f-voundou" },
    s_end: { j: "splice", label: "South terminus", sn: "f-voundou" },
    j_e: { j: "tap", label: "East 380→220 T", sn: "f-voundou" },
    e_tee: { j: "tap", label: "East black T", sn: "f-voundou" },
    e_end: { j: "splice", label: "East terminus", sn: "f-voundou" },
    e_south: { j: "splice", label: "SE 220 V end", sn: "f-voundou" },
    e_n1: { j: "splice", label: "NE 220 V mid", sn: "f-voundou" },
    e_n2: { j: "splice", label: "NE 220 V end", sn: "f-voundou" },
    j_w: { j: "tap", label: "West 380→220 T", sn: "f-voundou" },
    w_bend: { j: "splice", label: "West bend", sn: "f-voundou" },
    w_nw: { j: "splice", label: "WNW 220 V end", sn: "f-voundou" },
    w_sw: { j: "splice", label: "SW terminus", sn: "f-voundou" },
    tap_n: { j: "tap", label: "Hub N lateral tap", sn: "f-voundou" },
    b_n: { j: "splice", label: "N 220 V end", sn: "f-voundou" },
    tap_n2: { j: "tap", label: "N2 lateral tap", sn: "f-voundou" },
    b_n2: { j: "splice", label: "N2 220 V end", sn: "f-voundou" },
    tap_s: { j: "tap", label: "Hub S lateral tap", sn: "f-voundou" },
    b_s: { j: "splice", label: "S 220 V elbow", sn: "f-voundou" },
    b_s_stub: { j: "splice", label: "S 220 V stub", sn: "f-voundou" },
    tap_se: { j: "tap", label: "SE lateral tap", sn: "f-voundou" },
    b_se: { j: "splice", label: "SE 220 V end", sn: "f-voundou" },
    tap_sw: { j: "tap", label: "SW lateral tap", sn: "f-voundou" },
    b_sw: { j: "splice", label: "SSW 220 V end", sn: "f-voundou" },
    tap_w_n: { j: "tap", label: "WN lateral tap", sn: "f-voundou" },
    b_w_n: { j: "splice", label: "WN 220 V end", sn: "f-voundou" },
  };

  for (const [id, meta] of Object.entries(nodeMeta)) {
    const poleId = `pole-${id}`;
    structure.push(
      pointFeat(poleId, "pole", "structure", pts[id], {
        subnetworkId: meta.sn,
        label: meta.label,
      }),
    );
    junctions.push(
      pointFeat(id, meta.j, "electric_junction", pts[id], {
        subnetworkId: meta.sn,
        label: meta.label,
        phase: meta.sn === "island-1" || id === "hub" || id.startsWith("j_") ? "ABCN" : "ABCN",
      }),
    );
    attachment.push({ structureId: poleId, attachedId: id });
  }

  const plant = [
    ["gen-1", "gen", "PV array", { terminals: [{ name: "OUT", side: "ac" }], phase: "ABC", nominalKv: 0.38, ratedA: 400 }],
    ["inv-1", "inverter", "Plant inverter", { terminals: [{ name: "AC", side: "ac" }], phase: "ABC", nominalKv: 0.38, ratedA: 400 }],
    ["station-1", "station", "Solar station", { terminals: [{ name: "H1", side: "ac" }, { name: "X1", side: "feeder" }], phase: "ABC", nominalKv: 0.38, ratedA: 400 }],
    ["brk-1", "breaker", "Plant breaker", { phase: "ABC", nominalKv: 0.38, ratedA: 400 }],
    ["ems-1", "ems", "Plant EMS", { terminals: [{ name: "N", side: "northbound" }, { name: "S", side: "southbound" }], phase: "ABC" }],
  ];
  const solarXY = pts.solar;
  const offsets = [
    [0, 0],
    [8, -4],
    [16, 2],
    [22, -6],
    [10, 10],
  ];
  plant.forEach(([id, ac, label, extra], i) => {
    const xy = [solarXY[0] + offsets[i][0], solarXY[1] + offsets[i][1]];
    devices.push(
      pointFeat(id, ac, "electric_device", xy, { subnetworkId: "island-1", label, ...extra }),
    );
  });
  structure.push(
    pointFeat("pad-plant", "pad", "structure", solarXY, {
      subnetworkId: "island-1",
      label: "Solar plant pad",
    }),
    pointFeat("cab-ems", "cabinet", "structure", [solarXY[0] + 10, solarXY[1] + 10], {
      subnetworkId: "island-1",
      label: "EMS cabinet",
    }),
  );
  attachment.push(
    { structureId: "pad-plant", attachedId: "gen-1" },
    { structureId: "pad-plant", attachedId: "station-1" },
    { structureId: "cab-ems", attachedId: "ems-1" },
  );
  containment.push({ containerId: "cab-ems", contentId: "ems-1" });

  const redProps = {
    subnetworkId: "f-voundou",
    conductor: "4x70mm2",
    nominalKv: 0.38,
    phase: "ABCN",
    schematicColor: "red",
    voltageNote: "380 V 3φ (L-L); 220 V L-N of same system",
  };
  const blackProps = {
    subnetworkId: "f-voundou",
    conductor: "4x25mm2",
    nominalKv: 0.22,
    phase: "ABCN",
    schematicColor: "black",
    voltageNote: "220 V laterals (4×25 mm²). No house services in this pack.",
  };

  const RED_SN = {
    "ln-solar": "island-1",
    "ln-plant-mid": "island-1",
    "ln-north-plant": "f-voundou",
  };
  for (const [id, ids] of RED) {
    const sn = RED_SN[id] || "f-voundou";
    const feat = lineFeat(id, "primary", ids, pts, {
      ...redProps,
      subnetworkId: sn,
      label: `${id} · 380 V 4×70 mm²`,
    });
    lines.push(feat);
    for (let i = 1; i < ids.length; i++) {
      connectivity.push({
        fromId: ids[i - 1],
        toId: ids[i],
        subnetworkId: sn,
        via: id,
      });
    }
  }
  for (const [id, ids] of BLACK) {
    lines.push(lineFeat(id, "secondary", ids, pts, { ...blackProps, label: `${id} · 220 V 4×25 mm²` }));
    for (let i = 1; i < ids.length; i++) {
      connectivity.push({ fromId: ids[i - 1], toId: ids[i], subnetworkId: "f-voundou", via: id });
    }
  }

  const padNodes = {
    gen_pad: [solarXY[0], solarXY[1]],
    inv_pad: [solarXY[0] + 8, solarXY[1] - 4],
    st_pad: [solarXY[0] + 16, solarXY[1] + 2],
    br_pad: [solarXY[0] + 22, solarXY[1] - 6],
  };
  lines.push(
    lineFeat("ln-gen-station", "trunk", ["gen_pad", "inv_pad", "st_pad", "br_pad", "gen_pad"], padNodes, {
      subnetworkId: "island-1",
      label: "gen→station (on pad)",
      nominalKv: 0.38,
      conductor: "plant",
    }),
  );

  connectivity.push(
    { fromId: "gen-1", toId: "inv-1", subnetworkId: "island-1", fromTerminal: "OUT", via: "ln-gen-station" },
    { fromId: "inv-1", toId: "station-1", subnetworkId: "island-1", toTerminal: "H1", via: "ln-gen-station" },
    { fromId: "station-1", toId: "brk-1", subnetworkId: "island-1", fromTerminal: "X1", via: "ln-gen-station" },
    { fromId: "brk-1", toId: "solar", subnetworkId: "island-1", via: "ln-gen-station" },
    { fromId: "ems-1", toId: "station-1", subnetworkId: "island-1" },
  );

  let poleN = 0;
  for (const [, ids] of [...RED, ...BLACK]) {
    for (let i = 1; i < ids.length; i++) {
      const extras = densify(pts[ids[i - 1]], pts[ids[i]], POLE_STEP);
      for (const xy of extras) {
        poleN += 1;
        const id = `pole-span-${poleN}`;
        structure.push(
          pointFeat(id, "pole", "structure", xy, {
            subnetworkId: "f-voundou",
            label: "Span pole",
          }),
        );
      }
    }
  }

  const plantBox = bboxPoly(["solar", "j_n_solar"], pts, 40);
  const feedBox = bboxPoly(Object.keys(pts), pts, 30);
  const subnetworks = [
    {
      type: "Feature",
      id: "island-1",
      properties: {
        id: "island-1",
        assetClass: "island",
        assetGroup: "subnetwork",
        label: "Island · solar plant",
        tier: "island",
        x: plantBox.c.x,
        z: plantBox.c.z,
        subnetworkId: "island-1",
        globalId: gid("island-1"),
      },
      geometry: { type: "Polygon", coordinates: [plantBox.ring] },
    },
    {
      type: "Feature",
      id: "f-voundou",
      properties: {
        id: "f-voundou",
        assetClass: "feeder",
        assetGroup: "subnetwork",
        label: "Feeder Voundou LV",
        tier: "feeder",
        controllerId: "brk-1",
        x: feedBox.c.x,
        z: feedBox.c.z,
        subnetworkId: "f-voundou",
        globalId: gid("f-voundou"),
      },
      geometry: { type: "Polygon", coordinates: [feedBox.ring] },
    },
  ];

  const zs = allXY.map((p) => -p[1]);
  const village = {
    id: "voundou-grid",
    name: "Voundou grid (traced schematic)",
    schemaVersion: "0.1.0",
    crs: "EPSG:4326",
    status: "hypothetical",
    origin: {
      lon: ORIGIN.lon,
      lat: ORIGIN.lat,
      alt: 0,
      note: "Same Voundou pin as worldline. Local ENU metres in properties x,z (+X east, −Z north). Geometry stores same local metres. Positions traced from operator overlay, then scaled to published conductor lengths — not surveyed GPS.",
    },
    bbox: [
      +Math.min(...xs).toFixed(2),
      +Math.min(...zs).toFixed(2),
      +Math.max(...xs).toFixed(2),
      +Math.max(...zs).toFixed(2),
    ],
    openami: {
      spatialSchema: "OpenAMI-aligned GeoJSON (ISV)",
      notes: `Traced radial LV. Red primary 380 V 4×70 mm² ${redM.toFixed(0)} m (key 2708). Black secondary 220 V 4×25 mm² ${blackM.toFixed(0)} m (key 3796). No house services. 380 L-L / 220 L-N same 4-wire system — taps, not xfmrs, at colour change.`,
    },
    source: {
      kind: "operator-schematic-overlay",
      lengths: { red_m: +redM.toFixed(1), black_m: +blackM.toFixed(1), key_red_m: RED_M, key_black_m: BLACK_M },
    },
  };

  const associations = {
    schemaVersion: "0.1.0",
    connectivity,
    containment,
    attachment,
  };

  const feeds = {
    schemaVersion: "0.1.0",
    bindings: [
      {
        assetId: "ems-1",
        lod: 2,
        feeds: [{ kind: "sim", scenarioId: "voundou-grid", metrics: ["kW", "A"] }],
      },
      {
        assetId: "gen-1",
        lod: 2,
        feeds: [{ kind: "sim", scenarioId: "voundou-grid", metrics: ["kW"] }],
      },
      {
        assetId: "station-1",
        lod: 2,
        feeds: [{ kind: "sim", scenarioId: "voundou-grid", metrics: ["kW", "A"] }],
      },
    ],
  };

  mkdirSync(join(OUT, "network"), { recursive: true });
  mkdirSync(join(OUT, "feeds"), { recursive: true });
  const write = (rel, obj) =>
    writeFileSync(join(OUT, rel), JSON.stringify(obj, null, 2) + "\n");
  write("village.json", village);
  write("network/structure.geojson", fc("structure", structure));
  write("network/electric-junctions.geojson", fc("electric-junctions", junctions));
  write("network/electric-devices.geojson", fc("electric-devices", devices));
  write("network/electric-lines.geojson", fc("electric-lines", lines));
  write("network/subnetworks.geojson", fc("subnetworks", subnetworks));
  write("network/associations.json", associations);
  write("feeds/registry.json", feeds);

  console.log(
    JSON.stringify(
      {
        out: OUT,
        red_m: +redM.toFixed(1),
        black_m: +blackM.toFixed(1),
        poles: structure.filter((f) => f.properties.assetClass === "pole").length,
        junctions: junctions.length,
        lines: lines.length,
        spanE: +(Math.max(...xs) - Math.min(...xs)).toFixed(0),
        spanN: +(Math.max(...ys) - Math.min(...ys)).toFixed(0),
      },
      null,
      2,
    ),
  );
}

main();
