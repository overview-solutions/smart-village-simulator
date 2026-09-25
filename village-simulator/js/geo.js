/**
 * Schematic WGS84 for the village footprint.
 * Local ENU metres: +X east, −Z north (matches NORTH in layout).
 * Third GeoJSON ordinate is metres above local ground, not Locus time-Y.
 * Conversion primitives come from @circaevum/locus/geo.
 */

import { M_PER_DEG_LAT, enuToLonLat as locusEnuToLonLat, lonLatToEnu as locusLonLatToEnu } from "@circaevum/locus/geo";
import {
  BOARDS,
  DTMS,
  FEEDERS,
  GRID_SEGS,
  HOUSES,
  MAIN_GEN,
  MAIN_XFMR,
  POLES,
  STATIONS,
  TRANSFORMERS,
} from "./village-worldline-layout.js";

export { M_PER_DEG_LAT };

/**
 * Real geographic anchor; all simulated infrastructure is hypothetical.
 * Pin a real lat/lon later by changing these two numbers only.
 */
export const GROUND_SCALE = 8; // metres per legacy schematic ground unit
export const HEIGHT_SCALE = 3; // physical equipment height conversion

export const ORIGIN = {
  lon: 11.53412,
  lat: 4.79209,
  alt: 0,
  name: "Voundou, Cameroon (hypothetical layout)",
  note: "Schematic ISV village. Local metres from here; +X east, −Z north.",
};

const VOUNDOU_PIN = { lon: 11.53412, lat: 4.79209 };

/** Move the village ENU pin. LocusMap._matrix must be rebuilt by the caller. */
export function setVillageOrigin(lon, lat, name) {
  ORIGIN.lon = +lon;
  ORIGIN.lat = +lat;
  if (name) ORIGIN.name = name;
}

export function resetVillageOrigin() {
  ORIGIN.lon = VOUNDOU_PIN.lon;
  ORIGIN.lat = VOUNDOU_PIN.lat;
  ORIGIN.name = "Voundou, Cameroon (hypothetical layout)";
}

/** Schematic equipment elevations, shared by the renderer and GeoJSON export. */
export const HANG = {
  ground: 0,
  secondary: 1.8,
  primary: 2.8,
  trunk: 2.8,
  pole: 2.8,
  xfmr: 2.0,
  ems: 1.3,
  dtm: 3.3,
};

/** Local ENU metres → GeoJSON position [lon, lat, alt]. */
export function enuToLonLat(x, z, h = 0, origin = ORIGIN) {
  return locusEnuToLonLat(x, z, h, origin);
}

function roundM(n) {
  return +Number(n).toFixed(3);
}

function roundDeg(n) {
  return +Number(n).toFixed(8);
}

/** RFC 7946 Point Feature. geometry = WGS84; properties hold local ENU + tags. */
export function geoidBlock(id, kind, x, z, hang = 0, extra = {}) {
  const [lon, lat, alt] = enuToLonLat(x * GROUND_SCALE, z * GROUND_SCALE, hang * HEIGHT_SCALE);
  return {
    type: "Feature",
    id,
    properties: {
      id,
      kind,
      hang: hang * HEIGHT_SCALE,
      x: roundM(x * GROUND_SCALE),
      z: roundM(z * GROUND_SCALE),
      ...extra,
    },
    geometry: {
      type: "Point",
      coordinates: [roundDeg(lon), roundDeg(lat), roundM(alt)],
    },
  };
}

export function geoidCollection(features, name = "ISV village schematic") {
  return {
    type: "FeatureCollection",
    name,
    features,
  };
}

/** GeoJSON position → local ENU metres. */
export function lonLatToEnu(lon, lat, alt = 0, origin = ORIGIN) {
  return locusLonLatToEnu(lon, lat, alt, origin);
}

function point(id, kind, x, z, h, props = {}) {
  return geoidBlock(id, kind, x, z, h, props);
}

function line(id, kind, ax, az, bx, bz, h, props = {}) {
  return {
    type: "Feature",
    id,
    properties: {
      id,
      kind,
      hang: h,
      ax: roundM(ax),
      az: roundM(az),
      bx: roundM(bx),
      bz: roundM(bz),
      ...props,
    },
    geometry: {
      type: "LineString",
      coordinates: [enuToLonLat(ax * GROUND_SCALE, az * GROUND_SCALE, h * HEIGHT_SCALE), enuToLonLat(bx * GROUND_SCALE, bz * GROUND_SCALE, h * HEIGHT_SCALE)].map(([lon, lat, alt]) => [
        roundDeg(lon),
        roundDeg(lat),
        roundM(alt),
      ]),
    },
  };
}

export function villageGeoJSON() {
  const features = [
    point("gen", "gen", MAIN_GEN.x, MAIN_GEN.z, HANG.ground, { label: "gen + solar" }),
    point("xfmr-main", "station", MAIN_XFMR.x, MAIN_XFMR.z, HANG.xfmr, {
      label: STATIONS[0]?.label || "main LV xfmr",
    }),
  ];

  for (const h of HOUSES) {
    features.push(
      point(h.id, "house", h.x, h.z, HANG.ground, {
        name: h.name,
        cluster: h.cluster,
        feederId: h.feederId,
        boardId: h.boardId,
        xfmrId: h.xfmrId,
        phase: h.phase,
      }),
    );
  }
  for (const p of POLES) {
    features.push(
      point(`pole-${features.length}`, "pole", p.x, p.z, HANG.pole, { feederId: p.feederId }),
    );
  }
  for (const t of TRANSFORMERS) {
    features.push(
      point(t.id, "xfmr", t.x, t.z, HANG.xfmr, {
        feederId: t.feederId,
        cluster: t.cluster,
        label: t.label,
      }),
    );
  }
  for (const f of FEEDERS) {
    features.push(point(f.id, "feeder", f.x, f.z, HANG.pole, { cluster: f.cluster, label: f.label }));
  }
  for (const b of BOARDS) {
    features.push(
      point(b.id, "ems", b.x, b.z, HANG.ems, {
        feederId: b.feederId,
        xfmrId: b.xfmrId,
        houseIds: b.houseIds,
        label: b.label,
      }),
    );
  }
  for (const d of DTMS) {
    features.push(
      point(d.id, "dtm", d.x, d.z, HANG.dtm, { feederId: d.feederId, label: d.label }),
    );
  }
  GRID_SEGS.forEach((s, i) => {
    const h = HANG[s.kind] ?? HANG.secondary;
    features.push(
      line(`seg-${i}`, s.kind, s.ax, s.az, s.bx, s.bz, h, {
        feederId: s.feederId,
        xfmrId: s.xfmrId,
        houseId: s.houseId,
        capW: s.capW,
      }),
    );
  });

  return geoidCollection(features, "ISV village schematic");
}
