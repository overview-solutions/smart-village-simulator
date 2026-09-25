# Smart Village Simulator

Live 3D village energy app on [Circaevum Locus](https://github.com/Circaevum/locus).  
Repository: [overview-solutions/smart-village-simulator](https://github.com/overview-solutions/smart-village-simulator).  
License: **Apache-2.0**. `package.json` is `"private": true` (not published to npm).

Hypothetical GroundBolt prepaid day — not live telemetry. Default layout is synthetic
(Voundou, Cameroon; hypothetical infrastructure). A real basemap does not make it a survey.

---

## This repo vs [isv.wiki](https://isv.wiki/)

| | [isv.wiki](https://isv.wiki/) | This repo |
|---|---|---|
| What | Static knowledge base (meters, AMI/EMS notes, citations). No login. | Runnable 3D simulator (Build / Operations / Loads / Maintenance / Energy Assets). |
| Repo | [overview-solutions/isv-ai-wiki](https://github.com/overview-solutions/isv-ai-wiki) | This tree |
| Sim on the site | Frozen embed (may be older than `main` here). Do not treat wiki numbers as this app’s runtime. | Live scene you `npm start` |

ISV volunteer knowledge vs a scene you can build and run. Public writing never copies private facts from `isv-ai-wiki-private` (contacts, prices, NDA text).

**Open the wiki only** (no Node, workshop / village kit):

```bash
git clone https://github.com/overview-solutions/isv-ai-wiki.git
cd isv-ai-wiki
./preview.sh
```

Then [http://127.0.0.1:8765/index.html#village-metering/village-simulator](http://127.0.0.1:8765/index.html#village-metering/village-simulator). Details: [isv-ai-wiki README](https://github.com/overview-solutions/isv-ai-wiki#offline-in-one-go-start-here).

Do **not** develop against the wiki’s frozen `village-simulator/` copy. Change this repo; refresh the wiki snapshot when ready.

---

## Run (no Circaevum workbench required)

Need **Node 18.18+** (20+ recommended). **macOS** is first-class. **Linux** should work. **Windows** is untested.

```sh
git clone https://github.com/overview-solutions/smart-village-simulator.git
cd smart-village-simulator
npm install
npm start
```

Browser opens [http://127.0.0.1:5176/](http://127.0.0.1:5176/). Leave the terminal open; Ctrl+C stops Vite.

`@circaevum/locus` is the real package name (Circaevum Locus). It is **not** on the public npm registry. `npm install` pulls [`github:Circaevum/locus`](https://github.com/Circaevum/locus).

**macOS one-click:** double-click `Start Simulator.command` in this folder. Prefers Homebrew arm64 Node when present (avoids nvm Rosetta × wrong `@rollup/rollup-darwin-*`). First run may `npm install`.

```sh
npm test
npm run villages:sync    # copy villages/ packs → village-simulator/public/villages/
```

Pack contract, catalog, and LOD rules: [`villages/README.md`](villages/README.md). Catalog: [`villages/catalog.json`](villages/catalog.json).

---

## First session

Default scene is the hypothetical Voundou / GroundBolt day. Empty project is the planning path.

1. **New / empty project** — File menu → **New project…**. Drops the schematic village. Pin bar appears.
2. **Place / coords** — type a town, address, or `lat, lon` in **Place**, Enter or Go. Dev server calls `GET /api/geocode` (Nominatim; needs internet). Origin becomes that WGS84 point. XZ ground, +X east, −Z north; Y is Locus playhead time (diagram, not altitude).
3. **BUILD** — place gen → station/switch → primary → secondary / LV. Click a feeder in the Build strip for the completion grid.
4. **Seed customers** — **Seed customers** on the Build strip (needs LV). Density: none on 11 kV; ≥10/pole on 0.38 kV; denser (≥14/pole) on 0.22 kV. Load diversity: use-class mix (homes, market/shop, civic, industry, ag, …) from community center out. Then **Loads** to inspect classes.
5. **Modes** (top strip):
   - **Build** — place assets; no playhead.
   - **Operations** — prepaid day, feeders, anomalies, EMS.
   - **Loads** — critical vs non-critical / use-class (productive-use overlay on the demo village; empty canvas uses seeded customers).
   - **Maintenance** — faults, leaks, mesh; no playhead.
   - **Energy Assets** — diesel / solar / wind / battery (demo village overlay).
6. **Feeder select** — click a feeder (or pick one in Build). Scope filters plant and meters. Packs use LOD 2 on feeder, LOD 3 only after a meter is selected — see [`villages/README.md`](villages/README.md).
7. **Offline maps / geocode / site-pack** — `GET /api/geocode` and `POST /api/site-pack` exist on the Vite dev server only. Place triggers a local OpenFreeMap + OSM cache under `village-simulator/public/maps/sites/` (gitignored). For the default Voundou packs:

   ```sh
   npm run map:prepare   # once, online
   npm start
   ```

   Satellite still needs internet. Other styles use the local pack when present. `map:prepare` and `/api/site-pack` run `scripts/prepare-map-pack.mjs` from **installed** `@circaevum/locus` (GitHub tree includes it).

---

## If you sit next to a CIR clone

Workbench layout `GitHub/CIR/yang/locus` next to `GitHub/ISV/smart-village-simulator` (`../../CIR/yang/locus` from this repo). `preinstall` / `postinstall` symlink `node_modules/@circaevum/locus` to that tree so local Locus edits apply. `package.json` stays `github:Circaevum/locus` — do not commit a `file:` override.

Graphics issues → [Circaevum/locus](https://github.com/Circaevum/locus). App / energy / modes → this repo.

---

## Boundary

| Layer | Owns |
|-------|------|
| Locus (`@circaevum/locus`) | Time→Y (`TimeContext`), ENU↔WGS84, `LocusGL` / `LocusMap` |
| This app | Meters, feeders, tariffs, payments, village meshes, UI, modes |
| [isv.wiki](https://isv.wiki/) | Docs, nav, hash aliases. Embed is still the wiki’s frozen static copy until a Pages cutover |

LocusMap owns the visible canvas, basemaps, camera, and shared renderer. Village meshes attach to its scene. Drag to pan, right-drag to rotate/pitch, scroll to zoom.

Wiki hashes `#village-metering/village-simulator` (and `worldline-day` aliases) stay. After this app is on GitHub Pages, point the wiki iframe at that URL with `?embed=1`.

---

## Physical equipment

Pole crossarms and insulators, sagging overhead conductors, pole-mounted transformers, EMS cabinets, RF enclosures. Schematic visuals — not construction dimensions or an RF model. Elevations in `js/geo.js`; regenerate GeoJSON with `npm run geojson` after changing them.

Voundou anchor: 4.79209 N, 11.53412 E (user-confirmed pin; infrastructure still hypothetical). Legacy schematic ground units convert to 8 metres; equipment heights convert by 3. Homes about 4.7–6.4 m wide and ~2.1–2.2 m wall height; poles about 8.4 m. Layout is generated, not traced footprints. Do not infer population or existing assets.

---

## Productive-use scenario (demo village)

Planning panel: four irrigation pumps, a cold room, two mills, a welding shop, two tailors, a produce market, repair/charging shop, bakery, and six street lights. Illustrative extra loads. Overlay assumes supplied power; it does not yet change feeder dispatch, outages, or household billing. No thermal, spoilage, solar-surplus, or business-income claims.

Productive buildings use the schematic home footprint as a scale reference. `village-water.js` adds an explicitly hypothetical river, intake, treatment, tank, standpipes, and wastewater path. Pipes are conceptual, not hydraulic design.

---

## License

Apache-2.0. See [LICENSE](LICENSE). How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md).
