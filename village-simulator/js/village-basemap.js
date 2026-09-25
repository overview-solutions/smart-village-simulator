import { LocusMap } from '@circaevum/locus/map';
import { Matrix4 } from 'three';
import { M_PER_DEG_LAT } from '@circaevum/locus/geo';
import { ORIGIN, GROUND_SCALE } from './geo.js';

/** Same local-tangent matrix LocusMap uses. Keeps 3D meshes on the new pin. */
export function rebindMapOrigin(viewer, origin = ORIGIN) {
  if (!viewer) return;
  viewer.origin = { ...viewer.origin, lon: origin.lon, lat: origin.lat, alt: origin.alt || 0 };
  const r = origin.lat * Math.PI / 180;
  const scale = 1 / (360 * M_PER_DEG_LAT * Math.cos(r));
  const x = (origin.lon + 180) / 360;
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) / 2;
  viewer._matrix = new Matrix4().set(scale, 0, 0, x, 0, 0, scale, y, 0, scale, 0, 0, 0, 0, 0, 1);
  viewer.map?.triggerRepaint?.();
}

/** Online satellite (Esri). Nature = local bright pack + lush green paints (offline-safe). */
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

const GREEN = {
  background: '#4f8f35',
  wood: '#2f6b28',
  grass: '#6cb84a',
  park: '#5aa83c',
  wetland: '#4a8f68',
  sand: '#d4c478',
  water: '#3d7eae',
  residential: 'hsla(95, 28%, 72%, 0.35)',
  suburb: 'hsla(95, 32%, 70%, 0.25)',
  cemetery: '#7aad5c',
  school: '#8fbf6a',
  pitch: '#5aa83c',
  industrial: 'hsla(85, 20%, 75%, 0.3)',
  commercial: 'hsla(90, 18%, 78%, 0.28)',
};

/**
 * Heavy green landscape — background alone reads as “lots of green” where landcover is sparse.
 * @param {import('maplibre-gl').Map} map
 */
function applyNaturalColors(map) {
  if (!map?.getStyle) return;
  const set = (id, prop, value) => {
    if (!map.getLayer(id)) return;
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      /* skip */
    }
  };

  set('background', 'background-color', GREEN.background);

  // Liberty (demo)
  set('park', 'fill-color', GREEN.park);
  set('park', 'fill-opacity', 0.9);
  set('landcover_wood', 'fill-color', GREEN.wood);
  set('landcover_wood', 'fill-opacity', 0.85);
  set('landcover_grass', 'fill-color', GREEN.grass);
  set('landcover_grass', 'fill-opacity', 0.95);
  set('landcover_sand', 'fill-color', GREEN.sand);
  set('landcover_wetland', 'fill-color', GREEN.wetland);
  set('landcover_wetland', 'fill-opacity', 0.85);
  set('water', 'fill-color', GREEN.water);
  set('waterway_river', 'line-color', GREEN.water);
  set('waterway_other', 'line-color', GREEN.water);
  set('landuse_residential', 'fill-color', GREEN.residential);
  set('landuse_cemetery', 'fill-color', GREEN.cemetery);
  set('landuse_school', 'fill-color', GREEN.school);
  set('landuse_pitch', 'fill-color', GREEN.pitch);
  set('landuse_track', 'fill-color', GREEN.grass);

  // Bright (demo-bright)
  set('landcover-wood', 'fill-color', GREEN.wood);
  set('landcover-wood', 'fill-opacity', 0.85);
  set('landcover-grass', 'fill-color', GREEN.grass);
  set('landcover-grass', 'fill-opacity', 1);
  set('landcover-grass-park', 'fill-color', GREEN.park);
  set('landcover-grass-park', 'fill-opacity', 0.95);
  set('landcover-sand', 'fill-color', GREEN.sand);
  set('water', 'fill-color', GREEN.water);
  set('waterway-river', 'line-color', GREEN.water);
  set('waterway-other', 'line-color', GREEN.water);
  set('waterway-stream-canal', 'line-color', GREEN.water);
  set('park', 'fill-color', GREEN.park);
  set('park', 'fill-opacity', 0.85);
  set('landuse-residential', 'fill-color', GREEN.residential);
  set('landuse-suburb', 'fill-color', GREEN.suburb);
  set('landuse-cemetery', 'fill-color', GREEN.cemetery);
  set('landuse-school', 'fill-color', GREEN.school);
  set('landuse-industrial', 'fill-color', GREEN.industrial);
  set('landuse-commercial', 'fill-color', GREEN.commercial);
  set('landuse-railway', 'fill-color', GREEN.suburb);
}

function needsNetwork(key) {
  return key === 'satellite';
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

  const localStyleUrl = (key) => new URL(`maps/${paths[key]}/style.json`, location.href).href;

  const style = (key) => {
    if (key === 'satellite') return satellite;
    if (key === 'none') {
      return {
        version: 8,
        sources: {},
        layers: [{ id: 'background', type: 'background', paint: { 'background-color': GREEN.background } }],
      };
    }
    // Nature = local bright (or liberty) URL — greens applied on style.load
    if (key === 'nature') return siteStyleUrl || localStyleUrl('bright');
    return localStyleUrl(key);
  };

  let siteStyleUrl = null;
  let selected = new URLSearchParams(location.search).get('basemap') || 'nature';
  if (!(selected in paths) && !['satellite', 'nature', 'none'].includes(selected)) {
    selected = 'nature';
  }

  if (![...select.options].some((o) => o.value === 'nature')) {
    select.add(new Option('Nature', 'nature'), 0);
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
        'Map asset unavailable · run npm run map:prepare or pick satellite online';
    },
  });

  const enableGestures = () => {
    viewer.map.scrollZoom.enable();
    viewer.map.touchZoomRotate.enable();
    viewer.map.dragPan.enable();
    viewer.map.dragRotate.enable();
    viewer.map.touchPitch?.enable?.();
    viewer.map.keyboard.disable();
  };
  enableGestures();

  const labelFor = (key) => {
    if (key === 'nature') return 'nature · lush green';
    if (key === 'satellite') return 'satellite online';
    if (key === 'none') return 'no basemap';
    return 'local map';
  };

  const copy = () => {
    const place = ORIGIN.name || 'Voundou';
    status.textContent = `Locus · ${place} · ${labelFor(selected)}`;
  };

  const afterStyle = () => {
    enableGestures();
    if (selected === 'nature') {
      applyNaturalColors(viewer.map);
      // Retry once tiles/layers settle — first paint can race style.load.
      requestAnimationFrame(() => applyNaturalColors(viewer.map));
      setTimeout(() => applyNaturalColors(viewer.map), 200);
    }
    copy();
    viewer.map.triggerRepaint();
  };

  viewer.map.on('style.load', afterStyle);
  viewer.map.on('idle', () => {
    if (selected === 'nature') applyNaturalColors(viewer.map);
  });
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
      if (selected === 'nature') {
        try {
          viewer.offline = true;
          await viewer.setBasemap(localStyleUrl('liberty'));
          afterStyle();
          status.textContent = 'Locus · Voundou · nature greens (liberty pack)';
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
  viewer.useOnlineSatellite = async () => {
    selected = 'satellite';
    if (select) select.value = 'satellite';
    viewer.offline = false;
    await viewer.setBasemap(satellite);
    afterStyle();
  };
  viewer.useLocalStyle = async (styleUrl, { adopt } = {}) => {
    siteStyleUrl = styleUrl;
    const wantNature = adopt === true || selected === 'nature' || select?.value === 'nature';
    if (!wantNature) {
      afterStyle();
      return;
    }
    selected = 'nature';
    if (select) select.value = 'nature';
    viewer.offline = true;
    await viewer.setBasemap(styleUrl);
    applyNaturalColors(viewer.map);
    requestAnimationFrame(() => applyNaturalColors(viewer.map));
    afterStyle();
  };
  viewer.refreshStatus = copy;
  viewer.clearSiteStyle = () => {
    siteStyleUrl = null;
  };
  return viewer;
}
