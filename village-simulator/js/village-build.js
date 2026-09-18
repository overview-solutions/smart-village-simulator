/**
 * BUILD mode — palette of every UN-style asset type; click map to place.
 * Overlay only (does not mutate procedural HOUSES / GRID_SEGS sim state).
 */

import * as THREE from "three";

/** @typedef {{ id: string, group: string, label: string, kind: 'point'|'line'|'area', color: number, hang: number }} AssetDef */

/** Every asset class from villages/_schema/asset-types.json */
export const BUILD_ASSETS = /** @type {AssetDef[]} */ ([
  // structure
  { id: "pole", group: "structure", label: "Pole", kind: "point", color: 0x79624b, hang: 1.4 },
  { id: "cabinet", group: "structure", label: "Cabinet", kind: "point", color: 0x4a5568, hang: 0.55 },
  { id: "pad", group: "structure", label: "Pad", kind: "point", color: 0x6b7280, hang: 0.08 },
  { id: "enclosure", group: "structure", label: "Enclosure", kind: "point", color: 0x374151, hang: 0.7 },
  // electric_device
  { id: "meter", group: "device", label: "Meter", kind: "point", color: 0x6b2d5c, hang: 1.1 },
  { id: "breaker", group: "device", label: "Breaker", kind: "point", color: 0xb42318, hang: 1.2 },
  { id: "fuse", group: "device", label: "Fuse", kind: "point", color: 0xba7517, hang: 1.15 },
  { id: "disconnect", group: "device", label: "Disconnect", kind: "point", color: 0xc45b5b, hang: 1.2 },
  { id: "recloser", group: "device", label: "Recloser", kind: "point", color: 0x9b1c1c, hang: 1.35 },
  { id: "inverter", group: "device", label: "Inverter", kind: "point", color: 0x175cd3, hang: 0.45 },
  { id: "bess", group: "device", label: "BESS", kind: "point", color: 0x2bb6a3, hang: 0.5 },
  { id: "ems", group: "device", label: "EMS", kind: "point", color: 0x0b6e4f, hang: 1.3 },
  { id: "dtm", group: "device", label: "DTM", kind: "point", color: 0x2bb6a3, hang: 3.0 },
  { id: "gen", group: "device", label: "Gen", kind: "point", color: 0x3d5a3d, hang: 0.4 },
  { id: "xfmr", group: "device", label: "Xfmr", kind: "point", color: 0xc9a227, hang: 2.0 },
  { id: "station", group: "device", label: "Station", kind: "point", color: 0xc9a227, hang: 2.0 },
  // electric_junction
  { id: "bus", group: "junction", label: "Bus", kind: "point", color: 0x7a4419, hang: 1.0 },
  { id: "splice", group: "junction", label: "Splice", kind: "point", color: 0x8a8a82, hang: 1.6 },
  { id: "service_point", group: "junction", label: "Service pt", kind: "point", color: 0x5c7cfa, hang: 0.15 },
  { id: "tap", group: "junction", label: "Tap", kind: "point", color: 0xba7517, hang: 1.5 },
  // electric_line
  { id: "trunk", group: "line", label: "Trunk", kind: "line", color: 0x0b6e4f, hang: 2.8 },
  { id: "primary", group: "line", label: "Primary", kind: "line", color: 0x1d4e89, hang: 2.8 },
  { id: "secondary", group: "line", label: "Secondary", kind: "line", color: 0x7a4419, hang: 1.8 },
  { id: "service", group: "line", label: "Service", kind: "line", color: 0x6b2d5c, hang: 1.8 },
  { id: "neutral", group: "line", label: "Neutral", kind: "line", color: 0x6b7280, hang: 1.6 },
  // subnetwork
  { id: "island", group: "subnetwork", label: "Island", kind: "area", color: 0x3d5a3d, hang: 0.05 },
  { id: "feeder", group: "subnetwork", label: "Feeder", kind: "area", color: 0x1d4e89, hang: 0.05 },
]);

const byId = Object.fromEntries(BUILD_ASSETS.map((a) => [a.id, a]));

/** Feed kinds from villages/_schema/feeds.schema.json */
export const FEED_KINDS = {
  mqtt_sunspec: {
    label: "MQTT SunSpec",
    fields: [
      { key: "brokerRef", label: "Broker ref", placeholder: "env:MQTT_URL" },
      { key: "topic", label: "Topic", placeholder: "openami/…/ems" },
      { key: "model", label: "Model", placeholder: "SunSpec" },
    ],
    required: ["topic"],
  },
  rest_json: {
    label: "REST JSON",
    fields: [
      { key: "urlTemplate", label: "URL template", placeholder: "https://…/{id}" },
      { key: "pollSec", label: "Poll (sec)", placeholder: "60" },
      { key: "authRef", label: "Auth ref", placeholder: "env:TOKEN" },
    ],
    required: ["urlTemplate"],
  },
  dlms: {
    label: "DLMS",
    fields: [
      { key: "deviceRef", label: "Device ref", placeholder: "dlms://…" },
      { key: "obis", label: "OBIS", placeholder: "1.8.0" },
      { key: "authRef", label: "Auth ref", placeholder: "env:DLMS" },
    ],
    required: ["deviceRef"],
  },
  openpaygo: {
    label: "OpenPAYGO",
    fields: [
      { key: "deviceId", label: "Device id", placeholder: "meter-id" },
      { key: "tokenApiRef", label: "Token API ref", placeholder: "env:OPENPAYGO" },
    ],
    required: ["deviceId"],
  },
  groundbolt: {
    label: "GroundBolt",
    fields: [
      { key: "siteRef", label: "Site ref", placeholder: "site" },
      { key: "meterRef", label: "Meter ref", placeholder: "m-…" },
    ],
    required: ["meterRef"],
  },
  sim: {
    label: "Sim (local)",
    fields: [{ key: "scenarioId", label: "Scenario id", placeholder: "demo-prepaid" }],
    required: ["scenarioId"],
  },
};

export function feedConfigComplete(cfg) {
  if (!cfg?.kind || !FEED_KINDS[cfg.kind]) return false;
  return FEED_KINDS[cfg.kind].required.every((k) => String(cfg[k] ?? "").trim() !== "");
}

const ICONS = {
  pole: "M12 3v14M9 17h6M12 7h.01",
  cabinet: "M7 4h10v16H7zM7 10h10",
  pad: "M5 16h14v3H5zM7 16V9h10v7",
  enclosure: "M6 5h12v14H6zM9 9h6v6H9z",
  meter: "M8 4h8v16H8zM10 8h4M10 12h4M10 16h3",
  breaker: "M8 5h8v4H8zM12 9v6M9 15h6",
  fuse: "M10 4h4v16h-4zM12 8v8",
  disconnect: "M7 8h10M7 12h10M12 8v8",
  recloser: "M12 4a6 6 0 0 1 0 12 6 6 0 0 1 0-12M12 10v6",
  inverter: "M5 8h14v8H5zM8 12h8M9 8V5h6v3",
  bess: "M7 7h10v12H7zM10 4h4v3h-4z",
  ems: "M6 6h12v12H6zM9 9h6v6H9zM12 3v3",
  dtm: "M12 3v4M8 7h8l-1 12H9L8 7z",
  gen: "M12 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10M12 8v4l2 1",
  xfmr: "M8 6h8v4H8zM9 10v8M15 10v8M7 18h10",
  station: "M5 18V9l7-5 7 5v9H5zM10 18v-5h4v5",
  bus: "M5 11h14M5 14h14M8 8v10M16 8v10",
  splice: "M8 12h8M12 8v8M9 9l6 6M15 9l-6 6",
  service_point: "M12 18V9M9 12l3-3 3 3M8 18h8",
  tap: "M12 5v14M8 12h8M12 12l4-4",
  trunk: "M4 12h16M6 9l-2 3 2 3M18 9l2 3-2 3",
  primary: "M4 10h16M4 14h16",
  secondary: "M4 12h16M7 9v6M17 9v6",
  service: "M5 12h14M12 8v8",
  neutral: "M5 12h14M8 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  island: "M12 4l7 4v8l-7 4-7-4V8l7-4z",
  feeder: "M6 6h12v4H6zM8 10v8M16 10v8M10 14h4",
};

function svgIcon(pathD) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${pathD}"/></svg>`;
}

/**
 * @param {{
 *   scene: THREE.Scene,
 *   groundAt: (clientX: number, clientY: number) => { x: number, z: number } | null,
 *   toolbarEl: HTMLElement,
 *   hintEl?: HTMLElement | null,
 *   onChange?: () => void,
 * }} opts
 */
export function createBuildMode(opts) {
  const { scene, groundAt, toolbarEl, hintEl, onChange } = opts;

  const state = {
    active: false,
    tool: /** @type {string | null} */ (null),
    pendingLine: /** @type {{ x: number, z: number } | null} */ (null),
    placed: /** @type {any[]} */ ([]),
    seq: 0,
    /** houseId → placed asset id */
    houseMap: /** @type {Record<string, string>} */ ({}),
    /** boardId → placed asset id */
    boardMap: /** @type {Record<string, string>} */ ({}),
    /** assetId → feed config */
    configs: /** @type {Record<string, Record<string, string>>} */ ({}),
    selectedAssetId: /** @type {string | null} */ (null),
    pendingHouseId: /** @type {string | null} */ (null),
    pendingBoardId: /** @type {string | null} */ (null),
  };

  const root = new THREE.Group();
  root.name = "build-layer";
  scene.add(root);

  const ghost = new THREE.Group();
  ghost.visible = false;
  root.add(ghost);

  function bump() {
    onChange?.();
  }

  function def() {
    return state.tool ? byId[state.tool] : null;
  }

  function setHint(msg) {
    if (hintEl) hintEl.textContent = msg || "";
  }

  function findPlaced(id) {
    return state.placed.find((p) => p.id === id) || null;
  }

  function assetConfigured(assetId) {
    return feedConfigComplete(state.configs[assetId]);
  }

  /** @returns {'red'|'green'} */
  function houseStatus(houseId) {
    const aid = state.houseMap[houseId];
    if (!aid || !findPlaced(aid)) return "red";
    return assetConfigured(aid) ? "green" : "red";
  }

  /** @returns {'red'|'green'} */
  function boardStatus(boardId) {
    const aid = state.boardMap[boardId];
    if (!aid || !findPlaced(aid)) return "red";
    return assetConfigured(aid) ? "green" : "red";
  }

  function syncToggle() {
    toolbarEl.hidden = !state.active;
    toolbarEl.setAttribute("aria-hidden", state.active ? "false" : "true");
    if (hintEl) {
      hintEl.hidden = !state.active;
      hintEl.setAttribute("aria-hidden", state.active ? "false" : "true");
    }
    if (!state.active) {
      state.tool = null;
      state.pendingLine = null;
      ghost.visible = false;
      setHint("");
      syncTools();
    } else {
      setHint(state.tool ? hintForTool() : "Pick an asset, then click the map. Grid cell = map meter.");
    }
  }

  function setActive(on) {
    state.active = !!on;
    if (!state.active) state.pendingLine = null;
    syncToggle();
    bump();
  }

  function hintForTool() {
    const d = def();
    if (!d) return "Pick an asset, then click the map.";
    if (d.kind === "line") {
      return state.pendingLine
        ? `${d.label}: click end point (Esc cancels)`
        : `${d.label}: click start, then end`;
    }
    if (d.kind === "area") return `${d.label}: click center on map`;
    return `${d.label}: click map to place`;
  }

  function syncTools() {
    toolbarEl.querySelectorAll("[data-build-asset]").forEach((btn) => {
      const id = btn.getAttribute("data-build-asset");
      btn.classList.toggle("on", state.active && state.tool === id);
    });
  }

  function makeMesh(asset, x, z, extra = {}) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.userData = { build: true, assetId: asset.id, ...extra };

    if (asset.kind === "line" && extra.bx != null) {
      const dx = extra.bx - x;
      const dz = extra.bz - z;
      const len = Math.hypot(dx, dz) || 0.2;
      const y = asset.hang;
      const geo = new THREE.CylinderGeometry(0.04, 0.04, len, 6);
      const mat = new THREE.MeshLambertMaterial({ color: asset.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(dx / 2, y, dz / 2);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(dx, 0, dz).normalize(),
      );
      g.add(mesh);
      return g;
    }

    if (asset.kind === "area") {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(asset.id === "island" ? 4.5 : 3.2, 28),
        new THREE.MeshBasicMaterial({
          color: asset.color,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.04;
      g.add(disc);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(asset.id === "island" ? 4.3 : 3.0, asset.id === "island" ? 4.5 : 3.2, 28),
        new THREE.MeshBasicMaterial({ color: asset.color, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 10),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      pin.position.y = 0.35;
      g.add(pin);
      return g;
    }

    // point assets
    let mesh;
    if (asset.id === "pole") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.1, 2.8, 6),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 1.4;
    } else if (asset.id === "xfmr" || asset.id === "station") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 0.65, 10),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    } else if (asset.id === "cabinet" || asset.id === "enclosure" || asset.id === "ems" || asset.id === "bess") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.85, 0.4),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 0.45;
    } else if (asset.id === "pad") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.08, 1.4),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 0.04;
    } else if (asset.id === "gen") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.7, 12),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = 0.35;
    } else if (asset.id === "dtm") {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.55, 8),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    } else if (asset.group === "junction") {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    } else {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 10),
        new THREE.MeshLambertMaterial({ color: asset.color }),
      );
      mesh.position.y = asset.hang;
    }
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }

  function rebuildGhost() {
    while (ghost.children.length) {
      const c = ghost.children.pop();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
    const d = def();
    if (!d || !state.active) {
      ghost.visible = false;
      return;
    }
    const sample = makeMesh(d, 0, 0, d.kind === "line" ? { bx: 2, bz: 0 } : {});
    while (sample.children.length) ghost.add(sample.children[0]);
    ghost.visible = false;
  }

  function placeRecord(rec) {
    state.placed.push(rec);
    const d = byId[rec.assetClass];
    const mesh = makeMesh(
      d,
      rec.x,
      rec.z,
      rec.kind === "line" ? { bx: rec.bx, bz: rec.bz } : {},
    );
    mesh.userData.recordId = rec.id;
    root.add(mesh);
    state.selectedAssetId = rec.id;
    if ((rec.assetClass === "meter" || rec.assetClass === "service_point") && state.pendingHouseId) {
      state.houseMap[state.pendingHouseId] = rec.id;
      setHint(`Mapped ${state.pendingHouseId} → ${rec.assetClass}. Configure API feed.`);
      state.pendingHouseId = null;
    } else if (rec.assetClass === "ems" && state.pendingBoardId) {
      state.boardMap[state.pendingBoardId] = rec.id;
      setHint(`Mapped EMS ${state.pendingBoardId} → placed cabinet. Configure API feed.`);
      state.pendingBoardId = null;
    }
    bump();
  }

  function handleMapClick(clientX, clientY) {
    if (!state.active || !state.tool) return false;
    const d = def();
    if (!d) return false;
    const pt = groundAt(clientX, clientY);
    if (!pt) return true;

    if (d.kind === "line") {
      if (!state.pendingLine) {
        state.pendingLine = { x: pt.x, z: pt.z };
        setHint(hintForTool());
        return true;
      }
      const a = state.pendingLine;
      state.pendingLine = null;
      state.seq += 1;
      placeRecord({
        id: `build-${d.id}-${state.seq}`,
        assetClass: d.id,
        assetGroup: d.group,
        kind: "line",
        x: a.x,
        z: a.z,
        bx: pt.x,
        bz: pt.z,
      });
      setHint(hintForTool());
      return true;
    }

    state.seq += 1;
    placeRecord({
      id: `build-${d.id}-${state.seq}`,
      assetClass: d.id,
      assetGroup: d.group,
      kind: d.kind,
      x: pt.x,
      z: pt.z,
    });
    setHint(`${d.label} placed · configure feed in right panel`);
    return true;
  }

  function renderToolbar() {
    const groups = [
      ["structure", "Structure"],
      ["device", "Devices"],
      ["junction", "Junctions"],
      ["line", "Lines"],
      ["subnetwork", "Subnetworks"],
    ];
    toolbarEl.innerHTML = "";
    toolbarEl.className = "wl-build-bar";
    for (const [gid, title] of groups) {
      const row = document.createElement("div");
      row.className = "wl-build-group";
      const lab = document.createElement("span");
      lab.className = "wl-build-group-lab";
      lab.textContent = title;
      row.appendChild(lab);
      const tools = document.createElement("div");
      tools.className = "wl-build-tools";
      for (const a of BUILD_ASSETS.filter((x) => x.group === gid)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wl-build-tool";
        btn.dataset.buildAsset = a.id;
        btn.title = `${a.label}${a.kind === "line" ? " (2 clicks)" : ""}`;
        btn.setAttribute("aria-label", a.label);
        btn.innerHTML = svgIcon(ICONS[a.id] || ICONS.pole);
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!state.active) setActive(true);
          state.tool = state.tool === a.id ? null : a.id;
          state.pendingLine = null;
          rebuildGhost();
          syncTools();
          setHint(hintForTool());
        });
        tools.appendChild(btn);
      }
      row.appendChild(tools);
      toolbarEl.appendChild(row);
    }
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "wl-build-undo";
    undo.textContent = "Undo last";
    undo.title = "Remove last placed build asset";
    undo.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const last = state.placed.pop();
      if (!last) return;
      const obj = root.children.find((c) => c.userData?.recordId === last.id);
      if (obj) {
        root.remove(obj);
        obj.traverse((o) => {
          o.geometry?.dispose?.();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material.dispose?.();
          }
        });
      }
      for (const [hid, aid] of Object.entries(state.houseMap)) {
        if (aid === last.id) delete state.houseMap[hid];
      }
      for (const [bid, aid] of Object.entries(state.boardMap)) {
        if (aid === last.id) delete state.boardMap[bid];
      }
      delete state.configs[last.id];
      if (state.selectedAssetId === last.id) state.selectedAssetId = null;
      setHint(last.assetClass + " removed");
      bump();
    });
    toolbarEl.appendChild(undo);
  }

  window.addEventListener("keydown", (e) => {
    if (!state.active || e.key !== "Escape") return;
    if (state.pendingLine) {
      state.pendingLine = null;
      setHint(hintForTool());
      e.preventDefault();
      return;
    }
    state.tool = null;
    syncTools();
    setHint(hintForTool());
  });

  renderToolbar();
  syncToggle();

  return {
    isActive: () => state.active,
    setActive,
    handleMapClick,
    getPlaced: () => state.placed.slice(),
    houseStatus,
    boardStatus,
    houseMap: () => ({ ...state.houseMap }),
    boardMap: () => ({ ...state.boardMap }),
    getConfig: (assetId) => (state.configs[assetId] ? { ...state.configs[assetId] } : null),
    getSelectedAssetId: () => state.selectedAssetId,
    getPendingHouseId: () => state.pendingHouseId,
    getPendingBoardId: () => state.pendingBoardId,
    selectAsset(assetId) {
      state.selectedAssetId = assetId || null;
      bump();
    },
    /** Click grid cell: select mapped asset, or arm pending house for next meter place / link. */
    focusHouse(houseId) {
      state.pendingBoardId = null;
      const aid = state.houseMap[houseId];
      if (aid && findPlaced(aid)) {
        state.selectedAssetId = aid;
        state.pendingHouseId = null;
        setHint(`Selected meter for ${houseId}. Edit API feed.`);
      } else {
        state.pendingHouseId = houseId;
        state.selectedAssetId = null;
        setHint(`House ${houseId} armed · place a Meter (or Service pt) to map.`);
      }
      bump();
    },
    focusBoard(boardId) {
      state.pendingHouseId = null;
      const aid = state.boardMap[boardId];
      if (aid && findPlaced(aid)) {
        state.selectedAssetId = aid;
        state.pendingBoardId = null;
        setHint(`Selected EMS for ${boardId}. Edit API feed.`);
      } else {
        state.pendingBoardId = boardId;
        state.selectedAssetId = null;
        setHint(`EMS ${boardId} armed · place an EMS cabinet to map.`);
      }
      bump();
    },
    linkSelectedToHouse(houseId) {
      if (!state.selectedAssetId) return false;
      const rec = findPlaced(state.selectedAssetId);
      if (!rec || (rec.assetClass !== "meter" && rec.assetClass !== "service_point")) return false;
      state.houseMap[houseId] = state.selectedAssetId;
      state.pendingHouseId = null;
      setHint(`Linked ${houseId} → ${state.selectedAssetId}`);
      bump();
      return true;
    },
    linkSelectedToBoard(boardId) {
      if (!state.selectedAssetId) return false;
      const rec = findPlaced(state.selectedAssetId);
      if (!rec || rec.assetClass !== "ems") return false;
      state.boardMap[boardId] = state.selectedAssetId;
      state.pendingBoardId = null;
      setHint(`Linked EMS ${boardId} → ${state.selectedAssetId}`);
      bump();
      return true;
    },
    setFeedConfig(assetId, cfg) {
      if (!assetId) return;
      state.configs[assetId] = { ...cfg };
      state.selectedAssetId = assetId;
      bump();
    },
    findPlaced,
  };
}
