/**
 * Scoreboard for the village simulator.
 * Loads and Energy Assets keep schematic target-vs-actual groups.
 * Operations zoom (village, feeder, EMS, meter) reports the meters in that selection.
 * Targets there are schematic thresholds. Volume figures have no target.
 * Do not mirror any real operator report, site name, currency, or ledger tool.
 *
 * Row/group `modes` tags which appMode(s) show the metric:
 *   operations · productive (Loads) · energy (Energy Assets)
 */

import {
  IMB_EMS_W,
  IMB_FEEDER_W,
  IMB_WARN,
  focusLevel,
  phaseImbalance,
  timelineMembers,
} from "./village-focus-series.js";
import { LOW_BALANCE, PF_POOR, TARIFF_PER_KWH } from "./village-worldline-sim.js";

/** @typedef {'higher'|'lower'} KpiBetter */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   uom: string,
 *   better: KpiBetter,
 *   target: number,
 *   actual: number,
 *   focus?: string,
 *   digits?: number,
 *   modes?: string[],
 * }} KpiRow
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   modes?: string[],
 *   rows: KpiRow[],
 * }} KpiGroup
 */

/**
 * @param {{
 *   summary: Record<string, any>,
 *   houses: { id: string, startCredit?: number }[],
 *   events: { kind: string, houseId?: string | null }[],
 *   nowMin?: number,
 * }} day
 * @param {{ scopeFeederId?: string | null, houseN?: number }} [opts]
 * @returns {{ periodLabel: string, groups: KpiGroup[], missN: number, hitN: number }}
 */
export function buildKpiReport(day, opts = {}) {
  const s = day.summary || {};
  const houses = day.houses || [];
  const n = opts.houseN || houses.length || s.customers || 1;
  const pvKWh = s.pvKWh ?? 0;
  const loadKWh = s.kWh ?? 0;
  // Fake split: PV first, leftover treated as diesel for the demo day.
  const dieselKWh = Math.max(0, Math.round((loadKWh - pvKWh) * 10) / 10);
  const madeKWh = Math.round((pvKWh + dieselKWh) * 10) / 10;
  const renewShare = madeKWh > 0 ? (pvKWh / madeKWh) * 100 : 0;
  const nameplateW = s.pvNameplateW || 1;
  const fakeSunH = 5;
  const arrayUsePct = (pvKWh / ((nameplateW / 1000) * fakeSunH)) * 100;

  const payHouse = new Set(
    (day.events || []).filter((e) => e.kind === "pay" && e.houseId).map((e) => e.houseId),
  );
  const payingN = payHouse.size || Math.max(1, Math.round(n * 0.8));
  const idleMeters = Math.max(0, n - payingN);
  const revenue = s.billed ?? 0;
  const revPerPayer = revenue / Math.max(1, payingN);
  const kwhPerHome = loadKWh / Math.max(1, n);

  const leakKWh = ((s.leakW || 0) * 4) / 1000;
  const lossPct = madeKWh > 0 ? Math.min(30, ((madeKWh - loadKWh + leakKWh) / madeKWh) * 100) : 0;
  const storeLossKWh = Math.round(pvKWh * 0.05 * 10) / 10;
  const storeLossPct = pvKWh > 0 ? (storeLossKWh / pvKWh) * 100 : 0;

  const litresPerKwh = 1 / 3.1;
  const dieselL = dieselKWh * litresPerKwh;
  const dieselHrs = dieselKWh > 0 ? Math.min(16, dieselKWh / 40) : 0;

  const outages = s.outages || [];
  let darkHours = 0;
  let darkEvents = 0;
  for (const o of outages) {
    const hrs = Math.max(0, ((o.restore ?? 0) - (o.min ?? 0)) / 60);
    const dark = o.nDark ?? Math.round(n * 0.12);
    darkHours += (hrs * dark) / n;
    darkEvents += dark / n;
  }
  const hoursOn = Math.max(0, 24 - darkHours);
  const availPct = (hoursOn / 24) * 100;

  const dieselCost = dieselL * 1.2;
  const crewPay = 400;
  const travel = 90;
  const misc = 100;
  const spend = crewPay + travel + dieselCost + misc;
  const dayProfit = revenue - spend;
  const booksRev = revenue * 0.96;
  const booksGapPct = revenue > 0 ? Math.abs((revenue - booksRev) / revenue) * 100 : 0;

  /** @type {KpiGroup[]} */
  const groups = [
    {
      id: "energy",
      label: "Energy made",
      modes: ["energy"],
      rows: [
        row("made", "Energy made today", "kWh", "higher", madeKWh * 0.8, madeKWh, "production"),
        row("pv", "From solar array", "kWh", "higher", pvKWh * 0.88, pvKWh, "production"),
        row("diesel", "From diesel set", "kWh", "lower", Math.max(dieselKWh * 0.65, madeKWh * 0.12), dieselKWh, "generator"),
        row("array_use", "Array use vs nameplate-day", "%", "higher", 70, clamp(arrayUsePct, 0, 120), "production", 1),
        row("renew", "Solar share of energy made", "%", "higher", 70, clamp(renewShare, 0, 100), "production", 1),
      ],
    },
    {
      id: "customers",
      label: "Customers (fake)",
      modes: ["productive"],
      rows: [
        row("used", "Energy used by meters", "kWh", "higher", loadKWh * 0.86, loadKWh, "customer"),
        row("sales", "Prepaid sales (abstract $)", "$", "higher", revenue * 0.9, revenue, "customer", 2),
        row("meters", "Meters in sim", "#", "higher", n, n, "customer", 0),
        row("paying", "Meters with a top-up today", "#", "higher", Math.round(n * 0.85), payingN, "customer", 0),
        row("idle", "Meters with no top-up", "#", "lower", Math.round(n * 0.1), idleMeters, "customer", 0),
        row("rev_pay", "Sales / paying meter", "$", "higher", revPerPayer * 0.9, revPerPayer, "customer", 2),
        row("kwh_home", "kWh / meter", "kWh", "higher", kwhPerHome * 0.9, kwhPerHome, "customer", 2),
      ],
    },
    {
      id: "losses",
      label: "Losses (fake)",
      modes: ["operations"],
      rows: [
        row("loss", "Unaccounted energy share", "%", "lower", 12, clamp(Math.abs(lossPct), 0, 35), "losses", 1),
      ],
    },
    {
      id: "storage",
      label: "Storage (fake)",
      modes: ["energy"],
      rows: [
        row("store_kwh", "Storage round-trip loss", "kWh", "lower", storeLossKWh * 0.75, storeLossKWh, "battery", 1),
        row("store_pct", "Storage round-trip loss", "%", "lower", 6, clamp(storeLossPct, 0, 20), "battery", 1),
      ],
    },
    {
      id: "diesel",
      label: "Diesel set (fake)",
      modes: ["energy"],
      rows: [
        row("eff", "Fake fuel yield", "kWh/L", "higher", 3.4, 3.1, "generator", 1),
        row("litres", "Diesel burned", "L", "lower", Math.max(dieselL * 0.7, 0.5), dieselL, "generator", 1),
        row("run", "Diesel run hours", "h", "lower", Math.max(dieselHrs * 0.65, 0.4), dieselHrs, "generator", 1),
      ],
    },
    {
      id: "reliability",
      label: "Reliability (fake)",
      modes: ["operations"],
      rows: [
        row("dark_h", "Avg dark hours / meter", "h", "lower", 2, darkHours, "outages", 2),
        row("dark_n", "Avg dark events / meter", "#", "lower", 1, darkEvents, "outages", 2),
        row("on_h", "Hours with service", "h", "higher", 21, hoursOn, "uptime", 1),
        row("avail", "Service availability", "%", "higher", 94, clamp(availPct, 0, 100), "uptime", 1),
      ],
    },
    {
      id: "money",
      label: "Money sandbox",
      modes: ["operations"],
      rows: [
        row("profit", "Day profit (toy)", "$", "higher", 50, dayProfit, "operations", 2),
        row("books", "Toy ledger revenue", "$", "higher", booksRev * 0.95, booksRev, "operations", 2),
        row("gap", "Sim sales vs toy ledger", "%", "lower", 4, booksGapPct, "operations", 1),
        row("spend", "Toy opex total", "$", "lower", spend * 1.08, spend, "operations", 2),
        row("crew", "Crew pay (toy)", "$", "lower", 430, crewPay, "operations", 2),
        row("travel", "Travel (toy)", "$", "lower", 110, travel, "operations", 2),
        row("fuel$", "Diesel cost (toy)", "$", "lower", dieselCost * 1.15, dieselCost, "operations", 2),
        row("misc", "Misc (toy)", "$", "lower", 120, misc, "operations", 2),
      ],
    },
  ];

  const scored = kpiScore(groups);

  return {
    periodLabel: "Voundou demo day · all figures invented",
    groups,
    hitN: scored.hitN,
    missN: scored.missN,
  };
}

/**
 * Groups (and rows) visible for an appMode. Untagged → operations.
 * @param {KpiGroup[]} groups
 * @param {string} mode
 * @returns {KpiGroup[]}
 */
export function kpiGroupsForMode(groups, mode) {
  const m = mode || "operations";
  const out = [];
  for (const g of groups || []) {
    const gModes = g.modes?.length ? g.modes : ["operations"];
    const rows = (g.rows || []).filter((r) => {
      const rm = r.modes?.length ? r.modes : gModes;
      return rm.includes(m);
    });
    if (!rows.length) continue;
    out.push({ ...g, rows });
  }
  return out;
}

/**
 * Hit / miss counts for a filtered group list.
 * @param {KpiGroup[]} groups
 */
export function kpiScore(groups) {
  let hitN = 0;
  let missN = 0;
  for (const g of groups || []) {
    for (const r of g.rows || []) {
      if (r.kind === "figure") continue;
      if (kpiHit(r)) hitN += 1;
      else missN += 1;
    }
  }
  return { hitN, missN };
}

/**
 * @param {KpiRow} r
 */
export function kpiHit(r) {
  if (r.kind === "figure") return true;
  if (r.better === "higher") return r.actual >= r.target;
  return r.actual <= r.target;
}

/**
 * @param {KpiRow} r
 */
export function fmtKpi(r, which = "actual") {
  const v = which === "target" ? r.target : r.actual;
  const d = r.digits ?? (r.uom === "%" || r.uom === "h" ? 1 : r.uom === "#" ? 0 : 1);
  if (r.uom === "$" && Math.abs(v) >= 100) return v.toFixed(0);
  return Number(v).toFixed(d);
}

function row(id, label, uom, better, target, actual, focus, digits) {
  return {
    id,
    label,
    uom,
    better,
    target: Number(target) || 0,
    actual: Number(actual) || 0,
    focus,
    digits,
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function figure(id, label, uom, actual, digits) {
  const v = Number(actual) || 0;
  return { id, label, uom, better: "higher", target: v, actual: v, kind: "figure", digits, focus: "report" };
}

function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

/**
 * Meter report for the current zoom. Full known day. Slider does not clip it.
 * @param {{
 *   scope?: object,
 *   houses?: object[],
 *   boardById?: Record<string, object>,
 *   readings?: object[],
 *   events?: object[],
 *   leaks?: object[],
 *   outages?: object[],
 *   slotMin?: number,
 *   tariff?: number,
 *   labels?: { feeder?: string, board?: string, house?: string },
 * }} input
 */
export function buildZoomKpiReport(input = {}) {
  const scope = input.scope || { kind: "village" };
  const houses = input.houses || [];
  const readings = input.readings || [];
  const n = houses.length;
  const slotMin = input.slotMin || 15;
  const tariff = input.tariff ?? TARIFF_PER_KWH;
  const level = focusLevel(scope);
  const members = timelineMembers(scope, houses, input.boardById);
  const slots = n ? Math.floor(readings.length / n) : 0;
  const labels = input.labels || {};
  const title =
    level === "meter"
      ? labels.house || members[0]?.name || members[0]?.id || "Meter"
      : level === "ems"
        ? labels.board || "EMS"
        : level === "feeder"
          ? labels.feeder || scope.id || "Feeder"
          : "Village";
  const ids = new Set(members.map((h) => h.id));
  const dayH = (slots * slotMin) / 60;

  let energyWh = 0;
  let onSlots = 0;
  let outSlots = 0;
  let peakW = 0;
  let coincident = 0;
  const dead = new Set();
  const dark = new Set();
  const poorPf = new Set();
  const breathLost = new Set();
  /** @type {Map<string, number>} */
  const prevWallet = new Map();
  let tokenOut = 0;
  let minWallet = Infinity;
  let endWallet = 0;
  let peakImb = 0;

  for (let s = 0; s < slots; s++) {
    let slotW = 0;
    const phaseRows = [];
    for (const h of members) {
      const r = readings[s * n + h.index];
      if (!r) continue;
      phaseRows.push(r);
      energyWh += r.energyWh || 0;
      const w = r.powerW || 0;
      if (w > peakW) peakW = w;
      const serving = !!r.on && !r.feederOut;
      if (serving) {
        onSlots += 1;
        slotW += w;
      }
      if (r.feederOut) {
        outSlots += 1;
        dark.add(h.id);
      }
      const wallet = r.wallet || 0;
      if (wallet <= 0) dead.add(h.id);
      if (wallet < minWallet) minWallet = wallet;
      if (serving && (r.pf ?? 1) < PF_POOR) poorPf.add(h.id);
      if (r.lastBreath && !r.lastBreathArrived) breathLost.add(h.id);
      const prev = prevWallet.get(h.id);
      if (prev != null && prev > 0 && wallet <= 0 && !r.feederOut) tokenOut += 1;
      prevWallet.set(h.id, wallet);
      if (s === slots - 1) endWallet += wallet;
    }
    if (slotW > coincident) coincident = slotW;
    const floorW = level === "ems" ? IMB_EMS_W : IMB_FEEDER_W;
    peakImb = Math.max(peakImb, phaseImbalance(phaseRows, floorW));
  }
  if (!Number.isFinite(minWallet)) minWallet = 0;

  let payN = 0;
  let paySum = 0;
  const paid = new Set();
  for (const h of members) {
    for (const p of h.payments || []) {
      payN += 1;
      paySum += p.amount || 0;
      paid.add(h.id);
    }
  }

  const mN = members.length;
  const slotN = Math.max(1, mN * Math.max(slots, 1));
  const avail = slots && mN ? (onSlots / (mN * slots)) * 100 : 0;
  const kWh = energyWh / 1000;
  const billed = kWh * tariff;
  const collectPct = billed > 0 ? (paySum / billed) * 100 : paySum > 0 ? 100 : 0;
  const deadPct = mN ? (dead.size / mN) * 100 : 0;
  const avgOutH = mN ? (outSlots * slotMin) / 60 / mN : 0;
  const onH = (onSlots * slotMin) / 60 / Math.max(1, mN);
  const outH = (outSlots * slotMin) / 60 / Math.max(1, level === "meter" ? 1 : mN);
  const payCover = mN ? (paid.size / mN) * 100 : 0;
  const limitW = members.reduce((s, h) => s + (h.loadLimitW || 0), 0) || Math.max(1, mN) * 200;
  const loadPct = (coincident / limitW) * 100;
  const meterLimit = members[0]?.loadLimitW || 200;
  const meterPeakPct = (peakW / meterLimit) * 100;

  const events = input.events || [];
  const overloadN = events.filter((e) => e.kind === "overload" && ids.has(e.houseId)).length;

  let leakN = 0;
  let leakKWh = 0;
  const bid = scope.boardId || (scope.kind === "board" ? scope.id : null);
  for (const lk of input.leaks || []) {
    const onFeeder = level === "feeder" && lk.feederId === scope.id;
    const onEms = level === "ems" && (lk.fromBoardId === bid || lk.toBoardId === bid);
    const onVillage = level === "village";
    if (!onFeeder && !onEms && !onVillage) continue;
    if (level === "meter") continue;
    leakN += 1;
    const hrs = Math.max(0, ((lk.restore ?? 0) - (lk.min ?? 0)) / 60);
    leakKWh += ((lk.leakW || 0) * hrs) / 1000;
  }

  /** @type {KpiGroup[]} */
  let groups = [];
  if (!mN) {
    groups = [];
  } else if (level === "feeder") {
    groups = [
      {
        id: "feeder-balance",
        label: "Feeder balance",
        modes: ["operations"],
        rows: [
          row("f-imb", "Peak phase imbalance", "%", "lower", IMB_WARN * 100, clamp(peakImb * 100, 0, 100), "report", 0),
          row("f-dark", "Meters touched by outage", "#", "lower", 0, dark.size, "report", 0),
          row("f-out", "Avg outage hours / meter", "h", "lower", 1, round2(avgOutH), "report", 2),
          figure("f-kwh", "Metered energy", "kWh", round2(kWh), 2),
          figure("f-n", "Meters on feeder", "#", mN, 0),
        ],
      },
      {
        id: "feeder-loss",
        label: "Feeder losses",
        modes: ["operations"],
        rows: [
          row("f-leak-n", "Leak spans", "#", "lower", 0, leakN, "report", 0),
          figure("f-leak-kwh", "Leak energy (schematic)", "kWh", round2(leakKWh), 2),
        ],
      },
    ];
  } else if (level === "ems") {
    groups = [
      {
        id: "ems-load",
        label: "EMS load",
        modes: ["operations"],
        rows: [
          row("e-cap", "Peak load vs meter limits", "%", "lower", 80, clamp(loadPct, 0, 200), "report", 0),
          row("e-imb", "Peak phase split", "%", "lower", IMB_WARN * 100, clamp(peakImb * 100, 0, 100), "report", 0),
          figure("e-kw", "Peak coincident", "W", Math.round(coincident), 0),
          figure("e-kwh", "Metered energy", "kWh", round2(kWh), 2),
          figure("e-n", "Tenants", "#", mN, 0),
        ],
      },
      {
        id: "ems-stress",
        label: "Tenant stress",
        modes: ["operations"],
        rows: [
          row("e-over", "Overload trips", "#", "lower", 0, overloadN, "report", 0),
          row("e-pf", "Tenants with poor PF", "#", "lower", 0, poorPf.size, "report", 0),
          row("e-leak", "Span leaks", "#", "lower", 0, leakN, "report", 0),
          row("e-breath", "Last breath lost", "#", "lower", 0, breathLost.size, "report", 0),
          row("e-dead", "Tenants who hit zero credit", "#", "lower", Math.round(mN * 0.2), dead.size, "report", 0),
        ],
      },
    ];
  } else if (level === "meter") {
    const end = slots ? endWallet : 0;
    groups = [
      {
        id: "meter-supply",
        label: "This meter",
        modes: ["operations"],
        rows: [
          row("m-on", "Hours with service", "h", "higher", Math.min(18, dayH || 18), round1(onH), "report", 1),
          row("m-out", "Outage hours", "h", "lower", 0.5, round2(outH), "report", 2),
          row("m-peak", "Peak vs load limit", "%", "lower", 100, clamp(meterPeakPct, 0, 250), "report", 0),
          figure("m-kwh", "Energy used", "kWh", round2(kWh), 2),
          figure("m-pay", "Top-ups", "$", round2(paySum), 0),
        ],
      },
      {
        id: "meter-credit",
        label: "Credit",
        modes: ["operations"],
        rows: [
          row("m-end", "Credit at end of day", "$", "higher", LOW_BALANCE, round1(end), "report", 0),
          row("m-tok", "Times credit hit zero", "#", "lower", 0, tokenOut, "report", 0),
          figure("m-min", "Lowest credit", "$", round1(minWallet), 0),
          figure("m-topn", "Top-up count", "#", payN, 0),
        ],
      },
    ];
  } else {
    groups = [
      {
        id: "village-fleet",
        label: "Village meters",
        modes: ["operations"],
        rows: [
          row("v-avail", "Service availability", "%", "higher", 94, clamp(avail, 0, 100), "report", 1),
          row("v-collect", "Top-ups vs metered cost", "%", "higher", 80, clamp(collectPct, 0, 300), "report", 0),
          row("v-cover", "Meters with a top-up", "%", "higher", 50, clamp(payCover, 0, 100), "report", 0),
          row("v-out", "Avg outage hours / meter", "h", "lower", 1, round2(avgOutH), "report", 2),
          figure("v-kwh", "Metered energy", "kWh", round2(kWh), 2),
          figure("v-n", "Meters", "#", mN, 0),
        ],
      },
      {
        id: "village-credit",
        label: "Village credit",
        modes: ["operations"],
        rows: [
          row("v-dead", "Meters that hit zero credit", "%", "lower", 15, clamp(deadPct, 0, 100), "report", 0),
          row("v-end", "Mean credit at end of day", "$", "higher", LOW_BALANCE, mN ? round1(endWallet / mN) : 0, "report", 0),
          figure("v-sales", "Top-up total", "$", round2(paySum), 0),
          figure("v-tok", "Credit-to-zero events", "#", tokenOut, 0),
        ],
      },
    ];
  }

  const scored = kpiScore(groups);
  const who = level === "village" ? "Village" : level === "feeder" ? "Feeder" : level === "ems" ? "EMS" : "Meter";
  return {
    level,
    periodLabel: mN ? `${who} · ${title} · ${mN} meter${mN === 1 ? "" : "s"} · full day` : `${who} · ${title} · no meters`,
    groups,
    hitN: scored.hitN,
    missN: scored.missN,
  };
}
