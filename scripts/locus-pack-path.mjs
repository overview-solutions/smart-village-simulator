/**
 * Resolve Circaevum Locus prepare-map-pack.mjs.
 * Prefer the installed @circaevum/locus tree (github: or file:), then CIR sibling.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function findLocusPrepareScript() {
  const candidates = [];
  try {
    const pkg = createRequire(import.meta.url).resolve("@circaevum/locus/package.json");
    candidates.push(join(dirname(pkg), "scripts/prepare-map-pack.mjs"));
  } catch {
    /* not installed */
  }
  candidates.push(join(root, "node_modules/@circaevum/locus/scripts/prepare-map-pack.mjs"));
  candidates.push(join(root, "../../CIR/yang/locus/scripts/prepare-map-pack.mjs"));
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    "prepare-map-pack.mjs not found. Run npm install so @circaevum/locus is present (github:Circaevum/locus). The script ships in that GitHub tree; a stripped npm pack would omit it.",
  );
}
