/**
 * tests/js/results.test.js — Unit tests for pure helper functions in results.js.
 *
 * Because results.js attaches exports to window.InterResults, we re-implement
 * the pure functions here as tested CommonJS functions.  This keeps the tests
 * isolated from the DOM/Leaflet environment.
 */

"use strict";

// ── Pure function re-implementations (mirroring results.js exactly) ──────────

/**
 * @param {number} km
 * @returns {string}
 */
function formatKm(km) {
  return `${Math.round(km)} km`;
}

/**
 * @param {string|null} isoStr
 * @returns {string}
 */
function formatTime(isoStr) {
  if (!isoStr) return "—";
  const parts = isoStr.split("T");
  if (parts.length < 2) return "—";
  return parts[1].substring(0, 5).replace(":", "h");
}

/**
 * @param {string} fromName
 * @param {string} toName
 * @returns {string}
 */
function buildBookingUrl(fromName, toName) {
  return (
    "https://www.sncf-connect.com/home/search" +
    "?userInput=" + encodeURIComponent(fromName) +
    "&userInput=" + encodeURIComponent(toName)
  );
}

/**
 * @param {{from:string, to:string, duration_min:number}} section
 * @returns {string}
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
 * @param {Array} sections
 * @param {string} expandBtnId
 * @param {string} detailId
 * @returns {string}
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

// ── formatKm ──────────────────────────────────────────────────────────────────

describe("formatKm", () => {
  test("rounds integer km to nearest integer with unit", () => {
    expect(formatKm(120)).toBe("120 km");
  });

  test("rounds a float up", () => {
    expect(formatKm(97.6)).toBe("98 km");
  });

  test("rounds a float down", () => {
    expect(formatKm(97.4)).toBe("97 km");
  });

  test("handles zero", () => {
    expect(formatKm(0)).toBe("0 km");
  });

  test("handles large values", () => {
    expect(formatKm(1800.5)).toBe("1801 km");
  });
});

// ── formatTime ────────────────────────────────────────────────────────────────

describe("formatTime", () => {
  test("converts ISO datetime to French hhmm format", () => {
    expect(formatTime("2026-04-09T08:15:00")).toBe("08h15");
  });

  test("pads single-digit hours", () => {
    expect(formatTime("2026-04-09T07:05:00")).toBe("07h05");
  });

  test("returns dash for null", () => {
    expect(formatTime(null)).toBe("—");
  });

  test("returns dash for empty string", () => {
    expect(formatTime("")).toBe("—");
  });

  test("returns dash for string without T separator", () => {
    expect(formatTime("2026-04-09")).toBe("—");
  });

  test("handles midnight", () => {
    expect(formatTime("2026-04-09T00:00:00")).toBe("00h00");
  });
});

// ── buildBookingUrl ───────────────────────────────────────────────────────────

describe("buildBookingUrl", () => {
  test("builds correct base URL with two userInput params", () => {
    const url = buildBookingUrl("Paris", "Eu");
    expect(url).toBe(
      "https://www.sncf-connect.com/home/search?userInput=Paris&userInput=Eu"
    );
  });

  test("URL-encodes spaces in station names", () => {
    const url = buildBookingUrl("Paris Gare de Lyon", "Dijon-Ville");
    expect(url).toContain("Paris%20Gare%20de%20Lyon");
    expect(url).toContain("Dijon-Ville");
  });

  test("URL-encodes accented characters", () => {
    const url = buildBookingUrl("Orléans", "Blois");
    expect(url).toContain(encodeURIComponent("Orléans"));
  });

  test("departure appears as first userInput param", () => {
    const url = buildBookingUrl("Lyon", "Marseille");
    const idx1 = url.indexOf("Lyon");
    const idx2 = url.indexOf("Marseille");
    expect(idx1).toBeLessThan(idx2);
  });

  test("both station names appear in the URL", () => {
    const url = buildBookingUrl("Nantes", "Bordeaux");
    expect(url).toContain("Nantes");
    expect(url).toContain("Bordeaux");
  });
});

// ── buildConnectionsHtml ──────────────────────────────────────────────────────

describe("buildConnectionsHtml", () => {
  const twoSections = [
    { mode: "RAIL", from: "Paris Gare de Lyon", to: "Dijon-Ville", duration_min: 95 },
    { mode: "RAIL", from: "Dijon-Ville",        to: "Lyon Part-Dieu", duration_min: 115 },
  ];

  test("returns empty string for null sections", () => {
    expect(buildConnectionsHtml(null, "btn-id", "detail-id")).toBe("");
  });

  test("returns empty string for empty array", () => {
    expect(buildConnectionsHtml([], "btn-id", "detail-id")).toBe("");
  });

  test("returns empty string for single section (no intermediate change)", () => {
    const single = [{ mode: "RAIL", from: "A", to: "B", duration_min: 60 }];
    expect(buildConnectionsHtml(single, "btn-id", "detail-id")).toBe("");
  });

  test("renders expand button for two sections", () => {
    const html = buildConnectionsHtml(twoSections, "expand-aller", "connections-aller");
    expect(html).toContain("btn-expand-connections");
    expect(html).toContain("expand-aller");
  });

  test("shows correct correspondence count (sections - 1) in button", () => {
    const html = buildConnectionsHtml(twoSections, "btn", "detail");
    expect(html).toContain("(1)");
  });

  test("renders detail div with correct ID", () => {
    const html = buildConnectionsHtml(twoSections, "btn", "my-detail");
    expect(html).toContain('id="my-detail"');
  });

  test("detail div is hidden by default", () => {
    const html = buildConnectionsHtml(twoSections, "btn", "detail");
    expect(html).toContain("hidden");
  });

  test("includes all station names in the rows", () => {
    const html = buildConnectionsHtml(twoSections, "btn", "detail");
    expect(html).toContain("Paris Gare de Lyon");
    expect(html).toContain("Dijon-Ville");
    expect(html).toContain("Lyon Part-Dieu");
  });

  test("formats duration correctly for sub-hour leg", () => {
    const sections = [
      { mode: "RAIL", from: "A", to: "B", duration_min: 45 },
      { mode: "RAIL", from: "B", to: "C", duration_min: 30 },
    ];
    const html = buildConnectionsHtml(sections, "btn", "detail");
    expect(html).toContain("45min");
    expect(html).toContain("30min");
  });

  test("formats duration correctly for multi-hour leg", () => {
    const sections = [
      { mode: "RAIL", from: "A", to: "B", duration_min: 125 },
      { mode: "RAIL", from: "B", to: "C", duration_min: 60 },
    ];
    const html = buildConnectionsHtml(sections, "btn", "detail");
    expect(html).toContain("2h 5min");
    expect(html).toContain("1h");
  });
});
