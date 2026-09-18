import * as THREE from 'three';
import { PRODUCTIVE_ASSETS, productiveUseAt } from './productive-use.js';

export function buildProductiveUse(scene, tariff, baselineKWh, labelSprite) {
  const group = new THREE.Group();
  scene.add(group);
  function box(w, h, d, color, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh;
  }
  for (const asset of PRODUCTIVE_ASSETS) {
    const { x, z, kind } = asset;
    const firstPart = group.children.length;
    if (kind === 'pump') {
      box(1.2, .6, .8, 0x328fc2, x, .3, z);
      box(.16, .16, 4, 0x71bddd, x, .25, z + 2);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2, 16), new THREE.MeshLambertMaterial({ color: 0x7bc2d6 }));
      tank.position.set(x, 1, z + 4); group.add(tank);
      for (let i=0;i<5;i++) box(5,.04,.12,0x338e67,x+4,.08,z+i);
    } else if (kind === 'light') {
      box(.09,3,.09,0x79868a,x,1.5,z);
      box(.7,.1,.12,0x79868a,x+.3,3,z);
    } else if (kind === 'market') {
      for (let i=0;i<4;i++) {
        box(1.5,.8,.8,0xb18d5b,x+i*1.8, .4,z);
        box(1.7,.12,1.3,i%2 ? 0xe1b94c : 0x52998c,x+i*1.8,2,z);
        for (const dx of [-.65,.65]) box(.06,2,.06,0x78634d,x+i*1.8+dx,1,z);
        box(1,.2,.5,0x72a546,x+i*1.8,.9,z);
      }
    } else {
      const color = {cold:0xd7e9e9,mill:0xc49b67,weld:0x70849a,tailor:0xba8bb3,shop:0xcab886}[kind];
      box(3.5,2.4,2.6,color,x,1.2,z);
      box(3.7,.15,2.8,0x4a8192,x,2.45,z);
      box(.9,1.9,.1,0x538da6,x,.95,z+1.35);
      if (kind === 'mill') {
        const silo = new THREE.Mesh(new THREE.CylinderGeometry(.5,.65,2,10),new THREE.MeshLambertMaterial({color:0xc9c6ad}));
        silo.position.set(x+2.4,1,z);group.add(silo);
      }
      if (kind === 'weld') box(1.7,.15,.9,0x555d65,x+2.5,1,z);
      if (kind === 'tailor') box(1.2,.12,.6,0xad8172,x,1,z+1.8);
      if (kind === 'cold') box(.8,.6,.4,0x536974,x+1,.7,z+1.5);
    }
    // Existing homes are roughly 0.6–0.8 units wide; shops are 1–1.4 units.
    const scale = kind === 'light' ? .8 : kind === 'pump' ? .5 : kind === 'market' ? .45 : .38;
    for (const part of group.children.slice(firstPart)) {
      part.position.x = x + (part.position.x - x) * scale;
      part.position.z = z + (part.position.z - z) * scale;
      part.position.y *= scale;
      part.scale.multiplyScalar(scale);
    }
  }
  const indicators = PRODUCTIVE_ASSETS.map(a => {
    const led = box(.10, .10, .10, 0x40505a, a.x, a.kind === 'light' ? 2.4 : 1.15, a.z);
    if (a.kind === 'light') return led;
    const label = labelSprite(a.label, '#a7e4ee', 340);
    label.position.set(a.x, 1.8, a.z); label.scale.set(4, .65, 1); group.add(label);
    return led;
  });
  const panel = document.getElementById('wl-productive');
  panel.innerHTML = `<h2>Productive-use planning</h2>
    <label><input id="wl-productive-enabled" type="checkbox" checked> Add productive-use village</label>
    <details><summary>Businesses and equipment</summary><div id="wl-productive-assets"></div></details>
    <p id="wl-productive-values" aria-live="polite"></p>
    <svg viewBox="0 0 240 46" role="img" aria-label="Additional demand from village businesses, irrigation, refrigeration and street lighting"><path id="wl-productive-chart" fill="none" stroke="#39b9c5" stroke-width="2"/></svg>
    <small>00:00 — 12:00 — 24:00 · additional demand (auto-scaled)</small>
    <details><summary>Assumptions and accounting</summary><p>Illustrative additional assets: four daytime pumps, two mills, welding shop, two tailors, market, repair/charging shop, bakery, cold room and six 40 W street lights. Duty cycles run at the start of each operating hour. These are additional planning loads, separate from existing household and civic demand. Cold room nominal capacity: 1,000 kg. Tariff: ${tariff} abstract units/kWh.</p><p>This incremental planning overlay assumes electricity is supplied. Solar-hour scheduling does not guarantee solar surplus. It does not yet alter feeder outages, storage dispatch or household bills. Cold-room temperature, spoilage and business income are not modeled. The energy charge is a customer expense and potential utility revenue, not profit or development-fund surplus.</p></details>`;
  const checkbox = document.getElementById('wl-productive-enabled');
  let lastMinute = 0;
  const daily = productiveUseAt(1440, tariff);
  function update(minute) {
    lastMinute = minute;
    const enabled = checkbox.checked;
    group.visible = enabled;
    const v = productiveUseAt(minute, tariff, enabled);
    v.assets.forEach((a,i) => {
      indicators[i].material.color.setHex(a.on ? (a.kind === 'light' ? 0xffe6a0 : 0x39f3b0) : 0x40505a);
      indicators[i].material.emissive.setHex(a.on ? (a.kind === 'light' ? 0xffd572 : 0x18664a) : 0);
    });
    const hhmm = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
    document.getElementById('wl-productive-assets').innerHTML = v.assets.map(a => `<div style="border-bottom:1px solid #456;padding:4px 0"><b>${a.label}</b> · ${a.on?'ON':'OFF'}<br>${a.kw} kW · ${(a.windows || [[a.start,a.end]]).map(w=>w.map(hhmm).join('–')).join(', ')} · ${Math.round((a.duty ?? 1)*100)}% duty<br>${a.kWh.toFixed(2)} kWh · charge ${a.cost.toFixed(2)}${a.m3PerHour ? ` · ${a.waterM3.toFixed(1)} m³` : ''}</div>`).join('');
    document.getElementById('wl-productive-values').innerHTML = `Now: <b>${v.kw.toFixed(2)} kW</b> · pump ${v.pumping ? 'running' : 'off'} · compressor ${v.cooling ? 'running' : 'off'}<br>
      Through playhead: ${v.kWh.toFixed(2)} kWh total (${v.pumpKWh.toFixed(2)} irrigation, ${v.coldKWh.toFixed(2)} refrigeration)<br>
      Water pumped: <b>${v.waterM3.toFixed(1)} m³</b> · energy charge: ${v.cost.toFixed(2)}<br>
      Full day: baseline ${baselineKWh.toFixed(2)} → ${(baselineKWh + (enabled ? daily.kWh : 0)).toFixed(2)} kWh<br>
      Additional daily charge: ${(enabled ? daily.cost : 0).toFixed(2)} · water: ${enabled ? daily.waterM3 : 0} m³`;
    const maxKW = PRODUCTIVE_ASSETS.reduce((sum,a)=>sum+a.kw,0);
    document.getElementById('wl-productive-chart').setAttribute('d', Array.from({ length: 241 }, (_, i) => `${i ? 'L' : 'M'}${i},${44 - productiveUseAt(i * 6, tariff, enabled).kw / maxKW * 40}`).join(' '));
  }
  checkbox.addEventListener('change', () => update(lastMinute));
  update(0);
  return update;
}
