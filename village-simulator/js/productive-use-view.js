import * as THREE from "three";
import { PRODUCTIVE_ASSETS, productiveUseAt } from "./productive-use.js";

/**
 * Optional 3D planning props (mills, pumps, …). No side panel —
 * Productive use mode colors customer homes by use class instead.
 * @returns {{ update: (minute: number) => void, setVisible: (on: boolean) => void }}
 */
export function buildProductiveUse(scene, tariff, _baselineKWh, labelSprite) {
  const group = new THREE.Group();
  group.name = "productive-props";
  group.visible = false;
  scene.add(group);

  function box(w, h, d, color, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  for (const asset of PRODUCTIVE_ASSETS) {
    const { x, z, kind } = asset;
    const firstPart = group.children.length;
    if (kind === "pump") {
      box(1.2, 0.6, 0.8, 0x328fc2, x, 0.3, z);
      box(0.16, 0.16, 4, 0x71bddd, x, 0.25, z + 2);
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 2, 16),
        new THREE.MeshLambertMaterial({ color: 0x7bc2d6 }),
      );
      tank.position.set(x, 1, z + 4);
      group.add(tank);
      for (let i = 0; i < 5; i++) box(5, 0.04, 0.12, 0x338e67, x + 4, 0.08, z + i);
    } else if (kind === "light") {
      box(0.09, 3, 0.09, 0x79868a, x, 1.5, z);
      box(0.7, 0.1, 0.12, 0x79868a, x + 0.3, 3, z);
    } else if (kind === "market") {
      for (let i = 0; i < 4; i++) {
        box(1.5, 0.8, 0.8, 0xb18d5b, x + i * 1.8, 0.4, z);
        box(1.7, 0.12, 1.3, i % 2 ? 0xe1b94c : 0x52998c, x + i * 1.8, 2, z);
        for (const dx of [-0.65, 0.65]) box(0.06, 2, 0.06, 0x78634d, x + i * 1.8 + dx, 1, z);
        box(1, 0.2, 0.5, 0x72a546, x + i * 1.8, 0.9, z);
      }
    } else {
      const color = { cold: 0xd7e9e9, mill: 0xc49b67, weld: 0x70849a, tailor: 0xba8bb3, shop: 0xcab886 }[kind];
      box(3.5, 2.4, 2.6, color, x, 1.2, z);
      box(3.7, 0.15, 2.8, 0x4a8192, x, 2.45, z);
      box(0.9, 1.9, 0.1, 0x538da6, x, 0.95, z + 1.35);
      if (kind === "mill") {
        const silo = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.65, 2, 10),
          new THREE.MeshLambertMaterial({ color: 0xc9c6ad }),
        );
        silo.position.set(x + 2.4, 1, z);
        group.add(silo);
      }
      if (kind === "weld") box(1.7, 0.15, 0.9, 0x555d65, x + 2.5, 1, z);
      if (kind === "tailor") box(1.2, 0.12, 0.6, 0xad8172, x, 1, z + 1.8);
      if (kind === "cold") box(0.8, 0.6, 0.4, 0x536974, x + 1, 0.7, z + 1.5);
    }
    const scale = kind === "light" ? 0.8 : kind === "pump" ? 0.5 : kind === "market" ? 0.45 : 0.38;
    for (const part of group.children.slice(firstPart)) {
      part.position.x = x + (part.position.x - x) * scale;
      part.position.z = z + (part.position.z - z) * scale;
      part.position.y *= scale;
      part.scale.multiplyScalar(scale);
    }
  }

  const indicators = PRODUCTIVE_ASSETS.map((a) => {
    const led = box(0.1, 0.1, 0.1, 0x40505a, a.x, a.kind === "light" ? 2.4 : 1.15, a.z);
    if (a.kind === "light") return led;
    const label = labelSprite(a.label, "#a7e4ee", 340);
    label.position.set(a.x, 1.8, a.z);
    label.scale.set(4, 0.65, 1);
    group.add(label);
    return led;
  });

  function update(minute) {
    if (!group.visible) return;
    const v = productiveUseAt(minute, tariff, true);
    v.assets.forEach((a, i) => {
      indicators[i].material.color.setHex(a.on ? (a.kind === "light" ? 0xffe6a0 : 0x39f3b0) : 0x40505a);
      indicators[i].material.emissive.setHex(a.on ? (a.kind === "light" ? 0xffd572 : 0x18664a) : 0);
    });
  }

  return {
    group,
    update,
    setVisible(on) {
      group.visible = !!on;
    },
  };
}
