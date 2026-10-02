/**
 * Worldlines follow the selected collection.
 * Village = critical meter stacks.
 * Feeder = leakage, phase imbalance, feeder outages.
 * EMS = that cabinet's span: leaks, tenant stress, phase split, mesh.
 * Meter = credit, token-out, outages, roof solar / battery.
 * A meter never keeps a feeder's stacks, and a feeder never keeps meter wallets.
 */

export const IMB_FEEDER_W = 80;
export const IMB_EMS_W = 40;
export const IMB_WARN = 0.38;
export const WALLET_FULL = 640;
export const ROOF_NAMEPLATE_W = 400;
export const HOME_BATT_WH = 1200;
export const HOME_BATT_MAX_W = 280;
export const PV_SHOW_W = 30;

/**
 * Minute-to-Y spacing does not follow map zoom. Zoom moves the camera,
 * so a closer view shows fewer minutes of the same axis.
 * Always 1. Do not multiply worldline or bead Y by this.
 */
export function stackScaleForZoom(_zoom) {
  return 1;
}

/**
 * v2 timeGroup origin. Scale on the group is ±1, so this is yAt(now), not yAt(now) * a zoom factor.
 * Local crumb Y stays (yAt(now) - diagramY). Displayed height is diagramY, same as yWorld(minute).
 */
export function timeGroupOriginY(nowDiagramY, stackScale, v2 = true) {
  if (!v2) return 0;
  const nowY = Number(nowDiagramY) || 0;
  const k = Number(stackScale);
  return nowY * (Number.isFinite(k) ? k : 1);
}

/** World Y of a crumb parented under timeGroup. diagramY is yWorld(event minute). */
export function stackedCrumbY(diagramY, nowDiagramY, stackScale, v2 = true) {
  const k = Number.isFinite(Number(stackScale)) ? Number(stackScale) : 1;
  const diagram = Number(diagramY) || 0;
  const nowY = Number(nowDiagramY) || 0;
  const origin = timeGroupOriginY(nowY, k, v2);
  const scale = (v2 ? -1 : 1) * k;
  const local = v2 ? nowY - diagram : diagram;
  return origin + scale * local;
}

const FEEDER_KINDS = new Set(["leak", "leak_clear", "phase_xfer", "outage", "repair", "restore", "shed"]);
const EMS_KINDS = new Set([
  "leak",
  "leak_clear",
  "phase_xfer",
  "overload",
  "cap_warn",
  "pf_warn",
  "lastbreath",
  "lastbreath_lost",
  "outage",
  "repair",
  "restore",
]);
const METER_KINDS = new Set([
  "pay",
  "credit",
  "sms",
  "disconnect",
  "reconnect",
  "overload",
  "outage",
  "repair",
  "restore",
  "token_out",
  "meter_outage",
  "lastbreath",
  "lastbreath_lost",
  "cap_warn",
  "pf_warn",
]);

export const INK = {
  ok: [0.23, 0.43, 0.07],
  imb: [0.36, 0.49, 0.98],
  leak: [0.91, 0.36, 1],
  outage: [1, 0.18, 0.29],
  warn: [0.73, 0.46, 0.09],
  pv: [0.25, 0.72, 1],
  battOut: [0.79, 0.64, 0.15],
  battIn: [0.24, 0.55, 0.99],
};

/** @param {{ kind?: string, id?: string, houseId?: string | null, boardId?: string | null } | null | undefined} scope */
export function focusLevel(scope) {
  if (!scope || scope.kind === "village" || !scope.kind) return "village";
  if (scope.houseId || scope.kind === "house") return "meter";
  if (scope.boardId || scope.kind === "board") return "ems";
  if (scope.kind === "feeder") return "feeder";
  return "village";
}

/** `f-run-auto-8` and `run-auto-8` are the same feeder. Blank ids match nothing. */
export function sameFeeder(a, b) {
  if (a == null || b == null || a === "" || b === "") return false;
  const na = String(a).replace(/^f-/, "");
  const nb = String(b).replace(/^f-/, "");
  return na.length > 0 && na === nb;
}

/** 15-min reading beads: feeder, EMS, or meter only. Village stays clear. */
export function readingInScope(house, scope) {
  const level = focusLevel(scope);
  if (!house || level === "village") return false;
  const houseId = scope?.houseId || (scope?.kind === "house" ? scope.id : null);
  const boardId = scope?.boardId || (scope?.kind === "board" ? scope.id : null);
  if (level === "meter") return house.id === houseId;
  if (level === "ems") return !!boardId && house.boardId === boardId;
  if (level === "feeder") return scope?.kind === "feeder" && sameFeeder(house.feederId, scope.id);
  return false;
}

export function walletInk(wallet, full = WALLET_FULL) {
  const n = Number(wallet) || 0;
  if (n <= 0) return 0;
  return Math.max(0, Math.min(1, n / Math.max(1, full)));
}

export function phaseImbalance(rows, minWatts = IMB_FEEDER_W) {
  const load = { A: 0, B: 0, C: 0 };
  for (const r of rows || []) {
    if (!r || !r.on || r.feederOut) continue;
    const ph = r.phase === "B" || r.phase === "C" ? r.phase : "A";
    load[ph] += r.powerW || 0;
  }
  const mx = Math.max(load.A, load.B, load.C);
  const mn = Math.min(load.A, load.B, load.C);
  if (mx < minWatts) return 0;
  return (mx - mn) / mx;
}

function outageOf(e, index) {
  if (!e?.outageId || !index?.outageById) return null;
  return index.outageById[e.outageId] || null;
}

function leakOf(e, index) {
  if (!e?.leakId || !index?.leakById) return null;
  return index.leakById[e.leakId] || null;
}

function houseOf(e, index) {
  if (!e?.houseId || !index?.houseById) return null;
  return index.houseById[e.houseId] || null;
}

export function outageHitsHouse(o, house) {
  if (!o || !house) return false;
  if (o.xfmrId) return house.xfmrId === o.xfmrId;
  if (o.feederId) return house.feederId === o.feederId;
  return false;
}

export function outageHitsFeeder(o, feederId, index) {
  if (!o || !feederId) return false;
  if (o.feederId) return sameFeeder(o.feederId, feederId);
  if (!o.xfmrId || !index?.houseById) return false;
  return Object.values(index.houseById).some((h) => sameFeeder(h.feederId, feederId) && h.xfmrId === o.xfmrId);
}

export function outageHitsBoard(o, board) {
  if (!o || !board) return false;
  if (o.feederId) return o.feederId === board.feederId;
  if (o.xfmrId) return board.xfmrId === o.xfmrId;
  return false;
}

function scopeCtx(scope, index) {
  const houseId = scope?.houseId || (scope?.kind === "house" ? scope.id : null);
  const boardId = scope?.boardId || (scope?.kind === "board" ? scope.id : null);
  const house = houseId && index?.houseById ? index.houseById[houseId] : null;
  const board = boardId && index?.boardById ? index.boardById[boardId] : null;
  const feederId =
    scope?.kind === "feeder" ? scope.id : house?.feederId || board?.feederId || null;
  return { feederId, boardId: board?.id || boardId, houseId, house, board };
}

function onFeeder(e, ctx, index) {
  if (e.kind === "leak" || e.kind === "leak_clear") {
    const lk = leakOf(e, index);
    return !!lk && sameFeeder(lk.feederId, ctx.feederId);
  }
  if (e.kind === "phase_xfer") {
    if (sameFeeder(e.feederId, ctx.feederId)) return true;
    const h = houseOf(e, index);
    return !!h && sameFeeder(h.feederId, ctx.feederId);
  }
  const o = outageOf(e, index);
  return outageHitsFeeder(o, ctx.feederId, index);
}

function onBoard(e, ctx, index) {
  const board = ctx.board;
  if (!board) return false;
  if (e.kind === "leak" || e.kind === "leak_clear") {
    const lk = leakOf(e, index);
    return !!lk && (lk.fromBoardId === board.id || lk.toBoardId === board.id);
  }
  if (
    e.kind === "phase_xfer" ||
    e.kind === "overload" ||
    e.kind === "cap_warn" ||
    e.kind === "pf_warn" ||
    e.kind === "lastbreath" ||
    e.kind === "lastbreath_lost"
  ) {
    const h = houseOf(e, index);
    if (h) return h.boardId === board.id;
    if (e.kind === "lastbreath_lost") return outageHitsBoard(outageOf(e, index), board);
    return false;
  }
  return outageHitsBoard(outageOf(e, index), board);
}

function onMeter(e, ctx, index) {
  if (
    e.kind === "pay" ||
    e.kind === "credit" ||
    e.kind === "sms" ||
    e.kind === "disconnect" ||
    e.kind === "reconnect" ||
    e.kind === "overload" ||
    e.kind === "token_out" ||
    e.kind === "meter_outage" ||
    e.kind === "lastbreath" ||
    e.kind === "lastbreath_lost" ||
    e.kind === "cap_warn" ||
    e.kind === "pf_warn"
  ) {
    return !!ctx.houseId && e.houseId === ctx.houseId;
  }
  return outageHitsHouse(outageOf(e, index), ctx.house);
}

/** Village keeps the existing anomaly filter. Other levels drop foreign stacks. */
export function eventVisibleAtLevel(e, scope, index) {
  const level = focusLevel(scope);
  if (level === "village") return true;
  if (!e?.kind) return false;
  const ctx = scopeCtx(scope, index);
  if (level === "feeder") return FEEDER_KINDS.has(e.kind) && onFeeder(e, ctx, index);
  if (level === "ems") return EMS_KINDS.has(e.kind) && onBoard(e, ctx, index);
  return METER_KINDS.has(e.kind) && onMeter(e, ctx, index);
}

/** Path hops (pay walk, mesh credit) stay on the village layer. */
export function markerVisible(marker, scope, index) {
  if (marker?.span === "path" && focusLevel(scope) !== "village") return false;
  return eventVisibleAtLevel(marker, scope, index);
}

export function ribbonRgb(sample) {
  if (!sample) return INK.ok;
  if (sample.outage) return INK.outage;
  if (sample.leak) return INK.leak;
  if ((sample.imb || 0) >= IMB_WARN) return INK.imb;
  if ((sample.stress || 0) >= 0.55) return INK.warn;
  return INK.ok;
}

export function sampleAt(series, min) {
  if (!series?.length) return null;
  let best = series[0].min <= min ? series[0] : null;
  for (const s of series) {
    if (s.min <= min) best = s;
    else break;
  }
  return best;
}

function leakActive(leaks, feederId, boardId, min) {
  for (const lk of leaks || []) {
    if (min < lk.min || min >= lk.restore) continue;
    if (boardId) {
      if (lk.fromBoardId === boardId || lk.toBoardId === boardId) return true;
    } else if (sameFeeder(lk.feederId, feederId)) return true;
  }
  return false;
}

function pfStressOf(pf) {
  const p = pf == null ? 1 : pf;
  return (1 - Math.max(0.55, Math.min(1, p))) / 0.45;
}

/**
 * Schematic roof PV + home battery. Not a metered channel.
 * Charge when the roof outruns the meter. Discharge on outage or token-out.
 */
export function meterGenTrace(readings, opts) {
  const pv = !!opts?.pv;
  const batt = !!opts?.batt;
  const sunAt = opts?.sunAt || (() => 0);
  let soc = batt ? 0.45 : 0;
  const trace = [];
  let prev = null;
  for (const r of readings || []) {
    const sun = Math.max(0, sunAt(r.min) || 0);
    const pvW = pv ? ROOF_NAMEPLATE_W * sun : 0;
    const loadW = r.on && !r.feederOut ? r.powerW || 0 : 0;
    let battW = 0;
    let battMode = "idle";
    if (batt) {
      const slotH = (opts.slotMin || 15) / 60;
      const backup = r.feederOut || (!r.on && (r.wallet || 0) <= 0);
      if (backup && soc > 0.08) {
        const availW = ((soc - 0.05) * HOME_BATT_WH) / slotH;
        const draw = Math.min(HOME_BATT_MAX_W, 80, availW);
        if (draw > 15) {
          soc -= (draw * slotH) / HOME_BATT_WH;
          battW = draw;
          battMode = "discharge";
        }
      } else if (pvW - loadW > 20 && soc < 0.98) {
        const surplus = pvW - loadW;
        const roomW = ((0.98 - soc) * HOME_BATT_WH) / slotH;
        const charge = Math.min(surplus, HOME_BATT_MAX_W, roomW);
        soc += (charge * slotH) / HOME_BATT_WH;
        battW = -charge;
        battMode = "charge";
      }
    }
    const tokenOut = !!(prev && prev.wallet > 0 && (r.wallet || 0) <= 0 && !r.feederOut);
    const outageStart = !!(r.feederOut && !(prev && prev.feederOut));
    trace.push({
      min: r.min,
      wallet: r.wallet || 0,
      on: !!r.on,
      feederOut: !!r.feederOut,
      pvW,
      battW,
      battMode,
      tokenOut,
      outageStart,
    });
    prev = r;
  }
  return trace;
}

export function activeSpans(trace, pick) {
  const spans = [];
  for (let i = 0; i < (trace?.length || 0) - 1; i++) {
    const rgb = pick(trace[i]);
    if (!rgb) continue;
    spans.push({ min0: trace[i].min, min1: trace[i + 1].min, rgb });
  }
  return spans;
}

export function pvSpans(trace) {
  return activeSpans(trace, (p) => (p.pvW >= PV_SHOW_W ? INK.pv : null));
}

export function battSpans(trace) {
  return activeSpans(trace, (p) => {
    if (p.battMode === "discharge") return INK.battOut;
    if (p.battMode === "charge") return INK.battIn;
    return null;
  });
}

function rowsFor(readings, n, slot, pred) {
  const rows = [];
  const base = slot * n;
  for (let i = 0; i < n; i++) {
    if (pred(i)) rows.push(readings[base + i]);
  }
  return rows;
}

/**
 * @param {{
 *   houses: object[],
 *   boards: object[],
 *   feeders: object[],
 *   readings: object[],
 *   leaks?: object[],
 *   slotMin?: number,
 *   pvIds?: Set<string> | string[],
 *   battIds?: Set<string> | string[],
 *   sunAt?: (min: number) => number,
 * }} input
 */
export function buildFocusSamples(input) {
  const houses = input.houses || [];
  const n = houses.length;
  const readings = input.readings || [];
  const slots = n ? Math.floor(readings.length / n) : 0;
  const leaks = input.leaks || [];
  const slotMin = input.slotMin || 15;
  const pvIds = input.pvIds instanceof Set ? input.pvIds : new Set(input.pvIds || []);
  const battIds = input.battIds instanceof Set ? input.battIds : new Set(input.battIds || []);
  const sunAt = input.sunAt || (() => 0);
  const feeders = {};
  const boards = {};
  const idxByHouse = new Map(houses.map((h, i) => [h.id, i]));

  for (const f of input.feeders || []) feeders[f.id] = [];
  for (const b of input.boards || []) boards[b.id] = [];

  for (let s = 0; s < slots; s++) {
    const min = readings[s * n]?.min ?? s * slotMin;
    for (const f of input.feeders || []) {
      const rows = rowsFor(readings, n, s, (i) => sameFeeder(houses[i].feederId, f.id));
      const imb = phaseImbalance(rows, IMB_FEEDER_W);
      const leak = leakActive(leaks, f.id, null, min);
      const outage = rows.some((r) => r?.feederOut);
      feeders[f.id].push({
        min,
        imb,
        leak,
        outage,
        stress: outage ? 1 : leak ? 0.86 : imb,
      });
    }
    for (const b of input.boards || []) {
      const idSet = new Set(b.houseIds || []);
      const rows = rowsFor(readings, n, s, (i) => idSet.has(houses[i].id));
      const imb = phaseImbalance(rows, IMB_EMS_W);
      const leak = leakActive(leaks, b.feederId, b.id, min);
      const outage = rows.some((r) => r?.feederOut);
      let cap = 0;
      let pfStress = 0;
      let breath = false;
      let overload = false;
      for (const r of rows) {
        if (!r) continue;
        if (r.lastBreath && !r.lastBreathArrived) breath = true;
        if (!r.on && !r.feederOut && (r.wallet || 0) > 0) overload = true;
        if (r.on && !r.feederOut) {
          const limit = r.loadLimitW || 220;
          cap = Math.max(cap, limit ? (r.powerW || 0) / limit : 0);
          pfStress = Math.max(pfStress, pfStressOf(r.pf));
        }
      }
      const stress = Math.max(
        outage ? 1 : 0,
        leak ? 0.86 : 0,
        imb,
        cap,
        pfStress,
        breath ? 0.78 : 0,
        overload ? 0.9 : 0,
      );
      boards[b.id].push({ min, imb, leak, outage, cap, pfStress, breath, overload, stress });
    }
  }

  const meters = {};
  const want = new Set([...pvIds, ...battIds]);
  for (const id of want) {
    const i = idxByHouse.get(id);
    if (i == null) continue;
    const series = [];
    for (let s = 0; s < slots; s++) series.push(readings[s * n + i]);
    meters[id] = meterGenTrace(series, {
      pv: pvIds.has(id),
      batt: battIds.has(id),
      sunAt,
      slotMin,
    });
  }

  return { feeders, boards, meters };
}

/** Moments for every meter, from readings. Gen traces stay on PV / battery homes. */
export function meterMomentIndex(houses, readings) {
  const n = houses?.length || 0;
  const slots = n ? Math.floor((readings?.length || 0) / n) : 0;
  /** @type {Record<string, { min: number, kind: string, houseId: string }[]>} */
  const byHouse = {};
  for (let i = 0; i < n; i++) {
    const id = houses[i].id;
    let prev = null;
    const moments = [];
    for (let s = 0; s < slots; s++) {
      const r = readings[s * n + i];
      if (!r) continue;
      if (prev && prev.wallet > 0 && (r.wallet || 0) <= 0 && !r.feederOut) {
        moments.push({ min: r.min, kind: "token_out", houseId: id });
      }
      if (r.feederOut && !(prev && prev.feederOut)) {
        moments.push({ min: r.min, kind: "meter_outage", houseId: id });
      }
      prev = r;
    }
    if (moments.length) byHouse[id] = moments;
  }
  return byHouse;
}

const PHASE_COLOR = { A: "#5c7cfa", B: "#2bb6a3", C: "#e6c84a" };

export function houseBandColor(i) {
  const hue = Math.round((i * 137.508) % 360);
  return `hsl(${hue}, 62%, 58%)`;
}

/** Houses that belong on the bottom timeline for this selection. `index` matches the reading slot. */
export function timelineMembers(scope, houses, boardById) {
  const tagged = (houses || []).map((h, index) => ({ ...h, index }));
  const level = focusLevel(scope);
  if (level === "meter") {
    const id = scope?.houseId || (scope?.kind === "house" ? scope.id : null);
    return tagged.filter((h) => h.id === id);
  }
  if (level === "ems") {
    const bid = scope?.boardId || (scope?.kind === "board" ? scope.id : null);
    const ids = new Set(boardById?.[bid]?.houseIds || []);
    return tagged.filter((h) => ids.has(h.id) || h.boardId === bid);
  }
  if (level === "feeder") return tagged.filter((h) => sameFeeder(h.feederId, scope.id));
  return tagged;
}

function readingAtSlot(readings, n, slot, index) {
  if (!readings || n <= 0 || index == null) return null;
  return readings[slot * n + index] || null;
}

/**
 * Bottom timeline for the selected collection.
 * Village and meter: end-use mix. Feeder: phase watts. EMS: one band per meter.
 * Every known reading slot is included. The time slider does not clip this series.
 * @param {{
 *   scope: object,
 *   houses: object[],
 *   boardById?: Record<string, { id?: string, label?: string, houseIds?: string[], feederId?: string, xfmrId?: string }>,
 *   readings: object[],
 *   leaks?: object[],
 *   outages?: object[],
 *   nowMin: number,
 *   slotMin?: number,
 *   mix?: { id: string, label: string, color: string }[],
 *   labels?: { feeder?: string, board?: string, house?: string },
 * }} input
 */
export function collectTimeline(input) {
  const scope = input.scope || { kind: "village" };
  const houses = input.houses || [];
  const n = houses.length;
  const readings = input.readings || [];
  const slotMin = input.slotMin || 15;
  const slots = n ? Math.floor(readings.length / n) : 0;
  const level = focusLevel(scope);
  const members = timelineMembers(scope, houses, input.boardById);
  const mins = [];
  for (let s = 0; s < slots; s++) mins.push(readings[s * n]?.min ?? s * slotMin);
  const labels = input.labels || {};
  const houseById = Object.fromEntries(houses.map((h) => [h.id, h]));
  const index = { houseById, outageById: Object.fromEntries((input.outages || []).map((o) => [o.id, o])) };

  /** @type {{ id: string, label: string, color: string, values: number[] }[]} */
  let layers = [];
  /** @type {{ min: number, end: number, kind: string }[]} */
  let marks = [];
  let title = "all meters";
  let note = "End-use watts, all meters.";

  if (level === "feeder") {
    title = labels.feeder || scope.id || "Feeder";
    note = "Phase watts on this feeder. Purple band is a leak. Red band is an outage.";
    layers = ["A", "B", "C"].map((ph) => ({ id: ph, label: `Phase ${ph}`, color: PHASE_COLOR[ph], values: [] }));
    for (let s = 0; s < mins.length; s++) {
      const acc = { A: 0, B: 0, C: 0 };
      for (const h of members) {
        const r = readingAtSlot(readings, n, s, h.index);
        if (!r || !r.on || r.feederOut) continue;
        const ph = r.phase === "B" || r.phase === "C" ? r.phase : "A";
        acc[ph] += r.powerW || 0;
      }
      for (const layer of layers) layer.values.push(acc[layer.id]);
    }
    for (const lk of input.leaks || []) {
      if (sameFeeder(lk.feederId, scope.id)) marks.push({ min: lk.min, end: lk.restore, kind: "leak" });
    }
    for (const o of input.outages || []) {
      if (outageHitsFeeder(o, scope.id, index)) marks.push({ min: o.min, end: o.restore, kind: "outage" });
    }
  } else if (level === "ems") {
    const bid = scope.boardId || scope.id;
    title = labels.board || "EMS";
    note = "Each band is one meter on this EMS.";
    layers = members.map((h, i) => ({
      id: h.id,
      label: h.name || h.id,
      color: houseBandColor(i),
      values: [],
    }));
    for (let s = 0; s < mins.length; s++) {
      members.forEach((h, i) => {
        const r = readingAtSlot(readings, n, s, h.index);
        const w = r && r.on && !r.feederOut ? r.powerW || 0 : 0;
        layers[i].values.push(w);
      });
    }
    const board = input.boardById?.[bid];
    for (const lk of input.leaks || []) {
      if (lk.fromBoardId === bid || lk.toBoardId === bid) marks.push({ min: lk.min, end: lk.restore, kind: "leak" });
    }
    for (const o of input.outages || []) {
      if (outageHitsBoard(o, board)) marks.push({ min: o.min, end: o.restore, kind: "outage" });
    }
  } else {
    const mix = input.mix || [];
    layers = mix.map((m) => ({ id: m.id, label: m.label, color: m.color, values: [] }));
    for (let s = 0; s < mins.length; s++) {
      const acc = Object.fromEntries(layers.map((l) => [l.id, 0]));
      for (const h of members) {
        const r = readingAtSlot(readings, n, s, h.index);
        const row = r?.mix || {};
        for (const layer of layers) acc[layer.id] += row[layer.id] || 0;
      }
      for (const layer of layers) layer.values.push(acc[layer.id]);
    }
    if (level === "meter") {
      const h = members[0];
      title = labels.house || h?.name || h?.id || "Meter";
      note = "This meter only. Bands are end uses.";
      const house = h ? houseById[h.id] : null;
      for (const o of input.outages || []) {
        if (outageHitsHouse(o, house)) marks.push({ min: o.min, end: o.restore, kind: "outage" });
      }
    }
  }

  marks = marks.filter((m) => Number.isFinite(m.min) && Number.isFinite(m.end) && m.end > m.min);

  return { level, title, note, layers, mins, marks };
}

export function focusCaption(level, sample) {
  if (level === "feeder") {
    if (!sample) return "Feeder · leakage, phase imbalance, outages";
    const imb = Math.round((sample.imb || 0) * 100);
    const bits = [`imbalance ${imb}%`];
    if (sample.leak) bits.push("leak");
    if (sample.outage) bits.push("outage");
    if (!sample.leak && !sample.outage && (sample.imb || 0) < IMB_WARN) bits.push("quiet");
    return `Feeder · ${bits.join(" · ")}`;
  }
  if (level === "ems") {
    if (!sample) return "EMS · span leak, tenant stress, phase split, mesh";
    const bits = [];
    if (sample.leak) bits.push("span leak");
    if (sample.outage) bits.push("region dark");
    if ((sample.imb || 0) >= IMB_WARN) bits.push(`phase ${Math.round(sample.imb * 100)}%`);
    if ((sample.cap || 0) >= 0.8) bits.push(`load ${Math.round(sample.cap * 100)}%`);
    if (sample.overload) bits.push("tenant cutoff");
    if (sample.breath) bits.push("last breath lost");
    if ((sample.pfStress || 0) >= 0.45) bits.push("poor PF");
    if (!bits.length) bits.push("quiet");
    return `EMS · ${bits.join(" · ")}`;
  }
  if (level === "meter") {
    if (!sample) return "Meter · credit, token-out, outage, roof solar / battery";
    const bits = [`credit ${Math.round(sample.wallet || 0)}`];
    if (sample.tokenOut) bits.push("token out");
    else if ((sample.wallet || 0) <= 0 && sample.on === false) bits.push("no credit");
    if (sample.feederOut) bits.push("outage");
    if ((sample.pvW || 0) >= PV_SHOW_W) bits.push(`solar ${Math.round(sample.pvW)} W`);
    if (sample.battMode === "discharge") bits.push("battery out");
    else if (sample.battMode === "charge") bits.push("battery charge");
    return `Meter · ${bits.join(" · ")}`;
  }
  return "Village · critical meter stacks";
}

export const FOCUS_CAPTION_KEY = {
  village: "Critical stacks across meters. Select a feeder, EMS, or meter to swap layers.",
  feeder: "Line at the DTM: green quiet, blue phase imbalance, purple leak, red outage.",
  ems: "Line at the cabinet: leak on this span, tenant overload, phase split, lost last breath.",
  meter: "Gold line is credit. Red bead token-out. Fault bead outage. Cyan roof solar. Amber battery discharge.",
};
