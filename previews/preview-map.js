/**
 * preview-map.js — Minimal Leaflet backdrop for the feature-preview mockups.
 *
 * Reproduces the live app's map look (OpenStreetMap-France greyscale tiles, see
 * `initMap` in static/js/map.js) so the static preview panels float over an
 * authentic background. Optionally draws a single Eurovelo route polyline.
 *
 * This is a SHOWCASE-ONLY helper: it deliberately does not replicate the full
 * application map logic (clustering, hover panels, itinerary layers). It exists
 * only to make the preview screenshots look like genuine in-app captures.
 */
(function () {
  "use strict";

  // Mirror the production tile configuration (static/js/map.js initMap).
  const TILE_URL = "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png";
  const TILE_OPTS = {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
      'rendu par <a href="https://tile.openstreetmap.fr">OSM France</a>',
    subdomains: "abc",
    maxZoom: 20,
    className: "map-tiles-greyscale",
  };

  // France-wide default view, matching DEFAULT_MAP_CENTER / DEFAULT_MAP_ZOOM.
  const DEFAULT_CENTER = [46.8, 2.3];
  const DEFAULT_ZOOM = 6;

  // Route polyline style, matching the thin overlay drawn by loadRoute.
  const ROUTE_WEIGHT = 3;
  const ROUTE_OPACITY = 0.8;
  const ROUTE_SMOOTH_FACTOR = 1.5;

  /**
   * Draw a single Eurovelo route polyline onto a map from its geometry file.
   *
   * @param {L.Map} map - Target Leaflet map instance.
   * @param {string} routeId - Route id, e.g. "EV3". The geometry is read from
   *   `../static/data/routes/<id-lowercase>.json` (shape: { name, color, points }).
   * @returns {Promise<void>} Resolves once the polyline is added, or silently on
   *   fetch failure (non-fatal, mirroring the app's tolerant route loading).
   */
  function drawRoute(map, routeId) {
    const url = "../static/data/routes/" + routeId.toLowerCase() + ".json";
    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status + " for " + url);
        }
        return response.json();
      })
      .then(function (data) {
        L.polyline(data.points, {
          color: data.color || "#888",
          weight: ROUTE_WEIGHT,
          opacity: ROUTE_OPACITY,
          smoothFactor: ROUTE_SMOOTH_FACTOR,
        }).addTo(map);
      })
      .catch(function (err) {
        console.warn("preview: could not load route " + routeId + ":", err);
      });
  }

  /**
   * Initialise a greyscale OSM-France map backdrop for a preview page.
   *
   * @param {string} containerId - Id of the map container element (must exist
   *   and be sized by CSS before this is called).
   * @param {Object} [options] - Backdrop options.
   * @param {[number, number]} [options.center=[46.8, 2.3]] - Map center [lat, lon].
   * @param {number} [options.zoom=6] - Initial zoom level.
   * @param {?string} [options.routeId=null] - Optional route to draw, e.g. "EV3".
   * @returns {L.Map} The created Leaflet map instance.
   * @throws {Error} If Leaflet (`L`) is not loaded or the container is missing.
   */
  function initPreviewMap(containerId, options) {
    if (typeof L === "undefined") {
      throw new Error("Leaflet (L) must be loaded before initPreviewMap.");
    }
    if (!document.getElementById(containerId)) {
      throw new Error('Map container "' + containerId + '" not found.');
    }

    const opts = options || {};
    const center = opts.center || DEFAULT_CENTER;
    const zoom = typeof opts.zoom === "number" ? opts.zoom : DEFAULT_ZOOM;

    const map = L.map(containerId, {
      zoomControl: false,
      preferCanvas: true,
    }).setView(center, zoom);

    L.tileLayer(TILE_URL, TILE_OPTS).addTo(map);

    if (opts.routeId) {
      drawRoute(map, opts.routeId);
    }
    return map;
  }

  window.PreviewMap = { initPreviewMap };
})();
