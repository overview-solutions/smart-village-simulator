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
  export, regional packs later.
- **Locus:** `TimeContext`, geo conversion, `LocusGL` / `LocusMap`, examples.
- **Wiki:** explanations, navigation, embed. Hash aliases stay.

Dependency: wiki → this app → Locus. App imports `@circaevum/locus/time` and
`@circaevum/locus/geo`. Domain renderer is still app Three.js (Sky, instancing,
last-gasp hops). Do not fork Locus core into this tree.

## Map / coords

XZ ground, +X east, −Z north. Y is time via Locus playhead. Origin is synthetic
Null Island. MapLibre + local OpenFreeMap lives in Locus examples — not wired
under this village (would imply a surveyed site).

Never copy private contacts, prices, NDA text, or CIR `internal/` here.

## Files

| Path | Role |
|------|------|
| `village-simulator/js/village-worldline-sim.js` | Prepaid day rules |
| `village-simulator/js/village-worldline-layout.js` | Schematic plant |
| `village-simulator/js/village-worldline-day.js` | Renderer + UI |
| `village-simulator/js/geo.js` | Village GeoJSON; conversion from Locus |
| `scripts/write-village-geojson.js` | Writes `grid.geojson` |
| `tests/` | Geo round-trip + TimeContext playhead |

Update this file when the wiki iframe cutover or LocusScene host lands.
