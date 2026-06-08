/**
 * test_housing_classifier.js — Unit tests for the housing classification logic.
 *
 * Tests the classifyHousingType function extracted from map.js.
 * Run with: node tests/test_housing_classifier.js
 */

"use strict";

const assert = require("assert");

// ── classifyHousingType (reproduced from map.js for testability) ───────────

const CAMPING_KEYWORDS = ['camping', 'bivouac', 'motorhome', 'camping-car'];
const HOTEL_KEYWORDS = [
  'hôtel', 'hotel', 'ibis', 'novotel', 'mercure', 'kyriad',
  'première classe', 'premiere classe', 'b&b hotel', 'formule 1', 'etap hotel',
];

/**
 * Classify an accommodation name into a housing category.
 *
 * @param {string|null} name - Accommodation name.
 * @returns {'camping'|'hotel'|'gite'} Inferred category.
 */
function classifyHousingType(name) {
  if (!name) return 'gite';
  const n = name.toLowerCase();
  if (CAMPING_KEYWORDS.some(function (k) { return n.includes(k); })) return 'camping';
  if (HOTEL_KEYWORDS.some(function (k) { return n.includes(k); })) return 'hotel';
  return 'gite';
}

// ── Test helpers ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * Assert that classifyHousingType(name) equals expected.
 *
 * @param {string|null} name - Input name.
 * @param {'camping'|'hotel'|'gite'} expected - Expected classification.
 * @param {string} description - Human-readable test label.
 */
function test(description, name, expected) {
  try {
    const result = classifyHousingType(name);
    assert.strictEqual(result, expected, `Expected '${expected}' but got '${result}'`);
    console.log(`  ✓ ${description}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${description}: ${err.message}`);
    failed += 1;
  }
}

// ── Camping tests ──────────────────────────────────────────────────────────

console.log("Camping classification:");
test("explicit 'camping' keyword", "Camping Au Bol d'air", 'camping');
test("mixed case camping", "CAMPING LES PINS", 'camping');
test("motorhome area", "Motorhome area of Erquelinnes", 'camping');
test("camping-car keyword", "Camping-car Park Maubeuge", 'camping');
test("bivouac keyword", "Bivouac du Chemin", 'camping');
test("null name defaults to gite (not camping)", null, 'gite');

// ── Hotel tests ────────────────────────────────────────────────────────────

console.log("Hotel classification:");
test("explicit 'Hôtel' keyword", "Hôtel Première Classe Maubeuge – Feignies", 'hotel');
test("accented hôtel", "Hôtel du Château", 'hotel');
test("unaccented hotel keyword", "B&B HOTEL Louvroil", 'hotel');
test("ibis brand", "ibis budget Strasbourg", 'hotel');
test("novotel brand", "Novotel Paris Centre", 'hotel');
test("mercure brand", "Mercure Lyon Centre", 'hotel');
test("kyriad brand", "Kyriad Orléans", 'hotel');
test("premiere classe keyword", "Premiere Classe Metz", 'hotel');
test("première classe keyword (accented)", "Première Classe Rouen", 'hotel');
test("formule 1 keyword", "Formule 1 Paris", 'hotel');

// ── Gite (default) tests ───────────────────────────────────────────────────

console.log("Gîte (default) classification:");
test("explicit gîte name", "Gîtes de France - n° 4078", 'gite');
test("gîte keyword", "Gîte La ferme aux charmes", 'gite');
test("chambre d'hôtes (not a hotel)", "Chambre d'hôtes La Maison Verte", 'gite');
test("ferme with no hotel/camping keyword", "Ferme de la Rivière", 'gite');
test("generic accommodation with no keyword", "Le Grand Pré", 'gite');
test("relais name", "Relais éco-vélo et base VTT", 'gite');
test("null name", null, 'gite');
test("empty string", "", 'gite');

// ── Edge cases ─────────────────────────────────────────────────────────────

console.log("Edge cases:");
test("'hote' alone does not match hotel", "Auberge de l'Hôte", 'gite');
test("camping keyword takes priority over hotel keywords if both present", "Camping Hôtel du Lac", 'camping');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
