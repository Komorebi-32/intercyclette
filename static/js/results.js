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
        <span class="journey-stations">${journey.from} → ${journey.to}</span>
        <span class="journey-time">${formatTime(journey.departure)} – ${formatTime(journey.arrival)}</span>
        <span class="journey-duration">(${journey.duration})</span>
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
   * Build the expanded detail HTML for one itinerary card.
   *
   * @param {Object} itinerary - Full itinerary card object from the API.
   * @returns {string} HTML string for the detail section.
   */
  function buildDetailHtml(itinerary) {
    const rhythmLabel = RHYTHM_LABELS[itinerary.rhythm_key] || itinerary.rhythm_key;

    // Outbound section details
    const ob = itinerary.outbound;
    const ret = itinerary.return_train;

    const outboundDetail = ob
      ? `<div class="journey-detail">
           <h4>Train aller</h4> ${ob.from} → ${ob.to}<br/>
           Départ ${formatTime(ob.departure)} · Arrivée ${formatTime(ob.arrival)} · ${ob.duration}
           ${ob.nb_transfers > 0 ? `· ${ob.nb_transfers} correspondance(s)` : ""}
           <div class="journey-book">${buildBookingButtonHtml(ob.from, ob.to)}</div>
         </div>`
      : `<div class="journey-detail journey-missing">Train aller : connexion non trouvée</div>`;

    const returnDetail = ret
      ? `<div class="journey-detail">
           <h4>Train retour</h4> ${ret.from} → ${ret.to}<br/>
           Départ ${formatTime(ret.departure)} · Arrivée ${formatTime(ret.arrival)} · ${ret.duration}
           ${ret.nb_transfers > 0 ? `· ${ret.nb_transfers} correspondance(s)` : ""}
           <div class="journey-book">${buildBookingButtonHtml(ret.from, ret.to)}</div>
         </div>`
      : `<div class="journey-detail journey-missing">Train retour : connexion non trouvée</div>`;

    return `
      <div class="card-detail">
        <div class="detail-section">
          ${outboundDetail}
        </div>
        <div class="detail-section">
          <h4>Rythme : ${rhythmLabel}</h4>
          <p>Départ vélo depuis <strong>${itinerary.departure_station.nom}</strong> (km ${Math.round(itinerary.biking_start_km)})</p>
          <p>Arrivée à <strong>${itinerary.arrival_station.nom}</strong> (km ${Math.round(itinerary.biking_end_km)})</p>
          <p>Distance totale à vélo : <strong>${formatKm(itinerary.total_biking_km)}</strong></p>
        </div>
        <div class="detail-section">
          ${returnDetail}
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
          <span class="meta-km">${formatKm(itinerary.total_biking_km)} à vélo</span>
          <span class="meta-days">${itinerary.n_days} jour${itinerary.n_days > 1 ? "s" : ""}</span>
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
