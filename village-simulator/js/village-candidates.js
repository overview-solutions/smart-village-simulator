/**
 * Africa mini-grid candidate layer (Kenya + Zambia historical planning sites).
 * Shown when the camera zooms out past the active village.
 * Data: /data/africa-minigrid-candidates.geojson — eligibility unverified.
 */

import { ORIGIN } from "./geo.js";

const SRC = "mg-candidates";
const LY_CIRCLE = "mg-candidates-circle";
const LY_LABEL = "mg-candidates-label";
const SRC_HOME = "mg-voundou";
const LY_HOME = "mg-voundou-pulse";
const LY_HOME_CORE = "mg-voundou-core";

/** Lon/lat bounds: KE+ZM candidates plus Voundou (CM) active sim. */
export const AFRICA_CANDIDATE_BOUNDS = [
  [10.2, -18.8],
  [42.6, 6.2],
];

/** Angled continent view — pitch high enough to read terrain, bearing across the corridor. */
export const AFRICA_VIEW = {
  pitch: 46,
  bearing: 18,
  maxZoom: 4.85,
  duration: 1.2,
  padding: { top: 52, bottom: 68, left: 44, right: 44 },
};

/**
 * @param {import('maplibre-gl').Map} map
 */
export function createCandidateOverlay(map) {
  let ready = false;
  let visible = false;
  let loadPromise = null;

  map.on("style.load", () => {
    ready = false;
    loadPromise = null;
    if (visible) load();
  });

  function ensureStyle() {
    if (!map.isStyleLoaded()) return false;
    return true;
  }

  async function load() {
    if (ready) return true;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!ensureStyle()) {
        await new Promise((resolve) => map.once("style.load", resolve));
      }
      if (map.getSource(SRC)) {
        ready = true;
        return true;
      }
      const res = await fetch(`${import.meta.env.BASE_URL}data/africa-minigrid-candidates.geojson`);
      if (!res.ok) throw new Error(`candidates HTTP ${res.status}`);
      const data = await res.json();

      map.addSource(SRC, { type: "geojson", data });
      map.addLayer({
        id: LY_CIRCLE,
        type: "circle",
        source: SRC,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            3,
            1.6,
            5,
            3.2,
            7,
            5.5,
          ],
          "circle-color": [
            "match",
            ["get", "country_code"],
            "KE",
            "#bd5e1b",
            "ZM",
            "#087f8c",
            "#6b7280",
          ],
          "circle-opacity": 0.88,
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "#f4f4f0",
        },
      });

      map.addSource(SRC_HOME, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { name: "Voundou · active sim" },
          geometry: { type: "Point", coordinates: [ORIGIN.lon, ORIGIN.lat] },
        },
      });
      map.addLayer({
        id: LY_HOME,
        type: "circle",
        source: SRC_HOME,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            3,
            6,
            6,
            14,
            10,
            22,
          ],
          "circle-color": "#5ee0ff",
          "circle-opacity": 0.22,
          "circle-stroke-width": 0,
        },
      });
      map.addLayer({
        id: LY_HOME_CORE,
        type: "circle",
        source: SRC_HOME,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            3,
            3,
            6,
            6,
            10,
            9,
          ],
          "circle-color": "#5ee0ff",
          "circle-opacity": 0.95,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0b3a44",
        },
      });

      map.on("mouseenter", LY_CIRCLE, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", LY_CIRCLE, () => {
        map.getCanvas().style.cursor = "";
      });

      ready = true;
      if (visible) setVisible(true);
      return true;
    })().catch((err) => {
      loadPromise = null;
      console.warn("[candidates]", err);
      return false;
    });
    return loadPromise;
  }

  function setVisible(on) {
    visible = !!on;
    if (!ready) {
      if (visible) load();
      return;
    }
    const v = visible ? "visible" : "none";
    for (const id of [LY_CIRCLE, LY_HOME, LY_HOME_CORE]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    }
  }

  function isVisible() {
    return visible;
  }

  /**
   * Frame Kenya + Zambia candidates with a readable tilt.
   * @param {{ duration?: number }} [opts]
   */
  function flyToRegion(opts = {}) {
    const dur = (opts.duration ?? AFRICA_VIEW.duration) * 1000;
    setVisible(true);
    map.fitBounds(AFRICA_CANDIDATE_BOUNDS, {
      padding: AFRICA_VIEW.padding,
      maxZoom: AFRICA_VIEW.maxZoom,
      pitch: AFRICA_VIEW.pitch,
      bearing: AFRICA_VIEW.bearing,
      duration: dur,
      essential: true,
    });
  }

  /**
   * Popup HTML for a candidate feature.
   * @param {GeoJSON.Feature} feature
   */
  function popupHtml(feature) {
    const p = feature.properties || {};
    const name = p.name || "Candidate";
    const place = [p.country, p.administrative_area].filter(Boolean).join(" · ");
    return `<div class="mg-pop">
      <strong>${escapeHtml(name)}</strong>
      <p>${escapeHtml(place)}</p>
      <p class="mg-pop-meta">${escapeHtml(p.source_classification || "mini-grid")} · evidence ${escapeHtml(String(p.evidence_date || "—"))}</p>
      <p class="mg-pop-warn">Current eligibility: unverified</p>
    </div>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return {
    load,
    setVisible,
    isVisible,
    flyToRegion,
    popupHtml,
    layerIds: { circle: LY_CIRCLE, home: LY_HOME_CORE },
  };
}
