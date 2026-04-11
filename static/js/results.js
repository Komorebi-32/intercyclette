/**
 * results.js — Render and manage itinerary result cards.
 *
 * Renders a list of compact cards. Each card expands on click to show the
 * full trip detail including train bookings and connection breakdowns.
 * Clicking a card also triggers map rendering via window.InterMap.
 */

(function () {
  "use strict";

  const RHYTHM_LABELS = {
    escargot: "Escargot tranquille",
    randonneur: "Habitué des randovélo",
    athlete: "Athlète olympique",
  };

  // ── Formatting helpers ─────────────────────────────────────────────────────

  /**
   * Format a floating-point km value as a rounded integer string.
   *
   * @param {number} km
   * @returns {string} e.g. "120 km"
   */
  function formatKm(km) {
    return `${Math.round(km)} km`;
  }

  /**
   * Format an ISO 8601 datetime string to French time display ("HHhMM").
   *
   * @param {string|null} isoStr - e.g. "2026-04-09T08:15:00"
   * @returns {string} e.g. "08h15" or "—"
   */
  function formatTime(isoStr) {
    if (!isoStr) return "—";
    const parts = isoStr.split("T");
    if (parts.length < 2) return "—";
    return parts[1].substring(0, 5).replace(":", "h");
  }

  /**
   * Build the SNCF Connect booking URL for a train journey.
   *
   * URL format: https://www.sncf-connect.com/home/search?userInput=FROM&userInput=TO
   *
   * @param {string} fromName - Departure station name.
   * @param {string} toName - Arrival station name.
   * @returns {string} Full SNCF Connect booking URL.
   */
  function buildBookingUrl(fromName, toName) {
    return (
      "https://www.sncf-connect.com/home/search" +
      "?userInput=" + encodeURIComponent(fromName) +
      "&userInput=" + encodeURIComponent(toName)
    );
  }

  /**
   * Build HTML for a connection section of one rail leg.
   *
   * @param {{from:string, to:string, duration_min:number}} section
   * @returns {string} HTML string for one connection row.
   */
  function buildConnectionRowHtml(section) {
    const h = Math.floor(section.duration_min / 60);
    const m = section.duration_min % 60;
    const dur = h > 0
      ? (m > 0 ? `${h}h ${m}min` : `${h}h`)
      : `${m}min`;
    return `
      <div class="connection-row">
        <span class="connection-stations">${section.from} → ${section.to}</span>
        <span class="connection-duration">(${dur})</span>
      </div>
    `;
  }

  /**
   * Build the collapsible HTML for the full list of connection sections.
   *
   * Returns empty string when sections is empty or has only one leg
   * (no intermediate changes).
   *
   * @param {Array<{mode:string, from:string, to:string, duration_min:number}>} sections
   * @param {string} expandBtnId - ID for the expand toggle button.
   * @param {string} detailId - ID for the collapsible detail div.
   * @returns {string} HTML string, or "" when connections are not applicable.
   */
  function buildConnectionsHtml(sections, expandBtnId, detailId) {
    if (!sections || sections.length <= 1) return "";
    const rows = sections.map(buildConnectionRowHtml).join("");
    return `
      <button class="btn-expand-connections" id="${expandBtnId}" data-target="${detailId}">
        Voir les correspondances (${sections.length - 1}) ▾
      </button>
      <div class="connections-detail" id="${detailId}" hidden>
        ${rows}
      </div>
    `;
  }

  /**
   * Build the HTML detail block for one train journey (aller or retour).
   *
   * @param {Object|null} journey - Journey object from the itinerary card.
   * @param {"aller"|"retour"} direction - Used for heading style and IDs.
   * @returns {string} HTML string.
   */
  function buildTrainDetailHtml(journey, direction) {
    const headingClass = direction === "aller"
      ? "train-aller-heading"
      : "train-retour-heading";
    const label = direction === "aller" ? "Train aller" : "Train retour";

    if (!journey) {
      return `
        <div class="detail-section">
          <h4 class="${headingClass}">${label}</h4>
          <div class="journey-detail journey-missing">Connexion non trouvée</div>
        </div>
      `;
    }

    const bookingUrl = buildBookingUrl(journey.from, journey.to);
    const transferText = journey.nb_transfers > 0
      ? ` · ${journey.nb_transfers} correspondance${journey.nb_transfers > 1 ? "s" : ""}`
      : "";

    const expandBtnId  = `expand-${direction}`;
    const detailId     = `connections-${direction}`;
    const connectionsHtml = journey.nb_transfers > 0
      ? buildConnectionsHtml(journey.sections, expandBtnId, detailId)
      : "";

    return `
      <div class="detail-section">
        <h4 class="${headingClass}">${label}</h4>
        <div class="journey-detail">
          <strong>${journey.from}</strong> → <strong>${journey.to}</strong><br/>
          Départ ${formatTime(journey.departure)}
          · Arrivée ${formatTime(journey.arrival)}
          · ${journey.duration}${transferText}
        </div>
        ${connectionsHtml}
        <a href="${bookingUrl}" target="_blank" rel="noopener" class="btn-book-train">
          Réserver sur SNCF Connect →
        </a>
      </div>
    `;
  }

  /**
   * Build the HTML detail block for the bike portion of the trip.
   *
   * @param {Object} itinerary - Full itinerary card object.
   * @returns {string} HTML string.
   */
  function buildBikeDetailHtml(itinerary) {
    const rhythmLabel = RHYTHM_LABELS[itinerary.rhythm_key] || itinerary.rhythm_key;
    return `
      <div class="detail-section">
        <h4>Vélo — ${rhythmLabel}</h4>
        <p>Départ depuis <strong>${itinerary.departure_station.nom}</strong> (km ${Math.round(itinerary.biking_start_km)})</p>
        <p>Arrivée à <strong>${itinerary.arrival_station.nom}</strong> (km ${Math.round(itinerary.biking_end_km)})</p>
        <p>Distance totale : <strong>${formatKm(itinerary.total_biking_km)}</strong>
           sur ${itinerary.n_days} jour${itinerary.n_days > 1 ? "s" : ""}</p>
      </div>
    `;
  }

  /**
   * Build the expanded detail HTML for one itinerary card.
   *
   * Section order: Train aller → Vélo → Train retour.
   * The "Programme" day-breakdown section has been removed.
   *
   * @param {Object} itinerary - Full itinerary card object from the API.
   * @returns {string} HTML string for the detail section.
   */
  function buildDetailHtml(itinerary) {
    return `
      <div class="card-detail">
        ${buildTrainDetailHtml(itinerary.outbound, "aller")}
        ${buildBikeDetailHtml(itinerary)}
        ${buildTrainDetailHtml(itinerary.return_train, "retour")}
      </div>
    `;
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
   * Wire connection-expand toggle buttons inside a card detail element.
   *
   * Uses event delegation: one listener on the detail element catches all
   * button clicks matching [data-target].
   *
   * @param {HTMLElement} detailEl - The expanded .card-detail element.
   */
  function wireConnectionExpand(detailEl) {
    detailEl.addEventListener("click", function (e) {
      const btn = e.target.closest(".btn-expand-connections");
      if (!btn) return;
      const targetId = btn.dataset.target;
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;
      const isHidden = target.hidden;
      target.hidden = !isHidden;
      btn.textContent = isHidden
        ? btn.textContent.replace("▾", "▴")
        : btn.textContent.replace("▴", "▾");
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

    const obSummary  = buildJourneySummaryHtml(itinerary.outbound, "Aller");
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

    card.addEventListener("click", function (e) {
      // Don't collapse when clicking inside the detail (links, buttons)
      if (e.target.closest(".card-detail")) return;

      const isExpanded = card.classList.contains("expanded");

      // Collapse all other cards
      document.querySelectorAll(".itinerary-card.expanded").forEach(function (other) {
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
        const detailNode = detailEl.firstElementChild;
        card.appendChild(detailNode);
        wireConnectionExpand(detailNode);
        const icon = card.querySelector(".card-expand-icon");
        if (icon) icon.textContent = "▲";
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

    itineraries.forEach(function (itinerary, i) {
      container.appendChild(buildCardElement(itinerary, i));
    });
  }

  // Expose public API and pure helpers for testing
  window.InterResults = {
    renderResults,
    // Exposed for unit tests
    formatKm,
    formatTime,
    buildBookingUrl,
    buildConnectionsHtml,
  };
})();
