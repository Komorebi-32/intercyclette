/**
 * search.js — Search form management, autocomplete, and search orchestration.
 *
 * Static-site version. Loads data from static JSON files, runs the itinerary
 * planner entirely in the browser, and queries the Transitous API for train
 * journeys (no proxy server, no API token required).
 *
 * Depends on: planner.js (window.InterPlanner), transitous.js (window.InterTimetable),
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
  const travelDateDisplay = document.getElementById("travel-date-display");
  const searchBtn         = document.getElementById("search-btn");
  const searchStatus      = document.getElementById("search-status");
  const resultsContainer  = document.getElementById("results-container");
  const selectAllCheckbox = document.getElementById("select-all-routes");
  const btnHelp           = document.getElementById("btn-help");
  const helpModal         = document.getElementById("help-modal");
  const helpModalClose    = document.getElementById("help-modal-close");

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
    if (window.InterMap && station.lat && station.lon) {
      window.InterMap.centerOn(station.lat, station.lon, 10);
    }
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
    const routes   = [...document.querySelectorAll(".route-checkbox:checked")].map((cb) => cb.value);
    const rhythmEl = document.querySelector('input[name="rhythm"]:checked');
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
   * Add n days to a YYYY-MM-DD date string and return the result as YYYY-MM-DD.
   *
   * Uses UTC arithmetic to avoid DST-boundary issues.
   *
   * @param {string} isoDate - Date in YYYY-MM-DD format.
   * @param {number} n - Number of days to add (may be negative).
   * @returns {string} Resulting date in YYYY-MM-DD format.
   */
  function addDaysIso(isoDate, n) {
    const [year, month, day] = isoDate.split("-").map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() + n);
    const y2 = d.getUTCFullYear();
    const m2 = String(d.getUTCMonth() + 1).padStart(2, "0");
    const d2 = String(d.getUTCDate()).padStart(2, "0");
    return `${y2}-${m2}-${d2}`;
  }

  // ── Transitous journey queries ─────────────────────────────────────────────

  /**
   * Query the Transitous API for the best outbound journey and return a
   * journey result object, or null if no train is found.
   *
   * Station names in the result come from the API response itself (actual
   * boarding and alighting stations), not from the passed coordinates.
   *
   * @param {number} fromLat - Departure latitude.
   * @param {number} fromLon - Departure longitude.
   * @param {number} toLat - Arrival latitude.
   * @param {number} toLon - Arrival longitude.
   * @param {string} localIsoDatetime - Desired local departure datetime,
   *   e.g. "2026-05-02T08:00:00".
   * @returns {Promise<Object|null>} Journey result object, or null if not found.
   */
  async function queryOutboundJourney(fromLat, fromLon, toLat, toLon, localIsoDatetime) {
    const itineraries = await window.InterTimetable.queryJourney(
      fromLat, fromLon, toLat, toLon, localIsoDatetime, 1
    );
    if (!itineraries.length) return null;
    return window.InterTimetable.buildJourneyResult(itineraries[0]);
  }

  /**
   * Query the Transitous API for the best return journey and return a
   * journey result object, or null if no train is found.
   *
   * Station names in the result come from the API response itself (actual
   * boarding and alighting stations), not from the passed coordinates.
   *
   * @param {number} fromLat - Return origin latitude (route end station).
   * @param {number} fromLon - Return origin longitude.
   * @param {number} toLat - Return destination latitude (home city).
   * @param {number} toLon - Return destination longitude.
   * @param {string} localIsoDatetime - Desired local departure datetime,
   *   e.g. "2026-05-05T16:00:00".
   * @returns {Promise<Object|null>} Journey result object, or null if not found.
   */
  async function queryReturnJourney(fromLat, fromLon, toLat, toLon, localIsoDatetime) {
    const itineraries = await window.InterTimetable.queryJourney(
      fromLat, fromLon, toLat, toLon, localIsoDatetime, 1
    );
    if (!itineraries.length) return null;
    return window.InterTimetable.buildJourneyResult(itineraries[0]);
  }

  // ── Itinerary card assembly ────────────────────────────────────────────────

  /**
   * Assemble an itinerary card object from a TripCandidate and two journeys.
   *
   * @param {Object} candidate - TripCandidate from InterPlanner.
   * @param {Object|null} outboundJourney - Journey from queryOutboundJourney().
   * @param {Object|null} returnJourney - Journey from queryReturnJourney().
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
        duration: window.InterTimetable.formatDurationMinutes(j.duration_minutes),
        duration_minutes: j.duration_minutes,
        nb_transfers: j.nb_transfers,
        train_type: j.train_type || null,
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
   * Run the full itinerary search: plan locally, then query the Transitous API
   * for outbound and return train times for each candidate.
   *
   * Outbound and return queries for each candidate run in parallel; all
   * candidates are processed concurrently.
   *
   * @param {Object} params - Form values from getFormValues().
   * @returns {Promise<Object[]>} Array of itinerary card objects.
   */
  async function runSearch(params) {
    if (!routeIndex) {
      throw new Error("Index des routes non chargé. Rechargez la page.");
    }

    const depStation = allStations.find((s) => s.uic === params.departure_uic);
    if (!depStation) {
      throw new Error(`Gare UIC '${params.departure_uic}' introuvable.`);
    }

    const travelDate = params.travel_date || new Date().toISOString().split("T")[0];

    const outboundDate = travelDate;
    const returnDate   = addDaysIso(travelDate, params.n_days - 1);

    const outboundIso = `${outboundDate}T08:00:00`;
    const returnIso   = `${returnDate}T16:00:00`;

    // Compute itinerary candidates (pure JS, no network)
    const candidates = window.InterPlanner.findAllItineraries(
      params.routes,
      routeIndex,
      depStation.lat,
      depStation.lon,
      params.n_days,
      params.rhythm
    );

    if (candidates.length === 0) return [];

    // For each candidate, query outbound and return journeys in parallel via
    // the Transitous API, then assemble a card from the results.
    const cardPromises = candidates.map(async function (candidate) {
      const dep = candidate.departure_station;
      const arr = candidate.arrival_station;

      const [outboundJourney, returnJourney] = await Promise.all([
        queryOutboundJourney(
          depStation.lat, depStation.lon,
          dep.lat, dep.lon,
          outboundIso
        ),
        queryReturnJourney(
          arr.lat, arr.lon,
          depStation.lat, depStation.lon,
          returnIso
        ),
      ]);

      return buildItineraryCard(candidate, outboundJourney, returnJourney);
    });

    return Promise.all(cardPromises);
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

  // ── French date input ──────────────────────────────────────────────────────

  /**
   * Convert an ISO date string (YYYY-MM-DD) to French display format (DD/MM/YYYY).
   *
   * @param {string} iso - Date string in YYYY-MM-DD format.
   * @returns {string} Date string in DD/MM/YYYY format.
   */
  function isoToFrench(iso) {
    if (!iso || iso.length < 10) return "";
    return iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4);
  }

  /**
   * Convert a French display date (DD/MM/YYYY) to ISO format (YYYY-MM-DD).
   *
   * Returns empty string if the input is not a valid complete date.
   *
   * @param {string} french - Date string in DD/MM/YYYY format.
   * @returns {string} ISO date string, or empty string if invalid.
   */
  function frenchToIso(french) {
    const parts = french.split("/");
    if (parts.length !== 3 || parts[2].length !== 4) return "";
    const [dd, mm, yyyy] = parts;
    if (dd.length !== 2 || mm.length !== 2) return "";
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Wire the French date display input to the hidden ISO date field.
   *
   * Auto-inserts slashes as the user types (after 2 digits for day and month).
   * Syncs the hidden field on every valid keystroke.
   */
  function initFrenchDateInput() {
    if (!travelDateDisplay || !travelDateInput) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isoTomorrow = tomorrow.toISOString().split("T")[0];
    travelDateInput.value = isoTomorrow;
    travelDateDisplay.value = isoToFrench(isoTomorrow);

    travelDateDisplay.addEventListener("input", function () {
      let v = this.value.replace(/[^\d/]/g, "");
      const digits = v.replace(/\//g, "");
      if (digits.length <= 2) {
        v = digits;
      } else if (digits.length <= 4) {
        v = digits.slice(0, 2) + "/" + digits.slice(2);
      } else {
        v = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4, 8);
      }
      this.value = v;
      const iso = frenchToIso(v);
      travelDateInput.value = iso || "";
    });
  }

  // ── Help modal ─────────────────────────────────────────────────────────────

  /**
   * Wire the help button and modal close interactions.
   *
   * The modal opens on "?" click and closes on ✕ click, backdrop click, or
   * Escape key.
   */
  function initHelpModal() {
    if (!btnHelp || !helpModal) return;

    btnHelp.addEventListener("click", function () {
      helpModal.hidden = false;
    });

    if (helpModalClose) {
      helpModalClose.addEventListener("click", function () {
        helpModal.hidden = true;
      });
    }

    helpModal.addEventListener("click", function (e) {
      if (e.target === helpModal) {
        helpModal.hidden = true;
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !helpModal.hidden) {
        helpModal.hidden = true;
      }
    });
  }

  /**
   * Wire open/close behaviour for a simple overlay modal.
   *
   * @param {string} btnId - ID of the button that opens the modal.
   * @param {string} modalId - ID of the modal element.
   * @param {string} closeId - ID of the close button inside the modal.
   */
  function initOverlayModal(btnId, modalId, closeId) {
    const btn   = document.getElementById(btnId);
    const modal = document.getElementById(modalId);
    const close = document.getElementById(closeId);
    if (!btn || !modal) return;

    btn.addEventListener("click", function () { modal.hidden = false; });
    if (close) close.addEventListener("click", function () { modal.hidden = true; });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.hidden = true;
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) modal.hidden = true;
    });
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

  initFrenchDateInput();
  initHelpModal();
  initOverlayModal("btn-roadmap", "roadmap-modal", "roadmap-modal-close");
  initOverlayModal("btn-credits", "credits-modal", "credits-modal-close");

  fetch("static/data/route_stations.json")
    .then((r) => r.json())
    .then((index) => {
      routeIndex = index;
    })
    .catch(() => {
      console.warn("Could not load route_stations.json.");
    });

  if (window.InterMap) {
    window.InterMap.initMap("map");
    window.InterMap.loadAllRoutes();
    window.InterMap.loadHousingPoints();
    window.InterMap.loadAccueilVeloHousing();
    window.InterMap.loadAccueilVeloRestaurants();
  }

  const toggleHousingCb = document.getElementById("toggle-housing");
  if (toggleHousingCb) {
    toggleHousingCb.addEventListener("change", function () {
      if (window.InterMap) {
        window.InterMap.toggleHousingPoints(!this.checked);
        window.InterMap.toggleAccueilVeloHousing(!this.checked);
      }
    });
  }

  const toggleRestaurantsCb = document.getElementById("toggle-restaurants");
  if (toggleRestaurantsCb) {
    toggleRestaurantsCb.addEventListener("change", function () {
      if (window.InterMap) {
        window.InterMap.toggleAccueilVeloRestaurants(!this.checked);
      }
    });
  }

  initStationAutocomplete();

  // Expose for testing
  window.InterSearch = { filterStations, getFormValues, handleSelectAll };
})();
