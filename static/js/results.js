/**
 * results.js — Render and manage itinerary result cards.
 *
 * Renders a list of compact cards. Each card expands on click to show the
 * full trip detail. Clicking a card also triggers map rendering via a custom
 * DOM event ("itinerary-selected").
 */

(function () {
  "use strict";

  const RHYTHM_LABELS = {
    escargot: "Escargot tranquille",
    randonneur: "Habitué des randovélo",
    athlete: "Athlète olympique",
  };

  /**
   * Format a floating-point km value as a readable string.
   *
   * @param {number} km
   * @returns {string} e.g. "120 km"
   */
  function formatKm(km) {
    return `${Math.round(km)} km`;
  }

  /**
   * Format an ISO 8601 datetime string to French time display.
   *
   * @param {string|null} isoStr - e.g. "2026-04-09T08:15:00"
   * @returns {string} e.g. "08h15" or "—"
   */
  function formatTime(isoStr) {
    if (!isoStr) return "—";
    const parts = isoStr.split("T");
    if (parts.length < 2) return "—";
    const time = parts[1].substring(0, 5).replace(":", "h");
    return time;
  }

  /**
   * Format an ISO 8601 datetime string to French date display.
   *
   * @param {string|null} isoStr - e.g. "2026-04-13T08:15:00"
   * @returns {string} e.g. "13/04/2026" or "—"
   */
  function formatDate(isoStr) {
    if (!isoStr) return "—";
    const parts = isoStr.split("T");
    if (parts.length < 1 || parts[0].length < 10) return "—";
    const [yyyy, mm, dd] = parts[0].split("-");
    return `${dd}/${mm}/${yyyy}`;
  }

  /**
   * Format the date `days` days after an ISO datetime, in French display.
   *
   * @param {string|null} isoStr - Base ISO datetime, e.g. "2026-04-09T08:15:00".
   * @param {number} days - Number of days to add (>= 0).
   * @returns {string} e.g. "11/04/2026" or "—" when the input is invalid.
   */
  function formatDatePlusDays(isoStr, days) {
    if (!isoStr) return "—";
    const datePart = isoStr.split("T")[0];
    const d = new Date(datePart + "T00:00:00");
    if (isNaN(d.getTime())) return "—";
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  /**
   * Build an anchor-styled booking button linking to SNCF Connect search.
   *
   * @param {string} from - Departure station name.
   * @param {string} to - Arrival station name.
   * @returns {string} HTML string for the booking anchor button.
   */
  function buildBookingButtonHtml(from, to) {
    const url =
      `https://www.sncf-connect.com/home/search` +
      `?userInput=${encodeURIComponent(from)}&userInput=${encodeURIComponent(to)}`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="btn-book">Réserver sur SNCF Connect</a>`;
  }

  /**
   * Build the HTML for a single train leg (aller or retour) with a pill header,
   * departure/arrival stops, duration, and booking link.
   *
   * @param {Object|null} journey - Journey object from the API card. Null when
   *   the connection was not found.
   * @param {string} label - Human-readable label, e.g. "Train aller".
   * @param {string} color - Hex color for the train pill (per-leg color).
   * @returns {string} Inner HTML string for the train detail section.
   */
  function buildTrainLegHtml(journey, label, color) {
    if (!journey) {
      return `
        <div class="leg-pill-row">
          <div class="leg-pill leg-pill--train" style="background:${color}">🚂 ${label}</div>
        </div>
        <p class="journey-missing">${label} : connexion non trouvée</p>
      `;
    }
    const transfersText = journey.nb_transfers > 0
      ? ` · ${journey.nb_transfers} correspondance(s)`
      : "";
    return `
      <div class="leg-pill-row">
        <div class="leg-pill leg-pill--train" style="background:${color}">🚂 ${label}</div>
        <span class="leg-date">${formatDate(journey.departure)}</span>
      </div>
      <div class="leg-body">
        <div class="leg-stop">
          <span class="leg-time">${formatTime(journey.departure)}</span>
          <span class="leg-station">${journey.from}</span>
        </div>
        <div class="leg-connector">
          <span class="leg-duration-text">${journey.duration}${transfersText}</span>
        </div>
        <div class="leg-stop">
          <span class="leg-time">${formatTime(journey.arrival)}</span>
          <span class="leg-station">${journey.to}</span>
        </div>
        <div class="journey-book">${buildBookingButtonHtml(journey.from, journey.to)}</div>
      </div>
    `;
  }

  /**
   * Build the HTML for the bike leg section with a colored pill header,
   * departure/arrival stations, km range, and total distance.
   *
   * Dates are shown at departure and at arrival only when they differ (i.e.
   * multi-day trips). When both dates are the same, the date is shown once at
   * departure only.
   *
   * @param {Object} itinerary - Full itinerary card object.
   * @param {string} rhythmLabel - Human-readable rhythm label.
   * @param {string|null} bikeDepartureDate - Formatted date string for bike
   *   departure (typically the outbound train arrival date), or null.
   * @param {string|null} bikeArrivalDate - Formatted date string for bike
   *   arrival (typically the return train departure date), or null.
   * @param {string|null} bikeStartIso - Raw ISO datetime of bike departure (the
   *   outbound train arrival), used to date each night. May be null.
   * @returns {string} Inner HTML string for the bike detail section.
   */
  function buildBikeLegHtml(itinerary, rhythmLabel, bikeDepartureDate, bikeArrivalDate, bikeStartIso) {
    const routeId = itinerary.route_id;
    const datesAreDifferent = bikeDepartureDate !== null
      && bikeArrivalDate !== null
      && bikeDepartureDate !== bikeArrivalDate;

    const depDateHtml = bikeDepartureDate
      ? `<span class="leg-date">${bikeDepartureDate}</span>` : "";
    const arrDateHtml = datesAreDifferent
      ? `<span class="leg-date">${bikeArrivalDate}</span>` : "";

    const hasHousing = itinerary.housing && itinerary.housing.length > 0;
    const housingHtml = hasHousing
      ? `
        <div class="leg-pill-row">
          <button type="button" class="benefit-pill housing-toggle" aria-expanded="false">🛏️ Voir les hébergements</button>
        </div>
        ${buildHousingListHtml(itinerary, bikeStartIso, bikeArrivalDate)}
      `
      : "";

    return `
      <div class="leg-pill-row">
        <div class="leg-pill leg-pill--bike" data-route="${routeId}">🚲 ${itinerary.route_name}</div>
      </div>
      <div class="leg-body">
        <div class="leg-stop">
          ${depDateHtml}
          <span class="leg-station">${itinerary.departure_station.nom}</span>
          <span class="leg-km">km ${Math.round(itinerary.biking_start_km)}</span>
        </div>
        <div class="leg-connector bike-summary">
          <span class="leg-duration-text">${formatKm(itinerary.total_biking_km)} · ${rhythmLabel}</span>
        </div>
        ${housingHtml}
        <div class="leg-stop">
          ${arrDateHtml}
          <span class="leg-station">${itinerary.arrival_station.nom}</span>
          <span class="leg-km">km ${Math.round(itinerary.biking_end_km)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Escape a string for safe interpolation into HTML text or an attribute.
   *
   * @param {string} s - Raw string.
   * @returns {string} HTML-escaped string.
   */
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Build the (initially hidden) per-night housing breakdown for the bike leg.
   *
   * Each day is one connector (dashed line to the left of all its rows): the
   * date (omitted for day 1, already shown on the train leg) → a 🚲 distance
   * row → a "Nuit k : name" pill (styled like the housing pill, truncated to one
   * line by attachHousingHandlers). A final connector covers the ride to the
   * arrival station and repeats that day's date below the last housing. Nights
   * with no housing found show a plain label.
   *
   * @param {Object} itinerary - Itinerary with a `housing` array.
   * @param {string|null} bikeStartIso - ISO datetime of the bike departure.
   * @param {string|null} bikeArrivalDate - Formatted arrival (last-day) date.
   * @returns {string} HTML string for the `.housing-list` block.
   */
  function buildHousingListHtml(itinerary, bikeStartIso, bikeArrivalDate) {
    const housing = itinerary.housing || [];
    let prevKm = itinerary.biking_start_km;
    let rows = "";
    housing.forEach(function (stop, i) {
      const segKm = Math.max(0, Math.round(stop.cumulativeKm - prevKm));
      prevKm = stop.cumulativeKm;
      const dateHtml = i === 0
        ? ""
        : `<span class="leg-date">${formatDatePlusDays(bikeStartIso, i)}</span>`;
      const name = stop.point ? (stop.point.name || "Hébergement") : "";
      const pillHtml = stop.point
        ? `<span class="benefit-pill housing-pill housing-name" data-night="${i}" data-prefix="Nuit ${stop.night} :" data-name="${escapeHtml(name)}">Nuit ${stop.night} : ${escapeHtml(name)}</span>`
        : `<span class="housing-none">Nuit ${stop.night} : aucun hébergement trouvé</span>`;
      rows += `
        <div class="leg-connector housing-connector">
          ${dateHtml}
          <span class="leg-duration-text">🚲 ${segKm} km</span>
          ${pillHtml}
        </div>
      `;
    });
    const lastSeg = Math.max(0, Math.round(itinerary.biking_end_km - prevKm));
    const lastDateHtml = bikeArrivalDate
      ? `<span class="leg-date">${bikeArrivalDate}</span>` : "";
    rows += `
      <div class="leg-connector housing-connector">
        ${lastDateHtml}
        <span class="leg-duration-text">🚲 ${lastSeg} km</span>
      </div>
    `;
    return `<div class="housing-list" hidden>${rows}</div>`;
  }

  /**
   * Build the expanded detail HTML for one itinerary card.
   *
   * Renders three detail sections with colored left-border lines: a distinct
   * per-leg color for each train leg (chosen to avoid clashing with the route
   * color) and the route color for the bike leg. Each section is headed by a
   * colored pill identifying the transport mode and route, and carries a
   * `data-leg` attribute ("outbound" / "bike" / "return") so clicking it can
   * focus the map on that leg. Bike dates are shown at departure and arrival
   * when they differ; the carbon info is shown as a hover-tooltip pill.
   *
   * @param {Object} itinerary - Full itinerary card object from the API.
   * @returns {string} HTML string for the detail section.
   */
  function buildDetailHtml(itinerary) {
    const rhythmLabel = RHYTHM_LABELS[itinerary.rhythm_key] || itinerary.rhythm_key;
    const ob = itinerary.outbound;
    const ret = itinerary.return_train;
    const bikeDepartureDate = ob ? formatDate(ob.arrival) : null;
    const bikeArrivalDate = ret ? formatDate(ret.departure) : null;
    const bikeStartIso = ob ? ob.arrival : null;
    const trainColors = window.InterMap.getTrainLegColors(itinerary.route_id);

    return `
      <div class="card-detail">
        <div class="detail-section detail-section--train" data-leg="outbound" style="border-left-color:${trainColors.outbound}">
          ${buildTrainLegHtml(ob, "Train aller", trainColors.outbound)}
        </div>
        <div class="detail-section detail-section--bike" data-leg="bike" data-route="${itinerary.route_id}">
          ${buildBikeLegHtml(itinerary, rhythmLabel, bikeDepartureDate, bikeArrivalDate, bikeStartIso)}
        </div>
        <div class="detail-section detail-section--train" data-leg="return" style="border-left-color:${trainColors.return}">
          ${buildTrainLegHtml(ret, "Train retour", trainColors.return)}
        </div>
        <div class="detail-section detail-section--carbon">
          ${window.InterCo2.buildCarbonInfoHtml(ob, ret)}
        </div>
      </div>
    `;
  }

  /**
   * Attach click handlers so clicking a leg's detail-section focuses the map on
   * that leg instead of collapsing the card. Clicks on the booking button are
   * ignored entirely (no focus, no collapse).
   *
   * @param {HTMLElement} card - The expanded itinerary card element.
   * @param {Object} itinerary - The itinerary object backing the card.
   */
  function attachLegFocusHandlers(card, itinerary) {
    card.querySelectorAll(".detail-section[data-leg]").forEach(function (section) {
      section.addEventListener("click", function (event) {
        event.stopPropagation();
        if (event.target.closest(".btn-book")) return;
        if (event.target.closest(".housing-toggle")) return;
        if (event.target.closest(".housing-name")) return;
        window.InterMap.focusOnLeg(itinerary, section.dataset.leg);
      });
    });
  }

  /**
   * Truncate a "Nuit k : name" pill to a single line at a word boundary.
   *
   * Starts from the full text; while it overflows its one-line box, drops the
   * last word of the name and appends "…", so words are never sliced in half.
   * Requires the pill to be laid out (visible), and the CSS to set nowrap +
   * a bounded max-width.
   *
   * @param {HTMLElement} el - The `.housing-name` pill element.
   */
  function fitHousingPill(el) {
    const prefix = el.dataset.prefix || "";
    const name = el.dataset.name || "";
    const full = (prefix ? prefix + " " : "") + name;
    el.textContent = full;
    if (el.scrollWidth <= el.clientWidth) return;
    const words = name.split(/\s+/);
    while (words.length > 1) {
      words.pop();
      el.textContent = (prefix ? prefix + " " : "") + words.join(" ") + "…";
      if (el.scrollWidth <= el.clientWidth) return;
    }
    // A single over-long word: leave it; the CSS ellipsis clips it.
  }

  /**
   * Wire the housing toggle (expand/collapse the night list, hiding the summary
   * line while open) and the per-night housing pills (hover shows the same info
   * box as the map markers; click focuses the map on that housing). All handlers
   * stop propagation so they neither collapse the card nor refocus the bike leg.
   *
   * @param {HTMLElement} card - The expanded itinerary card element.
   * @param {Object} itinerary - The itinerary object backing the card.
   */
  function attachHousingHandlers(card, itinerary) {
    const toggle = card.querySelector(".housing-toggle");
    const list = card.querySelector(".housing-list");
    const summary = card.querySelector(".detail-section--bike .bike-summary");
    if (toggle && list) {
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        const isHidden = list.hasAttribute("hidden");
        if (isHidden) {
          list.removeAttribute("hidden");
          if (summary) summary.setAttribute("hidden", "");
          toggle.setAttribute("aria-expanded", "true");
          toggle.textContent = "🛏️ Masquer les hébergements";
          // Truncate the night pills now the list is visible (needs layout).
          card.querySelectorAll(".housing-name").forEach(fitHousingPill);
        } else {
          list.setAttribute("hidden", "");
          if (summary) summary.removeAttribute("hidden");
          toggle.setAttribute("aria-expanded", "false");
          toggle.textContent = "🛏️ Voir les hébergements";
        }
      });
    }

    card.querySelectorAll(".housing-name").forEach(function (el) {
      const idx = parseInt(el.dataset.night, 10);
      const stop = (itinerary.housing || [])[idx];
      if (!stop || !stop.point) return;
      const panelHtml = window.InterMap.buildHousingInfoHtml(stop.point, stop.source);
      el.addEventListener("mouseover", function (event) {
        window.InterMap.showHoverPanel(panelHtml, event.clientX, event.clientY);
      });
      el.addEventListener("mousemove", function (event) {
        window.InterMap.positionHoverPanel(event.clientX, event.clientY);
      });
      el.addEventListener("mouseout", function () {
        window.InterMap.scheduleCloseHoverPanel();
      });
      el.addEventListener("click", function (event) {
        event.stopPropagation();
        window.InterMap.focusHousing(stop.point.lat, stop.point.lon);
      });
    });
  }

  /**
   * Build the DOM element for one compact itinerary card.
   *
   * @param {Object} itinerary - Itinerary card object from the API.
   * @param {number} index - Zero-based index for labelling.
   * @returns {HTMLElement} The card element (collapsed by default).
   */
  function buildCardElement(itinerary, index) {
    const card = document.createElement("article");
    card.className = "itinerary-card";
    card.dataset.index = String(index);

    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">
          <span class="route-badge" data-route="${itinerary.route_id}">${itinerary.route_id}</span>
          <span class="route-name">${itinerary.route_name}</span>
        </div>
        <div class="card-meta">
          <span class="card-expand-icon">▼</span>
        </div>
      </div>
    `;

    // Clicking the card header expands/collapses it and fires the map event.
    // Clicks on the booking button are ignored so the details stay open.
    card.addEventListener("click", function (event) {
      if (event.target.closest(".btn-book")) return;

      const isExpanded = card.classList.contains("expanded");

      // Collapse all other cards
      document.querySelectorAll(".itinerary-card.expanded").forEach((other) => {
        if (other !== card) {
          other.classList.remove("expanded");
          const detail = other.querySelector(".card-detail");
          if (detail) detail.remove();
          const icon = other.querySelector(".card-expand-icon");
          if (icon) icon.textContent = "▼";
        }
      });

      if (isExpanded) {
        card.classList.remove("expanded");
        const detail = card.querySelector(".card-detail");
        if (detail) detail.remove();
        const icon = card.querySelector(".card-expand-icon");
        if (icon) icon.textContent = "▼";
        window.InterMap.clearMap();
        window.InterMap.setRoutesHidden(false);
      } else {
        card.classList.add("expanded");
        const detailEl = document.createElement("div");
        detailEl.innerHTML = buildDetailHtml(itinerary);
        card.appendChild(detailEl.firstElementChild);
        attachLegFocusHandlers(card, itinerary);
        attachHousingHandlers(card, itinerary);
        const icon = card.querySelector(".card-expand-icon");
        if (icon) icon.textContent = "▲";

        // Notify the map
        window.InterMap.showItineraryOnMap(itinerary);
      }
    });

    return card;
  }

  /**
   * Render the list of itinerary cards into the results container.
   *
   * Clears any existing results before rendering.
   *
   * @param {Array<Object>} itineraries - Array of itinerary card objects.
   * @param {HTMLElement} container - The DOM element to render into.
   */
  function renderResults(itineraries, container) {
    container.innerHTML = "";

    if (!itineraries || itineraries.length === 0) {
      container.innerHTML =
        '<p class="no-results">Aucun itinéraire trouvé. Essayez d\'autres critères.</p>';
      return;
    }

    const search_synthesis = document.createElement("h2");
    search_synthesis.className = "results-heading";
    search_synthesis.textContent = `Départ de ${itineraries[0].outbound.from} - ${formatKm(itineraries[0].total_biking_km)} à vélo - ${itineraries[0].n_days} jour${itineraries[0].n_days > 1 ? "s" : ""}`;
    container.appendChild(search_synthesis);

    const heading = document.createElement("h2");
    heading.className = "results-heading";
    heading.textContent = `${itineraries.length} itinéraire${itineraries.length > 1 ? "s" : ""} trouvé${itineraries.length > 1 ? "s" : ""}`;
    container.appendChild(heading);    

    itineraries.forEach((itinerary, i) => {
      container.appendChild(buildCardElement(itinerary, i));
    });
  }

  // Expose public API on window
  window.InterResults = { renderResults };
})();
