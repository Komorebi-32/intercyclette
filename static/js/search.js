/**
 * search.js — Search form management and station autocomplete.
 *
 * Loads the station list from /api/stations on page load, provides local
 * fuzzy filtering for autocomplete, and submits searches to /api/search.
 */

(function () {
  "use strict";

  /** @type {Array<{nom: string, libellecourt: string, uic: string, lat: number, lon: number}>} */
  let allStations = [];

  /** Currently selected station UIC code. */
  let selectedUic = "";

  // ── DOM references ──────────────────────────────────────────────────────

  const form = document.getElementById("search-form");
  const departureInput = document.getElementById("departure-input");
  const departureUicInput = document.getElementById("departure-uic");
  const autocompleteList = document.getElementById("autocomplete-list");
  const daysSelect = document.getElementById("days-select");
  const travelDateInput = document.getElementById("travel-date");
  const searchBtn = document.getElementById("search-btn");
  const searchStatus = document.getElementById("search-status");
  const resultsContainer = document.getElementById("results-container");
  const selectAllCheckbox = document.getElementById("select-all-routes");

  // ── Autocomplete ─────────────────────────────────────────────────────────

  /**
   * Filter stations by a query string (case-insensitive, matches nom or libellecourt).
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
        const nom = s.nom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
        e.preventDefault(); // Prevent blur before click registers
        selectStation(station);
      });
      autocompleteList.appendChild(li);
    });
    autocompleteList.hidden = false;
  }

  /**
   * Select a station from the autocomplete list.
   *
   * Updates the text input and the hidden UIC input.
   *
   * @param {{nom: string, libellecourt: string, uic: string}} station
   */
  function selectStation(station) {
    departureInput.value = station.nom;
    departureUicInput.value = station.uic;
    selectedUic = station.uic;
    autocompleteList.hidden = true;
  }

  /**
   * Initialise station autocomplete: fetch list and wire up input events.
   */
  function initStationAutocomplete() {
    fetch("/api/stations")
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
      // Delay hide to allow click on list item to register
      setTimeout(() => {
        autocompleteList.hidden = true;
      }, 150);
    });

    departureInput.addEventListener("keydown", function (e) {
      const items = autocompleteList.querySelectorAll(".autocomplete-item");
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
        const uic = active.dataset.uic;
        const station = allStations.find((s) => s.uic === uic);
        if (station) selectStation(station);
      } else if (e.key === "Escape") {
        autocompleteList.hidden = true;
      }
    });
  }

  // ── Select All / Deselect All ─────────────────────────────────────────────

  /**
   * Toggle all route checkboxes to a given checked state.
   *
   * @param {boolean} checked
   */
  function handleSelectAll(checked) {
    document.querySelectorAll(".route-checkbox").forEach((cb) => {
      cb.checked = checked;
    });
  }

  if (selectAllCheckbox) {
    // Initialise the select-all checkbox to reflect current state
    selectAllCheckbox.checked = true;

    selectAllCheckbox.addEventListener("change", function () {
      handleSelectAll(this.checked);
    });

    // Keep select-all in sync when individual boxes change
    document.querySelectorAll(".route-checkbox").forEach((cb) => {
      cb.addEventListener("change", function () {
        const allChecked = [...document.querySelectorAll(".route-checkbox")].every(
          (c) => c.checked
        );
        const noneChecked = [...document.querySelectorAll(".route-checkbox")].every(
          (c) => !c.checked
        );
        selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
        selectAllCheckbox.checked = allChecked;
      });
    });
  }

  // ── Form values ───────────────────────────────────────────────────────────

  /**
   * Read the current form state and return a search params object.
   *
   * @returns {{departure_uic: string, n_days: number, rhythm: string, routes: string[], travel_date: string}}
   */
  function getFormValues() {
    const routes = [...document.querySelectorAll(".route-checkbox:checked")].map(
      (cb) => cb.value
    );
    const rhythmEl = document.querySelector('input[name="rhythm"]:checked');
    return {
      departure_uic: departureUicInput.value.trim(),
      n_days: parseInt(daysSelect.value, 10),
      rhythm: rhythmEl ? rhythmEl.value : "randonneur",
      routes,
      travel_date: travelDateInput.value || "",
    };
  }

  // ── Search submission ─────────────────────────────────────────────────────

  /**
   * Display an inline status message in the form.
   *
   * @param {string} message - Message to display.
   * @param {'info'|'error'} type
   */
  function showStatus(message, type) {
    searchStatus.textContent = message;
    searchStatus.className = `search-status status-${type}`;
    searchStatus.hidden = false;
  }

  function hideStatus() {
    searchStatus.hidden = true;
  }

  /**
   * Submit a search request to /api/search.
   *
   * @param {Object} params - Search parameters from getFormValues().
   * @returns {Promise<Array>} Resolves to array of itinerary card objects.
   */
  function submitSearch(params) {
    return fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }).then((r) => {
      if (!r.ok) {
        return r.json().then((err) => {
          throw new Error(err.error || `Erreur ${r.status}`);
        });
      }
      return r.json();
    });
  }

  // ── Event handlers ────────────────────────────────────────────────────────

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

      submitSearch(params)
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

  // ── Initialisation ────────────────────────────────────────────────────────

  // Set default travel date to tomorrow
  (function setDefaultDate() {
    if (!travelDateInput) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    travelDateInput.value = tomorrow.toISOString().split("T")[0];
  })();

  // Init map and autocomplete
  if (typeof window.InterMap !== "undefined") {
    window.InterMap.initMap("map");
  }
  initStationAutocomplete();

  // Expose for testing
  window.InterSearch = { filterStations, getFormValues, handleSelectAll };
})();
