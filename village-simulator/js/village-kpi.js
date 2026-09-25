/**
 * Fake day KPIs for the village simulator — Target vs Actual demo only.
 * All labels, units, and numbers are invented for Voundou schematic play.
 * Do not mirror any real operator report, site name, currency, or ledger tool.
 *
 * Row/group `modes` tags which appMode(s) show the metric:
 *   operations · productive (Loads) · energy (Energy Assets)
 */

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

  let hitN = 0;
  let missN = 0;
  for (const g of groups) {
    for (const r of g.rows) {
      if (kpiHit(r)) hitN += 1;
      else missN += 1;
    }
  }

  return {
    periodLabel: "Voundou demo day · all figures invented",
    groups,
    hitN,
    missN,
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
