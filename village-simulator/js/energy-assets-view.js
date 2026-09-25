import * as THREE from "three";
import { ENERGY_ASSETS, ENERGY_CLASSES, energyClassColor } from "./energy-assets.js";

/**
 * Schematic generation + storage props for Energy Assets mode.
 * @returns {{
 *   setVisible: (on: boolean) => void,
 *   setFocusClass: (id: string | null) => void,
 *   group: THREE.Group,
 * }}
 */
export function buildEnergyAssets(scene, labelSprite) {
  const group = new THREE.Group();
  group.name = "energy-assets";
  group.visible = false;
  scene.add(group);

  /** @type {{ kind: string, meshes: THREE.Object3D[], label?: THREE.Sprite }[]} */
  const entries = [];

  function addMesh(mesh, kind) {
    mesh.userData.energyClass = kind;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function box(w, h, d, hex, x, y, z, kind) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: hex }),
    );
    mesh.position.set(x, y, z);
    return addMesh(mesh, kind);
  }

  function diesel(a) {
    const hex = energyClassColor("diesel");
    const parts = [
      box(1.4, 0.9, 0.9, hex, a.x, 0.45, a.z, "diesel"),
      box(0.35, 1.1, 0.35, 0x4a4038, a.x + 0.55, 0.95, a.z, "diesel"),
      box(0.5, 0.2, 0.5, 0x2a2520, a.x, 0.12, a.z, "diesel"),
    ];
    return parts;
  }

  function solar(a) {
    const hex = energyClassColor("solar");
    const parts = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const m = box(1.1, 0.05, 0.72, hex, a.x + c * 1.2 - 1.2, 0.55, a.z + r * 0.9, "solar");
        m.rotation.x = 0.45;
        parts.push(m);
      }
    }
    parts.push(box(0.08, 0.5, 0.08, 0x555555, a.x, 0.25, a.z, "solar"));
    return parts;
  }

  function wind(a) {
    const towerHex = 0xc8d0d8;
    const bladeHex = energyClassColor("wind");
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.32, 8.5, 10),
      new THREE.MeshLambertMaterial({ color: towerHex }),
    );
    tower.position.set(a.x, 4.25, a.z);
    addMesh(tower, "wind");
    const hub = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xe8eef4 }),
    );
    hub.position.set(a.x, 8.5, a.z);
    addMesh(hub, "wind");
    const blades = [];
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 3.6, 0.35),
        new THREE.MeshLambertMaterial({ color: bladeHex }),
      );
      blade.position.set(a.x, 8.5, a.z);
      blade.rotation.z = (i * Math.PI * 2) / 3;
      blade.translateY(1.9);
      addMesh(blade, "wind");
      blades.push(blade);
    }
    return [tower, hub, ...blades];
  }

  function battery(a) {
    const hex = energyClassColor("battery");
    return [
      box(1.6, 1.0, 1.0, hex, a.x, 0.55, a.z, "battery"),
      box(1.5, 0.06, 0.94, 0x1e3328, a.x, 1.08, a.z, "battery"),
      box(0.08, 0.55, 0.06, 0xc9a227, a.x + 0.55, 0.7, a.z + 0.52, "battery"),
      box(0.08, 0.55, 0.06, 0xc9a227, a.x - 0.55, 0.7, a.z + 0.52, "battery"),
    ];
  }

  const builders = { diesel, solar, wind, battery };

  for (const a of ENERGY_ASSETS) {
    const build = builders[a.kind];
    if (!build) continue;
    const meshes = build(a);
    const yLabel = a.kind === "wind" ? 10.2 : a.kind === "solar" ? 1.6 : 1.5;
    const col = `#${ENERGY_CLASSES[a.kind].hex.toString(16).padStart(6, "0")}`;
    const label = labelSprite(a.label, col, 300);
    label.position.set(a.x, yLabel, a.z);
    label.scale.set(a.kind === "wind" ? 5.2 : 4.4, 0.7, 1);
    label.userData.energyClass = a.kind;
    group.add(label);
    entries.push({ kind: a.kind, meshes, label });
  }

  function setFocusClass(id) {
    for (const e of entries) {
      const on = !id || e.kind === id;
      const soft = !!id && !on;
      for (const m of e.meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (!mat) continue;
          if (mat.userData._eaBaseOp == null) mat.userData._eaBaseOp = mat.opacity ?? 1;
          mat.transparent = true;
          mat.opacity = soft ? 0.18 : mat.userData._eaBaseOp;
          if ("emissiveIntensity" in mat) {
            if (on && id) {
              mat.emissive?.setHex(ENERGY_CLASSES[e.kind]?.hex ?? 0x444444);
              mat.emissiveIntensity = 0.35;
            } else {
              mat.emissive?.setHex(0x000000);
              mat.emissiveIntensity = 0;
            }
          }
        }
      }
      if (e.label) {
        e.label.visible = on;
        if (e.label.material) {
          e.label.material.opacity = on ? 1 : 0.15;
          e.label.material.transparent = true;
        }
      }
    }
  }

  return {
    group,
    setVisible(on) {
      group.visible = !!on;
      if (!on) setFocusClass(null);
    },
    setFocusClass,
  };
}
