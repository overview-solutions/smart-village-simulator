import { test } from "node:test";
import assert from "node:assert/strict";
import { MODE_HIDE, MODE_META } from "../village-simulator/js/village-modes.js";

test("operations default is critical-only: hide routine, show leak + cutoff", () => {
  const h = MODE_HIDE.operations;
  assert.equal(h.reading, true);
  assert.equal(h.pay, true);
  assert.equal(h.sms, true);
  assert.equal(h.sync, true);
  assert.equal(h.mesh, true);
  assert.equal(h.rf, true);
  assert.equal(h.phase_xfer, true);
  assert.equal(h.leak, false);
  assert.equal(h.disconnect, false);
  assert.equal(h.worldline, false);
  assert.equal(MODE_META.operations.anomalyOnly, true);
});

test("build still hides the time stack", () => {
  const h = MODE_HIDE.build;
  assert.equal(h.worldline, true);
  assert.equal(h.outage, true);
  assert.equal(MODE_META.build.anomalyOnly, false);
});
