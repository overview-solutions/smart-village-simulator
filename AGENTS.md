# Smart Village Simulator — agent map

Repository: [overview-solutions/smart-village-simulator](https://github.com/overview-solutions/smart-village-simulator).
Read [README.md](README.md) for ownership and run commands. License: Apache-2.0.

## Public clone vs CIR sibling

**Public / stranger clone:** `npm install` uses `github:Circaevum/locus` (real package name `@circaevum/locus`; not on the npm registry). `npm start` / `npm test` / `npm run map:prepare` / Vite `/api/site-pack` do **not** need a CIR tree. `map:prepare` resolves `scripts/prepare-map-pack.mjs` from the installed package.

**If you sit next to a CIR clone** (`../../CIR/yang/locus` from this repo): `preinstall` / `postinstall` symlink `node_modules/@circaevum/locus` there. Keep `package.json` on `github:Circaevum/locus`. Do not commit a `file:` override.

Historical extract lived under a Locus `village-simulator/` folder. This repo **is** the app now. Do not hunt workbench-only shortcuts or dual-edit a Locus copy.

## isv.wiki vs this app

[isv.wiki](https://isv.wiki/) (`ISV/isv-ai-wiki`) is a **static HTML KB** — meters, AMI/EMS notes, citations. No login. This repo is the **live** 3D village app (Build / Operations / Loads). Wiki embed may be an older freeze; do not treat wiki numbers as runtime. Public writing never copies `isv-ai-wiki-private` (contacts, prices, NDA). Wiki Pages cutover still pending; hash aliases stay.

```sh
npm install
npm start   # :5176 (browser opens)
npm test
npm run villages:sync
```

Graphics work → [Circaevum/locus](https://github.com/Circaevum/locus) issues. App work here.

## Ownership

- **Here:** energy sim, meters, feeders, tariffs, payments, village UI, GeoJSON
  export, regional packs later, **modes** (Build / Operations / Loads / Energy
  Assets / Maintenance) via `village-modes.js` + Build palette `village-build.js`.
- **Locus:** `TimeContext`, geo conversion, `LocusGL` / `LocusMap`, examples.
- **Wiki:** explanations, navigation, frozen embed. Hash aliases stay.

Dependency: wiki → this app → Locus. App imports `@circaevum/locus/time` and
`@circaevum/locus/geo`. Domain meshes attach to the visible LocusMap scene. Do not fork Locus core into this tree.

## Map / coords

XZ ground, +X east, −Z north. Y is time via Locus playhead. Origin defaults to Voundou, Cameroon, with explicitly hypothetical infrastructure.
`village-basemap.js` creates the visible LocusMap (shared renderer, scene, camera). Selection uses its inverse projection; framing uses its camera API. `npm run map:prepare` builds ignored offline packs via installed Locus `prepare-map-pack.mjs`. Place / New project uses Vite `GET /api/geocode` and `POST /api/site-pack`.

Never copy private contacts, prices, NDA text, CIR `internal/`, Nakama keys, or AEP contract text here.

## Files

| Path | Role |
|------|------|
| `village-simulator/js/village-worldline-sim.js` | Prepaid day rules |
| `village-simulator/js/village-worldline-layout.js` | Schematic plant |
| `village-simulator/js/village-worldline-day.js` | Renderer + UI |
| `village-simulator/js/geo.js` | Village GeoJSON; conversion from Locus |
| `village-simulator/js/village-modes.js` | Build / Operations / Loads / Energy / Maintenance |
| `village-simulator/js/village-build.js` | BUILD core (gen · station/switch · primary · secondary · xfmr) vs More; `nominalKv` on lines |
| `village-simulator/js/village-seed-customers.js` | Example LV customers (density + use-class mix) |
| `village-simulator/js/village-candidates.js` | Africa KE/ZM candidate layer on zoom-out |
| `scripts/write-village-geojson.js` | Writes `grid.geojson` (legacy one-blob export) |
| `villages/` | Per-site UN-style GeoJSON packs + API bindings (LOD fetch) — see `villages/README.md` |
| `villages/catalog.json` | Site switcher catalog (Voundou · demo-lv · safari-park-casino · voundou-grid) |
| `village-simulator/public/villages/` | Pack copies (`npm run villages:sync`). 3D sim (`/`) draws them — hub redirects home. |
| `tests/` | Geo, TimeContext playhead, minigrid candidates, village-modes, productive-use, pack-topology |

**Topology packs:** Prefer `villages/<siteId>/` (structure / devices / junctions / lines /
subnetworks + `associations.json` + `feeds/registry.json`) over growing
`grid.geojson`. Geometry in files; meter telemetry only after feeder→meter
selection (LOD 2→3). Circaevum calendar CSV / slug layers stay out of this repo.

Update this file when the wiki iframe cutover or LocusScene host lands.

Voundou anchor confirmed by user: 4.79209 N, 11.53412 E. Legacy schematic
ground units convert to 8 metres; equipment heights convert by 3. Homes are
about 4.7–6.4 m wide and ~2.1–2.2 m wall height; poles about 8.4 m.
Layout remains generated, not traced building footprints. Time-Y is a diagram,
not physical altitude. Do not infer population or existing assets from this scenario.
