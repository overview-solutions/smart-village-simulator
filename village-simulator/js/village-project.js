/**
 * Village project documents — BUILD overlay + maps + feed configs.
 * Stored in localStorage; import/export as JSON or GeoJSON FeatureCollection.
 */

const STORAGE_KEY = "isv-village-projects-v1";
const DOC_KIND = "isv.village.project";
const DOC_VERSION = 1;

function uid() {
  return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** @returns {{ projects: Record<string, object>, recentId: string | null }} */
export function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: {}, recentId: null };
    const parsed = JSON.parse(raw);
    return {
      projects: parsed.projects && typeof parsed.projects === "object" ? parsed.projects : {},
      recentId: parsed.recentId || null,
    };
  } catch {
    return { projects: {}, recentId: null };
  }
}

function writeStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listProjects() {
  const { projects, recentId } = readStore();
  return Object.values(projects)
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((p) => ({
      id: p.id,
      name: p.name,
      siteId: p.siteId,
      updatedAt: p.updatedAt,
      assetCount: Array.isArray(p.build?.placed) ? p.build.placed.length : 0,
      recent: p.id === recentId,
    }));
}

export function getProject(id) {
  return readStore().projects[id] || null;
}

export function blankProject({
  name = "Untitled village",
  siteId = "voundou",
  homes = 200,
  emptyScene = false,
  origin = null,
} = {}) {
  const id = uid();
  const t = nowIso();
  return {
    kind: DOC_KIND,
    version: DOC_VERSION,
    id,
    name,
    siteId,
    homes,
    emptyScene: !!emptyScene,
    origin: origin || null,
    createdAt: t,
    updatedAt: t,
    build: {
      placed: [],
      configs: {},
      houseMap: {},
      boardMap: {},
      seq: 0,
      batchSeq: 0,
    },
  };
}

export function saveProject(doc) {
  if (!doc?.id) throw new Error("Project needs an id");
  const store = readStore();
  const next = {
    ...doc,
    kind: DOC_KIND,
    version: DOC_VERSION,
    updatedAt: nowIso(),
  };
  store.projects[doc.id] = next;
  store.recentId = doc.id;
  writeStore(store);
  return next;
}

export function deleteProject(id) {
  const store = readStore();
  delete store.projects[id];
  if (store.recentId === id) store.recentId = null;
  writeStore(store);
}

export function downloadText(text, filename, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(obj, filename) {
  downloadText(`${JSON.stringify(obj, null, 2)}\n`, filename, "application/json");
}

/** @param {File} file */
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result || "")));
      } catch (err) {
        reject(new Error(`${file.name}: invalid JSON`));
      }
    };
    reader.readAsText(file);
  });
}

export function slugName(name) {
  return String(name || "village")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "village";
}

/**
 * BUILD placed records → GeoJSON FeatureCollection (local ENU metres in props + coords).
 * @param {object[]} placed
 * @param {{ name?: string, siteId?: string }} meta
 */
export function placedToGeoJSON(placed, meta = {}) {
  const features = (placed || []).map((rec) => {
    const props = {
      id: rec.id,
      assetClass: rec.assetClass,
      assetGroup: rec.assetGroup,
      kind: rec.kind,
      uid: rec.uid || undefined,
      globalId: rec.globalId || rec.uid || undefined,
      structureId: rec.structureId || undefined,
      fromId: rec.fromId || undefined,
      toId: rec.toId || undefined,
      nominalKv: rec.nominalKv != null ? rec.nominalKv : undefined,
      mounted: rec.mounted || undefined,
      useClass: rec.useClass || undefined,
      lineId: rec.lineId || undefined,
      seeded: rec.seeded || undefined,
      runId: rec.runId || undefined,
      lineClass: rec.lineClass || undefined,
      x: rec.x,
      z: rec.z,
    };
    if (rec.kind === "line") {
      props.bx = rec.bx;
      props.bz = rec.bz;
      return {
        type: "Feature",
        id: rec.id,
        properties: props,
        geometry: {
          type: "LineString",
          coordinates: [
            [rec.x, rec.z],
            [rec.bx, rec.bz],
          ],
        },
      };
    }
    return {
      type: "Feature",
      id: rec.id,
      properties: props,
      geometry: { type: "Point", coordinates: [rec.x, rec.z] },
    };
  });
  return {
    type: "FeatureCollection",
    name: meta.name || "build-overlay",
    properties: {
      kind: "isv.build.overlay",
      siteId: meta.siteId || "blank",
      emptyScene: meta.emptyScene !== false,
      origin: meta.origin || null,
      exportedAt: nowIso(),
    },
    features,
  };
}

/** @param {object} fc GeoJSON FeatureCollection */
export function geoJsonToPlaced(fc) {
  if (!fc || fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection");
  }
  const placed = [];
  let seq = 0;
  for (const f of fc.features) {
    const p = f.properties || {};
    const assetClass = p.assetClass || p.asset || "pole";
    const id = p.id || f.id || `build-${assetClass}-${++seq}`;
    const geom = f.geometry;
    if (geom?.type === "LineString" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
      const a = geom.coordinates[0];
      const b = geom.coordinates[geom.coordinates.length - 1];
      placed.push({
        id,
        assetClass,
        assetGroup: p.assetGroup || "line",
        kind: "line",
        x: Number(p.x ?? a[0]),
        z: Number(p.z ?? a[1]),
        bx: Number(p.bx ?? b[0]),
        bz: Number(p.bz ?? b[1]),
        uid: p.uid || p.globalId || "",
        globalId: p.globalId || p.uid || undefined,
        fromId: p.fromId,
        toId: p.toId,
        structureId: p.structureId,
        nominalKv: p.nominalKv != null ? Number(p.nominalKv) : undefined,
        runId: p.runId || undefined,
        lineClass: p.lineClass || undefined,
      });
    } else if (geom?.type === "Point" && Array.isArray(geom.coordinates)) {
      placed.push({
        id,
        assetClass,
        assetGroup: p.assetGroup || "structure",
        kind: p.kind || "point",
        x: Number(p.x ?? geom.coordinates[0]),
        z: Number(p.z ?? geom.coordinates[1]),
        uid: p.uid || p.globalId || "",
        globalId: p.globalId || p.uid || undefined,
        structureId: p.structureId,
        mounted: p.mounted,
        useClass: p.useClass,
        lineId: p.lineId,
        seeded: !!p.seeded,
        runId: p.runId || undefined,
        lineClass: p.lineClass || undefined,
      });
    }
  }
  return { placed, seq: Math.max(seq, placed.length) };
}

/**
 * Normalize imported JSON into a project doc (or null if unrecognized).
 * @param {object} data
 * @param {{ siteId?: string, homes?: number, fileName?: string }} ctx
 */
export function normalizeImport(data, ctx = {}) {
  if (!data || typeof data !== "object") throw new Error("Empty import");

  if (data.kind === DOC_KIND || (data.build && Array.isArray(data.build.placed))) {
    const id = data.id && String(data.id).startsWith("proj-") ? data.id : uid();
    return {
      ...blankProject({
        name: data.name || ctx.fileName || "Imported project",
        siteId: data.siteId || ctx.siteId || "voundou",
        homes: data.homes || ctx.homes || 200,
      }),
      ...data,
      id,
      kind: DOC_KIND,
      version: DOC_VERSION,
      updatedAt: nowIso(),
    };
  }

  if (data.type === "FeatureCollection") {
    const { placed, seq } = geoJsonToPlaced(data);
    const name =
      data.name ||
      data.properties?.name ||
      ctx.fileName?.replace(/\.(geo)?json$/i, "") ||
      "Imported GeoJSON";
    const overlay = data.properties?.kind === "isv.build.overlay" || placed.length > 0;
    const siteId = data.properties?.siteId || (overlay ? "blank" : ctx.siteId) || "blank";
    const emptyScene = data.properties?.emptyScene !== false && (siteId === "blank" || overlay);
    const doc = blankProject({
      name,
      siteId,
      homes: ctx.homes || 200,
      emptyScene,
      origin: data.properties?.origin || ctx.origin || null,
    });
    doc.build = {
      placed,
      configs: {},
      houseMap: {},
      boardMap: {},
      seq,
      batchSeq: 0,
    };
    return doc;
  }

  throw new Error("Unrecognized file — use project JSON or GeoJSON FeatureCollection");
}
