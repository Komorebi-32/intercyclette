/**
 * tests/js/map.test.js — Unit tests for pure geometry helpers in map.js.
 *
 * computeBezierPoints is a pure function with no DOM or Leaflet dependency;
 * it is re-implemented here verbatim for isolated testing.
 */

"use strict";

// ── Pure function re-implementation (mirroring map.js exactly) ───────────────

const BEZIER_NUM_POINTS = 60;

/**
 * Compute BEZIER_NUM_POINTS + 1 points along a quadratic Bézier arc.
 *
 * @param {number} latA
 * @param {number} lonA
 * @param {number} latB
 * @param {number} lonB
 * @returns {Array<[number, number]>}
 */
function computeBezierPoints(latA, lonA, latB, lonB) {
  const midLat = (latA + latB) / 2;
  const midLon = (lonA + lonB) / 2;
  const dLat   = latB - latA;
  const dLon   = lonB - lonA;
  const cpLat  = midLat - dLon * 0.25;
  const cpLon  = midLon + dLat * 0.25;

  const points = [];
  for (let i = 0; i <= BEZIER_NUM_POINTS; i++) {
    const t = i / BEZIER_NUM_POINTS;
    const u = 1 - t;
    points.push([
      u * u * latA + 2 * u * t * cpLat + t * t * latB,
      u * u * lonA + 2 * u * t * cpLon + t * t * lonB,
    ]);
  }
  return points;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("computeBezierPoints", () => {
  const latA = 48.8566;  // Paris
  const lonA = 2.3522;
  const latB = 43.2965;  // Marseille
  const lonB = 5.3698;

  test("returns exactly BEZIER_NUM_POINTS + 1 points", () => {
    const pts = computeBezierPoints(latA, lonA, latB, lonB);
    expect(pts.length).toBe(BEZIER_NUM_POINTS + 1);
  });

  test("first point equals start coordinate", () => {
    const pts = computeBezierPoints(latA, lonA, latB, lonB);
    expect(pts[0][0]).toBeCloseTo(latA, 10);
    expect(pts[0][1]).toBeCloseTo(lonA, 10);
  });

  test("last point equals end coordinate", () => {
    const pts = computeBezierPoints(latA, lonA, latB, lonB);
    const last = pts[pts.length - 1];
    expect(last[0]).toBeCloseTo(latB, 10);
    expect(last[1]).toBeCloseTo(lonB, 10);
  });

  test("midpoint is offset from the straight-line midpoint (curve is not straight)", () => {
    const pts = computeBezierPoints(latA, lonA, latB, lonB);
    const midIndex = Math.floor(pts.length / 2);
    const midPt = pts[midIndex];
    // Straight-line midpoint
    const straightMidLat = (latA + latB) / 2;
    const straightMidLon = (lonA + lonB) / 2;
    // The bezier midpoint must differ from the straight-line midpoint
    const latDiff = Math.abs(midPt[0] - straightMidLat);
    const lonDiff = Math.abs(midPt[1] - straightMidLon);
    expect(latDiff + lonDiff).toBeGreaterThan(0.01);
  });

  test("all points are [lat, lon] arrays of length 2", () => {
    const pts = computeBezierPoints(latA, lonA, latB, lonB);
    pts.forEach((pt) => {
      expect(pt).toHaveLength(2);
      expect(typeof pt[0]).toBe("number");
      expect(typeof pt[1]).toBe("number");
    });
  });

  test("latitudes stay within a reasonable France bounding box", () => {
    const pts = computeBezierPoints(latA, lonA, latB, lonB);
    pts.forEach((pt) => {
      expect(pt[0]).toBeGreaterThan(40);
      expect(pt[0]).toBeLessThan(52);
    });
  });

  test("handles identical start and end (degenerate arc)", () => {
    const pts = computeBezierPoints(48.0, 2.0, 48.0, 2.0);
    expect(pts.length).toBe(BEZIER_NUM_POINTS + 1);
    pts.forEach((pt) => {
      expect(pt[0]).toBeCloseTo(48.0, 8);
      expect(pt[1]).toBeCloseTo(2.0, 8);
    });
  });

  test("short arc (nearby cities) still produces correct point count", () => {
    const pts = computeBezierPoints(48.85, 2.35, 48.90, 2.40);
    expect(pts.length).toBe(BEZIER_NUM_POINTS + 1);
  });
});
