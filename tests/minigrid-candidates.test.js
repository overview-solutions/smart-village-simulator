import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../village-simulator/public/data/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('africa-minigrid-candidates.geojson', root)));
const manifest = JSON.parse(readFileSync(new URL('africa-minigrid-candidates.manifest.json', root)));

test('candidate layer has unique geographic points and explicit uncertainty and provenance', () => {
  assert.equal(data.type, 'FeatureCollection');
  assert.equal(new Set(data.features.map(f => f.id)).size, data.features.length);
  const counts = {};
  for (const f of data.features) {
    assert.equal(f.geometry.type, 'Point');
    const [lon, lat] = f.geometry.coordinates;
    assert.ok(Number.isFinite(lon) && lon >= -20 && lon <= 55);
    assert.ok(Number.isFinite(lat) && lat >= -36 && lat <= 38);
    const p = f.properties;
    assert.equal(p.current_eligibility, 'unverified');
    assert.equal(p.current_grid_connection, 'unknown');
    assert.equal(p.source_license, 'CC0-1.0');
    assert.ok(p.source_url.startsWith('https://energydata.info/dataset/'));
    assert.ok(p.evidence_date && p.geometry_basis);
    if (p.country_code === 'ZM') {
      assert.equal(p.source_classification, 'Mini-grid');
      assert.equal(p.settlement_classification, 'rural');
    } else assert.equal(p.country_code, 'KE');
    counts[p.country] = (counts[p.country] || 0) + 1;
  }
  assert.deepEqual(counts, manifest.counts);
  assert.equal(data.features.length, 1946);
  assert.equal(manifest.zambia_exclusions.non_minigrid_or_conflicting_classification, 284);
});
