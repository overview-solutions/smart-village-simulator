import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZoomKpiReport } from "../village-simulator/js/village-kpi.js";

const houses = [
  { id: "h0", name: "Ada", feederId: "f-a", boardId: "b0", loadLimitW: 200, payments: [{ min: 10, amount: 40 }] },
  { id: "h1", feederId: "f-a", boardId: "b0", loadLimitW: 200, payments: [] },
  { id: "h2", feederId: "f-a", boardId: "b1", loadLimitW: 200, payments: [] },
  { id: "h3", feederId: "f-b", boardId: "b2", loadLimitW: 200, payments: [] },
];
const boards = [
  { id: "b0", feederId: "f-a", houseIds: ["h0", "h1"] },
  { id: "b1", feederId: "f-a", houseIds: ["h2"] },
  { id: "b2", feederId: "f-b", houseIds: ["h3"] },
];
const boardById = Object.fromEntries(boards.map((b) => [b.id, b]));
const leaks = [{ id: "lk-a", feederId: "f-a", fromBoardId: "b0", toBoardId: "b1", min: 30, restore: 90, leakW: 1000 }];

function row(partial) {
  return {
    min: 0,
    energyWh: 0,
    powerW: 0,
    on: true,
    wallet: 100,
    pf: 1,
    phase: "A",
    feederOut: false,
    ...partial,
  };
}

function pack() {
  const readings = [];
  const slots = [
    { h0: row({ wallet: 80, powerW: 50, energyWh: 25, phase: "A" }), h1: row({ powerW: 400, energyWh: 100, phase: "B" }), h2: row({ powerW: 40, energyWh: 10, phase: "C" }), h3: row({ powerW: 10, energyWh: 5, phase: "A" }) },
    { h0: row({ min: 15, wallet: 0, powerW: 0, on: false, energyWh: 0, phase: "A" }), h1: row({ min: 15, powerW: 400, energyWh: 100, phase: "B", pf: 0.5 }), h2: row({ min: 15, powerW: 40, energyWh: 10, phase: "C", feederOut: true }), h3: row({ min: 15, powerW: 10, energyWh: 5, phase: "A" }) },
  ];
  for (const slot of slots) {
    readings.push(slot.h0, slot.h1, slot.h2, slot.h3);
  }
  return readings;
}

const base = {
  houses,
  boardById,
  readings: pack(),
  leaks,
  events: [{ kind: "overload", houseId: "h1" }],
  slotMin: 15,
  tariff: 200,
};

function ids(report) {
  return report.groups.flatMap((g) => g.rows.map((r) => r.id));
}

test("village zoom reports the whole meter fleet", () => {
  const report = buildZoomKpiReport({ ...base, scope: { kind: "village" } });
  assert.equal(report.level, "village");
  assert.match(report.periodLabel, /Village/);
  assert.match(report.periodLabel, /4 meters/);
  assert.ok(ids(report).includes("v-avail"));
  assert.ok(ids(report).includes("v-kwh"));
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "v-n").actual, 4);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "v-tok").actual, 1);
  assert.ok(!ids(report).includes("f-imb"));
  assert.ok(!ids(report).includes("m-kwh"));
});

test("feeder zoom reports phase balance and leaks for that feeder", () => {
  const report = buildZoomKpiReport({
    ...base,
    scope: { kind: "feeder", id: "f-a" },
    labels: { feeder: "West" },
  });
  assert.equal(report.level, "feeder");
  assert.match(report.periodLabel, /West/);
  assert.match(report.periodLabel, /3 meters/);
  const imb = report.groups.flatMap((g) => g.rows).find((r) => r.id === "f-imb");
  assert.ok(imb.actual > 38);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "f-leak-n").actual, 1);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "f-leak-kwh").actual, 1);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "f-n").actual, 3);
  assert.ok(!ids(report).includes("v-avail"));
  assert.ok(!ids(report).includes("e-cap"));
});

test("EMS zoom reports tenants on that cabinet", () => {
  const report = buildZoomKpiReport({
    ...base,
    scope: { kind: "feeder", id: "f-a", boardId: "b0" },
    labels: { board: "MeshEMS west" },
  });
  assert.equal(report.level, "ems");
  assert.match(report.periodLabel, /MeshEMS west/);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "e-n").actual, 2);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "e-over").actual, 1);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "e-pf").actual, 1);
  assert.equal(report.groups.flatMap((g) => g.rows).find((r) => r.id === "e-leak").actual, 1);
  assert.ok(!ids(report).includes("f-leak-n"));
});

test("meter zoom reports one account, including later slots", () => {
  const report = buildZoomKpiReport({
    ...base,
    scope: { kind: "feeder", id: "f-a", boardId: "b0", houseId: "h0" },
    labels: { house: "Ada" },
  });
  assert.equal(report.level, "meter");
  assert.match(report.periodLabel, /Ada/);
  assert.match(report.periodLabel, /1 meter/);
  const rows = report.groups.flatMap((g) => g.rows);
  assert.equal(rows.find((r) => r.id === "m-kwh").actual, 0.03);
  assert.equal(rows.find((r) => r.id === "m-tok").actual, 1);
  assert.equal(rows.find((r) => r.id === "m-end").actual, 0);
  assert.equal(rows.find((r) => r.id === "m-pay").actual, 40);
  assert.ok(!ids(report).includes("e-n"));
  assert.ok(!ids(report).includes("f-n"));
});
