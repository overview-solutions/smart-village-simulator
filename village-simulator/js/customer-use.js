/**
 * Customer use-class legend for Loads mode.
 * Critical = priority circuits (shed last). Hypothetical — not surveyed land-use.
 */

/** @typedef {{ id: string, label: string, hex: number, critical: boolean }} UseClassMeta */

/** @type {Record<string, UseClassMeta>} */
export const USE_CLASSES = {
  // —— Critical (priority circuits) ——
  medical: { id: "medical", label: "Clinic / health", hex: 0xb42318, critical: true },
  water: { id: "water", label: "Water & pumps", hex: 0x2bb6a3, critical: true },
  security: { id: "security", label: "Police / security", hex: 0x1a3340, critical: true },
  fire: { id: "fire", label: "Fire / rescue", hex: 0xff4d1a, critical: true },
  school: { id: "school", label: "School", hex: 0x175cd3, critical: true },
  telecom: { id: "telecom", label: "Comms / tower", hex: 0x5c7cfa, critical: true },
  streetlight: { id: "streetlight", label: "Street lighting", hex: 0xe6c84a, critical: true },
  // —— Non-critical ——
  residential: { id: "residential", label: "Residential", hex: 0x6b8cae, critical: false },
  commercial: { id: "commercial", label: "Shops / kiosk", hex: 0xc9a227, critical: false },
  industrial: { id: "industrial", label: "Workshop / tools", hex: 0x9b4dca, critical: false },
  agricultural: { id: "agricultural", label: "Farms / mills", hex: 0x6a994e, critical: false },
  market: { id: "market", label: "Market stalls", hex: 0xba7517, critical: false },
  worship: { id: "worship", label: "Worship", hex: 0x8a6bb5, critical: false },
  leisure: { id: "leisure", label: "Leisure / hall", hex: 0x3d8bfd, critical: false },
};

export const CRITICAL_ORDER = [
  "medical",
  "water",
  "security",
  "fire",
  "school",
  "telecom",
  "streetlight",
];

export const NONCRITICAL_ORDER = [
  "residential",
  "commercial",
  "industrial",
  "agricultural",
  "market",
  "worship",
  "leisure",
];

export const USE_CLASS_ORDER = [...CRITICAL_ORDER, ...NONCRITICAL_ORDER];

/** Tier focus ids (All critical / All non-critical). */
export const USE_TIER = {
  critical: { id: "critical", label: "All critical" },
  noncritical: { id: "noncritical", label: "All non-critical" },
};

export function isCriticalUse(useClass) {
  return !!USE_CLASSES[useClass || "residential"]?.critical;
}

/**
 * @param {string | null | undefined} useClass
 * @param {string | null | undefined} focus — class id, "critical", "noncritical", or null
 */
export function useClassMatchesFocus(useClass, focus) {
  if (!focus) return true;
  const k = useClass || "residential";
  if (focus === "critical") return isCriticalUse(k);
  if (focus === "noncritical") return !isCriticalUse(k);
  return k === focus;
}

/**
 * Deterministic class from cluster + load traits — seed enough of each sample.
 * @param {{ cluster: string, ag?: boolean, pump?: boolean, tools?: boolean, ict?: boolean }} h
 * @param {number} i
 */
export function classifyCustomerUse(h, i) {
  // Guaranteed sparse samples so every legend row has ≥1 home on typical 200-home day.
  const forced = [
    [3, "fire"],
    [7, "fire"],
    [11, "leisure"],
    [19, "leisure"],
    [23, "security"],
    [29, "streetlight"],
    [31, "worship"],
    [37, "school"],
  ];
  for (const [idx, kind] of forced) {
    if (i === idx) return kind;
  }

  const cluster = h.cluster || "";
  const n = i % 47;

  if (cluster === "clinic") {
    if (n % 3 === 0) return "medical";
    if (n % 5 === 0) return "water";
    if (n % 7 === 0) return "telecom";
    if (n % 11 === 0) return "security";
    return "residential";
  }

  if (cluster === "market") {
    if (h.tools) return "industrial";
    if (n % 4 === 0) return "market";
    if (n % 5 === 0) return "commercial";
    if (n % 8 === 0) return "leisure";
    if (n % 11 === 0) return "worship";
    if (n % 13 === 0) return "school";
    if (n % 17 === 0) return "streetlight";
    return "residential";
  }

  const rural = cluster === "west" || cluster === "south";
  if (rural) {
    // Prefer pumps as water, but don't let every ag/pump dominate the legend.
    if (h.pump && n % 2 === 0) return "water";
    if (h.ag && n % 3 === 0) return "agricultural";
    if (h.tools) return "industrial";
    if (n === 0) return "fire";
    if (n === 1) return "security";
    if (n === 2 || n === 3) return "school";
    if (n === 4) return "worship";
    if (n === 5) return "telecom";
    if (n % 19 === 0) return "streetlight";
    if (n % 9 === 0) return "commercial";
    if (h.ag) return "agricultural";
    if (h.pump) return "water";
    return "residential";
  }

  // east / denser village core
  if (h.tools) return "industrial";
  if (h.ict && n % 2 === 0) return "telecom";
  if (n % 7 === 0) return "commercial";
  if (n % 11 === 0) return "market";
  if (n % 13 === 0) return "school";
  if (n % 15 === 0) return "worship";
  if (n % 17 === 0) return "leisure";
  if (n % 19 === 0) return "medical";
  if (n % 21 === 0) return "security";
  if (n % 23 === 0) return "water";
  if (n % 25 === 0) return "streetlight";
  if (n % 29 === 0) return "fire";
  if (n % 31 === 0) return "telecom";
  return "residential";
}

export function useClassColor(useClass) {
  return USE_CLASSES[useClass]?.hex ?? USE_CLASSES.residential.hex;
}
