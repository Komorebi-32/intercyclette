/**
 * test_housing_dedup.js — Unit tests for the OSM/Accueil Vélo deduplication.
 *
 * Tests the coordinate-grid helpers extracted from map.js that decide whether
 * an OSM housing point duplicates an Accueil Vélo point (same establishment),
 * so duplicates can be dropped and the establishment kept only as its AV point.
 *
 * Run with: node tests/test_housing_dedup.js
 */

"use strict";

const assert = require("assert");

// ── Functions reproduced from map.js for testability ─────────────────────────

const DUP_COORD_DECIMALS = 4;

/**
 * Round a coordinate value to a fixed number of decimal places.
 *
 * @param {number} value - Latitude or longitude in decimal degrees.
 * @param {number} decimals - Number of decimal places to round to (>= 0).
 * @returns {number} The rounded value.
 */
function roundCoord(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Build the grid-cell key for a coordinate pair at a given precision.
 *
 * @param {number} lat - Latitude in decimal degrees.
 * @param {number} lon - Longitude in decimal degrees.
 * @param {number} decimals - Number of decimal places defining the grid cell.
 * @returns {string} A "lat,lon" key string for the cell.
 */
function coordKey(lat, lon, decimals) {
  return roundCoord(lat, decimals) + ',' + roundCoord(lon, decimals);
}

/**
 * Build a Set of grid-cell keys covering all valid Accueil Vélo points.
 *
 * @param {Array<Object>} avPoints - Accueil Vélo points ({lat, lon, …}).
 * @param {number} decimals - Grid precision in decimal places.
 * @returns {Set<string>} Set of "lat,lon" cell keys.
 */
function buildAvCoordKeySet(avPoints, decimals) {
  const keys = new Set();
  avPoints.forEach(function (p) {
    if (typeof p.lat === 'number' && typeof p.lon === 'number') {
      keys.add(coordKey(p.lat, p.lon, decimals));
    }
  });
  return keys;
}

/**
 * Decide whether an OSM housing point duplicates an Accueil Vélo point.
 *
 * @param {Object} osmPoint - OSM housing point ({lat, lon, …}).
 * @param {Set<string>} avKeySet - AV grid-cell keys from buildAvCoordKeySet.
 * @param {number} decimals - Grid precision in decimal places.
 * @returns {boolean} True when an AV point lies in the point's neighbourhood.
 */
function isOsmDuplicateOfAv(osmPoint, avKeySet, decimals) {
  if (typeof osmPoint.lat !== 'number' || typeof osmPoint.lon !== 'number') {
    return false;
  }
  const step = 1 / Math.pow(10, decimals);
  for (let dLat = -1; dLat <= 1; dLat += 1) {
    for (let dLon = -1; dLon <= 1; dLon += 1) {
      const key = coordKey(
        osmPoint.lat + dLat * step,
        osmPoint.lon + dLon * step,
        decimals
      );
      if (avKeySet.has(key)) return true;
    }
  }
  return false;
}

// ── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * Run a single test, recording pass/fail and printing the result.
 *
 * @param {string} description - Human-readable test label.
 * @param {Function} fn - Test body that throws on failure.
 */
function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${description}: ${err.message}`);
    failed += 1;
  }
}

// ── roundCoord ───────────────────────────────────────────────────────────────

console.log("roundCoord:");
test("rounds to 4 decimals", function () {
  assert.strictEqual(roundCoord(48.123456, 4), 48.1235);
});
test("rounds down when below midpoint", function () {
  assert.strictEqual(roundCoord(2.000049, 4), 2.0);
});
test("handles negative coordinates", function () {
  assert.strictEqual(roundCoord(-1.234567, 4), -1.2346);
});
test("0 decimals rounds to integer", function () {
  assert.strictEqual(roundCoord(46.8, 0), 47);
});

// ── coordKey ─────────────────────────────────────────────────────────────────

console.log("coordKey:");
test("builds a 'lat,lon' key at precision", function () {
  assert.strictEqual(coordKey(48.123456, 2.654321, 4), "48.1235,2.6543");
});
test("nearby coordinates within a cell share a key", function () {
  assert.strictEqual(
    coordKey(48.12340, 2.65430, 4),
    coordKey(48.12342, 2.65431, 4)
  );
});

// ── buildAvCoordKeySet ───────────────────────────────────────────────────────

console.log("buildAvCoordKeySet:");
test("collects one key per distinct cell", function () {
  const set = buildAvCoordKeySet(
    [{ lat: 48.1, lon: 2.1 }, { lat: 49.2, lon: 3.2 }],
    DUP_COORD_DECIMALS
  );
  assert.strictEqual(set.size, 2);
  assert.ok(set.has("48.1,2.1"));
});
test("empty input yields an empty set", function () {
  assert.strictEqual(buildAvCoordKeySet([], DUP_COORD_DECIMALS).size, 0);
});
test("skips points without numeric coordinates", function () {
  const set = buildAvCoordKeySet(
    [{ lat: 48.1, lon: 2.1 }, { lat: null, lon: 2.2 }, { name: "no coords" }],
    DUP_COORD_DECIMALS
  );
  assert.strictEqual(set.size, 1);
});

// ── isOsmDuplicateOfAv ───────────────────────────────────────────────────────

console.log("isOsmDuplicateOfAv:");
const avKeys = buildAvCoordKeySet([{ lat: 48.5000, lon: 2.5000 }], DUP_COORD_DECIMALS);

test("identical coordinates are a duplicate", function () {
  assert.strictEqual(
    isOsmDuplicateOfAv({ lat: 48.5000, lon: 2.5000 }, avKeys, DUP_COORD_DECIMALS),
    true
  );
});
test("offset within neighbouring cell is a duplicate", function () {
  assert.strictEqual(
    isOsmDuplicateOfAv({ lat: 48.50012, lon: 2.49991 }, avKeys, DUP_COORD_DECIMALS),
    true
  );
});
test("far-away point is not a duplicate", function () {
  assert.strictEqual(
    isOsmDuplicateOfAv({ lat: 45.0, lon: 1.0 }, avKeys, DUP_COORD_DECIMALS),
    false
  );
});
test("point two cells away is not a duplicate", function () {
  assert.strictEqual(
    isOsmDuplicateOfAv({ lat: 48.5003, lon: 2.5000 }, avKeys, DUP_COORD_DECIMALS),
    false
  );
});
test("point without numeric coordinates is never a duplicate", function () {
  assert.strictEqual(
    isOsmDuplicateOfAv({ name: "no coords" }, avKeys, DUP_COORD_DECIMALS),
    false
  );
});
test("no AV points means nothing is a duplicate", function () {
  const empty = buildAvCoordKeySet([], DUP_COORD_DECIMALS);
  assert.strictEqual(
    isOsmDuplicateOfAv({ lat: 48.5, lon: 2.5 }, empty, DUP_COORD_DECIMALS),
    false
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
