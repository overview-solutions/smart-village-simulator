import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TimeContext } from "@circaevum/locus/time";

const WINDOW_MIN = 120;
const boundH = 108;
const SCRUNCH_H = 9;
const DAY_MIN = 1440;

function villageY(t, now) {
  const time = new TimeContext({
    mode: "playhead",
    now,
    window: WINDOW_MIN,
    presentHeight: boundH,
    pastHeight: SCRUNCH_H,
    futureHeight: SCRUNCH_H,
    pastSpan: Math.max(now - WINDOW_MIN, 1),
    futureSpan: Math.max(DAY_MIN - now, 1),
  });
  return time.y(t);
}

describe("village playhead via Locus TimeContext", () => {
  it("now sits at y=0", () => {
    assert.equal(villageY(600, 600), 0);
  });

  it("120 min lookback fills presentHeight", () => {
    assert.equal(villageY(480, 600), 108);
  });

  it("day-start packs to pastTop", () => {
    assert.equal(villageY(0, 600), 117);
  });

  it("future hangs below now", () => {
    const y = villageY(720, 600);
    assert.ok(Math.abs(y - (-(120 / 840) * 9)) < 1e-9);
  });
});
