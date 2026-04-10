/**
 * timetable.js — In-browser GTFS timetable lookup engine.
 *
 * Loads the precomputed static/data/timetable.json index (built by
 * scripts/build_gtfs_index.py) and answers direct-train journey queries
 * given a departure UIC, an arrival UIC, a date, and a minimum departure
 * time.  No network calls are made at query time.
 *
 * Expected timetable.json shape:
 *   {
 *     train_types: ["TER", "INTERCITES"],
 *     date_range: { min: 20260101, max: 20261231 },
 *     services: { "1": [20260501, 20260502, ...], ... },
 *     trips: [ { svc: 1, type: 0, stops: [[87123456, 480], ...] }, ... ]
 *   }
 *
 * Exposes: window.InterTimetable
 */

(function () {
  "use strict";

  // ── Module state ────────────────────────────────────────────────────────────

  /** Raw timetable data loaded from JSON. @type {Object|null} */
  let _timetable = null;

  /**
   * Per-service Set of dates for O(1) membership tests.
   * @type {Object.<string, Set<number>>|null}
   */
  let _serviceSets = null;

  /**
   * Reverse index: UIC integer → array of trip indices that include that UIC.
   * Built at load time to avoid scanning all trips on every query.
   * @type {Map<number, number[]>|null}
   */
  let _uicToTripIndices = null;

  // ── Loading ─────────────────────────────────────────────────────────────────

  /**
   * Fetch and parse the timetable JSON, then build acceleration structures.
   *
   * Safe to call multiple times — subsequent calls return the already-loaded
   * timetable immediately.
   *
   * @param {string} [basePath='static/data'] - Directory containing timetable.json.
   * @returns {Promise<void>} Resolves when the timetable is ready to query.
   */
  function loadTimetable(basePath) {
    if (_timetable !== null) return Promise.resolve();
    const url = (basePath || "static/data") + "/timetable.json";
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " loading " + url);
        return r.json();
      })
      .then(function (data) {
        _timetable = data;
        _buildAccelerationStructures(data);
      });
  }

  /**
   * Build serviceSets and uicToTripIndices from the loaded timetable data.
   *
   * serviceSets converts each service's date array into a Set for O(1) lookup.
   * uicToTripIndices maps each UIC code to the indices of trips that visit it,
   * so queryJourney only iterates over relevant trips rather than all trips.
   *
   * @param {Object} data - Parsed timetable JSON object.
   */
  function _buildAccelerationStructures(data) {
    // Convert date arrays to Sets
    _serviceSets = {};
    const services = data.services || {};
    for (const key of Object.keys(services)) {
      _serviceSets[key] = new Set(services[key]);
    }

    // Build UIC → trip-index reverse map
    _uicToTripIndices = new Map();
    const trips = data.trips || [];
    for (let i = 0; i < trips.length; i++) {
      for (const stop of trips[i].stops) {
        const uic = stop[0];
        if (!_uicToTripIndices.has(uic)) {
          _uicToTripIndices.set(uic, []);
        }
        _uicToTripIndices.get(uic).push(i);
      }
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /**
   * Find direct trains from fromUic to toUic on a given date.
   *
   * A trip qualifies when:
   *   - Its service runs on dateInt (O(1) via serviceSets)
   *   - fromUic appears in its stop list at position i with dep_minutes >= afterMinutes
   *   - toUic appears at a later position j > i in the same stop list
   *
   * Results are sorted by ascending departure time; the first maxResults are
   * returned.
   *
   * @param {number} fromUic - Departure station UIC as integer (e.g. 87723197).
   * @param {number} toUic - Arrival station UIC as integer.
   * @param {number} dateInt - Travel date as YYYYMMDD integer (e.g. 20260501).
   * @param {number} afterMinutes - Earliest acceptable departure, in minutes
   *   since midnight (e.g. 480 for 08:00).
   * @param {number} [maxResults=3] - Maximum number of results to return.
   * @returns {Array<{dep_minutes:number, arr_minutes:number, duration_minutes:number,
   *   train_type:string}>} Matching journey rows, sorted by departure time.
   *   Empty array if no direct train exists or timetable is not loaded.
   */
  function queryJourney(fromUic, toUic, dateInt, afterMinutes, maxResults) {
    if (!_timetable || !_serviceSets || !_uicToTripIndices) return [];
    const limit = maxResults !== undefined ? maxResults : 3;
    const trips = _timetable.trips;
    const trainTypes = _timetable.train_types || ["TER", "INTERCITES"];
    const candidateIndices = _uicToTripIndices.get(fromUic) || [];
    const results = [];

    for (const idx of candidateIndices) {
      const trip = trips[idx];
      const svcKey = String(trip.svc);
      if (!_serviceSets[svcKey] || !_serviceSets[svcKey].has(dateInt)) continue;

      const stops = trip.stops;
      let fromIdx = -1;
      let fromDep = -1;

      for (let i = 0; i < stops.length; i++) {
        const [uic, dep] = stops[i];
        if (uic === fromUic && dep >= afterMinutes && fromIdx === -1) {
          fromIdx = i;
          fromDep = dep;
        }
        if (fromIdx !== -1 && uic === toUic) {
          results.push({
            dep_minutes: fromDep,
            arr_minutes: dep,
            duration_minutes: dep - fromDep,
            train_type: trainTypes[trip.type] || "TRAIN",
          });
          break;
        }
      }
    }

    results.sort(function (a, b) { return a.dep_minutes - b.dep_minutes; });
    return results.slice(0, limit);
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  /**
   * Convert integer minutes since midnight to an 'HH:MM' time string.
   *
   * @param {number} minutes - Minutes since midnight (0–1439, or slightly beyond
   *   for overnight trips).
   * @returns {string} Time string, e.g. '08:05'.
   */
  function minutesToTime(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  /**
   * Build an ISO 8601 datetime string from a YYYYMMDD integer and minutes offset.
   *
   * @param {number} dateInt - Date as YYYYMMDD integer (e.g. 20260501).
   * @param {number} minutes - Minutes since midnight.
   * @returns {string} ISO 8601 string, e.g. '2026-05-01T08:00:00'.
   */
  function minutesToIsoDatetime(dateInt, minutes) {
    const s = String(dateInt);
    const year  = s.slice(0, 4);
    const month = s.slice(4, 6);
    const day   = s.slice(6, 8);
    const h = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    return year + "-" + month + "-" + day + "T" + h + ":" + m + ":00";
  }

  /**
   * Convert a duration in minutes to a human-readable French-style string.
   *
   * @param {number} totalMinutes - Non-negative integer number of minutes.
   * @returns {string} E.g. '1h 35min', '45min', '2h'.
   */
  function formatDurationMinutes(totalMinutes) {
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return minutes + "min";
    if (minutes === 0) return hours + "h";
    return hours + "h " + minutes + "min";
  }

  // ── Journey result builder ──────────────────────────────────────────────────

  /**
   * Wrap a raw query row into a journey result object compatible with
   * buildItineraryCard() in search.js.
   *
   * @param {{dep_minutes:number, arr_minutes:number, duration_minutes:number,
   *   train_type:string}} row - One result from queryJourney().
   * @param {string} fromStationNom - Display name of the departure station.
   * @param {string} toStationNom - Display name of the arrival station.
   * @param {number} dateInt - Travel date as YYYYMMDD integer.
   * @returns {{from_station_nom:string, to_station_nom:string,
   *   departure_datetime:string, arrival_datetime:string,
   *   duration_minutes:number, nb_transfers:number,
   *   train_type:string, sections:Array}} Journey result object.
   */
  function buildJourneyResult(row, fromStationNom, toStationNom, dateInt) {
    return {
      from_station_nom: fromStationNom,
      to_station_nom: toStationNom,
      departure_datetime: minutesToIsoDatetime(dateInt, row.dep_minutes),
      arrival_datetime: minutesToIsoDatetime(dateInt, row.arr_minutes),
      duration_minutes: row.duration_minutes,
      nb_transfers: 0,
      train_type: row.train_type,
      sections: [
        {
          mode: row.train_type,
          from: fromStationNom,
          to: toStationNom,
          duration_min: row.duration_minutes,
        },
      ],
    };
  }

  // ── Date range access ───────────────────────────────────────────────────────

  /**
   * Return the YYYYMMDD date range covered by the loaded timetable.
   *
   * @returns {{min:number, max:number}|null} Date range, or null if the
   *   timetable is not yet loaded or has no date_range field.
   */
  function getTimetableDateRange() {
    return (_timetable && _timetable.date_range) || null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.InterTimetable = {
    loadTimetable,
    queryJourney,
    buildJourneyResult,
    minutesToTime,
    minutesToIsoDatetime,
    formatDurationMinutes,
    getTimetableDateRange,
  };
})();
