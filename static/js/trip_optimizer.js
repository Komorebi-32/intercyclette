/**
 * trip_optimizer.js — Hub-based, scored outbound + return train-leg search.
 *
 * Replaces the old "one query per route-start candidate" approach. For each
 * selected Eurovelo route:
 *   - if the route passes within NEAR_ROUTE_KM of the user, no outbound train is
 *     needed — the bike leg starts at the nearest route point (best score);
 *   - otherwise the user → the HUBS_PER_ROUTE big-city hub stations nearest the
 *     user are queried (several itineraries each) and the best journey per hub is
 *     kept.
 * All outbound candidates are scored (fewest transfers, then TER/IC over TGV,
 * then duration); the OUTBOUND_KEEP best advance. For each, the bike leg and its
 * end station are computed and the return (bike-end → user) is queried and
 * scored. Trips are ranked by the sum of both legs' scores and the FINAL_KEEP
 * best are returned.
 *
 * Depends on: window.InterPlanner (route math) and window.InterTimetable
 * (Transitous client + scoring). Exposes: window.InterTrip.
 */

(function () {
  "use strict";

  /** Max distance (km) from the route to skip the outbound train entirely. */
  const NEAR_ROUTE_KM = 10;

  /** Hub stations queried per route (the nearest to the user). */
  const HUBS_PER_ROUTE = 5;

  /** Itineraries requested per Transitous call (we keep the best). */
  const MAX_RESULTS = 5;

  /** Max concurrent Transitous requests. */
  const CONCURRENCY = 6;

  /** Outbound legs kept after scoring, before computing bike + return legs. */
  const OUTBOUND_KEEP = 10;

  /** Final trips returned. */
  const FINAL_KEEP = 3;

  /** A hub must leave at least this much route ahead to be a useful entry. */
  const MIN_AHEAD_FRACTION = 0.3;
  const MIN_AHEAD_KM = 20;

  /** Penalty score key for a leg whose train was not found (ranks last). */
  const NOT_FOUND_KEY = [1e9, 1e9, 1e9];

  /**
   * Run callbacks over items with a bounded number in flight at once.
   *
   * @param {Array} items - Work items.
   * @param {function(any, number): Promise} fn - Async worker for one item.
   * @param {number} limit - Max concurrent calls.
   * @returns {Promise<Array>} Results in the original order.
   */
  function mapWithConcurrency(items, fn, limit) {
    const results = new Array(items.length);
    let next = 0;
    function worker() {
      if (next >= items.length) return Promise.resolve();
      const idx = next++;
      return Promise.resolve(fn(items[idx], idx)).then(function (r) {
        results[idx] = r;
        return worker();
      });
    }
    const n = Math.min(limit, items.length);
    const starters = [];
    for (let k = 0; k < n; k++) starters.push(worker());
    return Promise.all(starters).then(function () { return results; });
  }

  /**
   * Build journey results from raw itineraries and return the best-scored one.
   *
   * @param {Array<Object>} itineraries - Raw Transitous itineraries.
   * @returns {Object|null} Best journey result, or null if none usable.
   */
  function bestJourney(itineraries) {
    const T = window.InterTimetable;
    let best = null;
    (itineraries || []).forEach(function (it) {
      const j = T.buildJourneyResult(it);
      if (!j) return;
      if (best === null || T.compareJourneys(j, best) < 0) best = j;
    });
    return best;
  }

  /**
   * Select the hub stations to query for a route: those leaving enough route
   * ahead, sorted by straight-line distance to the user, capped at HUBS_PER_ROUTE.
   *
   * @param {Array<Object>} hubs - Hub entries for the route (from route_big_cities).
   * @param {{lat:number, lon:number}} dep - User departure coordinates.
   * @param {Object} routeData - Route object (for total_km).
   * @param {number} bikingKm - Biking budget.
   * @returns {Array<Object>} Up to HUBS_PER_ROUTE hubs.
   */
  function selectHubs(hubs, dep, routeData, bikingKm) {
    const P = window.InterPlanner;
    const totalKm = routeData.total_km || Infinity;
    const minAhead = Math.min(bikingKm * MIN_AHEAD_FRACTION, MIN_AHEAD_KM);
    const ahead = (hubs || []).filter(function (h) {
      return (totalKm - h.cumulative_km) >= minAhead;
    });
    const pool = ahead.length > 0 ? ahead : (hubs || []);
    return pool
      .slice()
      .sort(function (a, b) {
        return P.haversineKm(dep.lat, dep.lon, a.lat, a.lon)
             - P.haversineKm(dep.lat, dep.lon, b.lat, b.lon);
      })
      .slice(0, HUBS_PER_ROUTE);
  }

  /**
   * Build the outbound candidates for every selected route.
   *
   * Direct (no-train) candidates are resolved synchronously; hub candidates are
   * returned as async tasks to be run through the concurrency pool.
   *
   * @param {Object} opts - See optimize().
   * @param {number} bikingKm - Biking budget.
   * @returns {{direct: Array<Object>, tasks: Array<function():Promise<Object|null>>}}
   */
  function buildOutboundWork(opts, bikingKm) {
    const P = window.InterPlanner;
    const T = window.InterTimetable;
    const dep = opts.depStation;
    const direct = [];
    const tasks = [];

    opts.routes.forEach(function (routeId) {
      const routeData = opts.routeIndex.routes[routeId];
      if (!routeData) return;

      const near = P.nearestRoutePoint(routeData, dep.lat, dep.lon);
      if (near && near.distanceKm <= NEAR_ROUTE_KM) {
        direct.push({
          routeId: routeId,
          routeData: routeData,
          entry: {
            lat: near.point[0], lon: near.point[1],
            cumulative_km: near.cumulativeKm, nom: dep.nom, uic: dep.uic,
          },
          journey: null,
          noTrain: true,
          scoreKey: T.journeyScoreKey(null),
        });
        return;
      }

      const hubs = selectHubs(opts.bigCities[routeId] || [], dep, routeData, bikingKm);
      hubs.forEach(function (hub) {
        tasks.push(function () {
          return T.queryJourney(dep.lat, dep.lon, hub.lat, hub.lon, opts.outboundIso, MAX_RESULTS)
            .then(function (itins) {
              const best = bestJourney(itins);
              if (!best) return null;
              return {
                routeId: routeId,
                routeData: routeData,
                entry: {
                  lat: hub.lat, lon: hub.lon,
                  cumulative_km: hub.cumulative_km, nom: hub.nom, uic: hub.uic,
                },
                journey: best,
                noTrain: false,
                scoreKey: T.journeyScoreKey(best),
              };
            })
            .catch(function () { return null; });
        });
      });
    });

    return { direct: direct, tasks: tasks };
  }

  /**
   * For one kept outbound candidate, compute the bike leg and query the return.
   *
   * @param {Object} cand - Outbound candidate.
   * @param {Object} opts - See optimize().
   * @param {number} bikingKm - Biking budget.
   * @returns {Promise<Object|null>} A trip object, or null if no bike leg.
   */
  function buildTrip(cand, opts, bikingKm) {
    const P = window.InterPlanner;
    const T = window.InterTimetable;
    const dep = opts.depStation;
    const bikeLeg = P.buildBikeLegFromEntry(cand.routeData, cand.entry, bikingKm);
    if (!bikeLeg) return Promise.resolve(null);
    const end = bikeLeg.endStation;
    return T.queryJourney(end.lat, end.lon, dep.lat, dep.lon, opts.returnIso, MAX_RESULTS)
      .then(function (itins) {
        const ret = bestJourney(itins);
        return {
          routeId: cand.routeId,
          routeName: cand.routeData.name || cand.routeId,
          entry: cand.entry,
          bikeLeg: bikeLeg,
          endStation: end,
          outboundJourney: cand.journey,
          returnJourney: ret,
          noTrain: cand.noTrain,
          outKey: cand.scoreKey,
          retKey: ret ? T.journeyScoreKey(ret) : NOT_FOUND_KEY.slice(),
        };
      })
      .catch(function () { return null; });
  }

  /**
   * Optimize a search end-to-end: outbound search → top-10 → bike + return →
   * top-3 trips.
   *
   * @param {Object} opts
   * @param {Object} opts.routeIndex - Parsed route_stations.json.
   * @param {Object} opts.bigCities - Parsed route_big_cities.json.
   * @param {string[]} opts.routes - Selected route ids.
   * @param {{lat:number, lon:number, nom:string, uic:string}} opts.depStation
   * @param {number} opts.nDays
   * @param {string} opts.rhythm
   * @param {string} opts.outboundIso - Local ISO datetime for outbound queries.
   * @param {string} opts.returnIso - Local ISO datetime for return queries.
   * @param {function(number, number): void} [opts.onProgress] - (done, total).
   * @returns {Promise<Array<Object>>} Up to FINAL_KEEP trip objects, best-first.
   */
  async function optimize(opts) {
    const T = window.InterTimetable;
    const onProgress = opts.onProgress || function () {};
    const bikingKm = window.InterPlanner.totalBikingKm(opts.nDays, opts.rhythm);

    const work = buildOutboundWork(opts, bikingKm);
    let done = 0;
    let total = work.tasks.length + OUTBOUND_KEEP; // estimate; refined below
    function tick() { done += 1; onProgress(Math.min(done, total), total); }

    const queried = await mapWithConcurrency(work.tasks, function (task) {
      return task().then(function (r) { tick(); return r; });
    }, CONCURRENCY);

    const candidates = work.direct.concat(queried.filter(Boolean));
    candidates.sort(function (a, b) { return T.compareScoreKeys(a.scoreKey, b.scoreKey); });
    const top = candidates.slice(0, OUTBOUND_KEEP);

    // Refine the progress total now that the number of return calls is known.
    total = work.tasks.length + top.length;

    const trips = (await mapWithConcurrency(top, function (cand) {
      return buildTrip(cand, opts, bikingKm).then(function (r) { tick(); return r; });
    }, CONCURRENCY)).filter(Boolean);

    trips.forEach(function (t) {
      t.tripKey = [
        t.outKey[0] + t.retKey[0],
        t.outKey[1] + t.retKey[1],
        t.outKey[2] + t.retKey[2],
      ];
    });
    trips.sort(function (a, b) { return T.compareScoreKeys(a.tripKey, b.tripKey); });
    onProgress(total, total);
    return trips.slice(0, FINAL_KEEP);
  }

  window.InterTrip = { optimize };
})();
