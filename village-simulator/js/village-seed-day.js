/**
 * One hypothetical GroundBolt day from BUILD-seeded customers.
 * Outages / leaks / prepaid / last-breath — schematic, not telemetry.
 */

import { lineServeBand } from "./village-seed-customers.js";

const GIVEN = [
  "Leila", "Musa", "Hope", "Daniel", "Ayo", "Ruth", "Eshe", "Tomas", "Winta", "Juma",
  "Sanaa", "Abel", "Farah", "Kojo", "Dina", "Issa", "Makeda", "Ravi", "Noor", "Taye",
];

const USE_LABEL = {
  medical: "Clinic",
  water: "Pump",
  school: "School",
  telecom: "Tower",
  streetlight: "Streetlight",
  residential: "Home",
  commercial: "Shop",
  industrial: "Workshop",
  agricultural: "Farm",
  market: "Stall",
  worship: "Worship",
  leisure: "Hall",
  security: "Post",
  fire: "Fire",
};

function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function lineLen(l) {
  return Math.hypot((l.bx ?? l.x) - l.x, (l.bz ?? l.z) - l.z) || 0.01;
}

function segDist(ax, az, bx, bz, cx, cz, dx, dz) {
  const pts = [
    [ax, az, cx, cz],
    [ax, az, dx, dz],
    [bx, bz, cx, cz],
    [bx, bz, dx, dz],
  ];
  let best = Infinity;
  for (const [x1, z1, x2, z2] of pts) best = Math.min(best, Math.hypot(x1 - x2, z1 - z2));
  return best;
}

function alongT(c, line) {
  const dx = (line.bx ?? line.x) - line.x;
  const dz = (line.bz ?? line.z) - line.z;
  const len2 = dx * dx + dz * dz || 1;
  return ((c.x - line.x) * dx + (c.z - line.z) * dz) / len2;
}

function clusterOf(useClass) {
  if (useClass === "agricultural" || useClass === "water") return "west";
  if (useClass === "market" || useClass === "commercial") return "market";
  if (useClass === "medical" || useClass === "school" || useClass === "worship") return "clinic";
  if (useClass === "industrial" || useClass === "telecom" || useClass === "leisure") return "east";
  return "south";
}

function traitsFor(useClass, i) {
  const u = hash(i + 3);
  const rural = useClass === "agricultural" || useClass === "water";
  const home = useClass === "residential";
  const base = {
    loadScale: rural ? 0.5 + u * 0.9 : 0.7 + u * 1.1,
    fridgeW: rural ? 14 + u * 18 : 22 + u * 28,
    cookDinner: home || useClass === "market",
    cookBreakfast: home && u > 0.4,
    dinnerOff: Math.floor(u * 90),
    dinnerDur: 40 + Math.floor(hash(i + 8) * 50),
    cookW: useClass === "market" ? 180 + u * 160 : rural ? 90 + u * 80 : 140 + u * 140,
    laundry: home && u > 0.72,
    laundryOff: Math.floor(hash(i + 5) * 240),
    pump: useClass === "water" || useClass === "agricultural",
    ag: useClass === "agricultural",
    ict:
      useClass === "commercial" ||
      useClass === "school" ||
      useClass === "telecom" ||
      useClass === "medical" ||
      useClass === "security" ||
      (!rural && !home && useClass !== "streetlight" && u > 0.35),
    ictW: useClass === "telecom" ? 80 + u * 40 : useClass === "school" ? 40 + u * 30 : 16 + u * 40,
    awayDay: home && u > 0.86,
    tools: useClass === "industrial",
    heat: home && u > 0.7,
    payVia: u < 0.45 ? "vendor" : u < 0.78 ? "phone" : "ciu",
  };
  if (useClass === "industrial") {
    base.peakLoad = "tools";
    base.peakW = 280 + Math.round(u * 220);
    base.peakStart = 9 * 60 + Math.floor(u * 40);
    base.peakEnd = 16 * 60 + Math.floor(hash(i + 2) * 50);
  } else if (useClass === "streetlight") {
    base.loadScale = 0.12 + u * 0.08;
    base.fridgeW = 0;
    base.cookDinner = false;
    base.cookBreakfast = false;
    base.laundry = false;
    base.ict = false;
    base.heat = false;
    base.pump = false;
  } else if (useClass === "medical") {
    base.loadScale = 1.1 + u * 0.35;
    base.fridgeW = 70 + u * 22;
    base.cookDinner = false;
    base.ict = true;
    base.ictW = 28 + u * 16;
  } else if (useClass === "school") {
    base.cookDinner = false;
    base.cookBreakfast = false;
    base.laundry = false;
    base.ict = true;
    base.awayDay = false;
  } else if (useClass === "worship") {
    base.cookDinner = false;
    base.laundry = false;
    base.heat = false;
    base.ict = false;
  } else if (useClass === "leisure") {
    base.cookDinner = u > 0.55;
    base.ict = true;
    base.peakLoad = "lighting";
    base.peakW = 80 + Math.round(u * 60);
    base.peakStart = 17 * 60;
    base.peakEnd = 22 * 60;
  } else if (useClass === "commercial") {
    base.cookDinner = false;
    base.ict = true;
    base.ictW = 24 + u * 20;
  } else if (useClass === "telecom") {
    base.cookDinner = false;
    base.laundry = false;
    base.ict = true;
    base.ictW = 80 + u * 40;
  } else if (useClass === "security") {
    base.cookDinner = false;
    base.laundry = false;
    base.ict = true;
    base.ictW = 18 + u * 10;
  } else if (useClass === "water") {
    base.cookDinner = false;
    base.laundry = false;
    base.pump = true;
  } else if (useClass === "agricultural") {
    base.ag = true;
    base.pump = true;
    base.cookDinner = u > 0.62;
  }
  return base;
}

function bandWatts(useClass) {
  return (
    {
      streetlight: { nightW: 42, dayW: 2, eveW: 42, nightLoad: "lighting", dayLoad: "lighting", eveLoad: "lighting" },
      medical: { nightW: 40, dayW: 140, eveW: 110, nightLoad: "fridge", dayLoad: "ict", eveLoad: "lighting" },
      water: { nightW: 8, dayW: 180, eveW: 160, nightLoad: "lighting", dayLoad: "pump", eveLoad: "pump" },
      school: { nightW: 10, dayW: 120, eveW: 30, nightLoad: "lighting", dayLoad: "ict", eveLoad: "lighting" },
      industrial: { nightW: 16, dayW: 320, eveW: 80, nightLoad: "lighting", dayLoad: "tools", eveLoad: "lighting" },
      agricultural: { nightW: 12, dayW: 140, eveW: 70, nightLoad: "lighting", dayLoad: "ag", eveLoad: "pump" },
      market: { nightW: 8, dayW: 90, eveW: 180, nightLoad: "lighting", dayLoad: "ict", eveLoad: "cooking" },
      commercial: { nightW: 10, dayW: 80, eveW: 70, nightLoad: "lighting", dayLoad: "ict", eveLoad: "lighting" },
      worship: { nightW: 6, dayW: 20, eveW: 70, nightLoad: "lighting", dayLoad: "lighting", eveLoad: "lighting" },
      leisure: { nightW: 8, dayW: 30, eveW: 110, nightLoad: "lighting", dayLoad: "ict", eveLoad: "lighting" },
      telecom: { nightW: 70, dayW: 90, eveW: 80, nightLoad: "ict", dayLoad: "ict", eveLoad: "ict" },
      security: { nightW: 28, dayW: 36, eveW: 32, nightLoad: "lighting", dayLoad: "ict", eveLoad: "lighting" },
      fire: { nightW: 20, dayW: 40, eveW: 36, nightLoad: "lighting", dayLoad: "ict", eveLoad: "lighting" },
      residential: { nightW: 22, dayW: 80, eveW: 150, nightLoad: "lighting", dayLoad: "fridge", eveLoad: "cooking" },
    }[useClass] || { nightW: 22, dayW: 80, eveW: 150, nightLoad: "lighting", dayLoad: "fridge", eveLoad: "cooking" }
  );
}

function walletPlan(useClass, i) {
  const u = hash(i + 13);
  const critical = useClass === "medical" || useClass === "water" || useClass === "telecom" || useClass === "streetlight" || useClass === "school";
  if (critical) return { startCredit: 900 + Math.round(u * 1100), pay: 520 + Math.round(u * 200), payMin: 6 * 60 + 10 + (i % 8) * 6 };
  if (useClass === "industrial") return { startCredit: 700 + Math.round(u * 400), pay: 800, payMin: 7 * 60 + 20 };
  if (useClass === "market" || useClass === "commercial") return { startCredit: 180 + Math.round(u * 280), pay: 640, payMin: 6 * 60 + 40 + (i % 10) * 5 };
  if (u < 0.22) return { startCredit: 0, pay: 480, payMin: 6 * 60 + 20 + (i % 16) * 8 };
  if (u < 0.36) return { startCredit: 40 + Math.round(u * 30), pay: 400, payMin: 7 * 60 + (i % 12) * 7 };
  return { startCredit: 280 + Math.round(u * 360), pay: 400, payMin: 6 * 60 + 15 + (i % 20) * 7 };
}

function loadLimitW(useClass) {
  return (
    {
      medical: 700,
      water: 900,
      industrial: 1400,
      school: 560,
      market: 520,
      commercial: 420,
      telecom: 240,
      agricultural: 380,
      worship: 300,
      leisure: 340,
      streetlight: 90,
      residential: 240,
    }[useClass] || 240
  );
}

function houseName(useClass, i) {
  const label = USE_LABEL[useClass] || "Home";
  if (useClass === "residential") return GIVEN[i % GIVEN.length];
  return `${label} ${1 + (i % 9)}`;
}

function nearestLv380(line, lines) {
  let best = null;
  let bestD = 10;
  for (const p of lines) {
    if (p.id === line.id) continue;
    if (lineServeBand(p) !== "lv380") continue;
    const d = segDist(line.x, line.z, line.bx ?? line.x, line.bz ?? line.z, p.x, p.z, p.bx ?? p.x, p.bz ?? p.z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** Dist-run feeders from BUILD overlay — no customers required. */
export function overlayLiveFromPlaced(placed) {
  const pack = emptyLivePack();
  const lines = (placed || []).filter((p) => p.kind === "line" && !p.seeded && p.assetClass !== "service");
  const byRun = new Map();
  for (const l of lines) {
    const rid = l.runId || l.id;
    if (!byRun.has(rid)) byRun.set(rid, []);
    byRun.get(rid).push(l);
  }
  pack.feeders = [...byRun].map(([rid, segs]) => {
    const l = segs[0];
    const kv = Number(l.nominalKv);
    const band = lineServeBand(l);
    const lab = band === "mv" ? "MV" : band === "lv380" ? "LV 380" : "LV 220";
    const kvBit = Number.isFinite(kv) ? ` ${kv} kV` : "";
    return {
      id: `f-${rid}`,
      runId: rid,
      cluster: band === "mv" ? "east" : band === "lv380" ? "market" : "south",
      label: `${lab}${kvBit} · ${segs.length} span${segs.length === 1 ? "" : "s"}`,
      x: l.x,
      z: l.z,
    };
  });
  return pack;
}

export function emptyLivePack() {
  return {
    houses: [],
    feeders: [],
    boards: [],
    leaks: [],
    outages: [],
    vendors: [],
    dtms: [],
    usb: { x: 0, z: 0 },
    pvNameplateW: 0,
    xfmrCapW: 0,
    houseMap: {},
    boardMap: {},
  };
}

/**
 * @param {object[]} placed
 */
export function buildSeededLive(placed) {
  const list = placed || [];
  const customers = list.filter((p) => p.assetClass === "customer");
  if (!customers.length) return emptyLivePack();

  const lines = list.filter((p) => p.kind === "line" && p.assetClass !== "service");
  const byLine = Object.fromEntries(lines.map((l) => [l.id, l]));
  const gen = list.find((p) => p.assetClass === "gen");
  const station = list.find((p) => p.assetClass === "station" || p.assetClass === "xfmr");
  const usb = gen || station || { x: customers[0].x, z: customers[0].z };

  const feederOfLine = {};
  for (const l of lines) {
    const band = lineServeBand(l);
    if (band === "mv") continue;
    if (band === "lv380") feederOfLine[l.id] = l.id;
    else {
      const parent = nearestLv380(l, lines);
      feederOfLine[l.id] = parent?.id || l.id;
    }
  }

  const houses = customers.map((c, i) => {
    const useClass = c.useClass || "residential";
    const line = byLine[c.lineId];
    const feederKey = (line && (line.runId || feederOfLine[line.id])) || c.lineId || "lat";
    const money = walletPlan(useClass, i);
    const loud = useClass !== "residential" ? i % 6 === 0 : i % 14 === 0;
    const band = bandWatts(useClass);
    return {
      id: `h${i}`,
      assetId: c.id,
      name: houseName(useClass, i),
      serial: `SM-${String(i).padStart(4, "0")}`,
      x: c.x,
      z: c.z,
      cluster: clusterOf(useClass),
      feederId: `f-${feederKey}`,
      lineId: c.lineId,
      xfmrId: `xf-f-${feederKey}`,
      boardIdx: 0,
      useClass,
      nominalKv: c.nominalKv,
      startCredit: money.startCredit,
      payments: [{ min: money.payMin, amount: money.pay }],
      loadLimitW: loadLimitW(useClass),
      ...band,
      phase: ["A", "B", "C"][i % 3],
      vendorId: useClass === "market" || useClass === "commercial" ? "v-kiosk" : `v-agent-${clusterOf(useClass)}`,
      loud,
      ...traitsFor(useClass, i),
    };
  });

  const feederIds = [...new Set(houses.map((h) => h.feederId))];
  const feeders = feederIds.map((id) => {
    const hs = houses.filter((h) => h.feederId === id);
    const key = id.replace(/^f-/, "");
    const line = byLine[key] || lines.find((l) => l.runId === key);
    const cluster = hs[0]?.cluster || "south";
    const kv = line ? Number(line.nominalKv) || (lineServeBand(line) === "lv380" ? 0.38 : 0.22) : 0.22;
    return {
      id,
      runId: line?.runId || key,
      cluster,
      label: `${kv >= 0.3 ? "LV 380" : "LV 220"} · ${hs.length} cust`,
      x: line?.x ?? hs[0].x,
      z: line?.z ?? hs[0].z,
    };
  });

  const boards = [];
  const houseMap = {};
  for (const h of houses) houseMap[h.id] = h.assetId;

  for (const f of feeders) {
    const hs = houses.filter((h) => h.feederId === f.id);
    const groups = new Map();
    for (const h of hs) {
      const key = h.lineId || "_";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(h);
    }
    let idx = 0;
    for (const [lineId, row] of groups) {
      const line = byLine[lineId];
      row.sort((a, b) => (line ? alongT(a, line) - alongT(b, line) : a.x - b.x));
      const chunk = Math.max(4, Math.min(8, Math.ceil(row.length / Math.max(1, Math.ceil(row.length / 7)))));
      for (let s = 0; s < row.length; s += chunk) {
        const part = row.slice(s, s + chunk);
        const id = `ems-${f.id}-${idx}`;
        const mx = part.reduce((n, h) => n + h.x, 0) / part.length;
        const mz = part.reduce((n, h) => n + h.z, 0) / part.length;
        boards.push({
          id,
          feederId: f.id,
          xfmrId: part[0].xfmrId,
          cluster: part[0].cluster,
          boardIdx: idx,
          x: mx,
          z: mz,
          houseIds: part.map((h) => h.id),
          label: `MeshEMS · ${part[0].cluster} ${idx + 1}`,
        });
        for (const h of part) {
          h.boardId = id;
          h.boardIdx = idx;
        }
        idx += 1;
      }
    }
  }

  const dtms = feeders.map((f) => ({
    id: `dtm-${f.id}`,
    feederId: f.id,
    cluster: f.cluster,
    x: f.x + 0.8,
    z: f.z + 0.5,
    label: `DTM · ${f.label}`,
  }));

  const vendors = [
    { id: "v-kiosk", label: "market kiosk", x: usb.x + 4, z: usb.z + 2, kind: "kiosk" },
    ...feeders.map((f) => ({
      id: `v-agent-${f.cluster}`,
      label: `${f.cluster} agent`,
      x: f.x + 1.4,
      z: f.z - 1.1,
      kind: "agent",
    })),
  ];

  const byFeederN = feeders.slice().sort((a, b) => houses.filter((h) => h.feederId === b.id).length - houses.filter((h) => h.feederId === a.id).length);
  const marketF = feeders.find((f) => f.cluster === "market") || byFeederN[0];
  const westF = feeders.find((f) => f.cluster === "west") || byFeederN[1] || byFeederN[0];
  const outages = [];
  if (byFeederN[0]) {
    outages.push({
      id: "o-seed-am",
      min: 8 * 60,
      restore: 9 * 60 + 15,
      feederId: westF.id,
      xfmrId: null,
      kind: "line",
      note: "LV lateral open · tree on 220 V run",
      x: westF.x,
      z: westF.z,
      label: westF.label,
    });
  }
  if (station || gen) {
    const xf = station || gen;
    const fid = byFeederN[0]?.id;
    outages.push({
      id: "o-seed-xfmr",
      min: 11 * 60 + 30,
      restore: 12 * 60 + 45,
      feederId: null,
      xfmrId: fid ? `xf-${fid}` : null,
      kind: "xfmr",
      note: "Pole xfmr over-temp · midday farm / shop load",
      x: xf.x,
      z: xf.z,
      label: "LV xfmr",
    });
  } else if (byFeederN[1]) {
    outages.push({
      id: "o-seed-mid",
      min: 11 * 60 + 30,
      restore: 12 * 60 + 40,
      feederId: byFeederN[1].id,
      xfmrId: null,
      kind: "line",
      note: "Fuse at takeoff · midday",
      x: byFeederN[1].x,
      z: byFeederN[1].z,
      label: byFeederN[1].label,
    });
  }
  if (marketF) {
    outages.push({
      id: "o-seed-eve",
      min: 17 * 60,
      restore: 18 * 60 + 30,
      feederId: marketF.id,
      xfmrId: null,
      kind: "overload",
      note: "Evening cooking / stall overload on LV",
      x: marketF.x,
      z: marketF.z,
      label: marketF.label,
    });
  }

  function boardsOn(fid) {
    return boards.filter((b) => b.feederId === fid).sort((a, b) => (a.boardIdx ?? 0) - (b.boardIdx ?? 0));
  }
  function leakSpan(fid, i, j, spec) {
    const row = boardsOn(fid);
    const a = row[i] || row[0];
    const b = row[j] || row[row.length - 1] || a;
    if (!a) return null;
    return {
      ...spec,
      feederId: fid,
      fromBoardId: a.id,
      toBoardId: b.id,
      fromIdx: a.boardIdx ?? i,
      toIdx: b.boardIdx ?? j,
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      label: `${a.label} → ${b.label}`,
    };
  }

  const leaks = [
    leakSpan(westF?.id, 0, 1, {
      id: "lk-seed-earth",
      min: 5 * 60 + 30,
      restore: 8 * 60,
      leakW: 180,
      kind: "earth",
      note: "Earth leak (wet insulation) · MeshEMS ΔP on LV",
    }),
    leakSpan(byFeederN[0]?.id, 0, Math.min(1, Math.max(0, boardsOn(byFeederN[0]?.id).length - 1)), {
      id: "lk-seed-tap",
      min: 9 * 60 + 45,
      restore: 13 * 60 + 20,
      leakW: 360,
      kind: "tap",
      note: "Illegal tap · upstream − downstream − billed laterals",
    }),
    leakSpan(marketF?.id, 0, 1, {
      id: "lk-seed-market",
      min: 18 * 60 + 45,
      restore: 21 * 60 + 30,
      leakW: 520,
      kind: "unmetered",
      note: "Unmetered evening stall · ΔP only on this MeshEMS span",
    }),
  ].filter((lk) => lk && lk.fromBoardId);

  const seen = new Set();
  const uniqLeaks = leaks.filter((lk) => {
    const k = `${lk.feederId}:${lk.fromBoardId}:${lk.toBoardId}:${lk.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const byId = Object.fromEntries(houses.map((h) => [h.id, h]));
  const hopsToUsb = (houseId) => {
    const h = byId[houseId];
    if (!h) return 9;
    const d = Math.hypot(h.x - usb.x, h.z - usb.z);
    if (d < 10) return 1;
    if (d < 22) return 2;
    if (d < 36) return 3;
    return 4;
  };

  const kva = Number(station?.kva || gen?.kva);
  const pvNameplateW = Number.isFinite(kva) && kva > 0 ? Math.round(kva * 1000) : Math.max(8000, houses.length * 220);

  return {
    houses,
    feeders,
    boards,
    leaks: uniqLeaks,
    outages,
    vendors,
    dtms,
    usb: { x: usb.x, z: usb.z },
    pvNameplateW,
    xfmrCapW: Math.max(pvNameplateW, houses.reduce((s, h) => s + (h.loadLimitW || 240), 0)),
    hopsToUsb,
    nextTowardUsb: () => "usb",
    houseMap,
    boardMap: {},
  };
}
