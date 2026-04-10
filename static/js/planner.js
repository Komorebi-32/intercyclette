/**
 * planner.js — Pure JS itinerary planner (port of app/itinerary/).
 *
 * Computes bike trip candidates from the route_stations.json index without
 * any network calls. All constants match the Python values in app/constants.py.
 *
 * Exposes: window.InterPlanner
 */

(function () {
  "use strict";

  // ── Constants (must match app/constants.py) ───────────────────────────────

  /** @type {Object.<string, {speed_kmh: number, hours_per_day: number}>} */
  const RHYTHMS = {
    escargot:   { speed_kmh: 12.0, hours_per_day: 5.0 },
    randonneur: { speed_kmh: 15.0, hours_per_day: 6.5 },
    athlete:    { speed_kmh: 20.0, hours_per_day: 8.0 },
  };

  const ROUTE_START_ZONE_FRACTION = 0.15;
  const ROUTE_START_ZONE_MAX_KM   = 100.0;
  const OUTBOUND_CANDIDATE_COUNT  = 3;
  const EARTH_RADIUS_KM           = 6371.0;
  const HALF_DAY_FRACTION         = 0.5;
  const MAP_GEOMETRY_MAX_POINTS   = 1000;

  // ── Geometry helpers ──────────────────────────────────────────────────────

  /**
   * Compute the great-circle distance between two WGS84 points (haversine).
   *
   * @param {number} lat1 - Latitude of point A in decimal degrees.
   * @param {number} lon1 - Longitude of point A in decimal degrees.
   * @param {number} lat2 - Latitude of point B in decimal degrees.
   * @param {number} lon2 - Longitude of point B in decimal degrees.
   * @returns {number} Distance in kilometres (non-negative).
   */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
  }

  /**
   * Compute cumulative distances along a polyline.
   *
   * @param {Array<[number, number]>} polyline - Array of [lat, lon] pairs.
   * @returns {number[]} Array of cumulative km values, same length as polyline.
   *   First value is always 0.
   */
  function cumulativeDistancesKm(polyline) {
    const cum = [0];
    for (let i = 1; i < polyline.length; i++) {
      cum.push(cum[i - 1] + haversineKm(polyline[i - 1][0], polyline[i - 1][1], polyline[i][0], polyline[i][1]));
    }
    return cum;
  }

  /**
   * Downsample a polyline to at most maxPoints entries.
   *
   * Selects every N-th point where N = ceil(len / maxPoints).
   * Always includes the first and last point.
   *
   * @param {Array<[number, number]>} points - Full array of [lat, lon] pairs.
   * @param {number} maxPoints - Maximum number of points to return.
   * @returns {Array<[number, number]>} Downsampled array. Empty if input is empty.
   */
  function downsampleGeometry(points, maxPoints) {
    if (!points || points.length === 0) return [];
    if (points.length <= maxPoints) return points.slice();
    const step = Math.ceil(points.length / maxPoints);
    const sampled = [];
    for (let i = 0; i < points.length; i += step) {
      sampled.push(points[i]);
    }
    const last = points[points.length - 1];
    if (sampled[sampled.length - 1] !== last) {
      sampled.push(last);
    }
    return sampled;
  }

  // ── Rhythm helpers ────────────────────────────────────────────────────────

  /**
   * Return the maximum biking distance in one full day for a rhythm key.
   *
   * @param {string} rhythmKey - One of 'escargot', 'randonneur', 'athlete'.
   * @returns {number} Distance in km.
   * @throws {Error} If rhythmKey is not recognised.
   */
  function kmPerFullDay(rhythmKey) {
    const r = RHYTHMS[rhythmKey];
    if (!r) throw new Error(`Unknown rhythm key: ${rhythmKey}`);
    return r.speed_kmh * r.hours_per_day;
  }

  /**
   * Compute total biking distance for a trip.
   *
   * - n_days == 1: half a day of biking (both trains on same day).
   * - n_days >= 2: (n_days - 1) full days (one day equivalent lost to trains).
   *
   * @param {number} nDays - Total trip days (1–15).
   * @param {string} rhythmKey - Rhythm key string.
   * @returns {number} Total biking km.
   */
  function totalBikingKm(nDays, rhythmKey) {
    const daily = kmPerFullDay(rhythmKey);
    if (nDays === 1) return HALF_DAY_FRACTION * daily;
    return (nDays - 1) * daily;
  }

  // ── Station selection ─────────────────────────────────────────────────────

  /**
   * Select candidate outbound stations from the start zone of a route.
   *
   * The start zone is the first ROUTE_START_ZONE_FRACTION of the route,
   * capped at ROUTE_START_ZONE_MAX_KM. Among those stations, the n closest
   * to the departure city (by haversine) are returned.
   *
   * @param {Object} routeData - Single route object from the route_stations index.
   * @param {number} depLat - Departure city latitude.
   * @param {number} depLon - Departure city longitude.
   * @param {number} n - Maximum number of stations to return.
   * @returns {Object[]} Station objects sorted by ascending distance to departure.
   */
  function getStationsNearRouteStart(routeData, depLat, depLon, n) {
    const totalKm = routeData.total_km;
    const zoneKm = Math.min(totalKm * ROUTE_START_ZONE_FRACTION, ROUTE_START_ZONE_MAX_KM);
    const inZone = routeData.stations.filter((s) => s.cumulative_km <= zoneKm);
    inZone.sort((a, b) => haversineKm(depLat, depLon, a.lat, a.lon) - haversineKm(depLat, depLon, b.lat, b.lon));
    return inZone.slice(0, n);
  }

  /**
   * Find the station closest to the expected end point after biking.
   *
   * The target position is startStation.cumulative_km + bikingKm.
   *
   * @param {Object} routeData - Single route object from the index.
   * @param {Object} startStation - Station where biking begins.
   * @param {number} bikingKm - Total biking distance in km.
   * @returns {Object|null} Station object closest to the end point, or null if
   *   no stations exist.
   */
  function computeEndStation(routeData, startStation, bikingKm) {
    const stations = routeData.stations;
    if (!stations || stations.length === 0) return null;
    const targetKm = startStation.cumulative_km + bikingKm;
    let best = stations[0];
    let bestDiff = Math.abs(best.cumulative_km - targetKm);
    for (let i = 1; i < stations.length; i++) {
      const diff = Math.abs(stations[i].cumulative_km - targetKm);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = stations[i];
      }
    }
    return best;
  }

  /**
   * Extract route track points between startKm and endKm (cumulative).
   *
   * Uses track_points embedded in routeData (added by preprocess.py).
   * Returns an empty array if track_points is absent.
   *
   * @param {Object} routeData - Single route object from the index.
   * @param {number} startKm - Cumulative km where the biked segment begins.
   * @param {number} endKm - Cumulative km where the biked segment ends.
   * @returns {Array<[number, number]>} Array of [lat, lon] pairs for the segment.
   */
  function extractSegmentPoints(routeData, startKm, endKm) {
    const raw = routeData.track_points;
    if (!raw || raw.length === 0) return [];
    const cum = cumulativeDistancesKm(raw);
    const total = cum[cum.length - 1];
    const clampedStart = Math.max(0, Math.min(startKm, total));
    const clampedEnd = Math.max(0, Math.min(endKm, total));
    return raw.filter((_, i) => cum[i] >= clampedStart && cum[i] <= clampedEnd);
  }

  // ── Candidate assembly ────────────────────────────────────────────────────

  /**
   * Build TripCandidate objects for a single Eurovelo route.
   *
   * For each outbound candidate station (up to OUTBOUND_CANDIDATE_COUNT):
   * 1. Compute the end station based on total biking km.
   * 2. Assemble a candidate object with segment geometry.
   *
   * @param {string} routeId - Eurovelo route ID (e.g. 'EV6').
   * @param {Object} routeData - Route entry from the proximity index.
   * @param {number} depLat - Departure city latitude.
   * @param {number} depLon - Departure city longitude.
   * @param {number} nDays - Total trip days.
   * @param {string} rhythmKey - Rhythm key string.
   * @returns {Object[]} Array of candidate objects. May be empty.
   */
  function findItineraryCandidates(routeId, routeData, depLat, depLon, nDays, rhythmKey) {
    const bikingKm = totalBikingKm(nDays, rhythmKey);
    const routeName = routeData.name || routeId;
    const outboundStations = getStationsNearRouteStart(routeData, depLat, depLon, OUTBOUND_CANDIDATE_COUNT);
    if (outboundStations.length === 0) return [];

    return outboundStations.reduce((acc, startStation) => {
      const endStation = computeEndStation(routeData, startStation, bikingKm);
      if (!endStation) return acc;
      const startKm = startStation.cumulative_km;
      const endKm = startKm + bikingKm;
      const segmentPoints = extractSegmentPoints(routeData, startKm, endKm);
      const geometry = downsampleGeometry(segmentPoints, MAP_GEOMETRY_MAX_POINTS);
      acc.push({
        route_id: routeId,
        route_name: routeName,
        departure_station: startStation,
        arrival_station: endStation,
        biking_start_km: Math.round(startKm * 10) / 10,
        biking_end_km: Math.round(endKm * 10) / 10,
        total_biking_km: Math.round(bikingKm * 10) / 10,
        n_days: nDays,
        rhythm_key: rhythmKey,
        geometry: geometry,
      });
      return acc;
    }, []);
  }

  /**
   * Build candidates for all requested Eurovelo routes.
   *
   * When a single route is selected: up to OUTBOUND_CANDIDATE_COUNT results.
   * When multiple routes are selected: at most one result per route.
   *
   * @param {string[]} routeIds - List of Eurovelo route IDs to search.
   * @param {Object} index - Full proximity index (parsed route_stations.json).
   * @param {number} depLat - Departure city latitude.
   * @param {number} depLon - Departure city longitude.
   * @param {number} nDays - Total trip days.
   * @param {string} rhythmKey - Rhythm key string.
   * @returns {Object[]} Flat array of candidate objects.
   */
  function findAllItineraries(routeIds, index, depLat, depLon, nDays, rhythmKey) {
    const routes = (index && index.routes) || {};
    const multipleRoutes = routeIds.length > 1;
    const all = [];

    for (const routeId of routeIds) {
      if (!routes[routeId]) continue;
      const candidates = findItineraryCandidates(routeId, routes[routeId], depLat, depLon, nDays, rhythmKey);
      if (multipleRoutes && candidates.length > 0) {
        all.push(candidates[0]);
      } else {
        all.push(...candidates);
      }
    }
    return all;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.InterPlanner = {
    haversineKm,
    kmPerFullDay,
    totalBikingKm,
    getStationsNearRouteStart,
    computeEndStation,
    extractSegmentPoints,
    downsampleGeometry,
    findItineraryCandidates,
    findAllItineraries,
  };
})();
