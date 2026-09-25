#!/usr/bin/env node
/**
 * Sync villages/catalog.json + pack folders into village-simulator/public/villages/
 * (Vite static). Does not replace villages:sync-demo (demo-lv embedded PACK).
 */
import { copyFileSync, cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "villages");
const pubRoot = join(root, "village-simulator", "public", "villages");

mkdirSync(pubRoot, { recursive: true });
copyFileSync(join(srcRoot, "catalog.json"), join(pubRoot, "catalog.json"));

const catalog = JSON.parse(readFileSync(join(srcRoot, "catalog.json"), "utf8"));
for (const site of catalog.sites) {
  if (site.kind !== "pack") continue;
  // demo-lv lives at public/demo-lv via villages:sync-demo
  if (site.path === "demo-lv") continue;
  const id = site.id;
  const from = join(srcRoot, id);
  const to = join(pubRoot, id);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log("synced", id, "→", to);
}

const hubSrc = join(srcRoot, "index.html");
const hubDst = join(pubRoot, "index.html");
try {
  copyFileSync(hubSrc, hubDst);
  console.log("synced villages/index.html");
} catch {
  console.log("keep existing public/villages/index.html");
}

console.log("catalog → public/villages/catalog.json");
