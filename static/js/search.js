/**
 * search.js — Search form management, autocomplete, and search orchestration.
 *
 * Static-site version. Loads data from static JSON files, runs the itinerary
 * planner entirely in the browser, and calls the proxy server (URL stored in
 * localStorage) to fetch Navitia journey data.
 *
 * Depends on: planner.js (window.InterPlanner), journey_parser.js (window.InterJourney),
 *             map.js (window.InterMap), results.js (window.InterResults).
 */

(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────────────────────

  /** @type {Array<{nom:string,libellecourt:string,uic:string,lat:number,lon:number}>} */
  let allStations = [];

  /** Full proximity index loaded from static/data/route_stations.json. */
  let routeIndex = null;

  /** Currently selected station UIC code. */
  let selectedUic = "";

  // ── DOM references ─────────────────────────────────────────────────────────

  const form              = document.getElementById("search-form");
  const departureInput    = document.getElementById("departure-input");
  const departureUicInput = document.getElementById("departure-uic");
  const autocompleteList  = document.getElementById("autocomplete-list");
  const daysSelect        = document.getElementById("days-select");
  const travelDateInput   = document.getElementById("travel-date");
  const searchBtn         = document.getElementById("search-btn");
  const searchStatus      = document.getElementById("search-status");
  const resultsContainer  = document.getElementById("results-container");
  const selectAllCheckbox = document.getElementById("select-all-routes");
  const btnSettings       = document.getElementById("btn-settings");
  const settingsPanel     = document.getElementById("settings-panel");
  const proxyUrlInput     = document.getElementById("proxy-url-input");
  const btnSaveProxy      = document.getElementById("btn-save-proxy");

  // ── Proxy URL (localStorage) ───────────────────────────────────────────────

  const PROXY_STORAGE_KEY = "intercyclette_proxy_url";

  /**
   * Read the saved proxy URL from localStorage.
   *
   * @returns {string} The proxy URL, or empty string if not set.
   */
  function getProxyUrl() {
    return localStorage.getItem(PROXY_STORAGE_KEY) || "";
  }

  /**
   * Save a proxy URL to localStorage.
   *
   * @param {string} url - Proxy base URL to persist.
   */
  function saveProxyUrl(url) {
    localStorage.setItem(PROXY_STORAGE_KEY, url.trim());
  }

  // ── Settings panel ─────────────────────────────────────────────────────────

  if (btnSettings) {
    btnSettings.addEventListener("click", function () {
      if (settingsPanel) {
        const hidden = settingsPanel.hidden;
        settingsPanel.hidden = !hidden;
        if (!hidden) return;
        if (proxyUrlInput) proxyUrlInput.value = getProxyUrl();
      }
    });
  }

  if (btnSaveProxy) {
    btnSaveProxy.addEventListener("click", function () {
      const url = proxyUrlInput ? proxyUrlInput.value.trim() : "";
      saveProxyUrl(url);
      if (settingsPanel) settingsPanel.hidden = true;
      showStatus("URL du proxy sauvegardée.", "info");
      setTimeout(hideStatus, 2000);
    });
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────

  /**
   * Filter stations by a query string (case-insensitive, accent-insensitive).
   *
   * @param {string} query - User input string.
   * @param {number} maxResults - Maximum number of suggestions to return.
   * @returns {Array} Matching station objects.
   */
  function filterStations(query, maxResults) {
    if (!query || query.length < 2) return [];
    const q = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return allStations
      .filter((s) => {
        const nom  = s.nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const code = (s.libellecourt || "").toLowerCase();
        return nom.includes(q) || code.includes(q);
      })
      .slice(0, maxResults);
  }

  /**
   * Populate the autocomplete dropdown with matching station options.
   *
   * @param {Array} stations - Filtered station list.
   */
  function showAutocomplete(stations) {
    autocompleteList.innerHTML = "";
    if (stations.length === 0) {
      autocompleteList.hidden = true;
      return;
    }
    stations.forEach((station) => {
      const li = document.createElement("li");
      li.className = "autocomplete-item";
      li.textContent = `${station.nom} (${station.libellecourt})`;
      li.dataset.uic = station.uic;
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectStation(station);
      });
      autocompleteList.appendChild(li);
    });
    autocompleteList.hidden = false;
  }

  /**
   * Select a station from the autocomplete list.
   *
   * @param {{nom:string,libellecourt:string,uic:string}} station
   */
  function selectStation(station) {
    departureInput.value = station.nom;
    departureUicInput.value = station.uic;
    selectedUic = station.uic;
    autocompleteList.hidden = true;
  }

  /**
   * Initialise station autocomplete: fetch station list, wire up input events.
   */
  function initStationAutocomplete() {
    fetch("static/data/stations.json")
      .then((r) => r.json())
      .then((stations) => {
        allStations = stations;
      })
      .catch(() => {
        console.warn("Could not load station list.");
      });

    departureInput.addEventListener("input", function () {
      selectedUic = "";
      departureUicInput.value = "";
      const matches = filterStations(departureInput.value, 8);
      showAutocomplete(matches);
    });

    departureInput.addEventListener("blur", function () {
      setTimeout(() => {
        autocompleteList.hidden = true;
      }, 150);
    });

    departureInput.addEventListener("keydown", function (e) {
      const items  = autocompleteList.querySelectorAll(".autocomplete-item");
      const active = autocompleteList.querySelector(".autocomplete-item.active");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = active ? active.nextElementSibling : items[0];
        if (active) active.classList.remove("active");
        if (next) next.classList.add("active");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = active ? active.previousElementSibling : items[items.length - 1];
        if (active) active.classList.remove("active");
        if (prev) prev.classList.add("active");
      } else if (e.key === "Enter" && active) {
        e.preventDefault();
        const uic     = active.dataset.uic;
        const station = allStations.find((s) => s.uic === uic);
        if (station) selectStation(station);
      } else if (e.key === "Escape") {
        autocompleteList.hidden = true;
      }
    });
  }

  // ── Select All / Deselect All ──────────────────────────────────────────────

  /**
   * Toggle all route checkboxes to a given checked state and sync map overlays.
   *
   * @param {boolean} checked - True to show all routes, false to hide all.
   */
  function handleSelectAll(checked) {
    document.querySelectorAll(".route-checkbox").forEach((cb) => {
      cb.checked = checked;
      if (window.InterMap) {
        window.InterMap.setRouteVisible(cb.value, checked);
      }
    });
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.addEventListener("change", function () {
      handleSelectAll(this.checked);
    });

    document.querySelectorAll(".route-checkbox").forEach((cb) => {
      cb.addEventListener("change", function () {
        const allChecked  = [...document.querySelectorAll(".route-checkbox")].every((c) => c.checked);
        const noneChecked = [...document.querySelectorAll(".route-checkbox")].every((c) => !c.checked);
        selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
        selectAllCheckbox.checked = allChecked;
        // Toggle route overlay visibility on map
        if (window.InterMap) {
          window.InterMap.setRouteVisible(this.value, this.checked);
        }
      });
    });
  }

  // ── Form values ────────────────────────────────────────────────────────────

  /**
   * Read current form state and return a search parameters object.
   *
   * @returns {{departure_uic:string,n_days:number,rhythm:string,routes:string[],travel_date:string}}
   */
  function getFormValues() {
    const routes    = [...document.querySelectorAll(".route-checkbox:checked")].map((cb) => cb.value);
    const rhythmEl  = document.querySelector('input[name="rhythm"]:checked');
    return {
      departure_uic: departureUicInput.value.trim(),
      n_days: parseInt(daysSelect.value, 10),
      rhythm: rhythmEl ? rhythmEl.value : "randonneur",
      routes,
      travel_date: travelDateInput.value || "",
    };
  }

  // ── Status messages ────────────────────────────────────────────────────────

  /**
   * Display an inline status message.
   *
   * @param {string} message
   * @param {'info'|'error'} type
   */
  function showStatus(message, type) {
    searchStatus.textContent = message;
    searchStatus.className = `search-status status-${type}`;
    searchStatus.hidden = false;
  }

  /** Hide the inline status message. */
  function hideStatus() {
    searchStatus.hidden = true;
  }

  // ── Date helpers ───────────────────────────────────────────────────────────

  /**
   * Convert a YYYY-MM-DD date string to Navitia compact format YYYYMMDD.
   *
   * @param {string} dateStr - Date string in YYYY-MM-DD format.
   * @returns {string} Compact YYYYMMDD string.
   */
  function formatDateCompact(dateStr) {
    return dateStr.replace(/-/g, "");
  }

  /**
   * Add n days to a YYYYMMDD date string and return the result as YYYYMMDD.
   *
   * @param {string} compact - Date in YYYYMMDD format.
   * @param {number} n - Number of days to add.
   * @returns {string} Resulting date in YYYYMMDD format.
   */
  function addDaysCompact(compact, n) {
    const year  = parseInt(compact.slice(0, 4), 10);
    const month = parseInt(compact.slice(4, 6), 10) - 1;
    const day   = parseInt(compact.slice(6, 8), 10);
    const d = new Date(Date.UTC(year, month, day));
    d.setUTCDate(d.getUTCDate() + n);
    const y2 = d.getUTCFullYear();
    const m2 = String(d.getUTCMonth() + 1).padStart(2, "0");
    const d2 = String(d.getUTCDate()).padStart(2, "0");
    return `${y2}${m2}${d2}`;
  }

  // ── Proxy calls ────────────────────────────────────────────────────────────

  /**
   * Call the proxy server to fetch one Navitia journey.
   *
   * @param {string} proxyUrl - Base URL of the proxy (no trailing slash).
   * @param {string} fromUic - Departure station UIC code.
   * @param {string} toUic - Arrival station UIC code.
   * @param {string} datetimeStr - Navitia datetime string (YYYYMMDDTHHmmss).
   * @returns {Promise<Object|null>} Parsed Navitia API JSON, or null on failure.
   */
  function fetchNavitiaJourney(proxyUrl, fromUic, toUic, datetimeStr) {
    return fetch(proxyUrl.replace(/\/$/, "") + "/navitia/journey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from_uic: fromUic, to_uic: toUic, datetime_str: datetimeStr }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  // ── Itinerary card assembly ────────────────────────────────────────────────

  /**
   * Assemble an itinerary card object from a TripCandidate and two journeys.
   *
   * Mirrors app/routes.py:build_itinerary_card() for the static frontend.
   *
   * @param {Object} candidate - TripCandidate from InterPlanner.
   * @param {Object|null} outboundJourney - Parsed journey from InterJourney.parseBestJourney().
   * @param {Object|null} returnJourney - Parsed return journey.
   * @returns {Object} Card object suitable for InterResults.renderResults().
   */
  function buildItineraryCard(candidate, outboundJourney, returnJourney) {
    function journeyDict(j) {
      if (!j) return null;
      return {
        from: j.from_station_nom,
        to: j.to_station_nom,
        departure: j.departure_datetime,
        arrival: j.arrival_datetime,
        duration: window.InterJourney.formatDurationMinutes(j.duration_minutes),
        duration_minutes: j.duration_minutes,
        nb_transfers: j.nb_transfers,
        sections: j.sections,
      };
    }

    const dep = candidate.departure_station;
    const arr = candidate.arrival_station;

    return {
      route_id: candidate.route_id,
      route_name: candidate.route_name,
      departure_station: {
        nom: dep.nom,
        uic: (dep.codes_uic && dep.codes_uic[0]) || "",
        lat: dep.lat,
        lon: dep.lon,
        cumulative_km: dep.cumulative_km,
      },
      arrival_station: {
        nom: arr.nom,
        uic: (arr.codes_uic && arr.codes_uic[0]) || "",
        lat: arr.lat,
        lon: arr.lon,
        cumulative_km: arr.cumulative_km,
      },
      biking_start_km: candidate.biking_start_km,
      biking_end_km: candidate.biking_end_km,
      total_biking_km: candidate.total_biking_km,
      n_days: candidate.n_days,
      rhythm_key: candidate.rhythm_key,
      geometry: candidate.geometry,
      outbound: journeyDict(outboundJourney),
      return_train: journeyDict(returnJourney),
    };
  }

  // ── Search orchestration ───────────────────────────────────────────────────

  /**
   * Run the full itinerary search: plan locally then fetch journeys via proxy.
   *
   * @param {Object} params - Form values from getFormValues().
   * @returns {Promise<Object[]>} Array of itinerary card objects.
   */
  function runSearch(params) {
    const proxyUrl = getProxyUrl();
    if (!proxyUrl) {
      return Promise.reject(new Error("URL du proxy non configurée. Ouvrez les paramètres (⚙) pour la saisir."));
    }

    if (!routeIndex) {
      return Promise.reject(new Error("Index des routes non chargé. Rechargez la page."));
    }

    // Find departure station coordinates from loaded station list
    const depStation = allStations.find((s) => s.uic === params.departure_uic);
    if (!depStation) {
      return Promise.reject(new Error(`Gare UIC '${params.departure_uic}' introuvable.`));
    }

    // Compute itinerary candidates (pure JS, no network)
    const candidates = window.InterPlanner.findAllItineraries(
      params.routes,
      routeIndex,
      depStation.lat,
      depStation.lon,
      params.n_days,
      params.rhythm
    );

    if (candidates.length === 0) {
      return Promise.resolve([]);
    }

    // Compute travel dates
    const travelDateCompact = params.travel_date
      ? formatDateCompact(params.travel_date)
      : formatDateCompact(new Date().toISOString().split("T")[0]);
    const returnDateCompact = addDaysCompact(travelDateCompact, params.n_days - 1);

    // Fetch journeys for each candidate, assemble cards
    const cardPromises = candidates.map((candidate) => {
      const outboundUic = (candidate.departure_station.codes_uic && candidate.departure_station.codes_uic[0]) || "";
      const returnUic   = (candidate.arrival_station.codes_uic && candidate.arrival_station.codes_uic[0]) || "";

      if (!outboundUic || !returnUic) {
        return Promise.resolve(null);
      }

      const outboundDatetime = travelDateCompact + "T080000";
      const returnDatetime   = returnDateCompact + "T160000";

      return Promise.all([
        fetchNavitiaJourney(proxyUrl, params.departure_uic, outboundUic, outboundDatetime),
        fetchNavitiaJourney(proxyUrl, returnUic, params.departure_uic, returnDatetime),
      ]).then(([outboundRaw, returnRaw]) => {
        const outboundJourney = outboundRaw ? window.InterJourney.parseBestJourney(outboundRaw) : null;
        const returnJourney   = returnRaw   ? window.InterJourney.parseBestJourney(returnRaw)   : null;
        return buildItineraryCard(candidate, outboundJourney, returnJourney);
      });
    });

    return Promise.all(cardPromises).then((cards) => cards.filter(Boolean));
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const params = getFormValues();

      if (!params.departure_uic) {
        showStatus("Veuillez sélectionner une gare de départ dans la liste.", "error");
        departureInput.focus();
        return;
      }
      if (params.routes.length === 0) {
        showStatus("Veuillez sélectionner au moins une route Eurovelo.", "error");
        return;
      }

      showStatus("Recherche en cours…", "info");
      searchBtn.disabled = true;
      window.InterMap.clearMap();
      resultsContainer.innerHTML = "";

      runSearch(params)
        .then((itineraries) => {
          hideStatus();
          window.InterResults.renderResults(itineraries, resultsContainer);
          searchBtn.disabled = false;
        })
        .catch((err) => {
          showStatus(`Erreur : ${err.message}`, "error");
          searchBtn.disabled = false;
        });
    });
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  /** Set default travel date to tomorrow. */
  (function setDefaultDate() {
    if (!travelDateInput) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    travelDateInput.value = tomorrow.toISOString().split("T")[0];
  })();

  /** Load route index from static data. */
  fetch("static/data/route_stations.json")
    .then((r) => r.json())
    .then((index) => {
      routeIndex = index;
    })
    .catch(() => {
      console.warn("Could not load route_stations.json.");
    });

  /** Init map, load route overlays, init autocomplete. */
  if (window.InterMap) {
    window.InterMap.initMap("map");
    window.InterMap.loadAllRoutes();
  }
  initStationAutocomplete();

  // Expose for testing
  window.InterSearch = { filterStations, getFormValues, handleSelectAll };
})();
