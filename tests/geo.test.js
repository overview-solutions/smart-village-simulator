import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORIGIN, M_PER_DEG_LAT, enuToLonLat, lonLatToEnu, geoidBlock } from "../village-simulator/js/geo.js";

describe("enuToLonLat", () => {
  it("keeps the configured geographic origin", () => {
    assert.deepEqual(enuToLonLat(0, 0, 0), [ORIGIN.lon, ORIGIN.lat, ORIGIN.alt]);
  });

  it("maps +X east and −Z north", () => {
    const east = enuToLonLat(M_PER_DEG_LAT, 0, 2);
    const north = enuToLonLat(0, -M_PER_DEG_LAT, 2);
    assert.ok(Math.abs(east[0] - ORIGIN.lon - 1 / Math.cos(ORIGIN.lat * Math.PI / 180)) < 1e-9);
    assert.ok(Math.abs(east[1] - ORIGIN.lat) < 1e-12);
    assert.equal(east[2], 2);
    assert.ok(Math.abs(north[0] - ORIGIN.lon) < 1e-12);
    assert.ok(Math.abs(north[1] - ORIGIN.lat - 1) < 1e-9);
  });

  it("round-trips ENU", () => {
    const [lon, lat, alt] = enuToLonLat(40, -12, 1.23);
    const back = lonLatToEnu(lon, lat, alt);
    assert.ok(Math.abs(back.x - 40) < 1e-6);
    assert.ok(Math.abs(back.z - -12) < 1e-6);
    assert.ok(Math.abs(back.h - 1.23) < 1e-9);
  });
});

describe("geoidBlock", () => {
  it("is a GeoJSON Point Feature", () => {
    const b = geoidBlock("h0", "house", 0, 0, 0, { name: "Amina" });
    assert.equal(b.type, "Feature");
    assert.equal(b.geometry.type, "Point");
    assert.deepEqual(b.geometry.coordinates, [ORIGIN.lon, +ORIGIN.lat.toFixed(8), ORIGIN.alt]);
    assert.equal(b.properties.id, "h0");
    assert.equal(b.properties.kind, "house");
    assert.equal(b.properties.name, "Amina");
    assert.equal(b.properties.x, 0);
    assert.equal(b.properties.z, 0);
  });
});

it('exports schematic positions at metre scale around Voundou', () => {
  const p = geoidBlock('test','pole',10,20,2.8);
  const local = lonLatToEnu(...p.geometry.coordinates);
  assert.ok(Math.abs(local.x-80)<.01);
  assert.ok(Math.abs(local.z-160)<.01);
  assert.equal(p.geometry.coordinates[2],8.4);
});
