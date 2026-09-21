# Smart Village Simulator

Village energy simulation built on [Circaevum Locus](https://github.com/Circaevum/locus).  
Repository: [overview-solutions/smart-village-simulator](https://github.com/overview-solutions/smart-village-simulator).

Hypothetical GroundBolt prepaid day — not live telemetry. Layout is synthetic
(Voundou, Cameroon; hypothetical infrastructure). Placing it on a real basemap later does not make it a survey.

---

## Offline via the ISV wiki (start here)

Want to **open** the simulator inside the knowledge base — workshop, village kit, no Node?

You do **not** need this repo for that.

1. Clone and run the wiki (one command after clone):

   ```bash
   git clone https://github.com/overview-solutions/isv-ai-wiki.git
   cd isv-ai-wiki
   ./preview.sh
   ```

2. Open [http://127.0.0.1:8765/index.html#village-metering/village-simulator](http://127.0.0.1:8765/index.html#village-metering/village-simulator)

The wiki embeds a **frozen snapshot** of the sim (`isv-ai-wiki/village-simulator/`). Same sidebar as [isv.wiki](https://isv.wiki/). Details: [isv-ai-wiki README → Offline in one go](https://github.com/overview-solutions/isv-ai-wiki#offline-in-one-go-start-here).

---

## Develop / run the live app (this repo)

**One-click (macOS):** double-click **`Start Simulator.command`** in this folder (or the Desktop alias **Start Village Simulator**). Uses Homebrew arm64 Node when present (avoids nvm Rosetta × wrong `@rollup/rollup-darwin-*`). First run may `npm install`; then Vite opens [http://127.0.0.1:5176/](http://127.0.0.1:5176/). Leave the Terminal window open; Ctrl+C stops the server. Needs Node/npm and the workbench `CIR/yang/locus` checkout (`file:` dependency).

For **editing** simulator code, BUILD/MAINT UX, or cutting a new freeze into the wiki:

```sh
cd smart-village-simulator   # or ISV/smart-village-simulator in the workbench
npm install
npm start                    # http://127.0.0.1:5176 (opens browser)
npm test
```

`@circaevum/locus` is a `file:` dependency on `CIR/yang/locus` in the Overview/Circaevum workbench. Standalone clones must point that dep at `github:Circaevum/locus` (or an npm pack) before CI/Pages.

Offline basemaps: run `npm run map:prepare` once while online, then `npm start`. Satellite still needs internet; other packs are local when prepared.

**Do not** develop against the wiki’s frozen `village-simulator/` copy — change this repo, then refresh the wiki snapshot when ready.

## Boundary

| Layer | Owns |
|-------|------|
| Locus (`@circaevum/locus`) | Time→Y (`TimeContext`), ENU↔WGS84, `LocusGL` / `LocusMap` |
| This app | Meters, feeders, tariffs, payments, village meshes, UI |
| ISV wiki | Docs, nav, hash aliases. Live embed is still the wiki's frozen static copy until Pages cutover |

LocusMap owns the visible canvas, basemaps, camera, and shared renderer. Village
meshes and time geometry attach directly to its scene. Drag to pan, right-drag
to rotate/pitch, scroll to zoom. Satellite requires internet; other basemaps use
local packs. The offscreen ground texture has been removed.

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

## Village basemap

Run `npm run map:prepare` while connected, then `npm start`. The ignored local
packs ship in Vite builds when present. Geographic, bright, light, dark, satellite (online), and no-map
options are available. Map tiles are zoom 12–14, overscaled for the village; this
is a geographic map, not terrain. The Voundou anchor does not
make the generated houses or electrical network surveyed infrastructure.

## Productive-use scenario

The planning panel toggles four irrigation pumps, a cold room, two mills, a
welding shop, two tailors, a produce market, repair/charging shop, bakery, and six
street lights. Each has geometry, a schedule and a demand profile. Expand
“Businesses and equipment” for per-asset energy, tariff charges and water output.
Scrubbing updates the scenario and its comparison with baseline consumption.
Inputs are illustrative additional loads. The overlay assumes supplied power;
it does not yet change feeder dispatch, outages or household billing. No thermal,
spoilage, solar-surplus or business-income claims are inferred.

## Scale and water infrastructure

Productive buildings use the existing schematic home footprint as a reference
(shops about 1–1.4 scene units wide; homes about 0.6–0.8). This is proportional
schematic geometry, not full-size surveyed buildings. `village-water.js` adds an
explicitly hypothetical river beyond the settlement edge, intake, treatment,
elevated tank, standpipes, wastewater collection, treatment basins and a wetland
reuse area. Colored pipes show conceptual connections, not hydraulic design.

Voundou anchor confirmed by user: 4.79209 N, 11.53412 E. Legacy schematic
ground units convert to 8 metres; equipment heights convert by 3. Homes are
about 4.7–6.4 m wide and ~2.1–2.2 m wall height; poles about 8.4 m.
Layout remains generated, not traced building footprints. Time-Y is a diagram,
not physical altitude. Do not infer population or existing assets from this scenario.
