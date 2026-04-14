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

  /** @type {L.Map} */
  let map = null;

  /** @type {L.LayerGroup} Holds itinerary-specific layers (cleared on each select). */
  let itineraryLayer = null;

  /** @type {L.LayerGroup} Holds the departure city marker (home emoji). */
  let departureLayer = null;

  /** @type {L.LayerGroup} Holds all housing circle markers (toggled by checkbox). */
  let housingLayer = null;

  /** @type {L.LayerGroup} Holds Accueil Vélo restaurant markers (toggled by checkbox). */
  let accueilVeloRestaurantsLayer = null;

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
      status: "Véloroute réalisée à 95 %",
      connections: "EuroVelo 6 (Orléans-Tours), EuroVelo 1 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-scandiberique-eurovelo-3",
      // img: BASE_IMG + "eurovelo-3-landes-scandiberique.jpg.webp",
    },
    EV4: {
      description: "La Vélomaritime relie Roscoff en Bretagne à Bray-Dunes à la frontière belge, longeant les côtes de la Manche et de la mer du Nord.",
      distance: "1 518 km",
      status: "Véloroute réalisée à 99,3 %",
      connections: "EV 1 (Roscoff), EV 5 et 12 (Calais)",
      url: "https://www.francevelotourisme.com/itineraire/la-velomaritime-eurovelo-4",
      // img: BASE_IMG + "Velo_au_Mont-Saint-Michel-Les_valises_de_Sarah_Calvados_Attractivite-11037.JPG.webp",
    },
    EV5: {
      description: "L'EuroVelo 5 traverse la France en deux sections : par Lille au nord et par Strasbourg et la route des vins d'Alsace au sud, vers Rome.",
      distance: "669 km",
      status: "Véloroute réalisée à 77 %",
      connections: "EV 15 (Strasbourg-Bâle), EV 6 (Mulhouse-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-5-moselle-alsace",
      // img: BASE_IMG + "eurovelo-5-vignes.jpg.webp",
    },
    EV6: {
      description: "L'EuroVelo 6 suit la vallée du Doubs puis la Loire à Vélo, de la Suisse jusqu'à l'Atlantique, à travers vignobles et châteaux.",
      distance: "1 300 km",
      status: "Véloroute réalisée à 100 %",
      connections: "EV 1 (Nantes), EV 3 (Orléans-Tours), EV 15 (Kembs)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-6-bale-nevers",
      // img: BASE_IMG + "eurovelo-6-loire-a-velo.jpg.webp",
    },
    EV8: {
      description: "La Méditerranée à Vélo suit la côte méditerranéenne entre Argelès-sur-Mer et Port-la-Nouvelle, traversant calanques, étangs et cités historiques.",
      distance: "850 km",
      status: "Véloroute réalisée à 53 %",
      connections: "ViaRhôna (Sète), Canal du Midi (Agde)",
      url: "https://www.francevelotourisme.com/itineraire/la-mediterranee-a-velo-eurovelo-8",
      // img: BASE_IMG + "eurovelo-8-mediterranee.jpg.webp",
    },
    EV15: {
      description: "La Véloroute du Rhin côtoie le canal du Rhône au Rhin et la citadelle de Vauban (Patrimoine Mondial), de Bâle à Strasbourg.",
      distance: "180 km",
      status: "Véloroute réalisée à 100 %",
      connections: "EV 6 (Kembs), EV 5 (Strasbourg-Bâle)",
      url: "https://www.francevelotourisme.com/itineraire/eurovelo-15-veloroute-rhin",
      // img: BASE_IMG + "eurovelo-15_strasbourg.jpg.webp",
    },
    EV19: {
      description: "La Meuse à Vélo longe ce fleuve européen sur plus de 1 000 km, depuis sa source à Langres jusqu'aux Pays-Bas, en traversant les Ardennes.",
      distance: "443 km (en France)",
      status: "Véloroute réalisée à 100 %",
      connections: "—",
      url: "https://www.francevelotourisme.com/itineraire/la-meuse-a-velo",
      // img: BASE_IMG + "meuse-a-velo-en-famille-revin-voie-verte-trans-ardennes.jpg.webp",
    },
    VEL: {
      description: "De Roscoff à Hendaye, la Vélodyssée® se déploie le long de l'Atlantique sur plus de 1 250 km. Découvrez le meilleur des régions traversées avec l'océan comme toile de fond !",
      distance: "1 250 km",
      status: "Véloroute réalisée à 99 %",
      connections: "EV 4 (Roscoff), EV 6 (Nantes), EV 3 (Bayonne)",
      url: "https://www.francevelotourisme.com/itineraire/la-velodyssee",
      // img: "https://fr.wikipedia.org/wiki/EuroVelo_1#/media/Fichier:258_La_Grande_Tranch%C3%A9e_de_Glomel.jpg",
    },
    VIA: {
      description: "La ViaRhôna longe le Rhône depuis sa source dans les Alpes suisses jusqu'à sa double embouchure en Méditerranée, traversant lacs, gorges et vignes.",
      distance: "815 km",
      status: "Véloroute réalisée à 100 %",
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

    if (itinerary.geometry && itinerary.geometry.length > 1) {
      const polyline = L.polyline(itinerary.geometry, {
        color: segmentColor,
        weight: 6,
        opacity: 0.9,
      });
      itineraryLayer.addLayer(polyline);
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
   * Markers are added to a dedicated layer group so they can be toggled
   * independently.  Hovering a marker shows the floating info panel via the
   * shared showPanel / scheduleClosePanel helpers.
   *
   * @returns {Promise<void>} Resolves when all markers have been added.
   */
  function loadAccueilVeloHousing() {
    return fetch("static/data/accueil_velo_housing.json")
      .then(function (r) { return r.json(); })
      .then(function (points) {
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

          housingLayer.addLayer(marker);
        });
        // Markers added to the shared housingLayer cluster group.
      })
      .catch(function (err) {
        console.warn("Could not load Accueil Vélo housing points:", err);
      });
  }

  /**
   * No-op: Accueil Vélo housing markers are merged into the shared housingLayer
   * cluster group and toggled via toggleHousingPoints().
   *
   * Kept in the public API so existing callers (search.js) do not break.
   */
  function toggleAccueilVeloHousing(_visible) { /* merged into housingLayer */ }

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
    clearMap,
    showItineraryOnMap,
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
  };
})();
