/**
 * journey_parser.js — Navitia API response parser (port of app/navitia/journey_parser.py).
 *
 * Extracts structured journey data from raw Navitia JSON responses.
 * No I/O or network calls — pure data transformation.
 *
 * Exposes: window.InterJourney
 */

(function () {
  "use strict";

  /**
   * Convert a Navitia datetime string to ISO 8601 format.
   *
   * Navitia format: '20260409T080400' (no separators).
   * ISO 8601 output: '2026-04-09T08:04:00'.
   *
   * @param {string} navitiaDatetime - Datetime string in Navitia format.
   * @returns {string} ISO 8601 string, or the original if conversion fails.
   */
  function navitiaDatetimeToIso(navitiaDatetime) {
    try {
      const year   = navitiaDatetime.slice(0, 4);
      const month  = navitiaDatetime.slice(4, 6);
      const day    = navitiaDatetime.slice(6, 8);
      const hour   = navitiaDatetime.slice(9, 11);
      const minute = navitiaDatetime.slice(11, 13);
      const second = navitiaDatetime.length >= 15 ? navitiaDatetime.slice(13, 15) : "00";
      return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    } catch (_) {
      return navitiaDatetime;
    }
  }

  /**
   * Extract a human-readable station name from a Navitia 'place' object.
   *
   * @param {Object} place - Navitia place object from a journey section endpoint.
   * @returns {string} Station name, or empty string if structure is unexpected.
   */
  function extractStationName(place) {
    if (!place) return "";
    const stopArea = place.stop_area || place.stop_point;
    if (stopArea) return stopArea.name || "";
    return place.name || "";
  }

  /**
   * Extract simplified section summaries from a single Navitia journey.
   *
   * @param {Object} journey - A single journey object from a Navitia API response.
   * @returns {Array<{mode: string, from: string, to: string, duration_min: number}>}
   *   Section summaries. Empty array if no sections are present.
   */
  function parseJourneySections(journey) {
    const sections = [];
    for (const section of (journey.sections || [])) {
      const sectionType = section.type || "";
      const mode = (section.display_informations && section.display_informations.physical_mode) || sectionType;
      const from = extractStationName(section.from);
      const to   = extractStationName(section.to);
      const durationMin = Math.round((section.duration || 0) / 60);
      sections.push({ mode, from, to, duration_min: durationMin });
    }
    return sections;
  }

  /**
   * Extract the best (first) journey from a Navitia journeys API response.
   *
   * Navitia returns journeys sorted by optimality. This function returns the
   * first entry as the recommended option.
   *
   * @param {Object} apiResponse - Parsed JSON from a Navitia /journeys call.
   * @returns {Object|null} Journey result object, or null if:
   *   - The response has no journeys.
   *   - The 'journeys' key is missing.
   *
   * The returned object has keys:
   *   from_station_nom, to_station_nom, departure_datetime, arrival_datetime,
   *   duration_minutes, nb_transfers, sections.
   */
  function parseBestJourney(apiResponse) {
    const journeys = apiResponse && apiResponse.journeys;
    if (!journeys || journeys.length === 0) return null;

    const journey = journeys[0];
    const departureDt = navitiaDatetimeToIso(journey.departure_date_time || "");
    const arrivalDt   = navitiaDatetimeToIso(journey.arrival_date_time || "");
    const durationMin = Math.round((journey.duration || 0) / 60);
    const nbTransfers = journey.nb_transfers || 0;
    const sections    = journey.sections || [];

    const fromNom = extractStationName((sections[0] || {}).from || {});
    const toNom   = extractStationName((sections[sections.length - 1] || {}).to || {});

    return {
      from_station_nom: fromNom,
      to_station_nom: toNom,
      departure_datetime: departureDt,
      arrival_datetime: arrivalDt,
      duration_minutes: durationMin,
      nb_transfers: nbTransfers,
      sections: parseJourneySections(journey),
    };
  }

  /**
   * Convert a duration in minutes to a human-readable French-style string.
   *
   * @param {number} totalMinutes - Non-negative integer number of minutes.
   * @returns {string} E.g. '1h 35min', '45min', '2h'.
   */
  function formatDurationMinutes(totalMinutes) {
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  window.InterJourney = {
    navitiaDatetimeToIso,
    extractStationName,
    parseJourneySections,
    parseBestJourney,
    formatDurationMinutes,
  };
})();
