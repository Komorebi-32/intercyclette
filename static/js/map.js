/**
 * map.js — Leaflet map initialisation, route overlays, and itinerary rendering.
 *
 * Manages a single Leaflet map instance.
 *
 * Always-on colored overlays (one per Eurovelo route) are loaded from
 * static/data/routes/*.json at page start. Individual route visibility is
 * toggled by setRouteVisible() when the user ticks/unticks checkboxes.
 *
 * Hovering a route polyline shows a floating info panel. The panel stays
 * visible when the mouse moves from the polyline onto the panel itself,
 * allowing the user to click the "En savoir plus" link.
 *
 * When an itinerary card is selected, the biked segment is highlighted in the
 * route's own color and station markers are added.
 */

(function () {
  "use strict";

  /**
   * Color for the "Train aller" (outbound train) line and label.
   * Chosen to be clearly distinct from all nine Eurovelo route colors.
   */
  const TRAIN_ALLER_COLOR = "#FF6D00";

  /**
   * Color for the "Train retour" (return train) line and label.
   * Chosen to be clearly distinct from all nine Eurovelo route colors and from
   * TRAIN_ALLER_COLOR.
   */
  const TRAIN_RETOUR_COLOR = "#1565C0";

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

  // ── Floating hover panel ───────────────────────────────────────────────────

  /** @type {HTMLElement|null} The floating info panel DOM element. */
  let hoverPanel = null;

  /** @type {number|null} Timeout ID for delayed panel close. */
  let closeTimeout = null;

  /**
   * Create and return the singleton floating hover panel element.
   *
   * Cancels the close timer when the mouse enters the panel and restarts it
   * when the mouse leaves, so the user can move the cursor onto the panel to
   * click the "En savoir plus" link.
   *
   * @returns {HTMLElement}
   */
  function getHoverPanel() {
    if (hoverPanel) return hoverPanel;
    hoverPanel = document.createElement("div");
    hoverPanel.className = "route-hover-panel";
    hoverPanel.style.display = "none";
    document.body.appendChild(hoverPanel);

    hoverPanel.addEventListener("mouseenter", function () {
      clearTimeout(closeTimeout);
    });
    hoverPanel.addEventListener("mouseleave", function () {
      scheduleClosePanel();
    });
    return hoverPanel;
  }

  /**
   * Position the hover panel near the given client coordinates.
   *
   * Keeps the panel within the viewport by flipping left/above when near edges.
   *
   * @param {number} clientX - Mouse X coordinate (viewport-relative).
   * @param {number} clientY - Mouse Y coordinate (viewport-relative).
   */
  function positionPanel(clientX, clientY) {
    const panel = getHoverPanel();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = 280;
    const offset = 18;

    let left = clientX + offset;
    if (left + pw > vw - 10) left = clientX - pw - offset;
    let top = clientY - 10;
    if (top + panel.offsetHeight > vh - 10) top = vh - panel.offsetHeight - 10;

    panel.style.left = left + "px";
    panel.style.top  = Math.max(10, top) + "px";
  }

  /**
   * Show the hover panel with given HTML content near the mouse position.
   *
   * @param {string} html - HTML to inject into the panel.
   * @param {number} clientX - Mouse X coordinate.
   * @param {number} clientY - Mouse Y coordinate.
   */
  function showPanel(html, clientX, clientY) {
    clearTimeout(closeTimeout);
    const panel = getHoverPanel();
    panel.innerHTML = html;
    panel.style.display = "block";
    positionPanel(clientX, clientY);
  }

  /**
   * Schedule closing the hover panel after a short delay.
   *
   * The delay lets the mouse travel from the polyline to the panel without
   * the panel disappearing.
   */
  function scheduleClosePanel() {
    clearTimeout(closeTimeout);
    closeTimeout = setTimeout(function () {
      if (hoverPanel) hoverPanel.style.display = "none";
    }, 250);
  }

  // ── Route metadata for hover popups ────────────────────────────────────────

  const BASE_IMG = "https://www.francevelotourisme.com/sites/default/files/styles/visuels/public/medias/images/";

  /**
   * Static metadata for each Eurovelo route, used in the hover info panel.
   * Sources: francevelotourisme.com/conseils/preparer-mon-voyage-a-velo/eurovelo-france
   *
   * @type {Object.<string, {description:string, distance:string, status:string, connections:string, url:string, img:string}>}
   */
  const ROUTE_INFO = {
    EV3: {
      description: "La Scandibérique traverse la France en diagonale depuis la frontière belge jusqu'à l'Espagne, à travers l'Île-de-France, la vallée de la Loire, le Poitou et la Gascogne.",
      distance: "1 700 km",
      status: "Véloroute réalisée à 95 %",
      connections: "EuroVelo 6 (Orléans-Tours), EuroVelo 1 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-scandiberique-eurovelo-3",
      img: BASE_IMG + "eurovelo-3-landes-scandiberique.jpg.webp",
    },
    EV4: {
      description: "La Vélomaritime relie Roscoff en Bretagne à Bray-Dunes à la frontière belge, longeant les côtes de la Manche et de la mer du Nord.",
      distance: "1 518 km",
      status: "Véloroute réalisée à 99,3 %",
      connections: "EV 1 (Roscoff), EV 5 et 12 (Calais)",
      url: "https://www.francevelotourisme.com/itineraire/la-velomaritime-eurovelo-4",
      img: BASE_IMG + "Velo_au_Mont-Saint-Michel-Les_valises_de_Sarah_Calvados_Attractivite-11037.JPG.webp",
    },
    EV5: {
      description: "L'EuroVelo 5 traverse la France en deux sections : par Lille au nord et par Strasbourg et la route des vins d'Alsace au sud, vers Rome.",
      distance: "669 km",
      status: "Véloroute réalisée à 77 %",
      connections: "EV 15 (Strasbourg-Bâle), EV 6 (Mulhouse-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-5-moselle-alsace",
      img: BASE_IMG + "eurovelo-5-vignes.jpg.webp",
    },
    EV6: {
      description: "L'EuroVelo 6 suit la vallée du Doubs puis la Loire à Vélo, de la Suisse jusqu'à l'Atlantique, à travers vignobles et châteaux.",
      distance: "1 300 km",
      status: "Véloroute réalisée à 100 %",
      connections: "EV 1 (Nantes), EV 3 (Orléans-Tours), EV 15 (Kembs)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-6-bale-nevers",
      img: BASE_IMG + "eurovelo-6-loire-a-velo.jpg.webp",
    },
    EV8: {
      description: "La Méditerranée à Vélo suit la côte méditerranéenne entre Argelès-sur-Mer et Port-la-Nouvelle, traversant calanques, étangs et cités historiques.",
      distance: "850 km",
      status: "Véloroute réalisée à 53 %",
      connections: "ViaRhôna (Sète), Canal du Midi (Agde)",
      url: "https://www.francevelotourisme.com/itineraire/la-mediterranee-a-velo-eurovelo-8",
      img: BASE_IMG + "eurovelo-8-mediterranee.jpg.webp",
    },
    EV15: {
      description: "La Véloroute du Rhin côtoie le canal du Rhône au Rhin et la citadelle de Vauban (Patrimoine Mondial), de Bâle à Strasbourg.",
      distance: "180 km",
      status: "Véloroute réalisée à 100 %",
      connections: "EV 6 (Kembs), EV 5 (Strasbourg-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-15-veloroute-rhin",
      img: BASE_IMG + "eurovelo-15_strasbourg.jpg.webp",
    },
    EV19: {
      description: "La Meuse à Vélo longe ce fleuve européen sur plus de 1 000 km, depuis sa source à Langres jusqu'aux Pays-Bas, en traversant les Ardennes.",
      distance: "443 km (en France)",
      status: "Véloroute réalisée à 100 %",
      connections: "—",
      url: "https://www.francevelotourisme.com/itineraire/la-meuse-a-velo",
      img: BASE_IMG + "meuse-a-velo-en-famille-revin-voie-verte-trans-ardennes.jpg.webp",
    },
    VEL: {
      description: "De Roscoff à Hendaye, la Vélodyssée® se déploie le long de l'Atlantique sur plus de 1 250 km. Découvrez le meilleur des régions traversées avec l'océan comme toile de fond !",
      distance: "1 250 km",
      status: "Véloroute réalisée à 99 %",
      connections: "EV 4 (Roscoff), EV 6 (Nantes), EV 3 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-velodyssee",
      img: BASE_IMG + "eurovelo-1-velodyssee.jpg.webp",
    },
    VIA: {
      description: "La ViaRhôna longe le Rhône depuis sa source dans les Alpes suisses jusqu'à sa double embouchure en Méditerranée, traversant lacs, gorges et vignes.",
      distance: "815 km",
      status: "Véloroute réalisée à 100 %",
      connections: "EV 8 (Sète-Beaucaire)",
      url: "https://www.francevelotourisme.com/itineraire/viarhona",
      img: BASE_IMG + "eurovelo-17-rhone-route.jpg.webp",
    },
  };

  // ── Map initialisation ─────────────────────────────────────────────────────

  /**
   * Initialise the Leaflet map centred on France using OpenStreetMap France tiles.
   *
   * OSM France tiles display labels in French and provide a clean light background
   * that contrasts well with the vivid Eurovelo route colors.
   *
   * @param {string} containerId - ID of the HTML element that will hold the map.
   * @returns {L.Map} The created Leaflet map instance.
   */
  function initMap(containerId) {
    map = L.map(containerId).setView([46.8, 2.3], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        'rendu par <a href="https://tile.openstreetmap.fr">OSM France</a>',
      subdomains: "abc",
      maxZoom: 20,
      className: "map-tiles-greyscale",
    }).addTo(map);

    itineraryLayer = L.layerGroup().addTo(map);
    return map;
  }

  // ── Route overlays ─────────────────────────────────────────────────────────

  /**
   * Build the HTML content for the route info panel.
   *
   * @param {string} routeId - Route identifier (e.g. 'EV3').
   * @param {string} name - Route name from the JSON file.
   * @param {string} color - Route color hex string.
   * @returns {string} HTML string for the panel.
   */
  function buildRoutePanelHtml(routeId, name, color) {
    const info = ROUTE_INFO[routeId];
    if (!info) {
      return `<div class="route-panel-body"><div class="route-panel-title" style="color:${color}">${name}</div></div>`;
    }
    return `
      <img src="${info.img}" alt="${name}" class="route-panel-img" onerror="this.style.display='none'" />
      <div class="route-panel-body">
        <div class="route-panel-title" style="color:${color}">${name}</div>
        <p class="route-panel-desc">${info.description}</p>
        <ul class="route-panel-meta">
          <li><span>📏</span> ${info.distance}</li>
          <li><span>✅</span> ${info.status}</li>
          <li><span>🔗</span> <strong>Connexions :</strong> ${info.connections}</li>
        </ul>
        <a href="${info.url}" target="_blank" rel="noopener" class="route-panel-link">
          En savoir plus →
        </a>
      </div>
    `;
  }

  /**
   * Fetch a single route geometry file and draw it as a thin colored polyline.
   *
   * Attaches mouseover/mousemove/mouseout handlers that show/hide the floating
   * info panel. The panel stays open when the mouse moves onto it.
   *
   * @param {string} routeId - Route ID, e.g. 'EV3'.
   * @returns {Promise<void>} Resolves when the polyline is added to the map.
   */
  function loadRoute(routeId) {
    const filename = routeId.toLowerCase() + ".json";
    return fetch("static/data/routes/" + filename)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        const color = data.color || "#888";
        routeColors[routeId] = color;

        const panelHtml = buildRoutePanelHtml(routeId, data.name, color);

        const polyline = L.polyline(data.points, {
          color: color,
          weight: 3,
          opacity: 0.8,
        });

        polyline.on("mouseover", function (e) {
          this.setStyle({ weight: 5, opacity: 1 });
          showPanel(panelHtml, e.originalEvent.clientX, e.originalEvent.clientY);
        });
        polyline.on("mousemove", function (e) {
          positionPanel(e.originalEvent.clientX, e.originalEvent.clientY);
        });
        polyline.on("mouseout", function () {
          this.setStyle({ weight: 3, opacity: 0.8 });
          scheduleClosePanel();
        });

        routeLayers[routeId] = polyline;
        if (map) polyline.addTo(map);
      })
      .catch(function (err) {
        console.warn("Could not load route geometry for " + routeId + ":", err);
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
   * Restore each Eurovelo route overlay to the visibility dictated by its
   * checkbox in the search form.
   *
   * Called after an itinerary is deselected so routes return to the state the
   * user configured before expanding a card.
   */
  function restoreAllRouteVisibility() {
    Object.keys(routeLayers).forEach(function (routeId) {
      const cb = document.querySelector(`.route-checkbox[value="${routeId}"]`);
      const shouldShow = cb ? cb.checked : true;
      setRouteVisible(routeId, shouldShow);
    });
  }

  /**
   * Clear all itinerary-specific layers and restore Eurovelo route overlays
   * to their checkbox-driven visibility.
   *
   * Persistent route overlays and the base tile layer are preserved.
   */
  function clearMap() {
    if (itineraryLayer) {
      itineraryLayer.clearLayers();
    }
    restoreAllRouteVisibility();
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
   * Compute sample points for a gently curved arc between two geo-coordinates.
   *
   * Uses a quadratic Bézier curve whose control point is offset perpendicular
   * to the straight line at a fraction of the chord length. This produces a
   * smooth arc without any external dependency.
   *
   * @param {number} lat1 - Departure latitude.
   * @param {number} lon1 - Departure longitude.
   * @param {number} lat2 - Arrival latitude.
   * @param {number} lon2 - Arrival longitude.
   * @param {number} [curvature=0.2] - Perpendicular offset as a fraction of
   *   the chord length. Positive curves left, negative curves right.
   * @param {number} [steps=48] - Number of line segments in the output.
   * @returns {Array<[number, number]>} Array of [lat, lon] sample points.
   */
  function buildCurvedPoints(lat1, lon1, lat2, lon2, curvature, steps) {
    const c = curvature !== undefined ? curvature : 0.2;
    const n = steps !== undefined ? steps : 48;

    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    const dLat   = lat2 - lat1;
    const dLon   = lon2 - lon1;

    // Rotate the chord vector 90° to get the perpendicular direction
    const ctrlLat = midLat - dLon * c;
    const ctrlLon = midLon + dLat * c;

    const points = [];
    for (let i = 0; i <= n; i++) {
      const t   = i / n;
      const u   = 1 - t;
      const lat = u * u * lat1 + 2 * u * t * ctrlLat + t * t * lat2;
      const lon = u * u * lon1 + 2 * u * t * ctrlLon + t * t * lon2;
      points.push([lat, lon]);
    }
    return points;
  }

  // ── Itinerary rendering ────────────────────────────────────────────────────

  /**
   * Draw the selected itinerary on the map.
   *
   * - Keeps all Eurovelo route overlays visible.
   * - Draws the outbound train as a dashed curved arc in TRAIN_ALLER_COLOR.
   * - Draws the return train as a dashed curved arc in TRAIN_RETOUR_COLOR.
   * - Places labelled markers at the home station and at both bike endpoints.
   * - Fits the map to all drawn elements.
   *
   * @param {Object} itinerary - Itinerary object assembled by search.js.
   * @param {Object} itinerary.home_station      - {nom, lat, lon}.
   * @param {Object} itinerary.departure_station - {nom, lat, lon}.
   * @param {Object} itinerary.arrival_station   - {nom, lat, lon}.
   */
  function showItineraryOnMap(itinerary) {
    itineraryLayer.clearLayers();

    const bounds = [];

    const dep  = itinerary.departure_station;
    const arr  = itinerary.arrival_station;
    const home = itinerary.home_station;

    // ── Train aller: home → dep ─────────────────────────────────────────────
    if (home && dep && home.lat && dep.lat) {
      itineraryLayer.addLayer(L.polyline(
        buildCurvedPoints(home.lat, home.lon, dep.lat, dep.lon),
        { color: TRAIN_ALLER_COLOR, weight: 3, opacity: 0.9, dashArray: "10 6" }
      ));
      itineraryLayer.addLayer(
        L.marker([home.lat, home.lon], {
          icon: buildStationIcon(TRAIN_ALLER_COLOR), title: home.nom,
        }).bindPopup(`<b>Départ train aller</b><br>${home.nom}`)
      );
      itineraryLayer.addLayer(
        L.marker([dep.lat, dep.lon], {
          icon: buildStationIcon(TRAIN_ALLER_COLOR), title: dep.nom,
        }).bindPopup(`<b>Arrivée train aller — Départ vélo</b><br>${dep.nom}`)
      );
      bounds.push([home.lat, home.lon], [dep.lat, dep.lon]);
    }

    // ── Train retour: arr → home ────────────────────────────────────────────
    if (arr && home && arr.lat && home.lat) {
      itineraryLayer.addLayer(L.polyline(
        buildCurvedPoints(arr.lat, arr.lon, home.lat, home.lon),
        { color: TRAIN_RETOUR_COLOR, weight: 3, opacity: 0.9, dashArray: "10 6" }
      ));
      itineraryLayer.addLayer(
        L.marker([arr.lat, arr.lon], {
          icon: buildStationIcon(TRAIN_RETOUR_COLOR), title: arr.nom,
        }).bindPopup(`<b>Arrivée vélo — Départ train retour</b><br>${arr.nom}`)
      );
      bounds.push([arr.lat, arr.lon]);
    }

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  /**
   * Pan and zoom the map to a specific coordinate.
   *
   * @param {number} lat - Latitude in decimal degrees.
   * @param {number} lon - Longitude in decimal degrees.
   * @param {number} zoom - Target zoom level.
   */
  function centerOn(lat, lon, zoom) {
    if (map) map.setView([lat, lon], zoom, { animate: true });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.InterMap = {
    initMap,
    loadAllRoutes,
    setRouteVisible,
    clearMap,
    showItineraryOnMap,
    centerOn,
    TRAIN_COLORS: { aller: TRAIN_ALLER_COLOR, retour: TRAIN_RETOUR_COLOR },
  };
})();
