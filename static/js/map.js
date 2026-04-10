/**
 * map.js — Leaflet map initialisation, route overlays, and itinerary rendering.
 *
 * Manages a single Leaflet map instance.
 *
 * Always-on colored overlays (one per Eurovelo route) are loaded from
 * static/data/routes/*.json at page start. Individual route visibility is
 * toggled by setRouteVisible() when the user ticks/unticks checkboxes.
 *
 * Hovering a route polyline shows a popup with route description and a link.
 *
 * When an itinerary card is selected, the biked segment is highlighted in the
 * route's own color and station markers are added.
 */

(function () {
  "use strict";

  /** @type {L.Map} */
  let map = null;

  /** @type {L.LayerGroup} Holds itinerary-specific layers (cleared on each select). */
  let itineraryLayer = null;

  /**
   * Route color map loaded from the JSON files.
   * Key: route_id (e.g. 'EV3'), value: hex color string.
   * @type {Object.<string, string>}
   */
  const routeColors = {};

  /**
   * Persistent route overlay layers, keyed by route_id.
   * @type {Object.<string, L.Polyline>}
   */
  const routeLayers = {};

  // ── Route metadata for hover popups ────────────────────────────────────────

  const BASE_IMG = "https://www.francevelotourisme.com/sites/default/files/styles/visuels/public/medias/images/";

  /**
   * Static metadata for each Eurovelo route, used in hover popups.
   * Sources: francevelotourisme.com/conseils/preparer-mon-voyage-a-velo/eurovelo-france
   *
   * @type {Object.<string, {description:string, distance:string, status:string, connections:string, url:string, img:string}>}
   */
  const ROUTE_INFO = {
    EV3: {
      description: "La Scandibérique traverse la France en diagonale depuis la frontière belge jusqu'à l'Espagne, à travers l'Île-de-France, la vallée de la Loire, le Poitou et la Gascogne.",
      distance: "1 700 km",
      status: "95 % réalisé",
      connections: "EuroVelo 6 (Orléans-Tours), EuroVelo 1 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-scandiberique-eurovelo-3",
      img: BASE_IMG + "eurovelo-3-landes-scandiberique.jpg.webp",
    },
    EV4: {
      description: "La Vélomaritime relie Roscoff en Bretagne à Bray-Dunes à la frontière belge, longeant les côtes de la Manche et de la mer du Nord.",
      distance: "1 518 km",
      status: "99,3 % réalisé",
      connections: "EV 1 (Roscoff), EV 5 et 12 (Calais)",
      url: "https://www.francevelotourisme.com/itineraire/la-velomaritime-eurovelo-4",
      img: BASE_IMG + "Velo_au_Mont-Saint-Michel-Les_valises_de_Sarah_Calvados_Attractivite-11037.JPG.webp",
    },
    EV5: {
      description: "L'EuroVelo 5 traverse la France en deux sections : par Lille au nord et par Strasbourg et la route des vins d'Alsace au sud, vers Rome.",
      distance: "669 km",
      status: "77 % réalisé",
      connections: "EV 15 (Strasbourg-Bâle), EV 6 (Mulhouse-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-5-moselle-alsace",
      img: BASE_IMG + "eurovelo-5-vignes.jpg.webp",
    },
    EV6: {
      description: "L'EuroVelo 6 suit la vallée du Doubs puis la Loire à Vélo, de la Suisse jusqu'à l'Atlantique, à travers vignobles et châteaux.",
      distance: "1 300 km",
      status: "100 % réalisé",
      connections: "EV 1 (Nantes), EV 3 (Orléans-Tours), EV 15 (Kembs)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-6-bale-nevers",
      img: BASE_IMG + "eurovelo-6-loire-a-velo.jpg.webp",
    },
    EV8: {
      description: "La Méditerranée à Vélo suit la côte méditerranéenne entre Argelès-sur-Mer et Port-la-Nouvelle, traversant calanques, étangs et cités historiques.",
      distance: "850 km",
      status: "53 % réalisé",
      connections: "ViaRhôna (Sète), Canal du Midi (Agde)",
      url: "https://www.francevelotourisme.com/itineraire/la-mediterranee-a-velo-eurovelo-8",
      img: BASE_IMG + "eurovelo-8-mediterranee.jpg.webp",
    },
    EV15: {
      description: "La Véloroute du Rhin côtoie le canal du Rhône au Rhin et la citadelle de Vauban (Patrimoine Mondial), de Bâle à Strasbourg.",
      distance: "180 km",
      status: "100 % réalisé",
      connections: "EV 6 (Kembs), EV 5 (Strasbourg-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-15-veloroute-rhin",
      img: BASE_IMG + "eurovelo-15_strasbourg.jpg.webp",
    },
    EV19: {
      description: "La Meuse à Vélo longe ce fleuve européen sur plus de 1 000 km, depuis sa source à Langres jusqu'aux Pays-Bas, en traversant les Ardennes.",
      distance: "443 km (en France)",
      status: "100 % réalisé",
      connections: "—",
      url: "https://www.francevelotourisme.com/itineraire/la-meuse-a-velo",
      img: BASE_IMG + "meuse-a-velo-en-famille-revin-voie-verte-trans-ardennes.jpg.webp",
    },
    VEL: {
      description: "De Roscoff à Hendaye, la Vélodyssée® se déploie le long de l'Atlantique sur plus de 1 250 km. Découvrez le meilleur des régions traversées avec l'océan comme toile de fond !",
      distance: "1 250 km",
      status: "99 % réalisé",
      connections: "EV 4 (Roscoff), EV 6 (Nantes), EV 3 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-velodyssee",
      img: BASE_IMG + "eurovelo-1-velodyssee.jpg.webp",
    },
    VIA: {
      description: "La ViaRhôna longe le Rhône depuis sa source dans les Alpes suisses jusqu'à sa double embouchure en Méditerranée, traversant lacs, gorges et vignes.",
      distance: "815 km",
      status: "100 % réalisé",
      connections: "EV 8 (Sète-Beaucaire)",
      url: "https://www.francevelotourisme.com/itineraire/viarhona",
      img: BASE_IMG + "eurovelo-17-rhone-route.jpg.webp",
    },
  };

  // ── Map initialisation ─────────────────────────────────────────────────────

  /**
   * Initialise the Leaflet map centred on France using light CartoDB Positron tiles.
   *
   * CartoDB Positron provides a white/light-grey background that contrasts well
   * with the vivid Eurovelo route colors.
   *
   * @param {string} containerId - ID of the HTML element that will hold the map.
   * @returns {L.Map} The created Leaflet map instance.
   */
  function initMap(containerId) {
    map = L.map(containerId).setView([46.8, 2.3], 6);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
        '© <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    itineraryLayer = L.layerGroup().addTo(map);
    return map;
  }

  // ── Route overlays ─────────────────────────────────────────────────────────

  /**
   * Build the HTML content for a route hover popup.
   *
   * @param {string} routeId - Route identifier (e.g. 'EV3').
   * @param {string} name - Route name from the JSON file.
   * @param {string} color - Route color hex string.
   * @returns {string} HTML string for the popup.
   */
  function buildRoutePopupHtml(routeId, name, color) {
    const info = ROUTE_INFO[routeId];
    if (!info) {
      return `<div class="route-popup"><strong style="color:${color}">${name}</strong></div>`;
    }
    return `
      <div class="route-popup">
        <img src="${info.img}" alt="${name}" class="route-popup-img" onerror="this.style.display='none'" />
        <div class="route-popup-body">
          <div class="route-popup-title" style="color:${color}">${name}</div>
          <p class="route-popup-desc">${info.description}</p>
          <ul class="route-popup-meta">
            <li><span>📏</span> ${info.distance}</li>
            <li><span>✅</span> ${info.status}</li>
            <li><span>🔗</span> ${info.connections}</li>
          </ul>
          <a href="${info.url}" target="_blank" rel="noopener" class="route-popup-link">
            En savoir plus →
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Fetch a single route geometry file and draw it as a thin colored polyline.
   *
   * Attaches a hover popup with route info.
   *
   * @param {string} routeId - Route ID, e.g. 'EV3'.
   * @returns {Promise<void>} Resolves when the polyline is added to the map.
   */
  function loadRoute(routeId) {
    const filename = routeId.toLowerCase() + ".json";
    return fetch("static/data/routes/" + filename)
      .then((r) => r.json())
      .then((data) => {
        const color = data.color || "#888";
        routeColors[routeId] = color;

        const polyline = L.polyline(data.points, {
          color: color,
          weight: 3,
          opacity: 0.8,
        });

        // Hover popup with route info
        const popupHtml = buildRoutePopupHtml(routeId, data.name, color);
        polyline.bindPopup(popupHtml, {
          maxWidth: 280,
          className: "route-info-popup",
        });

        polyline.on("mouseover", function (e) {
          this.setStyle({ weight: 5, opacity: 1 });
          this.openPopup(e.latlng);
        });
        polyline.on("mouseout", function () {
          this.setStyle({ weight: 3, opacity: 0.8 });
          this.closePopup();
        });
        polyline.on("mousemove", function (e) {
          this.getPopup().setLatLng(e.latlng);
        });

        routeLayers[routeId] = polyline;
        if (map) polyline.addTo(map);
      })
      .catch((err) => {
        console.warn(`Could not load route geometry for ${routeId}:`, err);
      });
  }

  /**
   * Fetch and draw all 9 Eurovelo route overlays.
   *
   * @returns {Promise<void>} Resolves when all routes have been attempted.
   */
  function loadAllRoutes() {
    const routeIds = ["EV3", "EV4", "EV5", "EV6", "EV8", "EV15", "EV19", "VEL", "VIA"];
    return Promise.all(routeIds.map(loadRoute));
  }

  /**
   * Show or hide the persistent overlay for one Eurovelo route.
   *
   * @param {string} routeId - Route ID, e.g. 'EV6'.
   * @param {boolean} visible - True to show, false to hide.
   */
  function setRouteVisible(routeId, visible) {
    const layer = routeLayers[routeId];
    if (!layer || !map) return;
    if (visible) {
      if (!map.hasLayer(layer)) layer.addTo(map);
    } else {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    }
  }

  // ── Map helpers ─────────────────────────────────────────────────────────────

  /**
   * Clear all itinerary-specific layers from the map.
   * Persistent route overlays and the base tile layer are preserved.
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

  // ── Itinerary rendering ────────────────────────────────────────────────────

  /**
   * Draw the biked segment and station markers for a selected itinerary.
   *
   * The segment polyline uses the route's own color at a heavier weight (6) to
   * distinguish it from the always-on thin overlay. Departure and arrival
   * stations use blue and red markers respectively. The map is fitted to all
   * visible elements.
   *
   * @param {Object} itinerary - Itinerary object assembled by search.js.
   * @param {string} itinerary.route_id - Route ID for color lookup.
   * @param {Array<[number, number]>} itinerary.geometry - [[lat,lon], …].
   * @param {Object} itinerary.departure_station - {nom, lat, lon}.
   * @param {Object} itinerary.arrival_station - {nom, lat, lon}.
   */
  function showItineraryOnMap(itinerary) {
    clearMap();

    const segmentColor = routeColors[itinerary.route_id] || "#2ecc71";
    const bounds = [];

    // Draw biked segment in route color (heavier weight)
    if (itinerary.geometry && itinerary.geometry.length > 1) {
      const polyline = L.polyline(itinerary.geometry, {
        color: segmentColor,
        weight: 6,
        opacity: 0.9,
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

  // ── Public API ─────────────────────────────────────────────────────────────

  window.InterMap = {
    initMap,
    loadAllRoutes,
    setRouteVisible,
    clearMap,
    showItineraryOnMap,
  };
})();
