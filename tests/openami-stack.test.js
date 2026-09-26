import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packToBuildSnapshot } from "../village-simulator/js/village-project.js";
import { buildSeededLive } from "../village-simulator/js/village-seed-day.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "villages/openami-stack");

function loadJson(rel) {
  return JSON.parse(readFileSync(join(DIR, rel), "utf8"));
}

function loadPack() {
  return {
    village: loadJson("village.json"),
    structure: loadJson("network/structure.geojson"),
    devices: loadJson("network/electric-devices.geojson"),
    junctions: loadJson("network/electric-junctions.geojson"),
    lines: loadJson("network/electric-lines.geojson"),
    subnetworks: loadJson("network/subnetworks.geojson"),
    feeds: loadJson("feeds/registry.json"),
  };
}

describe("openami-stack pack", () => {
  const pack = loadPack();

  it("picks one aggregation + one backend, no stacked siblings", () => {
    const stack = pack.village.openami.stack;
    assert.equal(stack.aggregation, "MPM Manager");
    assert.equal(stack.backend, "EnAccess MPM");
    assert.ok(stack.notInThisPack.includes("SparkNet Hub"));
    assert.ok(stack.notInThisPack.includes("OpenEMS"));
    assert.ok(stack.notInThisPack.includes("DLMS/COSEM"));
    assert.equal(pack.village.openami.seedLive, true);
  });

  it("feeds stay on the picked path", () => {
    const kinds = new Set();
    for (const b of pack.feeds.bindings) {
      for (const f of b.feeds || []) kinds.add(f.kind);
    }
    assert.ok(kinds.has("mqtt_sunspec"));
    assert.ok(kinds.has("rest_json"));
    assert.ok(kinds.has("sim"));
    assert.ok(kinds.has("groundbolt"));
    assert.ok(!kinds.has("dlms"));
    assert.ok(!kinds.has("openpaygo"));
    const topics = pack.feeds.bindings.flatMap((b) => (b.feeds || []).map((f) => f.topic || ""));
    assert.ok(!topics.some((t) => /sparknet/i.test(t)));
  });

  it("BUILD snapshot seeds Operations houses", () => {
    const snap = packToBuildSnapshot(pack, { groundScale: 8 });
    const customers = snap.placed.filter((p) => p.assetClass === "customer");
    assert.equal(customers.length, 14);
    assert.ok(snap.placed.some((p) => p.id === "ems-w"));
    assert.ok(snap.placed.some((p) => p.id === "cab-mpm"));
    assert.equal(snap.configs["ems-w"]?.kind, "mqtt_sunspec");
    assert.equal(snap.configs["cab-mpm"]?.kind, "rest_json");
    const live = buildSeededLive(snap.placed);
    assert.equal(live.houses.length, 14);
    assert.ok(live.feeders.length >= 2);
    assert.ok(live.boards.length >= 1);
  });
});
