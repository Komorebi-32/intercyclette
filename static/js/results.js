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
   * Build the compact (collapsed) summary line for one train journey.
   *
   * @param {Object|null} journey - Journey object from the API card.
   * @param {string} label - Direction label, e.g. "Aller" or "Retour".
   * @returns {string} HTML string.
   */
  function buildJourneySummaryHtml(journey, label) {
    if (!journey) {
      return `<span class="journey-unknown">${label} : trajet non trouvé</span>`;
    }
    return `
      <span class="journey-summary">
        <span class="journey-label">${label}</span>
        <span class="journey-date">${formatDate(journey.departure)}</span>
        <span class="journey-stations">${journey.from} → ${journey.to}</span>
        <span class="journey-time">${formatTime(journey.departure)} – ${formatTime(journey.arrival)}</span>
      </span>
    `;
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
   * @returns {string} Inner HTML string for the train detail section.
   */
  function buildTrainLegHtml(journey, label) {
    if (!journey) {
      return `
        <div class="leg-pill leg-pill--train">🚂 ${label}</div>
        <p class="journey-missing">${label} : connexion non trouvée</p>
      `;
    }
    const transfersText = journey.nb_transfers > 0
      ? ` · ${journey.nb_transfers} correspondance(s)`
      : "";
    return `
      <div class="leg-pill leg-pill--train">🚂 ${label}</div>
      <div class="leg-body">
        <div class="leg-stop">
          <span class="leg-time">${formatTime(journey.departure)}</span>
          <span class="leg-date">${formatDate(journey.departure)}</span>
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
   * @returns {string} Inner HTML string for the bike detail section.
   */
  function buildBikeLegHtml(itinerary, rhythmLabel, bikeDepartureDate, bikeArrivalDate) {
    const routeId = itinerary.route_id;
    const datesAreDifferent = bikeDepartureDate !== null
      && bikeArrivalDate !== null
      && bikeDepartureDate !== bikeArrivalDate;

    const depDateHtml = bikeDepartureDate
      ? `<span class="leg-date">${bikeDepartureDate}</span>` : "";
    const arrDateHtml = datesAreDifferent
      ? `<span class="leg-date">${bikeArrivalDate}</span>` : "";

    return `
      <div class="leg-pill leg-pill--bike" data-route="${routeId}">🚲 ${itinerary.route_name}</div>
      <div class="leg-body">
        <div class="leg-stop">
          ${depDateHtml}
          <span class="leg-station">${itinerary.departure_station.nom}</span>
          <span class="leg-km">km ${Math.round(itinerary.biking_start_km)}</span>
        </div>
        <div class="leg-connector">
          <span class="leg-duration-text">${formatKm(itinerary.total_biking_km)} · ${rhythmLabel}</span>
        </div>
        <div class="leg-stop">
          ${arrDateHtml}
          <span class="leg-station">${itinerary.arrival_station.nom}</span>
          <span class="leg-km">km ${Math.round(itinerary.biking_end_km)}</span>
        </div>
      </div>
    `;
  }

  /**
   * Build the expanded detail HTML for one itinerary card.
   *
   * Renders three detail sections with colored left-border lines:
   * grey for both train legs, route color for the bike leg. Each section
   * is headed by a colored pill identifying the transport mode and route.
   * Bike dates are shown at departure and arrival when they differ; the
   * carbon info is shown as a hover-tooltip pill.
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

    return `
      <div class="card-detail">
        <div class="detail-section detail-section--train">
          ${buildTrainLegHtml(ob, "Train aller")}
        </div>
        <div class="detail-section detail-section--bike" data-route="${itinerary.route_id}">
          ${buildBikeLegHtml(itinerary, rhythmLabel, bikeDepartureDate, bikeArrivalDate)}
        </div>
        <div class="detail-section detail-section--train">
          ${buildTrainLegHtml(ret, "Train retour")}
        </div>
        <div class="detail-section detail-section--carbon">
          ${window.InterCo2.buildCarbonInfoHtml(ob, ret)}
        </div>
      </div>
    `;
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

    const obSummary = buildJourneySummaryHtml(itinerary.outbound, "Aller");
    const retSummary = buildJourneySummaryHtml(itinerary.return_train, "Retour");

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
      <div class="card-journeys">
        ${obSummary}
        ${retSummary}
      </div>
    `;

    // Clicking the card header expands/collapses it and fires the map event
    card.addEventListener("click", function () {
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
