# Village microgrid packs — GeoJSON Utility Network (open)

Per-village folder packs for **map + topology trace + API bindings**.
Circaevum / Locus stay separate: Locus draws; this tree owns energy topology.

Model target: **Esri Utility Network semantics** (devices, junctions, lines,
terminals, subnetworks, associations) expressed as **GeoJSON + JSON**, OpenAMI-
aligned — no ArcGIS lock-in. See wiki standards note (Esri UN ↔ OpenAMI GeoJSON).

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

Every feature: stable `id` (string), optional `globalId` (UUID), `subnetworkId`
(feeder), `terminals[]` when multi-port (xfmr, EMS).

Trace = walk `associations.json` `connectivity` edges (± direction) within one
`subnetworkId`, then climb to island via feeder head → station.

## API bindings

`feeds/registry.json` maps **asset id → feed descriptor** (URL template, MQTT
topic, OBIS set, auth ref). Runtime resolves only after LOD 2/3 selection.
No secrets in pack — refs to env / leaf config only.

## Demo pack + viz

`demo-lv/` — small hypothetical island + 2 feeders with **every** layer filled.
Open `demo-lv/layers.html` in a browser (or Cursor canvas `demo-lv-microgrid-layers`)
to toggle layers / LOD / feeder and click devices for feed bindings.

## New village

```sh
cp -R villages/_template villages/<siteId>
# edit village.json origin + network GeoJSON
# register feeds/registry.json ids to match feature ids
```

## Demo pack + viz

`demo-lv/` — hypothetical island + two feeders with **every** layer filled.
Open `villages/demo-lv/index.html` (embedded data) or `npx serve villages/demo-lv`.
Layer toggles · feeder select = LOD 2 · meter click = LOD 3 feed binding.
