#!/usr/bin/env node
/**
 * Hypothetical OpenAMI stack village → UN pack (local ENU metres).
 * One compatible path only — not an any-to-any matrix.
 *
 * First km: Street EMS (NESL hardware) + MeshEMS (E-IOT firmware) on the same cabinets
 * Aggregation: MPM Manager (pick one — not SparkNet, not OpenEMS)
 * Backend: EnAccess MPM (alternative would be OpenEMS; not stacked here)
 * Later: GroundBolt-style prepaid / O&M via existing sim feed kinds
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "villages", "openami-stack");
const ORIGIN = { lon: 11.53412, lat: 4.79209 };
const SITE = "openami-stack";

/** Sketch: +x east, +y north. Hub = station. */
const XY = {
  gen: [-80, 52],
  inv: [-72, 48],
  bess: [-76, 56],
  station: [0, 0],
  bus_island: [0, -6],
  cab_mpm: [10, -4],
  pole_hub: [0, 0],

  pole_w1: [-56, 22],
  pole_w2: [-118, 34],
  pole_w3: [-176, 28],
  xfmr_w: [-118, 31],
  ems_w: [-116, 37],
  cab_w: [-116, 37],
  dtm_w: [-121, 30],
  bus_w: [-118, 38],
  brk_w: [-54, 20],

  pole_m1: [52, 28],
  pole_m2: [104, 48],
  pole_m3: [148, 62],
  xfmr_m: [104, 45],
  ems_m: [106, 51],
  cab_m: [106, 51],
  bus_m: [104, 52],
  fuse_m: [50, 26],

  tap_w1: [-118, 42],
  tap_w2: [-176, 36],
  tap_m1: [104, 56],
  tap_m2: [148, 70],
};

const HOUSES = [
  { id: "1", tap: "tap_w1", off: [-10, 12], use: "residential", feed: "f-west", line: "ln-w-sec-1", phase: "A" },
  { id: "2", tap: "tap_w1", off: [12, 10], use: "residential", feed: "f-west", line: "ln-w-sec-1", phase: "B" },
  { id: "3", tap: "tap_w1", off: [-14, -8], use: "agricultural", feed: "f-west", line: "ln-w-sec-1", phase: "C" },
  { id: "4", tap: "tap_w2", off: [-12, 10], use: "water", feed: "f-west", line: "ln-w-sec-2", phase: "A" },
  { id: "5", tap: "tap_w2", off: [10, 12], use: "residential", feed: "f-west", line: "ln-w-sec-2", phase: "B" },
  { id: "6", tap: "tap_w2", off: [-8, -11], use: "agricultural", feed: "f-west", line: "ln-w-sec-2", phase: "C" },
  { id: "7", tap: "tap_w2", off: [14, -6], use: "streetlight", feed: "f-west", line: "ln-w-sec-2", phase: "A" },
  { id: "8", tap: "tap_w1", off: [8, -14], use: "residential", feed: "f-west", line: "ln-w-sec-1", phase: "B" },
  { id: "9", tap: "tap_m1", off: [10, 10], use: "market", feed: "f-market", line: "ln-m-sec-1", phase: "A" },
  { id: "10", tap: "tap_m1", off: [-11, 8], use: "commercial", feed: "f-market", line: "ln-m-sec-1", phase: "B" },
  { id: "11", tap: "tap_m1", off: [8, -12], use: "school", feed: "f-market", line: "ln-m-sec-1", phase: "C" },
  { id: "12", tap: "tap_m2", off: [10, 8], use: "medical", feed: "f-market", line: "ln-m-sec-2", phase: "A" },
  { id: "13", tap: "tap_m2", off: [-10, 10], use: "worship", feed: "f-market", line: "ln-m-sec-2", phase: "B" },
  { id: "14", tap: "tap_m2", off: [6, -11], use: "residential", feed: "f-market", line: "ln-m-sec-2", phase: "C" },
];

function gid(id) {
  const h = createHash("sha1").update(`${SITE}:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
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

function add(a, d) {
  return [a[0] + d[0], a[1] + d[1]];
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

function lineFeat(id, assetClass, a, b, extra = {}) {
  const A = enu(a);
  const B = enu(b);
  const lengthM = +Math.hypot(a[0] - b[0], a[1] - b[1]).toFixed(1);
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
    geometry: { type: "LineString", coordinates: [[A.x, A.z], [B.x, B.z]] },
  };
}

function fc(name, features) {
  return { type: "FeatureCollection", name, features };
}

function bboxPoly(keys, pad = 24) {
  const pts = keys.map((k) => XY[k]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const ring = [
    enu([minX, minY]),
    enu([maxX, minY]),
    enu([maxX, maxY]),
    enu([minX, maxY]),
    enu([minX, minY]),
  ].map((p) => [p.x, p.z]);
  const c = enu([(minX + maxX) / 2, (minY + maxY) / 2]);
  return { ring, c };
}

function main() {
  for (const h of HOUSES) {
    XY[`sp_${h.id}`] = add(XY[h.tap], h.off);
    XY[`m_${h.id}`] = add(XY[`sp_${h.id}`], [0, 0.8]);
  }

  const structure = [
    pointFeat("pad-gen", "pad", "structure", XY.gen, { subnetworkId: "island-1", label: "PV pad" }),
    pointFeat("pole-hub", "pole", "structure", XY.pole_hub, { subnetworkId: "island-1", label: "Station pole" }),
    pointFeat("cab-mpm", "cabinet", "structure", XY.cab_mpm, {
      subnetworkId: "island-1",
      label: "MPM Manager (aggregation)",
      stackLayer: "aggregation",
      stackComponent: "MPM Manager",
    }),
    pointFeat("pole-w1", "pole", "structure", XY.pole_w1, { subnetworkId: "f-west", label: "West takeoff" }),
    pointFeat("pole-w2", "pole", "structure", XY.pole_w2, { subnetworkId: "f-west", label: "West EMS pole" }),
    pointFeat("pole-w3", "pole", "structure", XY.pole_w3, { subnetworkId: "f-west", label: "West farm pole" }),
    pointFeat("cab-w", "cabinet", "structure", XY.cab_w, {
      subnetworkId: "f-west",
      label: "Street EMS cabinet (NESL)",
      stackLayer: "firstKm",
      stackComponent: "Street EMS",
    }),
    pointFeat("pole-m1", "pole", "structure", XY.pole_m1, { subnetworkId: "f-market", label: "Market takeoff" }),
    pointFeat("pole-m2", "pole", "structure", XY.pole_m2, { subnetworkId: "f-market", label: "Market EMS pole" }),
    pointFeat("pole-m3", "pole", "structure", XY.pole_m3, { subnetworkId: "f-market", label: "Market civic pole" }),
    pointFeat("cab-m", "cabinet", "structure", XY.cab_m, {
      subnetworkId: "f-market",
      label: "Street EMS cabinet (NESL)",
      stackLayer: "firstKm",
      stackComponent: "Street EMS",
    }),
  ];

  const devices = [
    pointFeat("gen-1", "gen", "electric_device", XY.gen, {
      subnetworkId: "island-1",
      label: "PV + genset",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 250,
      terminals: [{ name: "OUT", side: "ac" }],
    }),
    pointFeat("inv-1", "inverter", "electric_device", XY.inv, {
      subnetworkId: "island-1",
      label: "Hybrid inverter",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 200,
    }),
    pointFeat("bess-1", "bess", "electric_device", XY.bess, {
      subnetworkId: "island-1",
      label: "BESS",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 200,
    }),
    pointFeat("station-1", "station", "electric_device", XY.station, {
      subnetworkId: "island-1",
      label: "Village station",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 400,
      terminals: [
        { name: "H1", side: "primary" },
        { name: "X1", side: "secondary" },
      ],
    }),
    pointFeat("brk-w", "breaker", "electric_device", XY.brk_w, {
      subnetworkId: "f-west",
      label: "West feeder breaker",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 200,
    }),
    pointFeat("xfmr-w", "xfmr", "electric_device", XY.xfmr_w, {
      subnetworkId: "f-west",
      label: "West pole xfmr",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 100,
      terminals: [
        { name: "H1", side: "primary" },
        { name: "X1", side: "secondary" },
      ],
    }),
    pointFeat("ems-w", "ems", "electric_device", XY.ems_w, {
      subnetworkId: "f-west",
      label: "Street EMS · MeshEMS firmware (west)",
      stackLayer: "firstKm",
      stackComponent: "MeshEMS",
      phase: "ABC",
      terminals: [
        { name: "N", side: "northbound" },
        { name: "S", side: "southbound" },
      ],
    }),
    pointFeat("dtm-w", "dtm", "electric_device", XY.dtm_w, {
      subnetworkId: "f-west",
      label: "DTM west",
      phase: "ABC",
    }),
    pointFeat("fuse-m", "fuse", "electric_device", XY.fuse_m, {
      subnetworkId: "f-market",
      label: "Market feeder fuse",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 63,
    }),
    pointFeat("xfmr-m", "xfmr", "electric_device", XY.xfmr_m, {
      subnetworkId: "f-market",
      label: "Market pole xfmr",
      phase: "ABC",
      nominalKv: 0.38,
      ratedA: 100,
      terminals: [
        { name: "H1", side: "primary" },
        { name: "X1", side: "secondary" },
      ],
    }),
    pointFeat("ems-m", "ems", "electric_device", XY.ems_m, {
      subnetworkId: "f-market",
      label: "Street EMS · MeshEMS firmware (market)",
      stackLayer: "firstKm",
      stackComponent: "MeshEMS",
      phase: "ABC",
      terminals: [
        { name: "N", side: "northbound" },
        { name: "S", side: "southbound" },
      ],
    }),
  ];

  for (const h of HOUSES) {
    devices.push(
      pointFeat(`m-${h.id}`, "meter", "electric_device", XY[`m_${h.id}`], {
        subnetworkId: h.feed,
        label: `Meter ${h.use} ${h.id}`,
        useClass: h.use,
        lineId: h.line,
        phase: h.phase,
        stackLayer: "laterBilling",
        stackComponent: "GroundBolt-style prepaid (sim)",
      }),
    );
  }

  const junctions = [
    pointFeat("bus-island", "bus", "electric_junction", XY.bus_island, {
      subnetworkId: "island-1",
      label: "Station LV bus",
    }),
    pointFeat("j-w-head", "splice", "electric_junction", XY.pole_w1, {
      subnetworkId: "f-west",
      label: "West feeder head",
    }),
    pointFeat("bus-w", "bus", "electric_junction", XY.bus_w, {
      subnetworkId: "f-west",
      label: "West xfmr bus",
    }),
    pointFeat("tap-w1", "tap", "electric_junction", XY.tap_w1, {
      subnetworkId: "f-west",
      label: "West EMS tap",
    }),
    pointFeat("tap-w2", "tap", "electric_junction", XY.tap_w2, {
      subnetworkId: "f-west",
      label: "West farm tap",
    }),
    pointFeat("j-m-head", "splice", "electric_junction", XY.pole_m1, {
      subnetworkId: "f-market",
      label: "Market feeder head",
    }),
    pointFeat("bus-m", "bus", "electric_junction", XY.bus_m, {
      subnetworkId: "f-market",
      label: "Market xfmr bus",
    }),
    pointFeat("tap-m1", "tap", "electric_junction", XY.tap_m1, {
      subnetworkId: "f-market",
      label: "Market EMS tap",
    }),
    pointFeat("tap-m2", "tap", "electric_junction", XY.tap_m2, {
      subnetworkId: "f-market",
      label: "Market civic tap",
    }),
  ];

  for (const h of HOUSES) {
    junctions.push(
      pointFeat(`sp-${h.id}`, "service_point", "electric_junction", XY[`sp_${h.id}`], {
        subnetworkId: h.feed,
        label: `SP ${h.use} ${h.id}`,
        useClass: h.use,
        lineId: h.line,
        nominalKv: 0.22,
      }),
    );
  }

  const lines = [
    lineFeat("ln-gen-inv", "trunk", XY.gen, XY.inv, {
      subnetworkId: "island-1",
      label: "gen→inverter",
      nominalKv: 0.38,
      phase: "ABC",
    }),
    lineFeat("ln-bess-inv", "trunk", XY.bess, XY.inv, {
      subnetworkId: "island-1",
      label: "bess→inverter",
      nominalKv: 0.38,
      phase: "ABC",
    }),
    lineFeat("ln-inv-station", "trunk", XY.inv, XY.station, {
      subnetworkId: "island-1",
      label: "inverter→station",
      nominalKv: 0.38,
      phase: "ABC",
    }),
    lineFeat("ln-w-pri", "primary", XY.station, XY.pole_w1, {
      subnetworkId: "f-west",
      label: "West primary 380 V",
      nominalKv: 0.38,
      phase: "ABCN",
      runId: "west",
    }),
    lineFeat("ln-w-sec-1", "secondary", XY.pole_w1, XY.pole_w2, {
      subnetworkId: "f-west",
      label: "West secondary 220 V",
      nominalKv: 0.22,
      phase: "ABCN",
      runId: "west",
    }),
    lineFeat("ln-w-sec-2", "secondary", XY.pole_w2, XY.pole_w3, {
      subnetworkId: "f-west",
      label: "West farm 220 V",
      nominalKv: 0.22,
      phase: "ABCN",
      runId: "west",
    }),
    lineFeat("ln-m-pri", "primary", XY.station, XY.pole_m1, {
      subnetworkId: "f-market",
      label: "Market primary 380 V",
      nominalKv: 0.38,
      phase: "ABCN",
      runId: "market",
    }),
    lineFeat("ln-m-sec-1", "secondary", XY.pole_m1, XY.pole_m2, {
      subnetworkId: "f-market",
      label: "Market secondary 220 V",
      nominalKv: 0.22,
      phase: "ABCN",
      runId: "market",
    }),
    lineFeat("ln-m-sec-2", "secondary", XY.pole_m2, XY.pole_m3, {
      subnetworkId: "f-market",
      label: "Market civic 220 V",
      nominalKv: 0.22,
      phase: "ABCN",
      runId: "market",
    }),
  ];

  for (const h of HOUSES) {
    lines.push(
      lineFeat(`ln-svc-${h.id}`, "service", XY[h.tap], XY[`sp_${h.id}`], {
        subnetworkId: h.feed,
        label: `Service ${h.id}`,
        nominalKv: 0.22,
        phase: h.phase,
        runId: h.feed.replace(/^f-/, ""),
      }),
    );
  }

  const islandBox = bboxPoly(["gen", "inv", "bess", "station", "cab_mpm"], 20);
  const westBox = bboxPoly(["pole_w1", "pole_w2", "pole_w3", "tap_w2"], 28);
  const marketBox = bboxPoly(["pole_m1", "pole_m2", "pole_m3", "tap_m2"], 24);

  const subnetworks = [
    {
      type: "Feature",
      id: "island-1",
      properties: {
        id: "island-1",
        assetClass: "island",
        assetGroup: "subnetwork",
        label: "Island · gen + station + MPM Manager",
        tier: "island",
        x: islandBox.c.x,
        z: islandBox.c.z,
        subnetworkId: "island-1",
        globalId: gid("island-1"),
      },
      geometry: { type: "Polygon", coordinates: [islandBox.ring] },
    },
    {
      type: "Feature",
      id: "f-west",
      properties: {
        id: "f-west",
        assetClass: "feeder",
        assetGroup: "subnetwork",
        label: "Feeder west farms",
        tier: "feeder",
        controllerId: "brk-w",
        x: westBox.c.x,
        z: westBox.c.z,
        subnetworkId: "f-west",
        globalId: gid("f-west"),
      },
      geometry: { type: "Polygon", coordinates: [westBox.ring] },
    },
    {
      type: "Feature",
      id: "f-market",
      properties: {
        id: "f-market",
        assetClass: "feeder",
        assetGroup: "subnetwork",
        label: "Feeder market / civic",
        tier: "feeder",
        controllerId: "fuse-m",
        x: marketBox.c.x,
        z: marketBox.c.z,
        subnetworkId: "f-market",
        globalId: gid("f-market"),
      },
      geometry: { type: "Polygon", coordinates: [marketBox.ring] },
    },
  ];

  const connectivity = [
    { fromId: "gen-1", toId: "inv-1", subnetworkId: "island-1", fromTerminal: "OUT", via: "ln-gen-inv" },
    { fromId: "bess-1", toId: "inv-1", subnetworkId: "island-1", via: "ln-bess-inv" },
    { fromId: "inv-1", toId: "station-1", subnetworkId: "island-1", toTerminal: "H1", via: "ln-inv-station" },
    { fromId: "station-1", toId: "bus-island", subnetworkId: "island-1", fromTerminal: "X1" },
    { fromId: "bus-island", toId: "brk-w", subnetworkId: "f-west", via: "ln-w-pri" },
    { fromId: "brk-w", toId: "j-w-head", subnetworkId: "f-west" },
    { fromId: "j-w-head", toId: "xfmr-w", subnetworkId: "f-west", toTerminal: "H1", via: "ln-w-sec-1" },
    { fromId: "xfmr-w", toId: "bus-w", subnetworkId: "f-west", fromTerminal: "X1" },
    { fromId: "bus-w", toId: "ems-w", subnetworkId: "f-west", toTerminal: "S" },
    { fromId: "ems-w", toId: "tap-w1", subnetworkId: "f-west", fromTerminal: "S" },
    { fromId: "tap-w1", toId: "tap-w2", subnetworkId: "f-west", via: "ln-w-sec-2" },
    { fromId: "bus-island", toId: "fuse-m", subnetworkId: "f-market", via: "ln-m-pri" },
    { fromId: "fuse-m", toId: "j-m-head", subnetworkId: "f-market" },
    { fromId: "j-m-head", toId: "xfmr-m", subnetworkId: "f-market", toTerminal: "H1", via: "ln-m-sec-1" },
    { fromId: "xfmr-m", toId: "bus-m", subnetworkId: "f-market", fromTerminal: "X1" },
    { fromId: "bus-m", toId: "ems-m", subnetworkId: "f-market" },
    { fromId: "ems-m", toId: "tap-m1", subnetworkId: "f-market" },
    { fromId: "tap-m1", toId: "tap-m2", subnetworkId: "f-market", via: "ln-m-sec-2" },
  ];

  for (const h of HOUSES) {
    connectivity.push(
      { fromId: h.tap.replace("_", "-"), toId: `m-${h.id}`, subnetworkId: h.feed, via: `ln-svc-${h.id}` },
      { fromId: `m-${h.id}`, toId: `sp-${h.id}`, subnetworkId: h.feed },
    );
  }

  const associations = {
    schemaVersion: "0.1.0",
    connectivity,
    containment: [
      { containerId: "cab-w", contentId: "ems-w" },
      { containerId: "cab-m", contentId: "ems-m" },
    ],
    attachment: [
      { structureId: "pad-gen", attachedId: "gen-1" },
      { structureId: "pole-hub", attachedId: "station-1" },
      { structureId: "pole-w2", attachedId: "xfmr-w" },
      { structureId: "pole-w2", attachedId: "ems-w" },
      { structureId: "pole-w2", attachedId: "dtm-w" },
      { structureId: "pole-m2", attachedId: "xfmr-m" },
      { structureId: "pole-m2", attachedId: "ems-m" },
      { structureId: "pole-w1", attachedId: "brk-w" },
      { structureId: "pole-m1", attachedId: "fuse-m" },
    ],
  };

  const meterFeeds = HOUSES.map((h) => ({
    assetId: `m-${h.id}`,
    lod: 3,
    feeds: [
      {
        kind: h.id === "12" ? "groundbolt" : "sim",
        ...(h.id === "12"
          ? { siteRef: SITE, meterRef: `m-${h.id}` }
          : { scenarioId: "openami-stack-prepaid", metrics: ["kWh", "credit", "relay"] }),
      },
    ],
  }));

  const feeds = {
    schemaVersion: "0.1.0",
    bindings: [
      {
        assetId: "ems-w",
        lod: 2,
        feeds: [
          {
            kind: "mqtt_sunspec",
            brokerRef: "env:MQTT_URL",
            topic: "openami/openami-stack/f-west/ems",
            model: "SunSpec",
          },
        ],
      },
      {
        assetId: "ems-m",
        lod: 2,
        feeds: [
          {
            kind: "mqtt_sunspec",
            brokerRef: "env:MQTT_URL",
            topic: "openami/openami-stack/f-market/ems",
            model: "SunSpec",
          },
        ],
      },
      {
        assetId: "cab-mpm",
        lod: 2,
        feeds: [
          {
            kind: "rest_json",
            urlTemplate: "env:MPM_URL/api/sites/{id}",
            pollSec: 60,
            authRef: "env:MPM_TOKEN",
          },
        ],
      },
      {
        assetId: "inv-1",
        lod: 2,
        feeds: [{ kind: "mqtt_sunspec", brokerRef: "env:MQTT_URL", topic: "openami/openami-stack/island/inv", model: "701" }],
      },
      {
        assetId: "bess-1",
        lod: 2,
        feeds: [{ kind: "mqtt_sunspec", brokerRef: "env:MQTT_URL", topic: "openami/openami-stack/island/bess", model: "802" }],
      },
      ...meterFeeds,
    ],
  };

  const allX = [];
  const allZ = [];
  for (const f of [...structure, ...devices, ...junctions]) {
    allX.push(f.properties.x);
    allZ.push(f.properties.z);
  }

  const village = {
    id: SITE,
    name: "OpenAMI stack (hypothetical)",
    schemaVersion: "0.1.0",
    crs: "EPSG:4326",
    status: "hypothetical",
    origin: {
      lon: ORIGIN.lon,
      lat: ORIGIN.lat,
      alt: 0,
      note: "Schematic ENU metres in properties x,z (+X east, −Z north). Same Voundou pin as other sample packs. Plant is invented — not existing assets.",
    },
    bbox: [
      +Math.min(...allX).toFixed(2),
      +Math.min(...allZ).toFixed(2),
      +Math.max(...allX).toFixed(2),
      +Math.max(...allZ).toFixed(2),
    ],
    openami: {
      spatialSchema: "OpenAMI-aligned GeoJSON (ISV)",
      seedLive: true,
      notes: "One compatible OpenAMI path. Street EMS + MeshEMS first km → MPM Manager aggregation → EnAccess MPM backend. GroundBolt-style prepaid is a later sim hook, not a second backend. OpenEMS / SparkNet / DLMS / STS are not in this pack.",
      stack: {
        firstKm: ["Street EMS (NESL hardware)", "MeshEMS (E-IOT firmware)"],
        aggregation: "MPM Manager",
        backend: "EnAccess MPM",
        later: ["GroundBolt-style prepaid (sim feed kind)", "O&M via MeshEMS ΔP / disconnect"],
        notInThisPack: ["SparkNet Hub", "OpenEMS", "DLMS/COSEM", "STS"],
      },
    },
    source: { kind: "hypothetical-openami-stack" },
  };

  mkdirSync(join(OUT, "network"), { recursive: true });
  mkdirSync(join(OUT, "feeds"), { recursive: true });
  const write = (rel, obj) => writeFileSync(join(OUT, rel), `${JSON.stringify(obj, null, 2)}\n`);
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
        houses: HOUSES.length,
        poles: structure.filter((f) => f.properties.assetClass === "pole").length,
        meters: devices.filter((f) => f.properties.assetClass === "meter").length,
        lines: lines.length,
      },
      null,
      2,
    ),
  );
}

main();
