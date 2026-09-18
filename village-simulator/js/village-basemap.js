import { LocusMap } from '@circaevum/locus/map';
import { ORIGIN, GROUND_SCALE } from './geo.js';

/** Online raster — Carto Voyager (green land, blue water, warm urban). */
const natureRaster = {
  version: 8,
  sources: {
    voyager: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 20,
      tiles: [
        'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      ],
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [{ id: 'nature', type: 'raster', source: 'voyager' }],
};

const satellite = {
  version: 8,
  sources: {
    imagery: {
      type: 'raster',
      tileSize: 256,
      maxzoom: 19,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      attribution:
        'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'imagery' }],
};

/**
 * Push liberty / bright vector packs toward a landscape palette
 * (wood, grass, water, earth). Safe no-ops when layer ids missing.
 * @param {import('maplibre-gl').Map} map
 */
function applyNaturalColors(map) {
  if (!map?.getStyle) return;
  const set = (id, prop, value) => {
    if (!map.getLayer(id)) return;
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      /* layer type mismatch — skip */
    }
  };

  set('background', 'background-color', '#dce8c8');

  // Liberty (OpenMapTiles) ids
  set('park', 'fill-color', '#7cb35a');
  set('park', 'fill-opacity', 0.75);
  set('landcover_wood', 'fill-color', '#3f8a3a');
  set('landcover_wood', 'fill-opacity', 0.62);
  set('landcover_grass', 'fill-color', '#9ccc6e');
  set('landcover_grass', 'fill-opacity', 0.55);
  set('landcover_sand', 'fill-color', '#e8d39a');
  set('landcover_wetland', 'fill-color', '#6aa88a');
  set('water', 'fill-color', '#4a90c8');
  set('waterway_river', 'line-color', '#4a90c8');
  set('waterway_other', 'line-color', '#5aa0d0');
  set('landuse_residential', 'fill-color', 'hsla(42, 42%, 82%, 0.45)');
  set('landuse_cemetery', 'fill-color', '#b5c99a');
  set('landuse_school', 'fill-color', '#c5d4a0');
  set('landuse_pitch', 'fill-color', '#8fbf6a');
  set('landuse_track', 'fill-color', '#a8c97a');

  // Bright (OpenMapTiles bright) ids
  set('landcover-wood', 'fill-color', '#3f8a3a');
  set('landcover-wood', 'fill-opacity', 0.45);
  set('landcover-grass', 'fill-color', '#9ccc6e');
  set('landcover-grass-park', 'fill-color', '#7cb35a');
  set('landcover-sand', 'fill-color', '#e8d39a');
  set('water', 'fill-color', '#4a90c8');
  set('waterway-river', 'line-color', '#4a90c8');
  set('waterway-other', 'line-color', '#5aa0d0');
  set('waterway-stream-canal', 'line-color', '#5aa0d0');
  set('park', 'fill-color', '#7cb35a');
}

function needsNetwork(key) {
  return key === 'satellite' || key === 'nature';
}

export async function createVillageMap(container) {
  const select = document.getElementById('wl-basemap');
  const status = document.getElementById('wl-map-status');
  const paths = {
    liberty: 'demo',
    bright: 'demo-bright',
    positron: 'demo-positron',
    dark: 'demo-dark',
  };

  const style = (key) => {
    if (key === 'nature') return natureRaster;
    if (key === 'satellite') return satellite;
    if (key === 'none') return { version: 8, sources: {}, layers: [] };
    return new URL(`maps/${paths[key]}/style.json`, location.href).href;
  };

  let selected = new URLSearchParams(location.search).get('basemap') || 'nature';
  if (!(selected in paths) && !['satellite', 'nature', 'none'].includes(selected)) {
    selected = 'nature';
  }

  // Ensure Nature sits first among online options in the control.
  if (![...select.options].some((o) => o.value === 'nature')) {
    select.add(new Option('Map: nature (online)', 'nature'), 0);
  }
  if (![...select.options].some((o) => o.value === 'satellite')) {
    select.add(new Option('Map: satellite (online)', 'satellite'));
  }
  select.value = selected;

  const viewer = new LocusMap(container, {
    origin: ORIGIN,
    zoom: 19,
    pitch: 55,
    bearing: 0,
    offline: !needsNetwork(selected),
    style: style(selected),
    onError: () => {
      status.textContent =
        'Map asset unavailable · check local packs or nature/satellite connection';
    },
  });

  // Gesture ownership: village-worldline-day owns drag orbit/pan + click hop.
  viewer.map.scrollZoom.enable();
  viewer.map.touchZoomRotate.enable();
  viewer.map.dragPan.disable();
  viewer.map.dragRotate.disable();
  viewer.map.keyboard.disable();

  const labelFor = (key) => {
    if (key === 'nature') return 'nature · Carto Voyager online';
    if (key === 'satellite') return 'satellite online';
    if (key === 'none') return 'no basemap';
    return 'local map';
  };

  const copy = () => {
    status.textContent = `Locus · Voundou · hypothetical infrastructure · ${labelFor(selected)}`;
  };

  const afterStyle = () => {
    // Offline nature falls back to bright pack — push greens/blues there.
    if (selected === 'nature') applyNaturalColors(viewer.map);
    copy();
  };

  viewer.map.on('style.load', afterStyle);
  viewer.map.on('render', () => {
    if (viewer.map.isStyleLoaded() && viewer.map.areTilesLoaded()) copy();
  });

  select.addEventListener('change', async () => {
    selected = select.value;
    viewer.offline = !needsNetwork(selected);
    const url = new URL(location.href);
    url.searchParams.set('basemap', selected);
    history.replaceState(null, '', url);
    status.textContent = 'Loading basemap…';
    try {
      await viewer.setBasemap(style(selected));
      afterStyle();
    } catch {
      // Offline fallback for nature → local bright + landscape paint.
      if (selected === 'nature') {
        try {
          viewer.offline = true;
          await viewer.setBasemap(style('bright'));
          applyNaturalColors(viewer.map);
          status.textContent =
            'Locus · Voundou · nature offline fallback (bright + landscape colors)';
          return;
        } catch {
          /* fall through */
        }
      }
      status.textContent = 'Basemap unavailable';
    }
  });

  await viewer.ready;
  if (!viewer.renderer) await new Promise((resolve) => viewer.map.once('style.load', resolve));
  afterStyle();

  window.addEventListener('pagehide', () => viewer.destroy(), { once: true });
  const fitBounds = viewer.camera.fitBounds;
  viewer.camera.fitBounds = (b, options) =>
    fitBounds(
      Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v * GROUND_SCALE])),
      options,
    );
  const flyTo = viewer.camera.flyTo;
  viewer.camera.flyTo = (options) =>
    flyTo({
      ...options,
      x: options.x * GROUND_SCALE,
      z: options.z * GROUND_SCALE,
      zoom: options.zoom - Math.log2(GROUND_SCALE),
    });
  return viewer;
}
