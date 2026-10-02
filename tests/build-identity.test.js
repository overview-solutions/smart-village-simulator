import test from "node:test";
import assert from "node:assert/strict";
import {
  autofillIdentity,
  finishLineDraw,
  generationSiteLayout,
  isBlankId,
  nextAutofillId,
} from "../village-simulator/js/village-build.js";

test("blank feeder, ems, and meter ids autofill and do not clobber a typed value", () => {
  assert.equal(isBlankId("  "), true);
  assert.equal(isBlankId("West"), false);

  const feeder = { assetClass: "feeder", kind: "area", runId: "", feederId: "", uid: "" };
  autofillIdentity(feeder, { placed: [], runId: null });
  assert.equal(feeder.runId, "AUTO-FEEDER-1");

  const second = { assetClass: "feeder", kind: "area", runId: "" };
  autofillIdentity(second, { placed: [feeder], runId: null });
  assert.equal(second.runId, "AUTO-FEEDER-2");
  assert.notEqual(feeder.runId, second.runId);

  const named = { assetClass: "feeder", kind: "area", runId: "West" };
  autofillIdentity(named, { placed: [feeder, second], runId: null });
  assert.equal(named.runId, "West");

  const line = { assetClass: "primary", kind: "line", runId: "" };
  const again = autofillIdentity(line, { placed: [feeder], runId: "AUTO-FEEDER-1" });
  assert.equal(line.runId, "AUTO-FEEDER-1");
  assert.equal(again.runId, "AUTO-FEEDER-1");

  const loose = { assetClass: "primary", kind: "line" };
  autofillIdentity(loose, { placed: [feeder, second], runId: null });
  assert.equal(loose.runId, "AUTO-FEEDER-3");

  const ems = { assetClass: "ems", kind: "point", uid: "" };
  autofillIdentity(ems, { placed: [] });
  assert.equal(ems.uid, "AUTO-EMS-1");
  assert.equal(ems.globalId, "AUTO-EMS-1");

  const emsNamed = { assetClass: "ems", kind: "point", uid: "cabinet-4" };
  autofillIdentity(emsNamed, { placed: [ems] });
  assert.equal(emsNamed.uid, "cabinet-4");

  const meter = { assetClass: "meter", kind: "point" };
  autofillIdentity(meter, { placed: [] });
  assert.equal(meter.uid, "AUTO-METER-1");

  const meter2 = { assetClass: "meter", kind: "point", uid: "" };
  autofillIdentity(meter2, { placed: [meter] });
  assert.equal(meter2.uid, "AUTO-METER-2");

  assert.equal(nextAutofillId("AUTO-FEEDER", new Set([1, 2])), "AUTO-FEEDER-3");
  const prefixed = { assetClass: "feeder", kind: "area", feederId: "f-AUTO-FEEDER-8", runId: "" };
  autofillIdentity(prefixed, { placed: [] });
  assert.equal(prefixed.runId, "AUTO-FEEDER-8");
});

test("complete line drops the open point and the line tool", () => {
  const mid = finishLineDraw({
    toolKind: "line",
    tool: "primary",
    pendingLine: { x: 1, z: 2 },
    runId: "AUTO-FEEDER-1",
    chainTail: null,
  });
  assert.equal(mid.changed, true);
  assert.equal(mid.tool, null);
  assert.equal(mid.pendingLine, null);
  assert.equal(mid.runId, null);

  const idle = finishLineDraw({ toolKind: "point", tool: "pole", pendingLine: null, runId: "AUTO-FEEDER-1" });
  assert.equal(idle.changed, false);
  assert.equal(idle.tool, "pole");
  assert.equal(idle.runId, "AUTO-FEEDER-1");

  const run = finishLineDraw({
    toolKind: "chain",
    tool: "dist_run_primary",
    pendingLine: { x: 0, z: 0 },
    runId: "AUTO-FEEDER-4",
    chainTail: { poleId: "p1" },
  });
  assert.equal(run.changed, true);
  assert.equal(run.tool, "dist_run_primary");
  assert.equal(run.pendingLine, null);
  assert.equal(run.runId, "AUTO-FEEDER-4");
});

test("generation site click does not start a line and parks a pole on the station", () => {
  const lay = generationSiteLayout(10, -4);
  assert.equal(lay.startLine, false);
  assert.deepEqual(lay.pole, lay.station);
  assert.deepEqual(lay.splice, lay.station);
  assert.notDeepEqual(lay.pole, lay.gen);
  assert.equal(lay.breaker.x, 12.45);
  assert.equal(lay.xfmr.z, lay.station.z + 1.05);
});
