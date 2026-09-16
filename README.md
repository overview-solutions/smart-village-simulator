# Smart Village Simulator

Village energy simulation built on [Circaevum Locus](https://github.com/Circaevum/locus).
Repository: [overview-solutions/smart-village-simulator](https://github.com/overview-solutions/smart-village-simulator).

Hypothetical GroundBolt prepaid day — not live telemetry. Layout is synthetic
(Null Island). Placing it on a real basemap later does not make it a survey.

## Run (this workspace)

```sh
cd ISV/smart-village-simulator
npm install
npm start    # http://localhost:5176
npm test
```

`@circaevum/locus` is a `file:` dependency on `CIR/yang/locus`. Standalone clones
must point that dep at `github:Circaevum/locus` (or an npm pack) before CI/Pages.

## Boundary

| Layer | Owns |
|-------|------|
| Locus (`@circaevum/locus`) | Time→Y (`TimeContext`), ENU↔WGS84, `LocusGL` / `LocusMap` |
| This app | Meters, feeders, tariffs, payments, village meshes, UI |
| ISV wiki | Docs, nav, hash aliases. Live embed is still the wiki's frozen static copy until Pages cutover |

Worldlines and ground graphs still render in the app's Three.js scene. Time Y and
GeoJSON conversion go through Locus. Next slice: attach meshes to `LocusScene` /
`LocusMap`. Do not drape OpenFreeMap under this Null Island layout by default.

## Wiki embed

Wiki hashes `#village-metering/village-simulator` (and `worldline-day` aliases)
stay. After this app is on GitHub Pages, point the wiki iframe at that URL with
`?embed=1`. Until then the wiki keeps serving its local `village-simulator/`.

## Physical equipment

The village renderer includes pole crossarms and insulators, segmented sagging
overhead conductors, pole-mounted transformer tanks and shelves, EMS cabinets
with mounting posts and solar caps, and RF enclosures with whip antennas. These
are schematic visual assets, not construction dimensions or an RF propagation
model. Shared equipment elevations live in `js/geo.js`; regenerate the exported
GeoJSON with `npm run geojson` after changing them.
