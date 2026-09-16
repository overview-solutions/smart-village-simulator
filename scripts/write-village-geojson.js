import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { villageGeoJSON } from "../village-simulator/js/geo.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "../village-simulator/grid.geojson");
const gj = villageGeoJSON();
writeFileSync(out, `${JSON.stringify(gj, null, 2)}\n`);
console.log(`${gj.features.length} features → ${out}`);
