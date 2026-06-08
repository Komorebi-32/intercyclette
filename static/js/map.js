/**
 * map.js — Leaflet map initialisation, route overlays, and itinerary rendering.
 *
 * Manages a single Leaflet map instance.
 *
 * Colored route overlays (one per Eurovelo route) are loaded from
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

  /** @type {L.Map} */
  let map = null;

  /** @type {L.LayerGroup} Holds itinerary-specific layers (cleared on each select). */
  let itineraryLayer = null;

  /** @type {L.LayerGroup} Holds the departure city marker (home emoji). */
  let departureLayer = null;

  /** @type {L.LayerGroup} Holds OSM housing circle markers (toggled by pill). */
  let housingLayer = null;

  /** @type {L.LayerGroup} Holds Accueil Vélo housing markers (toggled by pill). */
  let accueilVeloHousingLayer = null;

  /** @type {L.LayerGroup} Holds Accueil Vélo restaurant markers (toggled by pill). */
  let accueilVeloRestaurantsLayer = null;

  /**
   * Raw OSM housing points, retained after load so the housing-proposal feature
   * can search for the nearest accommodation to a point client-side.
   * @type {Array<Object>}
   */
  let housingPointsRaw = [];

  /**
   * Raw Accueil Vélo housing points, retained after load (same purpose).
   * @type {Array<Object>}
   */
  let accueilVeloHousingRaw = [];

  /**
   * Route color map loaded from the JSON files.
   * Key: route_id (e.g. 'EV3'), value: hex color string.
   * @type {Object.<string, string>}
   */
  const routeColors = {};

  /**
   * Candidate colors for train legs, in priority order
   * (green, orange, blue, violet, red). Two distinct colors are picked per
   * itinerary — one for the outbound leg, one for the return leg — while
   * avoiding any color too close to the selected Eurovelo route color.
   * @type {string[]}
   */
  // const TRAIN_COLOR_PALETTE = ["#16a34a", "#ea580c", "#2563eb", "#7c3aed", "#dc2626"];
  const TRAIN_COLOR_PALETTE = ["#f536a5","#2563eb", "#7c3aed", "#dc2626"];

  /**
   * Minimum RGB Euclidean distance a train color must keep from the route color
   * to be considered visually distinct.
   * @type {number}
   */
  const MIN_TRAIN_ROUTE_COLOR_DISTANCE = 90;

  /** Number of direction arrows distributed along each itinerary leg. */
  const ARROWS_PER_LEG = 6;

  /**
   * Per-zoom simplification tolerance (px) for the nine always-on route
   * overlays. The overlays now carry every GPX vertex (tens of thousands of
   * points each), so a slightly higher-than-default smoothFactor lets Leaflet
   * drop sub-pixel detail when zoomed out — keeping pan/zoom smooth — while
   * still drawing full detail when zoomed in onto a route. Combined with the
   * Canvas renderer (preferCanvas), this keeps all nine routes fluid.
   * @type {number}
   */
  const ROUTE_SMOOTH_FACTOR = 1.5;

  /** Breathing-room margin (px) kept around a leg when focusing the map. */
  const FOCUS_EDGE_MARGIN = 24;

  /** Vertical padding (px) kept above/below a leg when focusing the map. */
  const FOCUS_VERTICAL_PADDING = 40;

  /**
   * Persistent route overlay layers, keyed by route_id.
   * @type {Object.<string, L.Polyline>}
   */
  const routeLayers = {};

  /**
   * Desired visibility for each route overlay (synced with checkboxes).
   * @type {Object.<string, boolean>}
   */
  const routeVisibility = {};

  /** Whether route overlays are temporarily hidden while a result is selected. */
  let routesHidden = false;

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

  // const BASE_IMG = "https://www.francevelotourisme.com/sites/default/files/styles/visuels/public/medias/images/";

  /**
   * Static metadata for each Eurovelo route, used in the hover info panel.
   * Sources: francevelotourisme.com/conseils/preparer-mon-voyage-a-velo/eurovelo-france
   *
   * @type {Object.<string, {description:string, distance:string, status:string, connections:string, url:string, img:string}>} //img:string commented for now for copyright issues, 
   * need to ask the authors if it's ok to put their images
   */
  const ROUTE_INFO = {
    EV3: {
      description: "La Scandibérique traverse la France en diagonale depuis la frontière belge jusqu'à l'Espagne, à travers l'Île-de-France, la vallée de la Loire, le Poitou et la Gascogne.",
      distance: "1 700 km",
      // status: "Véloroute réalisée à 95 %",
      connections: "EuroVelo 6 (Orléans-Tours), EuroVelo 1 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-scandiberique-eurovelo-3",
      // img: BASE_IMG + "eurovelo-3-landes-scandiberique.jpg.webp",
    },
    EV4: {
      description: "La Vélomaritime relie Roscoff en Bretagne à Bray-Dunes à la frontière belge, longeant les côtes de la Manche et de la mer du Nord.",
      distance: "1 518 km",
      // status: "Véloroute réalisée à 99,3 %",
      connections: "EV 1 (Roscoff), EV 5 et 12 (Calais)",
      url: "https://www.francevelotourisme.com/itineraire/la-velomaritime-eurovelo-4",
      // img: BASE_IMG + "Velo_au_Mont-Saint-Michel-Les_valises_de_Sarah_Calvados_Attractivite-11037.JPG.webp",
    },
    EV5: {
      description: "L'EuroVelo 5 traverse la France en deux sections : par Lille au nord et par Strasbourg et la route des vins d'Alsace au sud, vers Rome.",
      distance: "669 km",
      // status: "Véloroute réalisée à 77 %",
      connections: "EV 15 (Strasbourg-Bâle), EV 6 (Mulhouse-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-5-moselle-alsace",
      // img: BASE_IMG + "eurovelo-5-vignes.jpg.webp",
    },
    EV6: {
      description: "L'EuroVelo 6 suit la vallée du Doubs puis la Loire à Vélo, de la Suisse jusqu'à l'Atlantique, à travers vignobles et châteaux.",
      distance: "1 300 km",
      // status: "Véloroute réalisée à 100 %",
      connections: "EV 1 (Nantes), EV 3 (Orléans-Tours), EV 15 (Kembs)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-6-bale-nevers",
      // img: BASE_IMG + "eurovelo-6-loire-a-velo.jpg.webp",
    },
    EV8: {
      description: "La Méditerranée à Vélo suit la côte méditerranéenne entre Argelès-sur-Mer et Port-la-Nouvelle, traversant calanques, étangs et cités historiques.",
      distance: "850 km",
      // status: "Véloroute réalisée à 53 %",
      connections: "ViaRhôna (Sète), Canal du Midi (Agde)",
      url: "https://www.francevelotourisme.com/itineraire/la-mediterranee-a-velo-eurovelo-8",
      // img: BASE_IMG + "eurovelo-8-mediterranee.jpg.webp",
    },
    EV15: {
      description: "La Véloroute du Rhin côtoie le canal du Rhône au Rhin et la citadelle de Vauban (Patrimoine Mondial), de Bâle à Strasbourg.",
      distance: "180 km",
      // status: "Véloroute réalisée à 100 %",
      connections: "EV 6 (Kembs), EV 5 (Strasbourg-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-15-veloroute-rhin",
      // img: BASE_IMG + "eurovelo-15_strasbourg.jpg.webp",
    },
    EV19: {
      description: "La Meuse à Vélo longe ce fleuve européen sur plus de 1 000 km, depuis sa source à Langres jusqu'aux Pays-Bas, en traversant les Ardennes.",
      distance: "443 km (en France)",
      // status: "Véloroute réalisée à 100 %",
      connections: "—",
      url: "https://www.francevelotourisme.com/itineraire/la-meuse-a-velo",
      // img: BASE_IMG + "meuse-a-velo-en-famille-revin-voie-verte-trans-ardennes.jpg.webp",
    },
    VEL: {
      description: "De Roscoff à Hendaye, la Vélodyssée® se déploie le long de l'Atlantique sur plus de 1 250 km. Découvrez le meilleur des régions traversées avec l'océan comme toile de fond !",
      distance: "1 250 km",
      // status: "Véloroute réalisée à 99 %",
      connections: "EV 4 (Roscoff), EV 6 (Nantes), EV 3 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-velodyssee",
      // img: "https://fr.wikipedia.org/wiki/EuroVelo_1#/media/Fichier:258_La_Grande_Tranch%C3%A9e_de_Glomel.jpg",
    },
    VIA: {
      description: "La ViaRhôna longe le Rhône depuis sa source dans les Alpes suisses jusqu'à sa double embouchure en Méditerranée, traversant lacs, gorges et vignes.",
      distance: "815 km",
      // status: "Véloroute réalisée à 100 %",
      connections: "EV 8 (Sète-Beaucaire)",
      url: "https://www.francevelotourisme.com/itineraire/viarhona",
      // img: BASE_IMG + "eurovelo-17-rhone-route.jpg.webp",
    },
  };

  // ── Map initialisation ─────────────────────────────────────────────────────

  /**
   * Initialise the Leaflet map centred on France using OpenStreetMap France tiles.
   *
   * OSM France tiles display labels in French and provide a clean light background
   * that contrasts well with the vivid Eurovelo route colors.
   *
   * The map uses a Canvas renderer (`preferCanvas: true`) so the full-resolution
   * route overlays (tens of thousands of vertices each, nine at once) render and
   * pan smoothly.
   *
   * @param {string} containerId - ID of the HTML element that will hold the map.
   * @returns {L.Map} The created Leaflet map instance.
   */
  function initMap(containerId) {
    map = L.map(containerId, { zoomControl: false, preferCanvas: true }).setView([46.8, 2.3], 6);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
        'rendu par <a href="https://tile.openstreetmap.fr">OSM France</a>',
      subdomains: "abc",
      maxZoom: 20,
      className: "map-tiles-greyscale",
    }).addTo(map);

    itineraryLayer = L.layerGroup().addTo(map);
    departureLayer = L.layerGroup().addTo(map);
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
   * img in pause awaiting authorization to use copyright. When ok insert this at the beginning of return:
   * images <img src="${info.img}" alt="${name}" class="route-panel-img" onerror="this.style.display='none'" />
   */
  function buildRoutePanelHtml(routeId, name, color) {
    const info = ROUTE_INFO[routeId];
    if (!info) {
      return `<div class="route-panel-body"><div class="route-panel-title" style="color:${color}">${name}</div></div>`;
    }
    return `
      <div class="route-panel-body">
        <div class="route-panel-title" style="color:${color}">${name}</div>
        <p class="route-panel-desc">${info.description}</p>
        <ul class="route-panel-meta">
          <li><span>📏</span> ${info.distance}</li>
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
        if (routeVisibility[routeId] === undefined) {
          routeVisibility[routeId] = true;
        }

        const panelHtml = buildRoutePanelHtml(routeId, data.name, color);

        const polyline = L.polyline(data.points, {
          color: color,
          weight: 3,
          opacity: 0.8,
          smoothFactor: ROUTE_SMOOTH_FACTOR,
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
        if (map && !routesHidden && routeVisibility[routeId] !== false) {
          polyline.addTo(map);
        }
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
    routeVisibility[routeId] = visible;
    if (!layer || !map) return;
    if (routesHidden || !visible) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
  }

  /**
   * Hide or show all route overlays while preserving checkbox visibility state.
   *
   * @param {boolean} hidden - True to hide all overlays, false to restore.
   */
  function setRoutesHidden(hidden) {
    routesHidden = hidden;
    if (!map) return;
    Object.keys(routeLayers).forEach(function (routeId) {
      const layer = routeLayers[routeId];
      const shouldShow = !routesHidden && routeVisibility[routeId] !== false;
      if (shouldShow) {
        if (!map.hasLayer(layer)) layer.addTo(map);
      } else if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });
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
   * Build a custom Leaflet icon for a station marker with an emoji.
   *
   * @param {string} emoji - The emoji to display.
   * @param {number} size - Font size in pixels.
   * @returns {L.DivIcon}
   */
  function buildEmojiStationIcon(emoji, size = 24) {
    return L.divIcon({
      className: "",
      html: `<div class="station-emoji-marker" style="font-size:${size}px">${emoji}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
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
   * Build a custom cluster DivIcon showing an emoji and the child count.
   *
   * @param {L.MarkerCluster} cluster - The cluster object provided by markercluster.
   * @param {string} emoji - Emoji displayed inside the cluster bubble.
   * @param {string} bgColor - CSS background color of the bubble.
   * @returns {L.DivIcon}
   */
  function buildClusterIcon(cluster, emoji, bgColor) {
    return L.divIcon({
      html: `<div class="cluster-bubble" style="background:${bgColor}">${emoji} ${cluster.getChildCount()}</div>`,
      className: "",
      iconSize: L.point(44, 44),
      iconAnchor: L.point(22, 22),
    });
  }

  /**
   * Build a DivIcon that renders as a small colored circle, replicating the
   * appearance of the former L.circleMarker while remaining compatible with
   * L.markerClusterGroup (which only clusters L.marker instances).
   *
   * @param {string} cssClass - CSS class(es) controlling the circle colors.
   * @returns {L.DivIcon}
   */
  function buildDotIcon(cssClass) {
    return L.divIcon({
      html: `<div class="${cssClass}"></div>`,
      className: "",
      iconSize: L.point(10, 10),
      iconAnchor: L.point(5, 5),
    });
  }

  // ── Train leg colors ───────────────────────────────────────────────────────

  /**
   * Convert a "#rrggbb" hex color to an {r, g, b} object.
   *
   * @param {string} hex - Hex color string, e.g. "#2ecc71".
   * @returns {{r:number, g:number, b:number}|null} RGB components (0-255), or
   *   null when the string is not a valid 6-digit hex color.
   */
  function hexToRgb(hex) {
    if (typeof hex !== "string") return null;
    const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const intVal = parseInt(match[1], 16);
    return { r: (intVal >> 16) & 255, g: (intVal >> 8) & 255, b: intVal & 255 };
  }

  /**
   * Euclidean distance between two RGB colors.
   *
   * @param {{r:number,g:number,b:number}} a - First color.
   * @param {{r:number,g:number,b:number}} b - Second color.
   * @returns {number} Distance in RGB space (0–441).
   */
  function colorDistance(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  /**
   * Pick two distinct train-leg colors that do not clash with the route color.
   *
   * Palette colors within MIN_TRAIN_ROUTE_COLOR_DISTANCE of the selected route
   * color are excluded; the first two survivors are returned. Falls back to the
   * full palette if fewer than two colors survive.
   *
   * @param {string} routeId - Route ID for route-color lookup (e.g. "EV6").
   * @returns {{outbound:string, return:string}} Hex colors for each train leg.
   */
  function getTrainLegColors(routeId) {
    const routeRgb = hexToRgb(routeColors[routeId] || "");
    const usable = routeRgb
      ? TRAIN_COLOR_PALETTE.filter(function (c) {
          return colorDistance(hexToRgb(c), routeRgb) > MIN_TRAIN_ROUTE_COLOR_DISTANCE;
        })
      : TRAIN_COLOR_PALETTE.slice();
    const pool = usable.length >= 2 ? usable : TRAIN_COLOR_PALETTE;
    return { outbound: pool[0], return: pool[1] };
  }

  // ── Direction arrows ───────────────────────────────────────────────────────

  /**
   * Compute the compass bearing (degrees, 0 = north) from one point to another.
   *
   * @param {[number, number]} from - [lat, lon] start point.
   * @param {[number, number]} to - [lat, lon] end point.
   * @returns {number} Bearing in degrees, 0–360.
   */
  function computeBearing(from, to) {
    const lat1 = (from[0] * Math.PI) / 180;
    const lat2 = (to[0] * Math.PI) / 180;
    const dLon = ((to[1] - from[1]) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2)
      - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
  }

  /**
   * Build a non-interactive arrowhead icon rotated to a travel bearing.
   *
   * The "➤" glyph points east (90° bearing), so it is rotated by
   * (bearing − 90) to align with the direction of travel.
   *
   * @param {string} color - CSS color for the arrow.
   * @param {number} bearingDeg - Travel bearing in degrees (0 = north).
   * @returns {L.DivIcon}
   */
  function buildArrowIcon(color, bearingDeg) {
    return L.divIcon({
      className: "",
      html: `<div class="leg-arrow" style="color:${color};transform:rotate(${bearingDeg - 90}deg)">➤</div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  /**
   * Interpolate a point and local bearing at a fractional distance along a path.
   *
   * @param {Array<[number, number]>} geometry - Polyline vertices.
   * @param {Array<number>} cumulative - Cumulative segment lengths (length n).
   * @param {number} targetDistance - Distance along the path to sample.
   * @returns {{point:[number, number], bearing:number}} The interpolated point
   *   and the bearing of the segment it falls on.
   */
  function sampleAlongPath(geometry, cumulative, targetDistance) {
    let i = 1;
    while (i < cumulative.length && cumulative[i] < targetDistance) i += 1;
    const segStart = geometry[i - 1];
    const segEnd = geometry[i];
    const segLen = cumulative[i] - cumulative[i - 1];
    const t = segLen > 0 ? (targetDistance - cumulative[i - 1]) / segLen : 0;
    const point = [
      segStart[0] + (segEnd[0] - segStart[0]) * t,
      segStart[1] + (segEnd[1] - segStart[1]) * t,
    ];
    return { point: point, bearing: computeBearing(segStart, segEnd) };
  }

  /**
   * Place evenly spaced direction arrows along a leg's geometry.
   *
   * Arrows are positioned by arc length (not vertex index) so spacing stays
   * even regardless of vertex density, and they are non-interactive so they do
   * not capture pointer events meant for the underlying polyline.
   *
   * @param {Array<[number, number]>} geometry - Polyline vertices.
   * @param {string} color - Arrow color.
   */
  function addDirectionArrows(geometry, color) {
    if (!geometry || geometry.length < 2) return;
    const cumulative = [0];
    for (let i = 0; i < geometry.length - 1; i += 1) {
      const dLat = geometry[i + 1][0] - geometry[i][0];
      const dLon = geometry[i + 1][1] - geometry[i][1];
      cumulative.push(cumulative[i] + Math.hypot(dLat, dLon));
    }
    const total = cumulative[cumulative.length - 1];
    if (total === 0) return;
    for (let k = 1; k <= ARROWS_PER_LEG; k += 1) {
      const targetDistance = (total * k) / (ARROWS_PER_LEG + 1);
      const sample = sampleAlongPath(geometry, cumulative, targetDistance);
      const marker = L.marker(sample.point, {
        icon: buildArrowIcon(color, sample.bearing),
        interactive: false,
        keyboard: false,
      });
      itineraryLayer.addLayer(marker);
    }
  }

  /**
   * Collect all section geometry coordinates of a train journey into one array.
   *
   * @param {Object|null} journey - Journey object with a `sections` array.
   * @returns {Array<[number, number]>} Flattened [lat, lon] coordinates (empty
   *   when the journey or its geometry is missing).
   */
  function collectJourneyCoords(journey) {
    const coords = [];
    if (journey && journey.sections) {
      journey.sections.forEach(function (section) {
        if (section.geometry && section.geometry.length >= 2) {
          coords.push(...section.geometry);
        }
      });
    }
    return coords;
  }

  // ── Itinerary rendering ────────────────────────────────────────────────────

    /**
   * Render train segments for a journey onto the itinerary layer.
   *
   * Each section is drawn as a dashed polyline in the given leg color with
   * direction arrows indicating the travel direction.
   *
   * @param {Object|null} journey - Journey object with a `sections` array.
   * @param {Array<[number, number]>} bounds - Bounds accumulator for fitBounds.
   * @param {string} color - Hex color for this train leg.
   */
  function renderTrainSegments(journey, bounds, color) {
    if (!journey || !journey.sections) return;
    journey.sections.forEach(function (section) {
      const geometry = section.geometry;
      if (!geometry || geometry.length < 2) return;
      const polyline = L.polyline(geometry, {
        color: color,
        weight: 4,
        opacity: 0.85,
        dashArray: "6 6",
      });
      itineraryLayer.addLayer(polyline);
      addDirectionArrows(geometry, color);
      bounds.push(...geometry);
    });
  }

  /**
   * Draw a full itinerary (two train legs + the biked segment + station
   * markers) onto the itinerary layer and fit the map to it.
   *
   * Existing itinerary layers are cleared first and the persistent route
   * overlays are hidden (`setRoutesHidden(true)`) so only the selected trip is
   * shown. Each train leg is delegated to `renderTrainSegments` (dashed, per-leg
   * color); the bike leg is drawn here as a solid route-colored polyline. A
   * 🚴 marker is placed at the bike departure (outbound train arrival) and a 🏁
   * marker at the bike arrival (return train departure). Finally `map.fitBounds`
   * frames every drawn coordinate with a 40px padding.
   *
   * ── How the bike leg is produced and drawn ────────────────────────────────
   *
   * The polyline drawn here (`itinerary.geometry`) is produced in `planner.js`
   * at search time by `extractSegmentPoints`, which snaps the departure and
   * arrival stations to their nearest vertices on the route's full-resolution
   * `track_points` and returns the slice between them — so the line spans
   * station to station and traces the GPX exactly. This function only renders
   * those coordinates.
   *
   * The rendering step proper: when `itinerary.geometry` has at least two
   * points, it is drawn as an `L.polyline` in the route color
   * (`routeColors[route_id]`, falling back to green) at weight 6 / opacity 0.9 —
   * heavier than the dashed train legs and the thin always-on route overlay so
   * the biked portion stands out. `addDirectionArrows` overlays travel-direction
   * arrows along it, and every vertex is pushed into `bounds` so the bike leg is
   * included in the final `fitBounds`.
   *
   * @param {Object} itinerary - Itinerary object assembled by search.js.
   * @param {string} itinerary.route_id - Route ID for bike-leg color lookup.
   * @param {Array<[number, number]>} itinerary.geometry - Biked segment polyline
   *   ([[lat, lon], …]), sliced full-resolution from the route track_points
   *   between the two stations by planner.js.
   * @param {Object|null} itinerary.outbound - Outbound train journey (sections).
   * @param {Object|null} itinerary.return_train - Return train journey (sections).
   * @param {{nom:string, lat:number, lon:number}} itinerary.departure_station -
   *   Bike departure / outbound train arrival station.
   * @param {{nom:string, lat:number, lon:number}} itinerary.arrival_station -
   *   Bike arrival / return train departure station.
   */
  function showItineraryOnMap(itinerary) {
    clearMap();
    setRoutesHidden(true);

    const segmentColor = routeColors[itinerary.route_id] || "#2ecc71";
    const trainColors = getTrainLegColors(itinerary.route_id);
    const bounds = [];

    renderTrainSegments(itinerary.outbound, bounds, trainColors.outbound);
    renderTrainSegments(itinerary.return_train, bounds, trainColors.return);

    if (itinerary.geometry && itinerary.geometry.length > 1) {
      const polyline = L.polyline(itinerary.geometry, {
        color: segmentColor,
        weight: 6,
        opacity: 0.9,
      });
      itineraryLayer.addLayer(polyline);
      addDirectionArrows(itinerary.geometry, segmentColor);
      bounds.push(...itinerary.geometry);
    }

    const dep = itinerary.departure_station;
    if (dep && dep.lat && dep.lon) {
      const marker = L.marker([dep.lat, dep.lon], {
        icon: buildEmojiStationIcon("🚴", 23),
        title: "Départ vélo : " + dep.nom,
      }).bindPopup(`<b>Arrivée train aller</b><br>${dep.nom}`);
      itineraryLayer.addLayer(marker);
      bounds.push([dep.lat, dep.lon]);
    }

    const arr = itinerary.arrival_station;
    if (arr && arr.lat && arr.lon) {
      const marker = L.marker([arr.lat, arr.lon], {
        icon: buildEmojiStationIcon("🏁", 23),
        title: "Arrivée vélo : " + arr.nom,
      }).bindPopup(`<b>Départ train retour</b><br>${arr.nom}`);
      itineraryLayer.addLayer(marker);
      bounds.push([arr.lat, arr.lon]);
    }

    renderNightHousingMarkers(itinerary, bounds);

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  /**
   * Draw a 🛏️ marker for each computed overnight housing stop of an itinerary.
   *
   * No-op when the housing-proposal feature is off (no `itinerary.housing`).
   * Each marker hovers the same info box used by the standalone housing layers
   * and carries a "Nuit N" popup. Markers are added to itineraryLayer so they
   * clear on the next selection.
   *
   * @param {Object} itinerary - Itinerary object; may carry a `housing` array of
   *   { night, lat, lon, point, source } entries (point null when none found).
   * @param {Array<[number, number]>} bounds - Bounds accumulator for fitBounds.
   */
  function renderNightHousingMarkers(itinerary, bounds) {
    if (!itinerary.housing || itinerary.housing.length === 0) return;
    itinerary.housing.forEach(function (stop) {
      if (!stop.point) return;
      const panelHtml = buildHousingInfoHtml(stop.point, stop.source);
      // No `title` option: it renders a second, native (dark) tooltip on top of
      // the custom hover panel. The hover panel below is the only info box.
      const marker = L.marker([stop.point.lat, stop.point.lon], {
        icon: buildEmojiStationIcon("🛏️", 22),
      }).bindPopup("<b>Nuit " + stop.night + "</b><br>" + (stop.point.name || ""));
      marker.on("mouseover", function (e) {
        showPanel(panelHtml, e.originalEvent.clientX, e.originalEvent.clientY);
      });
      marker.on("mousemove", function (e) {
        positionPanel(e.originalEvent.clientX, e.originalEvent.clientY);
      });
      marker.on("mouseout", function () {
        scheduleClosePanel();
      });
      itineraryLayer.addLayer(marker);
      bounds.push([stop.point.lat, stop.point.lon]);
    });
  }

  /**
   * Left inset (px) the map must keep clear so a focused leg is not hidden
   * behind the floating left panel.
   *
   * Measured from the live `.panel-left` element's right edge plus a margin, so
   * it adapts to the panel's actual width. Falls back to the bare margin when
   * the panel is absent.
   *
   * @returns {number} Left padding in pixels.
   */
  function leftPanelInset() {
    const panel = document.querySelector(".panel-left");
    if (!panel) return FOCUS_EDGE_MARGIN;
    return panel.getBoundingClientRect().right + FOCUS_EDGE_MARGIN;
  }

  /**
   * Fit the map to a single leg of an itinerary without redrawing it.
   *
   * Used when the user clicks one detail-section so the map zooms to the
   * concerned leg. The bike leg also includes its departure/arrival station
   * coordinates in the bounds. The leg is framed in the space between the
   * floating left panel and the right edge of the page (asymmetric padding) so
   * the panel never hides part of it.
   *
   * @param {Object} itinerary - Itinerary object assembled by search.js.
   * @param {string} legType - One of "outbound", "return", or "bike".
   */
  function focusOnLeg(itinerary, legType) {
    if (!map) return;
    let coords = [];
    if (legType === "outbound") {
      coords = collectJourneyCoords(itinerary.outbound);
    } else if (legType === "return") {
      coords = collectJourneyCoords(itinerary.return_train);
    } else if (legType === "bike") {
      coords = (itinerary.geometry || []).slice();
      const dep = itinerary.departure_station;
      const arr = itinerary.arrival_station;
      if (dep && dep.lat && dep.lon) coords.push([dep.lat, dep.lon]);
      if (arr && arr.lat && arr.lon) coords.push([arr.lat, arr.lon]);
    }
    if (coords.length > 0) {
      map.fitBounds(coords, {
        paddingTopLeft: [leftPanelInset(), FOCUS_VERTICAL_PADDING],
        paddingBottomRight: [FOCUS_EDGE_MARGIN, FOCUS_VERTICAL_PADDING],
      });
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

  /**
   * Pan and zoom the map to a housing point (used when a housing name is clicked
   * in a results card).
   *
   * @param {number} lat - Housing latitude.
   * @param {number} lon - Housing longitude.
   */
  function focusHousing(lat, lon) {
    centerOn(lat, lon, 13);
  }

  /**
   * Return the retained raw housing point pools for nearest-housing search.
   *
   * @returns {{osm: Array<Object>, av: Array<Object>}} OSM and Accueil Vélo
   *   housing point arrays (empty until the respective layers have loaded).
   */
  function getHousingPools() {
    return { osm: housingPointsRaw, av: accueilVeloHousingRaw };
  }

  /**
   * Add a single marker to the itinerary layer.
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} emoji
   * @param {number} size
   * @param {string} title
   * @param {string} popupContent
   */
  function addMarker(lat, lon, emoji, size, title, popupContent) {
    if (!itineraryLayer) return;
    const marker = L.marker([lat, lon], {
      icon: buildEmojiStationIcon(emoji, size),
      title: title,
    }).bindPopup(popupContent);
    itineraryLayer.addLayer(marker);
  }

  /**
   * Set or update the persistent departure city marker (home emoji).
   *
   * @param {number} lat
   * @param {number} lon
   * @param {string} title
   * @param {string} popupContent
   */
  function setDepartureMarker(lat, lon, title, popupContent) {
    if (!departureLayer) return;
    departureLayer.clearLayers();
    const marker = L.marker([lat, lon], {
      icon: buildEmojiStationIcon("🏠", 23),
      title: "Ville de départ : " + title,
    }).bindPopup(popupContent);
    departureLayer.addLayer(marker);
  }

  // ── Housing points ─────────────────────────────────────────────────────────

  /**
   * Build the HTML content for the housing hover panel.
   *
   * Reuses existing panel CSS classes. Null fields are shown as
   * <em class="housing-null">non renseigné</em>.
   *
   * @param {Object} point - Housing point object from housing.json.
   * @param {string|null} point.name - Establishment name.
   * @param {string|null} point.type - Accommodation type (e.g. "hotel").
   * @param {string|null} point.phone - Phone number.
   * @param {string|null} point.website - Website URL.
   * @returns {string} HTML string for the panel.
   */
  function buildHousingPanelHtml(point) {
    const nullHtml = '<em class="housing-null">non renseigné</em>';
    const nameHtml = point.name || nullHtml;
    // const typeHtml = point.type || nullHtml;
    const phoneHtml = point.phone || nullHtml;
    const websiteHtml = point.website
      ? `<a href="${point.website}" target="_blank" rel="noopener noreferrer" class="route-panel-link">Visiter le site →</a>`
      : nullHtml;

    return `
      <div class="route-panel-body">
        <div class="route-panel-title">${nameHtml}</div>
        <ul class="route-panel-meta">
          <li><span>📞</span> ${phoneHtml}</li>
        </ul>
        ${websiteHtml}
      </div>
    `;
  }

  /**
   * Build the hover info-box HTML for a housing point, dispatching on its
   * source so the same box used on map markers can be reused elsewhere (e.g. the
   * housing names in a results card).
   *
   * @param {Object} point - Housing point object.
   * @param {string} source - "av" for Accueil Vélo, anything else for OSM.
   * @returns {string} HTML string for the hover panel.
   */
  function buildHousingInfoHtml(point, source) {
    return source === "av"
      ? buildAccueilVeloHousingPanelHtml(point)
      : buildHousingPanelHtml(point);
  }

  /**
   * Fetch housing.json and add a pale-blue circle marker for each point.
   *
   * Markers are added directly to the map (not to itineraryLayer) so they
   * remain visible regardless of itinerary selection state. Hovering a marker
   * shows the floating info panel via the shared showPanel / scheduleClosePanel
   * helpers.
   *
   * @returns {Promise<void>} Resolves when all markers have been added.
   */
  function loadHousingPoints() {
    housingLayer = L.markerClusterGroup({
      disableClusteringAtZoom: 10,
      iconCreateFunction: function (cluster) {
        return buildClusterIcon(cluster, "🏠", "rgba(174, 214, 241, 0.6)");
      },
    });
    return fetch("static/data/housing.json")
      .then(function (r) { return r.json(); })
      .then(function (points) {
        housingPointsRaw = points;
        points.forEach(function (p) {
          const marker = L.marker([p.lat, p.lon], {
            icon: buildDotIcon("housing-dot housing-dot--osm"),
          });

          const panelHtml = buildHousingPanelHtml(p);

          marker.on("mouseover", function (e) {
            showPanel(panelHtml, e.originalEvent.clientX, e.originalEvent.clientY);
          });
          marker.on("mousemove", function (e) {
            positionPanel(e.originalEvent.clientX, e.originalEvent.clientY);
          });
          marker.on("mouseout", function () {
            scheduleClosePanel();
          });

          housingLayer.addLayer(marker);
        });
        // Layer loaded but hidden by default; toggled by checkbox.
      })
      .catch(function (err) {
        console.warn("Could not load housing points:", err);
      });
  }

  /**
   * Show or hide the housing points layer.
   *
   * @param {boolean} visible - True to show the layer, false to hide it.
   */
  function toggleHousingPoints(visible) {
    if (!housingLayer || !map) return;
    if (visible) {
      if (!map.hasLayer(housingLayer)) housingLayer.addTo(map);
    } else {
      if (map.hasLayer(housingLayer)) map.removeLayer(housingLayer);
    }
  }

  // ── Accueil Vélo housing ───────────────────────────────────────────────────

  /**
   * Build the HTML content for an Accueil Vélo housing hover panel.
   *
   * Null fields are shown as <em class="housing-null">non renseigné</em>.
   *
   * @param {Object} point - AccueilVeloPoint object from accueil_velo_housing.json.
   * @param {string|null} point.name - Establishment name.
   * @param {string|null} point.website - Website URL.
   * @returns {string} HTML string for the panel.
   */
  function buildAccueilVeloHousingPanelHtml(point) {
    const nullHtml = '<em class="housing-null">non renseigné</em>';
    const nameHtml = point.name || nullHtml;
    const websiteHtml = point.website
      ? `<a href="${point.website}" target="_blank" rel="noopener noreferrer" class="route-panel-link">Visiter le site →</a>`
      : nullHtml;

    return `
      <div class="route-panel-body">
        <div class="route-panel-title">Hébergement labellisé Accueil Vélo</div>
        <ul class="route-panel-meta">
          <li>${nameHtml}</li>
        </ul>
        ${websiteHtml}
      </div>
    `;
  }

  /**
   * Fetch accueil_velo_housing.json and add a pale green circle marker for
   * each point.
   *
   * Markers are added to a dedicated cluster group (accueilVeloHousingLayer) so
   * they can be toggled independently of the OSM housing layer.  Hovering a
   * marker shows the floating info panel via the shared showPanel /
   * scheduleClosePanel helpers.
   *
   * @returns {Promise<void>} Resolves when all markers have been added.
   */
  function loadAccueilVeloHousing() {
    accueilVeloHousingLayer = L.markerClusterGroup({
      disableClusteringAtZoom: 10,
      iconCreateFunction: function (cluster) {
        return buildClusterIcon(cluster, "🏠", "rgba(163, 228, 190, 0.6)");
      },
    });
    return fetch("static/data/accueil_velo_housing.json")
      .then(function (r) { return r.json(); })
      .then(function (points) {
        accueilVeloHousingRaw = points;
        points.forEach(function (p) {
          const marker = L.marker([p.lat, p.lon], {
            icon: buildDotIcon("housing-dot housing-dot--av"),
          });

          const panelHtml = buildAccueilVeloHousingPanelHtml(p);

          marker.on("mouseover", function (e) {
            showPanel(panelHtml, e.originalEvent.clientX, e.originalEvent.clientY);
          });
          marker.on("mousemove", function (e) {
            positionPanel(e.originalEvent.clientX, e.originalEvent.clientY);
          });
          marker.on("mouseout", function () {
            scheduleClosePanel();
          });

          accueilVeloHousingLayer.addLayer(marker);
        });
        // Layer loaded but hidden by default; toggled by pill.
      })
      .catch(function (err) {
        console.warn("Could not load Accueil Vélo housing points:", err);
      });
  }

  /**
   * Show or hide the Accueil Vélo housing layer.
   *
   * @param {boolean} visible - True to show the layer, false to hide it.
   */
  function toggleAccueilVeloHousing(visible) {
    if (!accueilVeloHousingLayer || !map) return;
    if (visible) {
      if (!map.hasLayer(accueilVeloHousingLayer)) accueilVeloHousingLayer.addTo(map);
    } else {
      if (map.hasLayer(accueilVeloHousingLayer)) map.removeLayer(accueilVeloHousingLayer);
    }
  }

  // ── Accueil Vélo restaurants ───────────────────────────────────────────────

  /**
   * Build the HTML content for an Accueil Vélo restaurant hover panel.
   *
   * Null fields are shown as <em class="housing-null">non renseigné</em>.
   *
   * @param {Object} point - AccueilVeloPoint object from accueil_velo_restaurants.json.
   * @param {string|null} point.name - Restaurant name.
   * @param {string|null} point.website - Website URL.
   * @returns {string} HTML string for the panel.
   */
  function buildAccueilVeloRestaurantPanelHtml(point) {
    const nullHtml = '<em class="housing-null">non renseigné</em>';
    const nameHtml = point.name || nullHtml;
    const websiteHtml = point.website
      ? `<a href="${point.website}" target="_blank" rel="noopener noreferrer" class="route-panel-link">Visiter le site →</a>`
      : nullHtml;

    return `
      <div class="route-panel-body">
        <div class="route-panel-title">😋 Restaurant labellisé Accueil Vélo</div>
        <ul class="route-panel-meta">
          <li>${nameHtml}</li>
        </ul>
        ${websiteHtml}
      </div>
    `;
  }

  /**
   * Fetch accueil_velo_restaurants.json and add a fork emoji marker for each
   * point.
   *
   * Markers use L.divIcon to display the 🍴 emoji.  Hovering shows the
   * floating info panel via the shared showPanel / scheduleClosePanel helpers.
   *
   * @returns {Promise<void>} Resolves when all markers have been added.
   */
  function loadAccueilVeloRestaurants() {
    accueilVeloRestaurantsLayer = L.markerClusterGroup({
      disableClusteringAtZoom: 14,
      iconCreateFunction: function (cluster) {
        return buildClusterIcon(cluster, "😋", "rgba(253, 235, 208, 0.6)");
      },
    });
    return fetch("static/data/accueil_velo_restaurants.json")
      .then(function (r) { return r.json(); })
      .then(function (points) {
        const icon = L.divIcon({
          html: "😋",
          className: "restaurant-marker",
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        });

        points.forEach(function (p) {
          const marker = L.marker([p.lat, p.lon], { icon: icon });

          const panelHtml = buildAccueilVeloRestaurantPanelHtml(p);

          marker.on("mouseover", function (e) {
            showPanel(panelHtml, e.originalEvent.clientX, e.originalEvent.clientY);
          });
          marker.on("mousemove", function (e) {
            positionPanel(e.originalEvent.clientX, e.originalEvent.clientY);
          });
          marker.on("mouseout", function () {
            scheduleClosePanel();
          });

          accueilVeloRestaurantsLayer.addLayer(marker);
        });
        // Layer loaded but hidden by default; toggled by checkbox.
      })
      .catch(function (err) {
        console.warn("Could not load Accueil Vélo restaurant points:", err);
      });
  }

  /**
   * Show or hide the Accueil Vélo restaurants layer.
   *
   * @param {boolean} visible - True to show the layer, false to hide it.
   */
  function toggleAccueilVeloRestaurants(visible) {
    if (!accueilVeloRestaurantsLayer || !map) return;
    if (visible) {
      if (!map.hasLayer(accueilVeloRestaurantsLayer)) accueilVeloRestaurantsLayer.addTo(map);
    } else {
      if (map.hasLayer(accueilVeloRestaurantsLayer)) map.removeLayer(accueilVeloRestaurantsLayer);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.InterMap = {
    initMap,
    loadAllRoutes,
    setRouteVisible,
    setRoutesHidden,
    clearMap,
    showItineraryOnMap,
    focusOnLeg,
    getTrainLegColors,
    centerOn,
    loadHousingPoints,
    toggleHousingPoints,
    loadAccueilVeloHousing,
    loadAccueilVeloRestaurants,
    toggleAccueilVeloHousing,
    toggleAccueilVeloRestaurants,
    buildEmojiStationIcon,
    addMarker,
    setDepartureMarker,
    getHousingPools,
    buildHousingInfoHtml,
    focusHousing,
    showHoverPanel: showPanel,
    positionHoverPanel: positionPanel,
    scheduleCloseHoverPanel: scheduleClosePanel,
  };
})();
