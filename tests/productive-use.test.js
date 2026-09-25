import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productiveUseAt } from '../village-simulator/js/productive-use.js';
test('daily energy, water and tariff costs reconcile', () => {
  const day = productiveUseAt(1440, 200);
  assert.equal(day.pumpKWh, 34.5);
  assert.ok(Math.abs(day.coldKWh - 11.52) < 1e-9);
  assert.equal(day.waterM3, 101);
  assert.ok(Math.abs(day.cost - day.kWh * 200) < 1e-8);
  let integrated = 0;
  for (let t = 0; t < 1440; t++) integrated += productiveUseAt(t, 200).kw / 60;
  assert.ok(Math.abs(integrated - day.kWh) < 1e-8);
});
test('pump follows solar-hour window and playback can rewind', () => {
  assert.equal(productiveUseAt(539, 200).pumping, false);
  assert.equal(productiveUseAt(540, 200).pumping, true);
  assert.equal(productiveUseAt(960, 200).pumping, false);
  assert.equal(productiveUseAt(0, 200).kWh, 0);
  assert.equal(productiveUseAt(600, 200).waterM3, 12);
});
test('baseline switch removes all additional demand, energy and charges', () => {
  const v = productiveUseAt(1440, 200, false);
  for (const key of ['kw', 'kWh', 'cost', 'waterM3']) assert.equal(v[key], 0);
});

test('night lighting and business opening and duty-cycle boundaries', () => {
  const at = t => productiveUseAt(t, 200).assets;
  assert.equal(at(0).find(a=>a.id==='light-0').on, true);
  assert.equal(at(720).find(a=>a.id==='light-0').on, false);
  assert.equal(at(480).find(a=>a.id==='welder').on, true);
  assert.equal(at(495).find(a=>a.id==='welder').on, false);
  assert.equal(at(1200).find(a=>a.id==='market').on, false);
  assert.equal(new Set(at(0).map(a=>a.id)).size, at(0).length);
});
