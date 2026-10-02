import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolvePlace, cacheSitePack, parseCoordPair } from "../village-simulator/js/village-site-cache.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("resolvePlace", () => {
  it("parses lat, lon without a request", async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("fetch");
    };
    const pin = await resolvePlace("4.792, 11.534");
    assert.equal(called, false);
    assert.equal(pin.lat, 4.792);
    assert.equal(pin.lon, 11.534);
    assert.deepEqual(parseCoordPair("4.792, 11.534").lat, 4.792);
  });

  it("asks Nominatim, not /api/geocode", async () => {
    /** @type {string[]} */
    const urls = [];
    globalThis.fetch = async (url) => {
      urls.push(String(url));
      return new Response(
        JSON.stringify([{ lat: "4.79", lon: "11.53", display_name: "Voundou, Cameroon" }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const pin = await resolvePlace("Voundou, Cameroon");
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
    assert.equal(urls[0].includes("/api/geocode"), false);
    assert.match(urls[0], /q=Voundou(\+|%20|,|%2C)+Cameroon/);
    assert.equal(pin.lat, 4.79);
    assert.equal(pin.lon, 11.53);
    assert.equal(pin.label, "Voundou, Cameroon");
  });

  it("does not throw an HTML body", async () => {
    globalThis.fetch = async () =>
      new Response("<!DOCTYPE html><title>Site not found</title>", { status: 404 });
    await assert.rejects(
      () => resolvePlace("Voundou, Cameroon"),
      (err) => {
        assert.match(err.message, /Place lookup failed/);
        assert.equal(/<!doctype/i.test(err.message), false);
        assert.equal(err.message.includes("Site not found"), false);
        return true;
      },
    );
  });
});

describe("cacheSitePack", () => {
  it("does not call /api/site-pack outside the Vite dev server", async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response("<!DOCTYPE html>", { status: 404 });
    };
    await assert.rejects(
      () => cacheSitePack({ lon: 11.53, lat: 4.79, name: "Voundou" }),
      (err) => {
        assert.equal(err.message, "Offline map pack needs the local dev server.");
        assert.equal(/<!doctype/i.test(err.message), false);
        return true;
      },
    );
    assert.equal(called, false);
  });
});
