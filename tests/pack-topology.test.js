import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDERS, GRID_SEGS, HOUSES, MAIN_GEN, MAIN_XFMR, POLES, TRANSFORMERS } from "../village-simulator/js/village-worldline-layout.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP = 1.5;

const PACKS = [
  { id: "demo-lv", dir: join(ROOT, "villages/demo-lv") },
  { id: "safari-park-casino", dir: join(ROOT, "villages/safari-park-casino") },
  { id: "voundou-grid", dir: join(ROOT, "villages/voundou-grid") },
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function featId(f) {
  return String(f.id ?? f.properties?.id ?? "");
}

function pointXY(f) {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === "Point") return { x: g.coordinates[0], z: g.coordinates[1] };
  return null;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function nearest(pt, nodes) {
  let best = null;
  for (const n of nodes) {
    const d = dist(pt, n);
    if (!best || d < best.d) best = { ...n, d };
  }
  return best;
}

function loadPack(dir) {
  const net = join(dir, "network");
  const files = {
    structure: join(net, "structure.geojson"),
    junctions: join(net, "electric-junctions.geojson"),
    devices: join(net, "electric-devices.geojson"),
    lines: join(net, "electric-lines.geojson"),
    subnetworks: join(net, "subnetworks.geojson"),
    associations: join(net, "associations.json"),
  };
  const fc = (p) => (existsSync(p) ? loadJson(p).features || [] : []);
  const features = [
    ...fc(files.structure),
    ...fc(files.junctions),
    ...fc(files.devices),
    ...fc(files.subnetworks),
  ];
  const nodes = [];
  const byId = new Map();
  for (const f of features) {
    const id = featId(f);
    if (!id) continue;
    byId.set(id, f);
    const xy = pointXY(f);
    if (xy) {
      nodes.push({
        id,
        ...xy,
        assetClass: f.properties?.assetClass,
        assetGroup: f.properties?.assetGroup,
      });
    }
  }
  const lines = fc(files.lines);
  const assoc = existsSync(files.associations) ? loadJson(files.associations) : { connectivity: [] };
  return { byId, nodes, lines, assoc };
}

for (const pack of PACKS) {
  describe(`pack topology · ${pack.id}`, () => {
    const { byId, nodes, lines, assoc } = loadPack(pack.dir);

    it("connectivity fromId/toId exist", () => {
      const missing = [];
      for (const e of assoc.connectivity || []) {
        if (!byId.has(e.fromId)) missing.push(`${e.fromId}→${e.toId} missing fromId`);
        if (!byId.has(e.toId)) missing.push(`${e.fromId}→${e.toId} missing toId`);
      }
      assert.equal(missing.length, 0, missing.join("\n"));
    });

    it("via lines exist", () => {
      const lineIds = new Set(lines.map(featId));
      const missing = [];
      for (const e of assoc.connectivity || []) {
        if (e.via && !lineIds.has(e.via)) missing.push(`${e.fromId}→${e.toId} via ${e.via}`);
      }
      assert.equal(missing.length, 0, missing.join("\n"));
    });

    it("attachment poles exist", () => {
      const missing = [];
      for (const a of assoc.attachment || []) {
        if (!byId.has(a.structureId)) missing.push(`structure ${a.structureId}`);
        if (!byId.has(a.attachedId)) missing.push(`attached ${a.attachedId}`);
      }
      assert.equal(missing.length, 0, missing.join("\n"));
    });

    it("line endpoints snap to a pole/junction/device", () => {
      const misses = [];
      for (const line of lines) {
        const coords = line.geometry?.coordinates;
        if (!coords || coords.length < 2) {
          misses.push(`${featId(line)} not a LineString`);
          continue;
        }
        const ends = [
          { name: "start", x: coords[0][0], z: coords[0][1] },
          { name: "end", x: coords[coords.length - 1][0], z: coords[coords.length - 1][1] },
        ];
        for (const end of ends) {
          const hit = nearest(end, nodes);
          if (!hit || hit.d > SNAP) {
            misses.push(
              `${featId(line)} ${end.name} → no node within ${SNAP} (nearest ${hit ? `${hit.id} d=${hit.d.toFixed(2)}` : "none"})`,
            );
          }
        }
      }
      assert.equal(misses.length, 0, misses.join("\n"));
    });
  });
}

describe("Voundou schematic topology", () => {
  it("every GRID_SEGS end sits on a pole, xfmr, house, feeder, or plant", () => {
    const nodes = [
      ...POLES.map((p, i) => ({ id: `pole-${i}`, x: p.x, z: p.z })),
      ...TRANSFORMERS.map((t) => ({ id: t.id, x: t.x, z: t.z })),
      ...HOUSES.map((h) => ({ id: h.id, x: h.x, z: h.z })),
      ...FEEDERS.map((f) => ({ id: f.id, x: f.x, z: f.z })),
      { id: "main-gen", x: MAIN_GEN.x, z: MAIN_GEN.z },
      { id: "main-xfmr", x: MAIN_XFMR.x, z: MAIN_XFMR.z },
    ];
    const misses = [];
    GRID_SEGS.forEach((s, i) => {
      for (const end of [
        { name: "a", x: s.ax, z: s.az },
        { name: "b", x: s.bx, z: s.bz },
      ]) {
        const hit = nearest(end, nodes);
        if (!hit || hit.d > 0.2) {
          misses.push(`seg ${i} ${s.kind} ${end.name} nearest ${hit ? `${hit.id} d=${hit.d.toFixed(3)}` : "none"}`);
        }
      }
    });
    assert.equal(misses.length, 0, misses.join("\n"));
  });
});
