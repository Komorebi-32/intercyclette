/**
 * transitous.js — Transitous API journey lookup engine.
 *
 * Queries the Transitous public routing API (https://api.transitous.org) for
 * rail journeys between two geographic coordinates.  No pre-built data file
 * is required: each search triggers a live API call.
 *
 * The browser sends the page Referer header automatically on every cross-origin
 * request, which satisfies the Transitous attribution requirement.
 *
 * API reference: https://transitous.org/api/
 *
 * Exposes: window.InterTimetable  (same namespace as the replaced timetable.js)
 */

(function () {
  "use strict";

  // ── Constants ───────────────────────────────────────────────────────────────

  /** Base URL for the Transitous routing API. */
  const TRANSITOUS_API_BASE = "https://api.transitous.org/api/v5";

  /**
   * Transit modes passed to the API.  RAIL covers TER, Intercités and similar
   * long-distance rail services that accept bicycles.
   */
  const TRANSIT_MODES = "RAIL";

  /** Maximum number of transfers allowed in a journey. */
  const MAX_TRANSFERS = 5;

  // ── Encoded polyline decoder ─────────────────────────────────────────────────

  /**
   * Decode a Google Encoded Polyline string into an array of [lat, lon] pairs.
   *
   * Implements the standard Google Encoded Polyline Algorithm
   * (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
   * The Transitous API (MOTIS) uses this format for legGeometry.points.
   *
   * @param {string} encoded - Encoded polyline string.
   * @returns {Array<[number, number]>} Decoded array of [lat, lon] coordinate pairs.
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

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Convert a UTC ISO 8601 datetime string to a local-timezone ISO string
   * without the "Z" suffix so that formatTime() in results.js reads the
   * correct local hour.
   *
   * @param {string} utcIsoStr - UTC datetime, e.g. "2026-05-02T06:22:00Z".
   * @returns {string} Local datetime, e.g. "2026-05-02T08:22:00".
   */
  function _utcToLocalIso(utcIsoStr) {
    const d = new Date(utcIsoStr);
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day   = String(d.getDate()).padStart(2, "0");
    const h     = String(d.getHours()).padStart(2, "0");
    const m     = String(d.getMinutes()).padStart(2, "0");
    const s     = String(d.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day}T${h}:${m}:${s}`;
  }

  /**
   * Convert a local ISO datetime string (no timezone suffix) to a UTC ISO
   * string suitable for the Transitous API's "time" parameter.
   *
   * @param {string} localIsoStr - Local datetime, e.g. "2026-05-02T08:00:00".
   * @returns {string} UTC datetime, e.g. "2026-05-02T06:00:00.000Z".
   */
  function _localToUtcIso(localIsoStr) {
    return new Date(localIsoStr).toISOString();
  }

  /**
   * Return the legs of a Transitous itinerary that are transit (non-WALK).
   *
   * @param {Object[]} legs - Full leg array from the Transitous itinerary.
   * @returns {Object[]} Only the transit legs.
   */
  function _transitLegs(legs) {
    return (legs || []).filter(function (leg) {
      return leg.mode !== "WALK";
    });
  }

  /**
   * Attempt to decode the leg geometry from a Transitous API leg object.
   *
   * The API returns geometry as an encoded polyline in leg.legGeometry.points.
   * Returns null if the geometry is absent or cannot be decoded.
   *
   * @param {Object} leg - A single leg from the Transitous itinerary.
   * @returns {Array<[number, number]>|null} Decoded [lat, lon] pairs, or null.
   */
  function _extractLegPoints(leg) {
    const encoded =
      leg && leg.legGeometry && typeof leg.legGeometry.points === "string"
        ? leg.legGeometry.points
        : null;
    if (!encoded) return null;
    try {
      const pts = decodePolyline(encoded);
      return pts.length > 0 ? pts : null;
    } catch (_) {
      return null;
    }
  }

  // ── API query ───────────────────────────────────────────────────────────────

  /**
   * Call the Transitous /plan endpoint and return the best itineraries.
   *
   * @param {number} fromLat - Departure latitude.
   * @param {number} fromLon - Departure longitude.
   * @param {number} toLat - Arrival latitude.
   * @param {number} toLon - Arrival longitude.
   * @param {string} localIsoDatetime - Desired local departure datetime,
   *   e.g. "2026-05-02T08:00:00" (no timezone suffix — interpreted as local).
   * @param {number} [maxResults=1] - Maximum number of itineraries to return.
   * @returns {Promise<Object[]>} Resolves with an array of raw Transitous
   *   itinerary objects (may be empty if no journey was found).
   * @throws {Error} On network failure or non-200 HTTP response.
   */
  async function queryJourney(fromLat, fromLon, toLat, toLon, localIsoDatetime, maxResults) {
    const limit = maxResults !== undefined ? maxResults : 1;
    const utcTime = _localToUtcIso(localIsoDatetime);

    const params = new URLSearchParams({
      fromPlace:    `${fromLat},${fromLon}`,
      toPlace:      `${toLat},${toLon}`,
      time:         utcTime,
      transitModes: TRANSIT_MODES,
      maxTransfers: String(MAX_TRANSFERS),
    });

    const url = `${TRANSITOUS_API_BASE}/plan?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Transitous API error: HTTP ${response.status}`);
    }

    const data = await response.json();
    const itineraries = data.itineraries || [];
    return itineraries.slice(0, limit);
  }

  // ── Journey result builder ──────────────────────────────────────────────────

  /**
   * Parse a raw Transitous itinerary object into the journey result shape
   * expected by buildItineraryCard() in search.js.
   *
   * Station names, departure and arrival times are taken from the first and
   * last transit legs. Walking legs are ignored. Leg geometry (encoded
   * polyline) is decoded when present so the map can draw the actual rail
   * track instead of a Bézier arc.
   *
   * @param {Object} itinerary - A single itinerary from the Transitous API.
   * @returns {{from_station_nom:string, to_station_nom:string,
   *   departure_datetime:string, arrival_datetime:string,
   *   duration_minutes:number, nb_transfers:number,
   *   train_type:string,
   *   sections:Array<{mode:string, from:string, to:string,
   *                   duration_min:number, points:Array|null}>}|null}
   *   Journey result object, or null if the itinerary has no transit legs.
   */
  function buildJourneyResult(itinerary) {
    if (!itinerary) return null;

    const transitLegs = _transitLegs(itinerary.legs);
    if (transitLegs.length === 0) return null;

    const firstLeg = transitLegs[0];
    const lastLeg  = transitLegs[transitLegs.length - 1];

    const depUtc = firstLeg.from.departure;
    const arrUtc = lastLeg.to.arrival;

    const depLocal = _utcToLocalIso(depUtc);
    const arrLocal = _utcToLocalIso(arrUtc);

    const depMs = new Date(depUtc).getTime();
    const arrMs = new Date(arrUtc).getTime();
    const durationMinutes = Math.round((arrMs - depMs) / 60000);

    const trainType = firstLeg.mode || "RAIL";

    const sections = transitLegs.map(function (leg) {
      const legDepMs  = new Date(leg.from.departure).getTime();
      const legArrMs  = new Date(leg.to.arrival).getTime();
      return {
        mode:         leg.mode,
        from:         leg.from.name,
        to:           leg.to.name,
        duration_min: Math.round((legArrMs - legDepMs) / 60000),
        points:       _extractLegPoints(leg),
      };
    });

    return {
      from_station_nom:   firstLeg.from.name,
      to_station_nom:     lastLeg.to.name,
      departure_datetime: depLocal,
      arrival_datetime:   arrLocal,
      duration_minutes:   durationMinutes,
      nb_transfers:       itinerary.transfers || 0,
      train_type:         trainType,
      sections:           sections,
    };
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  /**
   * Convert a duration in minutes to a human-readable French-style string.
   *
   * @param {number} totalMinutes - Non-negative integer number of minutes.
   * @returns {string} E.g. "1h 35min", "45min", "2h".
   */
  function formatDurationMinutes(totalMinutes) {
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return minutes + "min";
    if (minutes === 0) return hours + "h";
    return hours + "h " + minutes + "min";
  }

  /**
   * Convert integer minutes since midnight to an "HH:MM" time string.
   * Kept for compatibility with any callers that still use minute-based times.
   *
   * @param {number} minutes - Minutes since midnight (0–1439).
   * @returns {string} Time string, e.g. "08:05".
   */
  function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.InterTimetable = {
    queryJourney,
    buildJourneyResult,
    formatDurationMinutes,
    minutesToTime,
    // Exposed for unit tests
    decodePolyline,
  };
})();
