# Voundou grid — traced UN pack

Operator schematic overlay → Map Twin. Same origin pin as the worldline site
(`4.79209 N, 11.53412 E`). **Not surveyed GPS.**

| Overlay | Pack | Length |
|---------|------|--------|
| Red 4×70 mm² | `primary` · 380 V · `ABCN` | 2708 m (key) |
| Black 4×25 mm² | `secondary` · 220 V · `ABCN` | 3796 m (key) |

Solar plant sits on the NW red T (arrow on the print). White hub circle =
village bus. White end-circles = termini. No house service laterals — those
were off the drawing.

380 V L-L / 220 V L-N is one 4-wire system. Colour-change nodes are **taps**,
not transformers.

Regenerate after moving sketch nodes:

```sh
node scripts/build-voundou-grid.mjs
npm run villages:sync
```

Print used for the trace: `source-schematic.jpg` (in this folder).

3D sim (`/`) loads this pack on boot. No 2D hub.
