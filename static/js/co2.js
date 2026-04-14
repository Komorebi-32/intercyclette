/**
 * co2.js — CO2 emission computation for train journeys and avoided emissions.
 *
 * Computes the carbon footprint of train trips using ADEME Base Empreinte 2023
 * emission factors, then compares against a fixed reference plane round-trip
 * to Madrid to derive avoided emissions.
 *
 * Emission factors source: ADEME Base Empreinte 2023 (kg CO2e per passenger-km).
 *
 * Exposes: window.InterCo2
 */

(function () {
  "use strict";

  // ── Constants ───────────────────────────────────────────────────────────────

  /**
   * Emission factors in kg CO2e per passenger-km, by train type.
   * Source: ADEME Base Empreinte 2023.
   */
  const EMISSION_FACTORS = {
    TGV:       0.00173,
    TER:       0.02440,
    INTERCITES: 0.00514,
  };

  /**
   * Fallback train type when classification fails.
   * TER is the most emissive, so this gives a conservative upper bound.
   */
  const DEFAULT_TRAIN_TYPE = "TER";

  /**
   * CO2 footprint of a one-way flight to Madrid, in kg CO2e.
   * Source: user-provided reference value.
   */
  const PLANE_MADRID_ONE_WAY_KG = 194;

  /** CO2 footprint of a round-trip flight to Madrid, in kg CO2e. */
  const PLANE_MADRID_ROUNDTRIP_KG = PLANE_MADRID_ONE_WAY_KG * 2;

  // ── Computation helpers ─────────────────────────────────────────────────────

  /**
   * Return the emission factor (kg CO2e/km) for a given train type string.
   *
   * @param {string} trainType - One of "TGV", "TER", "INTERCITES".
   * @returns {number} Emission factor in kg CO2e per km.
   */
  function emissionFactor(trainType) {
    return EMISSION_FACTORS[trainType] || EMISSION_FACTORS[DEFAULT_TRAIN_TYPE];
  }

  /**
   * Compute the CO2 footprint of a single train section.
   *
   * Returns null when distance is unknown (null/undefined/zero), so callers
   * can distinguish "zero emissions" from "data unavailable".
   *
   * @param {{train_type:string, distance_km:number|null}} section
   *   - train_type: one of "TGV", "TER", "INTERCITES" (or unknown string).
   *   - distance_km: leg distance in km, or null if unavailable.
   * @returns {number|null} CO2 in kg CO2e, or null if distance is unknown.
   */
  function computeSectionCo2(section) {
    if (!section.distance_km) return null;
    return emissionFactor(section.train_type) * section.distance_km;
  }

  /**
   * Compute the total CO2 footprint of a complete journey (all transit sections).
   *
   * Returns null only when every section lacks distance data. If at least one
   * section has a known distance, returns the sum of known section CO2 values
   * (sections with null distance contribute 0).
   *
   * @param {Object|null} journey - Journey object with a `sections` array.
   *   Each section has `train_type` and `distance_km`.
   * @returns {number|null} Total CO2 in kg CO2e, or null if journey is absent
   *   or no distance data is available at all.
   */
  function computeJourneyCo2(journey) {
    if (!journey || !journey.sections || journey.sections.length === 0) return null;

    let total = 0;
    let hasAnyDistance = false;

    journey.sections.forEach(function (section) {
      const co2 = computeSectionCo2(section);
      if (co2 !== null) {
        total += co2;
        hasAnyDistance = true;
      }
    });

    return hasAnyDistance ? total : null;
  }

  /**
   * Compute avoided CO2 emissions: plane round-trip minus both train journeys.
   *
   * Returns null when either journey CO2 is unavailable, as the comparison
   * would be misleading without both values.
   *
   * @param {number|null} outboundCo2Kg - CO2 of the outbound train journey.
   * @param {number|null} returnCo2Kg   - CO2 of the return train journey.
   * @returns {number|null} Avoided emissions in kg CO2e, or null if data is
   *   insufficient.
   */
  function computeAvoidedCo2(outboundCo2Kg, returnCo2Kg) {
    if (outboundCo2Kg === null || returnCo2Kg === null) return null;
    return PLANE_MADRID_ROUNDTRIP_KG - (outboundCo2Kg + returnCo2Kg);
  }

  /**
   * Format a CO2 value in kg as a human-readable French string.
   *
   * @param {number} kg - CO2 in kg CO2e.
   * @returns {string} E.g. "12.3 kg CO2e".
   */
  function formatCo2Kg(kg) {
    return Math.round(kg * 10) / 10 + " kg CO2e";
  }

  // ── HTML builder ────────────────────────────────────────────────────────────

  /**
   * Build the "Info Carbone 🌎" HTML block for the itinerary detail card.
   *
   * Computes CO2 for each journey, then the avoided emissions vs. a Madrid
   * round-trip flight. If distance data is unavailable for either journey,
   * displays a fallback message instead of a misleading number.
   *
   * @param {Object|null} outboundJourney - Outbound journey card object
   *   (with a `sections` array carrying `train_type` and `distance_km`).
   * @param {Object|null} returnJourney - Return journey card object (same shape).
   * @returns {string} HTML string for the carbon info box.
   */
  function buildCarbonInfoHtml(outboundJourney, returnJourney) {
    const outboundCo2 = computeJourneyCo2(outboundJourney);
    const returnCo2   = computeJourneyCo2(returnJourney);
    const totalCo2    = (outboundCo2 !== null && returnCo2 !== null)
      ? outboundCo2 + returnCo2
      : null;
    const avoided     = computeAvoidedCo2(outboundCo2, returnCo2);

    if (totalCo2 === null) {
      return `
        <div class="carbon-info">
          <h4>Info Carbone 🌎</h4>
          <p class="carbon-unavailable">Données de distance non disponibles pour calculer l'empreinte carbone des trajets en train.</p>
        </div>
      `;
    }

    const avoidedText = avoided >= 0
      ? `Si vous étiez parti·e à Madrid en avion au lieu de cette randovélo, vous auriez émis <strong>${formatCo2Kg(avoided)}</strong> de plus !`
      : `Note : ces trajets en train émettent <strong>${formatCo2Kg(-avoided)}</strong> de plus que le vol Madrid aller-retour.`;

    return `
      <div class="carbon-info">
        <h4>Info Carbone 🌎</h4>
        <p>Impact carbone de vos trajets en train : <strong>${formatCo2Kg(totalCo2)}</strong>. ${avoidedText}</p>
      </div>
    `;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.InterCo2 = {
    emissionFactor,
    computeSectionCo2,
    computeJourneyCo2,
    computeAvoidedCo2,
    formatCo2Kg,
    buildCarbonInfoHtml,
  };
})();
