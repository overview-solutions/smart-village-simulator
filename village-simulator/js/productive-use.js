/** Illustrative planning inputs, not vendor specifications. Money is abstract units. */
export const PRODUCTIVE_ASSETS = [
  { id: 'irrigation', kind: 'pump', label: 'West irrigation', x: -40, z: 36, kw: 2, start: 540, end: 900, m3PerHour: 6 },
  { id: 'cold-room', kind: 'cold', label: 'Community cold room', x: 3, z: 9, kw: 1.2, start: 0, end: 1440, duty: .4, capacityKg: 1000 },
  { id: 'pump-south', kind: 'pump', label: 'South irrigation', x: 8, z: 68, kw: 1.5, start: 600, end: 900, m3PerHour: 4 },
  { id: 'pump-east', kind: 'pump', label: 'East irrigation', x: 55, z: 27, kw: 2, start: 540, end: 840, m3PerHour: 6 },
  { id: 'pump-north', kind: 'pump', label: 'North gardens', x: -32, z: -24, kw: 1, start: 660, end: 960, m3PerHour: 3 },
  { id: 'mill-west', kind: 'mill', label: 'Grain mill', x: -34, z: 20, kw: 4, start: 480, end: 1020, duty: .5 },
  { id: 'mill-south', kind: 'mill', label: 'Maize mill', x: 18, z: 46, kw: 3, start: 540, end: 960, duty: .5 },
  { id: 'welder', kind: 'weld', label: 'Welding workshop', x: 28, z: 17, kw: 5, start: 480, end: 1020, duty: .25 },
  { id: 'tailor-west', kind: 'tailor', label: 'West tailor', x: -21, z: 15, kw: .25, start: 480, end: 1080, duty: .6 },
  { id: 'tailor-east', kind: 'tailor', label: 'East tailor', x: 36, z: 2, kw: .25, start: 540, end: 1140, duty: .6 },
  { id: 'market', kind: 'market', label: 'Produce market', x: -3, z: 15, kw: .8, start: 360, end: 1200 },
  { id: 'repair', kind: 'shop', label: 'Repair and charging', x: 15, z: 15, kw: .6, start: 480, end: 1140 },
  { id: 'bakery', kind: 'shop', label: 'Community bakery', x: -13, z: 21, kw: 2.5, start: 300, end: 600, duty: .6 },
  ...[[-15,10], [5,22], [28,30], [-38,28], [12,53], [40,12]].map(([x,z], i) => ({ id: `light-${i}`, kind: 'light', label: `Street light ${i + 1}`, x, z, kw: .04, windows: [[0,360],[1080,1440]] })),
];

function activeMinutes(t, a) {
  return (a.windows || [[a.start, a.end]]).reduce((sum, [start,end]) => {
    const minutes = Math.max(0, Math.min(t, end) - start);
    const duty = a.duty ?? 1;
    return sum + Math.floor(minutes / 60) * 60 * duty + Math.min(minutes % 60, 60 * duty);
  }, 0);
}
export function productiveUseAt(minute, tariff, enabled = true) {
  const t = Math.max(0, Math.min(1440, Number(minute) || 0));
  const assets = PRODUCTIVE_ASSETS.map(a => {
    const on = enabled && t < 1440 && (a.windows || [[a.start,a.end]]).some(([start,end]) => t >= start && t < end && (t-start)%60 < 60*(a.duty ?? 1));
    const hours = enabled ? activeMinutes(t,a)/60 : 0;
    return { ...a, on, demandKW: on ? a.kw : 0, kWh: hours*a.kw, waterM3: hours*(a.m3PerHour || 0), cost: hours*a.kw*tariff };
  });
  const sum = key => assets.reduce((s,a) => s+a[key],0);
  return { assets, kw:sum('demandKW'), kWh:sum('kWh'), cost:sum('cost'), waterM3:sum('waterM3'),
    pumping: assets.some(a=>a.kind==='pump'&&a.on), cooling: assets[1].on,
    pumpKWh:assets.filter(a=>a.kind==='pump').reduce((s,a)=>s+a.kWh,0), coldKWh:assets[1].kWh };
}
