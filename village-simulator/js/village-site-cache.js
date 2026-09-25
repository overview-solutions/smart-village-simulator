/**
 * Pin a new site: Overpass OSM extract + local OpenFreeMap pack (via /api/site-pack).
 */

const OSM_SRC = "site-osm";
const OSM_LAYERS = ["site-osm-power", "site-osm-road", "site-osm-build"];

export function siteSlug(lat, lon, name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const pin = `${Number(lat).toFixed(4)}_${Number(lon).toFixed(4)}`.replace(/[.-]/g, "m");
  return n ? `${n}-${pin}` : `site-${pin}`;
}

export function parseLonLat(latRaw, lonRaw) {
  const lat = Number(String(latRaw ?? "").trim());
  const lon = Number(String(lonRaw ?? "").trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** "4.79, 11.53" or "11.53, 4.79" (first |n|>90 ⇒ lon,lat). */
export function parseCoordPair(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b, label: `${a}, ${b}` };
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lon: a, label: `${b}, ${a}` };
  return null;
}

export async function resolvePlace(query) {
  const q = String(query ?? "").trim();
  if (!q) return null;
  const pair = parseCoordPair(q);
  if (pair) return pair;
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `geocode HTTP ${res.status}`);
  }
  const hit = await res.json();
  if (!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lon)) {
    throw new Error(`No place match for “${q}”`);
  }
  return { lat: hit.lat, lon: hit.lon, label: hit.name || q };
}

function osmToGeoJSON(osm) {
  const nodes = new Map();
  for (const el of osm.elements || []) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }
  const features = [];
  for (const el of osm.elements || []) {
    if (el.type === "node" && el.tags && (el.tags.power || el.tags.building)) {
      const c = nodes.get(el.id);
      if (!c) continue;
      features.push({
        type: "Feature",
        properties: { ...el.tags, osmId: `node/${el.id}`, kind: el.tags.power ? "power" : "building" },
        geometry: { type: "Point", coordinates: c },
      });
      continue;
    }
    if (el.type !== "way" || !el.nodes?.length) continue;
    const coords = el.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (coords.length < 2) continue;
    const tags = el.tags || {};
    const closed = coords.length >= 4 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];
    const kind = tags.building ? "building" : tags.power ? "power" : tags.highway ? "highway" : "other";
    features.push({
      type: "Feature",
      properties: { ...tags, osmId: `way/${el.id}`, kind },
      geometry:
        tags.building && closed
          ? { type: "Polygon", coordinates: [coords] }
          : { type: "LineString", coordinates: coords },
    });
  }
  return { type: "FeatureCollection", name: "site-osm", features };
}

export async function fetchSiteOsm(lat, lon, radiusM = 800) {
  const q = `[out:json][timeout:30];
(
  way["building"](around:${radiusM},${lat},${lon});
  way["highway"](around:${radiusM},${lat},${lon});
  way["power"](around:${radiusM},${lat},${lon});
  node["power"](around:${radiusM},${lat},${lon});
);
out body;
>;
out skel qt;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(q)}`,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const osm = await res.json();
  return osmToGeoJSON(osm);
}

export function clearSiteOsmLayers(map) {
  if (!map?.getStyle?.()) return;
  for (const id of OSM_LAYERS) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(OSM_SRC)) map.removeSource(OSM_SRC);
}

export function addSiteOsmLayers(map, fc) {
  if (!map?.isStyleLoaded?.()) return;
  clearSiteOsmLayers(map);
  if (!fc?.features?.length) return;
  map.addSource(OSM_SRC, { type: "geojson", data: fc });
  map.addLayer({
    id: "site-osm-build",
    type: "fill",
    source: OSM_SRC,
    filter: ["==", ["get", "kind"], "building"],
    paint: { "fill-color": "#c4b59a", "fill-opacity": 0.45, "fill-outline-color": "#6b5a42" },
  });
  map.addLayer({
    id: "site-osm-road",
    type: "line",
    source: OSM_SRC,
    filter: ["==", ["get", "kind"], "highway"],
    paint: { "line-color": "#d8c8a0", "line-width": 1.4, "line-opacity": 0.85 },
  });
  map.addLayer({
    id: "site-osm-power",
    type: "line",
    source: OSM_SRC,
    filter: ["==", ["get", "kind"], "power"],
    paint: { "line-color": "#c41e3a", "line-width": 2, "line-opacity": 0.9 },
  });
}

export async function cacheSitePack({ lon, lat, name, km = 2, osm }) {
  const res = await fetch("/api/site-pack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lon, lat, km, name, osm }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `site-pack HTTP ${res.status}`);
  }
  return res.json();
}
