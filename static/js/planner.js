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
   * Find the index of the polyline vertex closest to a geographic point.
   *
   * Linear argmin of the haversine distance over every vertex. Used to snap a
   * station to the nearest point on the route polyline.
   *
   * @param {Array<[number, number]>} polyline - Array of [lat, lon] pairs.
   * @param {number} lat - Target point latitude in decimal degrees.
   * @param {number} lon - Target point longitude in decimal degrees.
   * @returns {number} Index of the nearest vertex, or -1 if the polyline is empty.
   */
  function nearestPointIndex(polyline, lat, lon) {
    if (!polyline || polyline.length === 0) return -1;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < polyline.length; i++) {
      const d = haversineKm(lat, lon, polyline[i][0], polyline[i][1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
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
   * Extract the route track points between two stations.
   *
   * Snaps each station to the nearest vertex of the route's `track_points`
   * polyline and returns the (inclusive) slice between those two indices. Slicing
   * the same full-resolution polyline that is drawn guarantees the segment ends
   * land exactly on the route line next to the station markers, regardless of
   * station spacing. The result is full-resolution (no downsampling) so the bike
   * leg traces the GPX exactly.
   *
   * @param {Array<[number, number]>} trackPoints - Route polyline ([lat, lon]),
   *   ordered along the route. Empty/absent yields an empty result.
   * @param {{lat:number, lon:number}} startStation - Bike departure station.
   * @param {{lat:number, lon:number}} endStation - Bike arrival station.
   * @returns {Array<[number, number]>} [lat, lon] pairs for the biked segment,
   *   or [] if trackPoints is empty.
   */
  function extractSegmentPoints(trackPoints, startStation, endStation) {
    if (!trackPoints || trackPoints.length === 0) return [];
    const i1 = nearestPointIndex(trackPoints, startStation.lat, startStation.lon);
    const i2 = nearestPointIndex(trackPoints, endStation.lat, endStation.lon);
    if (i1 === -1 || i2 === -1) return [];
    return trackPoints.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  }

  // ── Candidate assembly ────────────────────────────────────────────────────

  /**
   * Build TripCandidate objects for a single Eurovelo route.
   *
   * For each outbound candidate station (up to OUTBOUND_CANDIDATE_COUNT):
   *
   * 1. Biking budget — `totalBikingKm(nDays, rhythmKey)` converts the trip
   *    length and pace into a distance: a half day for a 1-day trip, otherwise
   *    `(nDays - 1)` full days, each full day being `speed_kmh * hours_per_day`
   *    for the chosen rhythm (escargot / randonneur / athlète).
   * 2. End station — `computeEndStation` scans the route's stations for the one
   *    whose `cumulative_km` is closest to `startStation.cumulative_km + bikingKm`,
   *    so the biked segment begins and ends at real reachable stations.
   * 3. Segment geometry — `extractSegmentPoints` snaps the start and end stations
   *    to their nearest vertices on the route's full-resolution `track_points`
   *    and returns the slice between them. The geometry is kept full-resolution
   *    so the bike leg traces the GPX exactly and its ends land on the station
   *    markers. (`startKm`/`endKm` are still used for the distance labels.)
   * 4. Hand-off — `search.js.buildItineraryCard` copies `candidate.geometry`
   *    onto the itinerary as `itinerary.geometry`, which map.js draws.
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
      const geometry = extractSegmentPoints(routeData.track_points, startStation, endStation);
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
    nearestPointIndex,
    extractSegmentPoints,
    findItineraryCandidates,
    findAllItineraries,
  };
})();
