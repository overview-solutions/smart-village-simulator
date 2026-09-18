# Smart Village Simulator — agent map

Repository: [overview-solutions/smart-village-simulator](https://github.com/overview-solutions/smart-village-simulator).
Read [README.md](README.md) for ownership and run commands. License: Apache-2.0.

## Current state

This repo **is** the village app. Source of the extract: `CIR/yang/locus/village-simulator/`
(newer than the wiki copy). Wiki `ISV/isv-ai-wiki/village-simulator/` remains the
**live static embed** until a Pages cutover is verified. Do not keep editing both.

```sh
npm install
npm start   # :5176
npm test
```

Locus is `file:../../CIR/yang/locus` in this workspace. Graphics work goes to
[Circaevum/locus](https://github.com/Circaevum/locus) issues; app work here.

## Ownership

- **Here:** energy sim, meters, feeders, tariffs, payments, village UI, GeoJSON
  export, regional packs later, **modes** (Build / Operations / Maintenance) via
  `village-modes.js` + Build palette `village-build.js`.
- **Locus:** `TimeContext`, geo conversion, `LocusGL` / `LocusMap`, examples.
- **Wiki:** explanations, navigation, embed. Hash aliases stay.

Dependency: wiki → this app → Locus. App imports `@circaevum/locus/time` and
`@circaevum/locus/geo`. Domain meshes are attached directly to the visible LocusMap scene. Do not fork Locus core into this tree.

## Map / coords

XZ ground, +X east, −Z north. Y is time via Locus playhead. Origin is Voundou, Cameroon, with explicitly hypothetical infrastructure.
`village-basemap.js` creates the visible LocusMap, owning the shared renderer,
scene and camera. Selection uses its inverse projection; framing uses its camera API. `npm run map:prepare` builds ignored offline packs.

Never copy private contacts, prices, NDA text, or CIR `internal/` here.

## Files

| Path | Role |
|------|------|
| `village-simulator/js/village-worldline-sim.js` | Prepaid day rules |
| `village-simulator/js/village-worldline-layout.js` | Schematic plant |
| `village-simulator/js/village-worldline-day.js` | Renderer + UI |
| `village-simulator/js/geo.js` | Village GeoJSON; conversion from Locus |
| `scripts/write-village-geojson.js` | Writes `grid.geojson` (legacy one-blob export) |
| `villages/` | Per-site UN-style GeoJSON packs + API bindings (LOD fetch) — see `villages/README.md` |
| `village-simulator/js/village-build.js` | Build palette + house/EMS map + feed config |
| `village-simulator/js/village-candidates.js` | Africa KE/ZM candidate layer on zoom-out |
| `tests/` | Geo round-trip + TimeContext playhead + minigrid candidates |

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
