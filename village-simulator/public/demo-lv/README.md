# demo-lv — hypothetical pack + layer viz

All Utility Network–style layers filled (island + 2 feeders).

**Served with the app** (Vite copies live under `village-simulator/public/demo-lv/`):

```sh
npm start
# http://localhost:5176/demo-lv/
```

GitHub Pages (after deploy): `…/demo-lv/` on the Pages site.

Pack source of truth: `villages/demo-lv/` (`village.json`, `network/`, `feeds/`).
This public folder is a served copy — run `npm run villages:sync-demo` after pack edits.

Canvas twin: Cursor canvas `demo-lv-microgrid-layers`.
