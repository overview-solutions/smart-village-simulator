#!/usr/bin/env node
/**
 * Rebuild embedded PACK in villages/demo-lv/*.html and sync JSON + index
 * into village-simulator/public/demo-lv/ (Vite static).
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packRoot = join(root, "villages", "demo-lv");
const pubRoot = join(root, "village-simulator", "public", "demo-lv");

function load(rel) {
  return JSON.parse(readFileSync(join(packRoot, rel), "utf8"));
}

const pack = {
  village: load("village.json"),
  structure: load("network/structure.geojson").features,
  devices: load("network/electric-devices.geojson").features,
  junctions: load("network/electric-junctions.geojson").features,
  lines: load("network/electric-lines.geojson").features,
  subnetworks: load("network/subnetworks.geojson").features,
  associations: load("network/associations.json"),
  feeds: load("feeds/registry.json"),
};
const packJs = `const PACK = ${JSON.stringify(pack)};`;

function replacePack(htmlPath) {
  const text = readFileSync(htmlPath, "utf8");
  const start = text.indexOf("const PACK = ");
  if (start < 0) throw new Error(`no PACK in ${htmlPath}`);
  let i = start;
  let depth = 0;
  let seen = false;
  let end = -1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      depth += 1;
      seen = true;
    } else if (ch === "}") {
      depth -= 1;
      if (seen && depth === 0) {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j += 1;
        if (text[j] === ";") {
          end = j;
          break;
        }
      }
    }
    i += 1;
  }
  if (end < 0) throw new Error(`PACK end not found in ${htmlPath}`);
  writeFileSync(htmlPath, text.slice(0, start) + packJs + text.slice(end + 1));
}

for (const name of ["index.html", "layers.html"]) {
  replacePack(join(packRoot, name));
}

const files = [
  "village.json",
  "network/subnetworks.geojson",
  "network/structure.geojson",
  "network/electric-lines.geojson",
  "network/electric-devices.geojson",
  "network/electric-junctions.geojson",
  "network/associations.json",
  "feeds/registry.json",
  "README.md",
  "index.html",
];
for (const rel of files) {
  const src = join(packRoot, rel);
  const dst = join(pubRoot, rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

console.log("synced demo-lv pack → public/demo-lv + embedded PACK");
