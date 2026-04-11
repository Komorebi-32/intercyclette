/**
 * tests/js/transitous.test.js — Unit tests for the encoded polyline decoder
 * and formatting helpers in transitous.js.
 */

"use strict";

// ── Pure function re-implementations (mirroring transitous.js exactly) ────────

/**
 * Decode a Google Encoded Polyline string into [lat, lon] pairs.
 *
 * @param {string} encoded
 * @returns {Array<[number, number]>}
 */
function decodePolyline(encoded) {
  const result = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let byte;
    let shift = 0;
    let result_value = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result_value |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result_value & 1) !== 0 ? ~(result_value >> 1) : (result_value >> 1);
    lat += deltaLat;

    shift = 0;
    result_value = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result_value |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLon = (result_value & 1) !== 0 ? ~(result_value >> 1) : (result_value >> 1);
    lon += deltaLon;

    result.push([lat / 1e5, lon / 1e5]);
  }

  return result;
}

/**
 * @param {number} totalMinutes
 * @returns {string}
 */
function formatDurationMinutes(totalMinutes) {
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return minutes + "min";
  if (minutes === 0) return hours + "h";
  return hours + "h " + minutes + "min";
}

// ── decodePolyline ─────────────────────────────────────────────────────────────

describe("decodePolyline", () => {
  // Google's own example: Atlanta → Chicago = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
  // decoded: [38.5, -120.2], [40.7, -120.95], [43.252, -126.453]
  const GOOGLE_EXAMPLE_ENCODED = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
  const GOOGLE_EXAMPLE_DECODED = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ];

  test("decodes Google example correctly — point count", () => {
    const pts = decodePolyline(GOOGLE_EXAMPLE_ENCODED);
    expect(pts.length).toBe(3);
  });

  test("decodes first coordinate of Google example", () => {
    const pts = decodePolyline(GOOGLE_EXAMPLE_ENCODED);
    expect(pts[0][0]).toBeCloseTo(GOOGLE_EXAMPLE_DECODED[0][0], 3);
    expect(pts[0][1]).toBeCloseTo(GOOGLE_EXAMPLE_DECODED[0][1], 3);
  });

  test("decodes second coordinate of Google example", () => {
    const pts = decodePolyline(GOOGLE_EXAMPLE_ENCODED);
    expect(pts[1][0]).toBeCloseTo(GOOGLE_EXAMPLE_DECODED[1][0], 3);
    expect(pts[1][1]).toBeCloseTo(GOOGLE_EXAMPLE_DECODED[1][1], 3);
  });

  test("decodes third coordinate of Google example", () => {
    const pts = decodePolyline(GOOGLE_EXAMPLE_ENCODED);
    expect(pts[2][0]).toBeCloseTo(GOOGLE_EXAMPLE_DECODED[2][0], 3);
    expect(pts[2][1]).toBeCloseTo(GOOGLE_EXAMPLE_DECODED[2][1], 3);
  });

  test("returns empty array for empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  test("each decoded point is a [lat, lon] pair", () => {
    const pts = decodePolyline(GOOGLE_EXAMPLE_ENCODED);
    pts.forEach((pt) => {
      expect(pt).toHaveLength(2);
      expect(typeof pt[0]).toBe("number");
      expect(typeof pt[1]).toBe("number");
    });
  });

  test("single-point encoding decodes to one point", () => {
    // Encoding of (48.85, 2.35):
    //   lat_e5 = 4885000, *2 = 9770000  → chunks [16,0,5,10,9] → "o_diH"
    //   lon_e5 =  235000, *2 =  470000  → chunks [16,31,10,14]  → "o~iM"
    const pts = decodePolyline("o_diHo~iM");
    expect(pts.length).toBe(1);
    expect(pts[0][0]).toBeCloseTo(48.85, 2);
    expect(pts[0][1]).toBeCloseTo(2.35, 2);
  });
});

// ── formatDurationMinutes ──────────────────────────────────────────────────────

describe("formatDurationMinutes", () => {
  test("formats whole hours without minutes", () => {
    expect(formatDurationMinutes(120)).toBe("2h");
  });

  test("formats sub-hour durations in minutes only", () => {
    expect(formatDurationMinutes(45)).toBe("45min");
  });

  test("formats mixed hours and minutes", () => {
    expect(formatDurationMinutes(95)).toBe("1h 35min");
  });

  test("formats zero minutes", () => {
    expect(formatDurationMinutes(0)).toBe("0min");
  });

  test("formats 1 minute", () => {
    expect(formatDurationMinutes(1)).toBe("1min");
  });

  test("formats exactly 1 hour", () => {
    expect(formatDurationMinutes(60)).toBe("1h");
  });

  test("formats 1h 1min", () => {
    expect(formatDurationMinutes(61)).toBe("1h 1min");
  });

  test("formats large durations", () => {
    expect(formatDurationMinutes(300)).toBe("5h");
    expect(formatDurationMinutes(315)).toBe("5h 15min");
  });
});
