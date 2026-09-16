import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ORIGIN, M_PER_DEG_LAT, enuToLonLat, lonLatToEnu, geoidBlock } from "../village-simulator/js/geo.js";

describe("enuToLonLat", () => {
  it("keeps the origin at Null Island", () => {
    assert.deepEqual(enuToLonLat(0, 0, 0), [ORIGIN.lon, ORIGIN.lat, ORIGIN.alt]);
  });

  it("maps +X east and −Z north", () => {
    const east = enuToLonLat(M_PER_DEG_LAT, 0, 2);
    const north = enuToLonLat(0, -M_PER_DEG_LAT, 2);
    assert.ok(Math.abs(east[0] - 1) < 1e-9);
    assert.ok(Math.abs(east[1]) < 1e-12);
    assert.equal(east[2], 2);
    assert.ok(Math.abs(north[0]) < 1e-12);
    assert.ok(Math.abs(north[1] - 1) < 1e-9);
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
    assert.deepEqual(b.geometry.coordinates, [ORIGIN.lon, ORIGIN.lat, ORIGIN.alt]);
    assert.equal(b.properties.id, "h0");
    assert.equal(b.properties.kind, "house");
    assert.equal(b.properties.name, "Amina");
    assert.equal(b.properties.x, 0);
    assert.equal(b.properties.z, 0);
  });
});
