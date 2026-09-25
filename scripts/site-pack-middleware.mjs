/**
 * Vite: POST /api/site-pack → OpenFreeMap tiles + OSM GeoJSON under public/maps/sites/<id>/.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packScript = join(root, "../../CIR/yang/locus/scripts/prepare-map-pack.mjs");

function slug(lat, lon, name) {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const pin = `${Number(lat).toFixed(4)}_${Number(lon).toFixed(4)}`.replace(/[.-]/g, "m");
  return n ? `${n}-${pin}` : `site-${pin}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function runPack({ out, lon, lat, km, base }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        packScript,
        `--out=${out}`,
        `--lon=${lon}`,
        `--lat=${lat}`,
        `--km=${km}`,
        `--style=liberty`,
        `--base=${base}`,
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `map pack exit ${code}`));
    });
  });
}

export function sitePackMiddleware() {
  return {
    name: "site-pack-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || "";
        const path = raw.split("?")[0];
        if (req.method === "GET" && path === "/api/geocode") {
          try {
            const q = new URL(raw, "http://local").searchParams.get("q")?.trim();
            if (!q) {
              res.statusCode = 400;
              res.end("Need q");
              return;
            }
            const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
            const nr = await fetch(url, {
              headers: {
                Accept: "application/json",
                "User-Agent": "smart-village-simulator/0.1 (ISV local workbench)",
              },
            });
            if (!nr.ok) {
              res.statusCode = nr.status;
              res.end(`Nominatim HTTP ${nr.status}`);
              return;
            }
            const rows = await nr.json();
            const hit = rows[0];
            if (!hit) {
              res.statusCode = 404;
              res.end(`No place match for “${q}”`);
              return;
            }
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                lat: Number(hit.lat),
                lon: Number(hit.lon),
                name: hit.display_name || q,
              }),
            );
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e?.message || e));
          }
          return;
        }
        if (req.method !== "POST" || path !== "/api/site-pack") {
          next();
          return;
        }
        try {
          const body = await readJsonBody(req);
          const lon = Number(body.lon);
          const lat = Number(body.lat);
          const km = Math.min(5, Math.max(0.5, Number(body.km) || 2));
          if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 80) {
            res.statusCode = 400;
            res.end("Need finite lon/lat");
            return;
          }
          const id = slug(lat, lon, body.name);
          const dest = join(root, "village-simulator/public/maps/sites", id);
          const base = `/maps/sites/${id}`;
          await runPack({ out: dest, lon, lat, km, base });
          const stylePath = join(dest, "style.json");
          const text = await readFile(stylePath, "utf8");
          await writeFile(stylePath, text.replaceAll(`${base}/`, "./"));
          if (body.osm) {
            await mkdir(dest, { recursive: true });
            await writeFile(join(dest, "osm.geojson"), JSON.stringify(body.osm));
          }
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id,
              styleUrl: `${base}/style.json`,
              osmUrl: body.osm ? `${base}/osm.geojson` : null,
            }),
          );
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e?.message || e));
        }
      });
    },
  };
}
