import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODE_HIDE,
  MODE_META,
  opsHasLiveHouses,
  opsWorldlinesBlocked,
  opsSetAllCustomers,
  opsCustomerStackMode,
} from "../village-simulator/js/village-modes.js";

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

test("empty canvas uses seeded houses, not demo HOUSES ref", () => {
  const demo = [{ id: "h0" }];
  const seeded = [{ id: "h0" }, { id: "h1" }];
  assert.equal(opsHasLiveHouses(true, demo, demo), false);
  assert.equal(opsHasLiveHouses(true, [], demo), false);
  assert.equal(opsHasLiveHouses(true, seeded, demo), true);
  assert.equal(opsHasLiveHouses(false, demo, demo), true);
});

test("BUILD blocks worldlines; Operations does not", () => {
  assert.equal(opsWorldlinesBlocked("build"), true);
  assert.equal(opsWorldlinesBlocked("maintenance"), true);
  assert.equal(opsWorldlinesBlocked("operations"), false);
});

test("All customers unhides pay / reading / SMS; off puts them back", () => {
  const hide = { ...MODE_HIDE.operations };
  opsSetAllCustomers(hide, true);
  assert.equal(hide.reading, false);
  assert.equal(hide.pay, false);
  assert.equal(hide.sms, false);
  assert.equal(hide.worldline, false);
  assert.equal(hide.leak, false);
  opsSetAllCustomers(hide, false);
  assert.equal(hide.reading, true);
  assert.equal(hide.pay, true);
  assert.equal(hide.sms, true);
  assert.equal(hide.leak, false);
});

test("Anomalies OFF hides customer stacks; All customers is a separate mode", () => {
  assert.equal(opsCustomerStackMode(true, false), "critical");
  assert.equal(opsCustomerStackMode(false, false), "hidden");
  assert.equal(opsCustomerStackMode(false, true), "all");
  assert.equal(opsCustomerStackMode(true, true), "all");
  assert.equal(MODE_META.operations.anomalyOnly, true);
});
