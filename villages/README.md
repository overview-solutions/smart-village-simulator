# Village microgrid packs — GeoJSON Utility Network (open)

**Offline browse:** use the [ISV wiki](https://github.com/overview-solutions/isv-ai-wiki#offline-in-one-go-start-here) (`./preview.sh`) — Village Simulator embed includes schematic village data. This folder is for **live** pack / UN GeoJSON work in `smart-village-simulator`.

**Human map of this contract:** wiki page `meter-village-geojson-un.html` → `#village-metering/village-geojson-un` (Map Twin essential vs nice-to-have layers).

Per-village folder packs for **Map Twin** (geometry + topology) and optional
**Live Twin** (`feeds/registry.json` API bindings). Circaevum / Locus stay
separate: Locus draws; this tree owns energy topology.

Model target: **Esri Utility Network semantics** (devices, junctions, lines,
terminals, subnetworks, associations) expressed as **GeoJSON + JSON**, OpenAMI-
aligned — no ArcGIS lock-in. See wiki standards note (Esri UN ↔ OpenAMI GeoJSON).

**Sample layers:** `demo-lv/` ships at least one feature in every Essential file
and every Nice-to-have class the schema lists (junctions, enclosure, disconnect,
recloser, neutral, terminals, containment / attachment, feed bindings). Copy it
or start from `_template/`.

## LOD (fetch contract)

| LOD | Camera / selection | Files loaded | Live API |
|-----|--------------------|--------------|----------|
| **0** | Region / multi-site | `village.json` bbox + pin only | none |
| **1** | Village open | `network/subnetworks.geojson` + `electric-lines.geojson` (trunk) + structure poles | feeder rollups only (optional) |
| **2** | Feeder selected | That feeder’s devices, junctions, laterals from `network/*` filtered by `subnetworkId` | EMS / DCU / feeder head meter |
| **3** | Meter / house selected | Service laterals + meter points already in pack | **that meter’s** OBIS / prepaid / MQTT — never whole village |

Rule: **geometry always local files; telemetry always on demand by selected id.**
Do not bake kWh series into GeoJSON.

## Folder layout

```
villages/
  _schema/                 # shared contract (versioned)
  _template/               # copy → villages/<siteId>/
  <siteId>/                # one pack per microgrid
    village.json
    network/
    feeds/
```

Today’s generated blob `village-simulator/grid.geojson` remains the **schematic
export** until a pack migrates Voundou into `villages/voundou/`. Do not fork both.

## Asset classes (UN ↔ GeoJSON)

| UN idea | File | Geometry | `properties.assetClass` |
|---------|------|----------|-------------------------|
| Structure junction | `network/structure.geojson` | Point | `pole`, `cabinet`, `pad` |
| Electric device | `network/electric-devices.geojson` | Point | `meter`, `breaker`, `fuse`, `recloser`, `inverter`, `bess`, `ems`, `dtm`, `gen` |
| Electric junction | `network/electric-junctions.geojson` | Point | `bus`, `splice`, `service_point` |
| Electric line | `network/electric-lines.geojson` | LineString | `trunk`, `primary`, `secondary`, `service` |
| Assembly / station | devices or structure | Point | `xfmr`, `station` |
| Subnetwork | `network/subnetworks.geojson` | Point or Polygon | `island`, `feeder` |
| Connectivity / containment | `network/associations.json` | — | edges only |

Every feature: stable `id` (string), `assetClass`, `assetGroup`, `subnetworkId`
(self id on island/feeder features; feeder id on everything else). Optional
`globalId` (UUID), `terminals[]` when multi-port (xfmr, EMS).

Trace = walk `associations.json` `connectivity` edges (± direction) within one
`subnetworkId`, then climb to island via feeder head → station.

## API bindings

`feeds/registry.json` maps **asset id → feed descriptor** (URL template, MQTT
topic, OBIS set, auth ref). Runtime resolves only after LOD 2/3 selection.
No secrets in pack — refs to env / leaf config only.

## Demo pack + viz

`demo-lv/` — hypothetical island + two feeders; **sample of every Essential and
Nice-to-have layer**. Open `villages/demo-lv/index.html` or
`http://localhost:5176/demo-lv/` (Vite serves `village-simulator/public/demo-lv/`).
Layer toggles · feeder select = LOD 2 · meter click = LOD 3 feed binding.

After editing pack JSON, rebuild the embedded `PACK` and sync public:

```sh
npm run villages:sync-demo
```


## Switch sites in the simulator

Catalog: [`catalog.json`](catalog.json). Packs are data. 3D sim (`/`) is the only viewer — `/villages/` redirects there.

| id | Kind |
|----|------|
| `voundou` | Worldline prepaid day (`/`) — only viewer |
| `demo-lv` | Pack data (not a separate page) |
| `safari-park-casino` | Pack data — Nairobi workshop |
| `voundou-grid` | Drawn in 3D sim — traced 380/220 overlay (no house services) |
| `openami-stack` | Hypothetical OpenAMI path — Street EMS + MeshEMS → MPM Manager → EnAccess MPM |

After editing a pack:

```sh
npm run villages:sync
# demo-lv embedded PACK still:
npm run villages:sync-demo
```

## New village

```sh
cp -R villages/_template villages/<siteId>
# edit village.json origin + network GeoJSON
# register feeds/registry.json ids to match feature ids
# or copy villages/demo-lv as a filled sample and rename
```
