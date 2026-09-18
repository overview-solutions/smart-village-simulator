import { LocusMap } from '@circaevum/locus/map';
import { ORIGIN, GROUND_SCALE } from './geo.js';

export async function createVillageMap(container) {
  const select = document.getElementById('wl-basemap');
  const status = document.getElementById('wl-map-status');
  const paths = { liberty:'demo', bright:'demo-bright', positron:'demo-positron', dark:'demo-dark' };
  const satellite = { version:8, sources:{ imagery:{ type:'raster', tileSize:256, maxzoom:19,
    tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution:'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community' } },
    layers:[{ id:'satellite', type:'raster', source:'imagery' }] };
  const style = key => key === 'satellite' ? satellite : key === 'none' ? {version:8,sources:{},layers:[]} : new URL(`maps/${paths[key]}/style.json`,location.href).href;
  let selected = new URLSearchParams(location.search).get('basemap') || 'liberty';
  if (!(selected in paths) && !['satellite','none'].includes(selected)) selected='liberty';
  select.add(new Option('Map: satellite (online)', 'satellite'));
  select.value=selected;
  const viewer=new LocusMap(container,{origin:ORIGIN,zoom:19,pitch:55,bearing:0,
    offline:selected!=='satellite',style:style(selected),
    onError:()=>{status.textContent='Map asset unavailable · check local packs or satellite connection';}});
  // Gesture ownership: village-worldline-day owns drag orbit/pan + click hop.
  // Keep scroll / pinch zoom available until the app rebinds.
  viewer.map.scrollZoom.enable();
  viewer.map.touchZoomRotate.enable();
  viewer.map.dragPan.disable();
  viewer.map.dragRotate.disable();
  viewer.map.keyboard.disable();
  const copy=()=>{status.textContent=`Locus · Voundou · hypothetical infrastructure · ${selected==='satellite'?'satellite online':'local map'}`;};
  viewer.map.on('render',()=>{if(viewer.map.isStyleLoaded() && viewer.map.areTilesLoaded()) copy();});
  select.addEventListener('change',async()=>{
    selected=select.value;
    viewer.offline=selected!=='satellite';
    const url=new URL(location.href);url.searchParams.set('basemap',selected);history.replaceState(null,'',url);
    status.textContent='Loading basemap…';
    try { await viewer.setBasemap(style(selected)); } catch {status.textContent='Basemap unavailable';}
  });
  await viewer.ready;
  if (!viewer.renderer) await new Promise(resolve=>viewer.map.once('style.load',resolve));
  window.addEventListener('pagehide',()=>viewer.destroy(),{once:true});
  const fitBounds = viewer.camera.fitBounds;
  viewer.camera.fitBounds = (b, options) => fitBounds(Object.fromEntries(Object.entries(b).map(([k,v])=>[k,v*GROUND_SCALE])), options);
  const flyTo = viewer.camera.flyTo;
  viewer.camera.flyTo = options => flyTo({...options,x:options.x*GROUND_SCALE,z:options.z*GROUND_SCALE,zoom:options.zoom-Math.log2(GROUND_SCALE)});
  return viewer;
}
