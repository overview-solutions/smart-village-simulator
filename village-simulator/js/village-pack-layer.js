/**
 * Draw a UN pack (local ENU metres) in the 3D worldline scene.
 * Scene units are schematic; GeoJSON metres ÷ GROUND_SCALE.
 */
import * as THREE from "three";
import { GROUND_SCALE, HANG } from "./geo.js";

const WIRE_STEPS = 8;
const COL = {
  red: 0xc41e3a,
  black: 0x1a1a1a,
  pole: 0x79624b,
  gen: 0x2f6b14,
  station: 0xc9a227,
  breaker: 0xb42318,
  box: 0x26b9ba,
};

export function packBaseFromPath(path) {
  const p = String(path || "").replace(/^\.\//, "").replace(/\/$/, "");
  return p.startsWith("/") ? p : `/${p}`;
}

export async function fetchVillagePack(base) {
  const root = packBaseFromPath(base);
  const j = async (rel) => {
    const r = await fetch(`${root}/${rel}`);
    if (!r.ok) throw new Error(`${rel} HTTP ${r.status}`);
    return r.json();
  };
  const opt = async (rel) => {
    try {
      const r = await fetch(`${root}/${rel}`);
      if (!r.ok) return null;
      return r.json();
    } catch {
      return null;
    }
  };
  const [village, lines, structure, devices, junctions, subnetworks, associations, feeds] = await Promise.all([
    opt("village.json"),
    j("network/electric-lines.geojson"),
    j("network/structure.geojson"),
    j("network/electric-devices.geojson"),
    opt("network/electric-junctions.geojson"),
    opt("network/subnetworks.geojson"),
    opt("network/associations.json"),
    opt("feeds/registry.json"),
  ]);
  return { village, lines, structure, devices, junctions, subnetworks, associations, feeds };
}

export function fetchVoundouGridPack() {
  return fetchVillagePack("/villages/voundou-grid");
}

export function disposePackLayer(layer) {
  if (!layer?.root) return;
  layer.root.removeFromParent();
  layer.root.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose?.();
    }
  });
}

function sceneXZ(xM, zM) {
  return { x: xM / GROUND_SCALE, z: zM / GROUND_SCALE };
}

function addWire(group, ax, az, bx, bz, hang, color) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 0.2;
  const sag = Math.min(0.36, len * 0.035);
  const thick = hang <= HANG.secondary + 0.01 ? 0.045 : 0.08;
  const mat = new THREE.MeshLambertMaterial({ color });
  const point = (t) =>
    new THREE.Vector3(ax + dx * t, hang - 4 * sag * t * (1 - t), az + dz * t);
  for (let j = 0; j < WIRE_STEPS; j++) {
    const a = point(j / WIRE_STEPS);
    const b = point((j + 1) / WIRE_STEPS);
    const dir = b.clone().sub(a);
    const segLen = dir.length() || 0.01;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, segLen, 5), mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    group.add(mesh);
  }
}

function featXZ(f) {
  const p = f.properties || {};
  if (typeof p.x === "number") return sceneXZ(p.x, p.z);
  if (f.geometry?.type === "Point") {
    return sceneXZ(f.geometry.coordinates[0], f.geometry.coordinates[1]);
  }
  return null;
}

export function buildPackLayer(pack) {
  const root = new THREE.Group();
  root.name = "voundou-grid-pack";
  const linesG = new THREE.Group();
  linesG.name = "pack-lines";
  const polesG = new THREE.Group();
  polesG.name = "pack-poles";
  const devicesG = new THREE.Group();
  devicesG.name = "pack-devices";

  const xs = [];
  const zs = [];
  for (const f of pack.lines.features || []) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const ac = f.properties?.assetClass;
    const hang = ac === "secondary" || ac === "service" ? HANG.secondary : HANG.primary;
    const color =
      f.properties?.schematicColor === "black" || ac === "secondary" ? COL.black : COL.red;
    for (let i = 1; i < coords.length; i++) {
      const a = sceneXZ(coords[i - 1][0], coords[i - 1][1]);
      const b = sceneXZ(coords[i][0], coords[i][1]);
      addWire(linesG, a.x, a.z, b.x, b.z, hang, color);
      xs.push(a.x, b.x);
      zs.push(a.z, b.z);
    }
  }

  const poleGeo = new THREE.CylinderGeometry(0.075, 0.12, HANG.pole, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: COL.pole });
  for (const f of pack.structure.features || []) {
    if (f.properties?.assetClass !== "pole") continue;
    const p = featXZ(f);
    if (!p) continue;
    const mesh = new THREE.Mesh(poleGeo, poleMat);
    mesh.position.set(p.x, HANG.pole / 2, p.z);
    polesG.add(mesh);
  }

  for (const f of pack.devices.features || []) {
    const p = featXZ(f);
    if (!p) continue;
    const ac = f.properties.assetClass;
    let mesh = null;
    if (ac === "gen") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.7, 12),
        new THREE.MeshLambertMaterial({ color: COL.gen }),
      );
      mesh.position.set(p.x, 0.4, p.z);
    } else if (ac === "station") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.7, 0.7),
        new THREE.MeshLambertMaterial({ color: COL.station }),
      );
      mesh.position.set(p.x, 0.4, p.z);
    } else if (ac === "inverter" || ac === "breaker" || ac === "ems") {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.55, 0.25),
        new THREE.MeshLambertMaterial({ color: ac === "breaker" ? COL.breaker : COL.box }),
      );
      mesh.position.set(p.x, 0.35, p.z);
    }
    if (mesh) devicesG.add(mesh);
  }

  root.add(linesG, polesG, devicesG);
  return {
    root,
    linesG,
    polesG,
    devicesG,
    bounds: xs.length
      ? {
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minZ: Math.min(...zs),
          maxZ: Math.max(...zs),
        }
      : { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
  };
}
