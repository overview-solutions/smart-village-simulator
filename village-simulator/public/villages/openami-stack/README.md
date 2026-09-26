# openami-stack — hypothetical OpenAMI path

One compatible stack. **Not** an any-to-any matrix.

## Pick in the 3D sim

Site dropdown → **OpenAMI stack**, or `/?site=openami-stack`.

Then `npm run villages:sync` if you edited this pack.

```sh
node scripts/build-openami-stack.mjs
npm run villages:sync
```

## Layers (this pack only)

1. **First km** — Street EMS (NESL hardware) + MeshEMS (E-IOT firmware) on the same pole cabinets (`ems-w`, `ems-m`). Field / IOT meters hang off those boards.
2. **Aggregation** — **MPM Manager** (`cab-mpm`). SparkNet Hub and OpenEMS are siblings, not stacked here.
3. **Backend** — **EnAccess MPM** (feed on `cab-mpm`, `env:MPM_URL`). OpenEMS is the other backend pick: Linux village box, MeshEMS fan-in OK, **no SparkNet / DLMS/COSEM / STS yet**.
4. **Later** — GroundBolt-style prepaid + O&M (`sim` / `groundbolt` meter feeds). Sim already has those hooks. Not a second backend.

## UN geometry

Same pack shape as `voundou-grid`: `village.json`, `network/{structure,electric-devices,electric-junctions,electric-lines,subnetworks}.geojson`, `associations.json`, `feeds/registry.json`.

14 service points / meters so Operations + Loads can run (BUILD overlay seeded from pack). Hypothetical plant on the Voundou pin — not surveyed assets. No private contacts or prices.

Regenerate: `node scripts/build-openami-stack.mjs`.
