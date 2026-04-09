/**
 * map.js — Leaflet map initialisation and itinerary rendering.
 *
 * Manages a single Leaflet map instance. Draws route polylines and station
 * markers when an itinerary card is selected.
 */

(function () {
  "use strict";

  /** @type {L.Map} */
  let map = null;

  /** @type {L.LayerGroup} Holds all itinerary-specific layers (cleared on each select). */
  let itineraryLayer = null;

  /**
   * Initialise the Leaflet map centred on France.
   *
   * Should be called once on page load after the #map container exists in the DOM.
   *
   * @param {string} containerId - ID of the HTML element that will hold the map.
   * @returns {L.Map} The created Leaflet map instance.
   */
  function initMap(containerId) {
    map = L.map(containerId).setView([46.8, 2.3], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    itineraryLayer = L.layerGroup().addTo(map);
    return map;
  }

  /**
   * Clear all itinerary-specific layers from the map.
   * The base tile layer is preserved.
   */
  function clearMap() {
    if (itineraryLayer) {
      itineraryLayer.clearLayers();
    }
  }

  /**
   * Build a custom Leaflet icon for a station marker.
   *
   * @param {string} color - CSS colour string for the marker background.
   * @returns {L.DivIcon}
   */
  function buildStationIcon(color) {
    return L.divIcon({
      className: "",
      html: `<div class="station-marker" style="background:${color}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  /**
   * Draw a route polyline and station markers for a selected itinerary.
   *
   * The biked segment is drawn in green. Departure and arrival train stations
   * are shown with coloured circle markers. The map viewport is automatically
   * fitted to the visible elements.
   *
   * @param {Object} itinerary - Itinerary card object from the /api/search response.
   * @param {Array<Array<number>>} itinerary.geometry - [[lat,lon], …] of the biked segment.
   * @param {Object} itinerary.departure_station - {nom, lat, lon}.
   * @param {Object} itinerary.arrival_station - {nom, lat, lon}.
   */
  function showItineraryOnMap(itinerary) {
    clearMap();

    const bounds = [];

    // Draw biked segment polyline
    if (itinerary.geometry && itinerary.geometry.length > 1) {
      const polyline = L.polyline(itinerary.geometry, {
        color: "#2ecc71",
        weight: 4,
        opacity: 0.85,
      });
      itineraryLayer.addLayer(polyline);
      bounds.push(...itinerary.geometry);
    }

    // Departure station marker (blue)
    const dep = itinerary.departure_station;
    if (dep && dep.lat && dep.lon) {
      const marker = L.marker([dep.lat, dep.lon], {
        icon: buildStationIcon("#2980b9"),
        title: dep.nom,
      }).bindPopup(`<b>Arrivée train aller</b><br>${dep.nom}`);
      itineraryLayer.addLayer(marker);
      bounds.push([dep.lat, dep.lon]);
    }

    // Arrival station marker (red)
    const arr = itinerary.arrival_station;
    if (arr && arr.lat && arr.lon) {
      const marker = L.marker([arr.lat, arr.lon], {
        icon: buildStationIcon("#e74c3c"),
        title: arr.nom,
      }).bindPopup(`<b>Départ train retour</b><br>${arr.nom}`);
      itineraryLayer.addLayer(marker);
      bounds.push([arr.lat, arr.lon]);
    }

    // Fit map to all visible elements
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  // Expose public API on window
  window.InterMap = { initMap, clearMap, showItineraryOnMap };
})();
