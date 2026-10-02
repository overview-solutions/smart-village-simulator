import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IMB_WARN,
  INK,
  battSpans,
  buildFocusSamples,
  eventVisibleAtLevel,
  collectTimeline,
  focusCaption,
  focusLevel,
  markerVisible,
  timelineMembers,
  meterGenTrace,
  meterMomentIndex,
  phaseImbalance,
  pvSpans,
  readingInScope,
  ribbonRgb,
  sampleAt,
  stackScaleForZoom,
  stackedCrumbY,
  walletInk,
} from "../village-simulator/js/village-focus-series.js";

const houses = [
  { id: "h0", feederId: "f-a", boardId: "b0", xfmrId: "x0" },
  { id: "h1", feederId: "f-a", boardId: "b0", xfmrId: "x0" },
  { id: "h2", feederId: "f-a", boardId: "b1", xfmrId: "x0" },
  { id: "h3", feederId: "f-b", boardId: "b2", xfmrId: "x1" },
];
const boards = [
  { id: "b0", feederId: "f-a", xfmrId: "x0", houseIds: ["h0", "h1"] },
  { id: "b1", feederId: "f-a", xfmrId: "x0", houseIds: ["h2"] },
  { id: "b2", feederId: "f-b", xfmrId: "x1", houseIds: ["h3"] },
];
const feeders = [{ id: "f-a" }, { id: "f-b" }];
const leaks = [
  { id: "lk-a", feederId: "f-a", fromBoardId: "b0", toBoardId: "b1", min: 30, restore: 60 },
];
const outages = [
  { id: "o-a", feederId: "f-a", xfmrId: null },
  { id: "o-x", feederId: null, xfmrId: "x1" },
];
const index = {
  houseById: Object.fromEntries(houses.map((h) => [h.id, h])),
  boardById: Object.fromEntries(boards.map((b) => [b.id, b])),
  leakById: Object.fromEntries(leaks.map((l) => [l.id, l])),
  outageById: Object.fromEntries(outages.map((o) => [o.id, o])),
};

function row(partial) {
  return {
    on: true,
    feederOut: false,
    powerW: 100,
    wallet: 200,
    phase: "A",
    pf: 1,
    loadLimitW: 200,
    ...partial,
  };
}

test("focus level follows house, then EMS, then feeder", () => {
  assert.equal(focusLevel(null), "village");
  assert.equal(focusLevel({ kind: "village" }), "village");
  assert.equal(focusLevel({ kind: "feeder", id: "f-a" }), "feeder");
  assert.equal(focusLevel({ kind: "feeder", id: "f-a", boardId: "b0" }), "ems");
  assert.equal(focusLevel({ kind: "feeder", id: "f-a", boardId: "b0", houseId: "h0" }), "meter");
  assert.equal(focusLevel({ kind: "house", id: "h0" }), "meter");
  assert.equal(focusLevel({ kind: "board", id: "b0" }), "ems");
  assert.equal(readingInScope({ id: "h0", feederId: "f-a", boardId: "b0" }, { kind: "village" }), false);
  assert.equal(readingInScope({ id: "h0", feederId: "f-a", boardId: "b0" }, { kind: "feeder", id: "f-a" }), true);
  assert.equal(readingInScope({ id: "h3", feederId: "f-b", boardId: "b2" }, { kind: "feeder", id: "f-a" }), false);
  assert.equal(readingInScope({ id: "h0", feederId: "f-a", boardId: "b0" }, { kind: "feeder", id: "f-a", boardId: "b0" }), true);
  assert.equal(readingInScope({ id: "h2", feederId: "f-a", boardId: "b1" }, { kind: "feeder", id: "f-a", boardId: "b0" }), false);
  assert.equal(readingInScope({ id: "h0", feederId: "f-a", boardId: "b0" }, { kind: "feeder", id: "f-a", boardId: "b0", houseId: "h0" }), true);
  assert.equal(readingInScope({ id: "h1", feederId: "f-a", boardId: "b0" }, { kind: "feeder", id: "f-a", boardId: "b0", houseId: "h0" }), false);
  assert.equal(readingInScope({ id: "h0", feederId: "f-run-auto-8" }, { kind: "feeder", id: "run-auto-8" }), true);
  assert.equal(readingInScope({ id: "h3", feederId: "f-run-auto-9" }, { kind: "feeder", id: "f-run-auto-8" }), false);
  assert.equal(readingInScope({ id: "h0" }, { kind: "feeder" }), false);
  assert.equal(readingInScope({ id: "h0", feederId: "f-a" }, { kind: "feeder", id: "" }), false);
  const members = timelineMembers({ kind: "feeder", id: "run-auto-8" }, [
    { id: "h0", feederId: "f-run-auto-8" },
    { id: "h3", feederId: "f-run-auto-9" },
    { id: "hx" },
  ], {});
  assert.deepEqual(members.map((h) => h.id), ["h0"]);
});

test("phase imbalance ignores a quiet feeder and flags a skewed one", () => {
  assert.equal(phaseImbalance([row({ phase: "A", powerW: 20 })]), 0);
  const skew = phaseImbalance([
    row({ phase: "A", powerW: 400 }),
    row({ phase: "B", powerW: 40 }),
    row({ phase: "C", powerW: 40 }),
  ]);
  assert.ok(skew > IMB_WARN);
});

test("feeder events stay off a meter, meter credit stays off a feeder", () => {
  const feeder = { kind: "feeder", id: "f-a" };
  const ems = { kind: "feeder", id: "f-a", boardId: "b0" };
  const meter = { kind: "feeder", id: "f-a", boardId: "b0", houseId: "h0" };
  const leak = { kind: "leak", leakId: "lk-a", houseId: null };
  const xfer = { kind: "phase_xfer", feederId: "f-a", houseId: "h2" };
  const credit = { kind: "credit", houseId: "h0" };
  const token = { kind: "disconnect", houseId: "h0" };
  const overload = { kind: "overload", houseId: "h1" };
  const outA = { kind: "outage", outageId: "o-a", houseId: null };
  const outB = { kind: "outage", outageId: "o-x", houseId: null };

  assert.equal(eventVisibleAtLevel(leak, feeder, index), true);
  assert.equal(eventVisibleAtLevel(leak, ems, index), true);
  assert.equal(eventVisibleAtLevel(leak, meter, index), false);
  assert.equal(eventVisibleAtLevel(xfer, feeder, index), true);
  assert.equal(eventVisibleAtLevel(xfer, ems, index), false);
  assert.equal(eventVisibleAtLevel(xfer, meter, index), false);
  assert.equal(eventVisibleAtLevel(credit, feeder, index), false);
  assert.equal(eventVisibleAtLevel(credit, ems, index), false);
  assert.equal(eventVisibleAtLevel(credit, meter, index), true);
  assert.equal(eventVisibleAtLevel(token, meter, index), true);
  assert.equal(eventVisibleAtLevel(token, { ...meter, houseId: "h3" }, index), false);
  assert.equal(eventVisibleAtLevel(overload, ems, index), true);
  assert.equal(eventVisibleAtLevel(overload, { kind: "feeder", id: "f-a", boardId: "b1" }, index), false);
  assert.equal(eventVisibleAtLevel(outA, feeder, index), true);
  assert.equal(eventVisibleAtLevel(outA, meter, index), true);
  assert.equal(eventVisibleAtLevel(outB, meter, index), false);
  assert.equal(eventVisibleAtLevel(outB, { kind: "feeder", id: "f-b" }, index), true);
  assert.equal(eventVisibleAtLevel({ kind: "sms", houseId: "h0" }, meter, index), true);
  assert.equal(eventVisibleAtLevel({ kind: "sms", houseId: "h0" }, feeder, index), false);
  assert.equal(eventVisibleAtLevel({ kind: "lastbreath", houseId: "h0" }, meter, index), true);
  assert.equal(eventVisibleAtLevel({ kind: "pf_warn", houseId: "h1" }, ems, index), true);
  assert.equal(eventVisibleAtLevel({ kind: "pf_warn", houseId: "h0" }, meter, index), true);
  assert.equal(eventVisibleAtLevel({ kind: "pf_warn", houseId: "h1" }, meter, index), false);
  assert.equal(stackScaleForZoom(16), 1);
  assert.equal(stackScaleForZoom(17), 1);
  assert.equal(stackScaleForZoom(20.6), 1);
  assert.equal(stackScaleForZoom(24), 1);
  const nowY = 8 * 54;
  assert.equal(stackedCrumbY(20, nowY, 1), 20);
  assert.equal(stackedCrumbY(0, nowY, 1), 0);
  assert.equal(stackedCrumbY(13.5, nowY, 1) - stackedCrumbY(0, nowY, 1), 13.5);
  assert.equal(markerVisible({ kind: "pay", houseId: "h0", span: "path" }, meter, index), false);
  assert.equal(markerVisible({ kind: "pay", houseId: "h0", span: "path" }, { kind: "village" }, index), true);
});

test("feeder sample paints leak and outage, not the other feeder", () => {
  const readings = [];
  for (const min of [0, 15, 30, 45]) {
    for (const h of houses) {
      readings.push(row({
        min,
        houseId: h.id,
        phase: h.id === "h0" ? "A" : "B",
        powerW: h.id === "h0" ? 300 : 40,
        feederOut: min === 45 && h.feederId === "f-a",
      }));
    }
  }
  const pack = buildFocusSamples({
    houses,
    boards,
    feeders,
    readings,
    leaks,
    slotMin: 15,
    sunAt: () => 0,
  });
  const atLeak = sampleAt(pack.feeders["f-a"], 30);
  assert.equal(atLeak.leak, true);
  assert.equal(atLeak.outage, false);
  assert.deepEqual(ribbonRgb(atLeak), INK.leak);
  const atOut = sampleAt(pack.feeders["f-a"], 45);
  assert.equal(atOut.outage, true);
  assert.deepEqual(ribbonRgb(atOut), INK.outage);
  assert.equal(sampleAt(pack.feeders["f-b"], 30).leak, false);
  assert.equal(sampleAt(pack.feeders["f-b"], 45).outage, false);
  const emsLeak = sampleAt(pack.boards.b0, 30);
  assert.equal(emsLeak.leak, true);
  assert.equal(sampleAt(pack.boards.b2, 30).leak, false);
});

test("meter trace keeps credit steps, solar, and battery backup", () => {
  const readings = [
    row({ min: 0, wallet: 100, powerW: 0, on: false }),
    row({ min: 15, wallet: 0, powerW: 0, on: false }),
    row({ min: 12 * 60, wallet: 400, powerW: 40, on: true }),
    row({ min: 12 * 60 + 15, wallet: 380, powerW: 0, on: false, feederOut: true }),
  ];
  const trace = meterGenTrace(readings, {
    pv: true,
    batt: true,
    slotMin: 15,
    sunAt: (min) => (min >= 12 * 60 ? 1 : 0),
  });
  assert.equal(trace[1].tokenOut, true);
  assert.equal(trace[0].pvW, 0);
  assert.ok(trace[2].pvW >= 30);
  assert.equal(trace[2].battMode, "charge");
  assert.equal(trace[3].battMode, "discharge");
  assert.equal(trace[3].outageStart, true);
  assert.ok(pvSpans(trace).length >= 1);
  assert.ok(battSpans(trace).some((s) => s.rgb === INK.battOut));
  assert.equal(walletInk(0), 0);
  assert.equal(walletInk(640), 1);
  const moments = meterMomentIndex([{ id: "h0" }], readings);
  assert.deepEqual(moments.h0.map((m) => m.kind), ["token_out", "meter_outage"]);
  assert.match(focusCaption("meter", trace[1]), /token out/);
  assert.match(focusCaption("meter", trace[3]), /outage/);
  assert.match(focusCaption("feeder", { imb: 0.5, leak: false, outage: false }), /imbalance 50%/);
  assert.match(focusCaption("village", null), /Village/);
});

test("bottom timeline follows feeder, EMS, then one meter", () => {
  const boardById = Object.fromEntries(boards.map((b) => [b.id, b]));
  const feederScope = { kind: "feeder", id: "f-a" };
  const emsScope = { kind: "feeder", id: "f-a", boardId: "b0" };
  const meterScope = { kind: "feeder", id: "f-a", boardId: "b0", houseId: "h0" };
  assert.deepEqual(timelineMembers(feederScope, houses, boardById).map((h) => h.id), ["h0", "h1", "h2"]);
  assert.deepEqual(timelineMembers(emsScope, houses, boardById).map((h) => h.id), ["h0", "h1"]);
  assert.deepEqual(timelineMembers(meterScope, houses, boardById).map((h) => h.id), ["h0"]);

  const readings = [];
  for (const min of [0, 15]) {
    for (const h of houses) {
      readings.push(row({
        min,
        phase: h.id === "h0" ? "A" : h.id === "h1" ? "B" : "C",
        powerW: h.id === "h3" ? 900 : 100,
        mix: { lighting: h.id === "h0" ? 40 : 0, cooking: 10 },
      }));
    }
  }
  const mix = [
    { id: "lighting", label: "Light", color: "#fff" },
    { id: "cooking", label: "Cook", color: "#000" },
  ];
  const feeder = collectTimeline({
    scope: feederScope,
    houses,
    boardById,
    readings,
    leaks,
    outages,
    nowMin: 0,
    slotMin: 15,
    mix,
    labels: { feeder: "West" },
  });
  assert.deepEqual(feeder.mins, [0, 15]);
  assert.equal(feeder.layers[0].values.length, 2);
  const leakMark = feeder.marks.find((m) => m.kind === "leak");
  assert.equal(leakMark.min, 30);
  assert.equal(leakMark.end, 60);
  assert.equal(feeder.level, "feeder");
  assert.deepEqual(feeder.layers.map((l) => l.id), ["A", "B", "C"]);
  assert.equal(feeder.layers[0].values[0], 100);
  assert.equal(feeder.layers[2].values[0], 100);
  assert.ok(feeder.marks.some((m) => m.kind === "leak"));
  assert.ok(!feeder.layers.some((l) => l.id === "lighting"));

  const ems = collectTimeline({
    scope: emsScope,
    houses,
    boardById,
    readings,
    leaks,
    outages,
    nowMin: 20,
    slotMin: 15,
    mix,
    labels: { board: "MeshEMS west" },
  });
  assert.equal(ems.level, "ems");
  assert.deepEqual(ems.layers.map((l) => l.id), ["h0", "h1"]);
  assert.equal(ems.layers[0].values[0], 100);

  const meter = collectTimeline({
    scope: meterScope,
    houses,
    boardById,
    readings,
    nowMin: 20,
    slotMin: 15,
    mix,
    labels: { house: "Ada" },
  });
  assert.equal(meter.level, "meter");
  assert.equal(meter.title, "Ada");
  assert.equal(meter.layers.find((l) => l.id === "lighting").values[0], 40);
  assert.equal(meter.layers.find((l) => l.id === "cooking").values[0], 10);
});
