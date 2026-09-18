# Africa mini-grid candidate layer

`africa-minigrid-candidates.geojson` contains **1,946 historical planning sites**:
1,795 rural Zambia sites and 151 proposed Kenya projects. EPSG:4326 longitude,
latitude; one point per project. Open as a vector layer in QGIS or import into
MapLibre. With the simulator running, download `/data/africa-minigrid-candidates.geojson`.
This is an initial two-country layer, not an Africa-wide inventory.

## What the screening means

These sources selected mini-grids in historical least-cost planning. We interpret
“not a larger utility” as **mini-grid supply instead of main-grid extension**.
This does not exclude utility ownership: a utility can own a mini-grid.
No record certifies current eligibility, licensing, lack of grid service, or absence
of an announced grid extension. Do not use this alone to select investments.

- **Zambia:** retain only `Elec metho = Mini-grid` AND `Urban/Rura = rural`.
  The nominal mini-grid file also includes 161 grid-extension and 123 unknown
  method records; all 284 are excluded, along with 311 urban mini-grid records.
  Retain `Classifica = MG or GE` as `source_alternative_classification`: this
  ambiguity must remain visible. Metadata updated 2022-11-30; analysis date is
  not established. Labels such as “Site 148” are not verified village names.
- **Kenya:** 151 named proposed projects from the 2017–2018 least-cost study.
  A point on each proposed generator polygon represents its location; these are
  not village centroids or surveyed generator installations. Inclusion in the
  proposed project layer does not establish a population or a village boundary.

Before promoting any candidate, check current national/utility extension plans,
existing service, local demand and anchor loads, renewable resource, feasibility,
land/environmental constraints and the relevant national mini-grid regime.
No universal population or distance threshold is asserted. Voundou is not inserted
without equivalent source evidence. Synthetic simulator infrastructure is not evidence.

## Public sources and license

Both datasets are published with **CC0-1.0** metadata on ENERGYDATA.INFO:

- [Zambia NEP base case mini-grid](https://energydata.info/dataset/zambia-nep-base-case-mini-grid)
- [Kenya potential new mini-grid sites](https://energydata.info/dataset/kenya-potential-new-mini-grid-sites)

Retrieved 2026-09-17. Each feature includes its source URL, classification, evidence
period and location derivation. The companion manifest records normalized input
SHA-256 checksums, counts and exclusion totals. Source licensing applies to data;
repository code licensing remains unchanged.

## Reproduce

Requires Python 3 and GDAL with OpenFileGDB and SQLite support. From repository root:

```sh
curl -L --fail 'https://energydata.info/dataset/f81ebb0a-2642-4860-9101-90a035ce9c47/resource/91134f35-d74a-4944-9c6e-d1aef55f8a29/download/basecase_mini_grids.geojson' -o /tmp/zambia-mini.geojson
curl -L --fail 'https://energydata.info/dataset/e3f39423-dc63-47ad-8548-3a1fd2ee7b86/resource/d7dbbd9f-160b-4f9a-9a9e-3f1ef7e90e68/download/potential_-minigrid_projects.gdb.zip' -o /tmp/kenya-mini.zip
unzip /tmp/kenya-mini.zip -d /tmp/kenya-minigrid-source
ogr2ogr -f GeoJSON /tmp/kenya-generators.geojson '/tmp/kenya-minigrid-source/Potential_ MiniGrid_Projects.gdb' -dialect SQLite -sql 'SELECT mg_name, county, subcounty, ST_PointOnSurface(Shape) AS geometry FROM generator_location' -t_srs EPSG:4326
python3 scripts/import-minigrid-candidates.py /tmp/zambia-mini.geojson /tmp/kenya-generators.geojson
npm test
```

Remove the prior temporary export before rerunning ogr2ogr. GDAL versions can
change serialized intermediate bytes and thus their hash. Raw archives stay outside
git. This layer adds no Locus dependency and is usable independently of the simulator.
