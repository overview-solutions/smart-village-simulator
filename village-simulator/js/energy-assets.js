/**
 * Energy asset classes for Energy Assets mode.
 * Hypothetical schematic — not surveyed generation / storage.
 */

export const ENERGY_CLASSES = {
  diesel: { id: "diesel", label: "Diesel", hex: 0x8b5a2b, group: "Generation" },
  solar: { id: "solar", label: "Solar", hex: 0x1a7cff, group: "Generation" },
  wind: { id: "wind", label: "Wind", hex: 0x5b8def, group: "Generation" },
  battery: { id: "battery", label: "Battery", hex: 0x2c8a5e, group: "Storage" },
};

export const ENERGY_CLASS_ORDER = ["diesel", "solar", "wind", "battery"];

/** Distributed schematic sites across village ground (XZ). */
export const ENERGY_ASSETS = [
  // Diesel gensets
  { id: "dg-main", kind: "diesel", label: "Main diesel", x: -26.0, z: -11.0, kw: 40 },
  { id: "dg-west", kind: "diesel", label: "West diesel", x: -42, z: 18, kw: 12 },
  { id: "dg-south", kind: "diesel", label: "South diesel", x: 10, z: 52, kw: 15 },
  { id: "dg-east", kind: "diesel", label: "East diesel", x: 48, z: 8, kw: 10 },
  { id: "dg-clinic", kind: "diesel", label: "Clinic backup", x: 14, z: -6, kw: 8 },
  { id: "dg-market", kind: "diesel", label: "Market genset", x: -8, z: 2, kw: 6 },
  { id: "dg-north", kind: "diesel", label: "North diesel", x: -18, z: -28, kw: 10 },
  { id: "dg-ops", kind: "diesel", label: "Ops backup", x: 22, z: -12, kw: 5 },
  // Solar arrays (distributed) — site farm lives in plant `pvMesh` / PV_FARM, not here.
  { id: "pv-west", kind: "solar", label: "West array", x: -48, z: 30, kw: 8 },
  { id: "pv-south", kind: "solar", label: "South array", x: 6, z: 62, kw: 6 },
  { id: "pv-east", kind: "solar", label: "East array", x: 52, z: 22, kw: 6 },
  { id: "pv-clinic", kind: "solar", label: "Clinic roof PV", x: 12, z: -4, kw: 4 },
  { id: "pv-market", kind: "solar", label: "Market canopy PV", x: -6, z: -3, kw: 3 },
  { id: "pv-north", kind: "solar", label: "North gardens PV", x: -30, z: -30, kw: 5 },
  // Wind turbines (periphery)
  { id: "wt-nw", kind: "wind", label: "NW turbine", x: -55, z: -35, kw: 20 },
  { id: "wt-ne", kind: "wind", label: "NE turbine", x: 58, z: -32, kw: 20 },
  { id: "wt-sw", kind: "wind", label: "SW turbine", x: -50, z: 55, kw: 15 },
  { id: "wt-se", kind: "wind", label: "SE turbine", x: 55, z: 48, kw: 15 },
  // Batteries / BESS
  { id: "bess-main", kind: "battery", label: "Plant BESS", x: -23.6, z: -9.4, kwh: 200 },
  { id: "bess-west", kind: "battery", label: "West pack", x: -40, z: 20, kwh: 40 },
  { id: "bess-south", kind: "battery", label: "South pack", x: 12, z: 50, kwh: 40 },
  { id: "bess-east", kind: "battery", label: "East pack", x: 46, z: 10, kwh: 30 },
  { id: "bess-clinic", kind: "battery", label: "Clinic BESS", x: 13, z: -5.5, kwh: 25 },
  { id: "bess-ops", kind: "battery", label: "Ops pack", x: 21, z: -10, kwh: 20 },
  { id: "bess-north", kind: "battery", label: "North pack", x: -20, z: -26, kwh: 30 },
];

export function countEnergyByClass() {
  const counts = Object.create(null);
  for (const id of ENERGY_CLASS_ORDER) counts[id] = 0;
  for (const a of ENERGY_ASSETS) counts[a.kind] = (counts[a.kind] || 0) + 1;
  return counts;
}

export function energyClassColor(kind) {
  return ENERGY_CLASSES[kind]?.hex ?? 0x888888;
}
