/**
 * test_slideshow.js — Unit tests for the slideshow index logic.
 *
 * Tests the nextIndex function extracted from static/js/slideshow.js.
 * Run with: node tests/test_slideshow.js
 */

"use strict";

const assert = require("assert");

// ── nextIndex (reproduced from slideshow.js for testability) ───────────────

/**
 * Compute the next slide index, wrapping around both ends.
 *
 * @param {number} current - Current zero-based slide index.
 * @param {number} total - Number of slides.
 * @param {number} direction - Step to apply, e.g. +1 (next) or -1 (previous).
 * @returns {number} The wrapped index within [0, total); 0 when total <= 0.
 */
function nextIndex(current, total, direction) {
  if (total <= 0) return 0;
  return (((current + direction) % total) + total) % total;
}

// ── Test helper ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

/**
 * Assert that nextIndex(current, total, direction) equals expected.
 *
 * @param {string} description - Human-readable test label.
 * @param {[number, number, number]} args - [current, total, direction].
 * @param {number} expected - Expected wrapped index.
 */
function test(description, args, expected) {
  try {
    const result = nextIndex(args[0], args[1], args[2]);
    assert.strictEqual(result, expected, `Expected ${expected} but got ${result}`);
    console.log(`  ✓ ${description}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${description}: ${err.message}`);
    failed += 1;
  }
}

// ── Forward navigation ───────────────────────────────────────────────────────

console.log("Next (direction +1):");
test("0 → 1 of 3", [0, 3, 1], 1);
test("1 → 2 of 3", [1, 3, 1], 2);
test("last wraps to first", [2, 3, 1], 0);

// ── Backward navigation ──────────────────────────────────────────────────────

console.log("Previous (direction -1):");
test("2 → 1 of 3", [2, 3, -1], 1);
test("1 → 0 of 3", [1, 3, -1], 0);
test("first wraps to last", [0, 3, -1], 2);

// ── Edge conditions ──────────────────────────────────────────────────────────

console.log("Edge cases:");
test("single slide, next stays at 0", [0, 1, 1], 0);
test("single slide, prev stays at 0", [0, 1, -1], 0);
test("zero slides returns 0 (guard)", [0, 0, 1], 0);
test("negative total returns 0 (guard)", [0, -3, 1], 0);
test("multi-step forward wraps", [2, 3, 2], 1);
test("multi-step backward wraps", [0, 3, -2], 1);
test("direction 0 is a no-op", [1, 3, 0], 1);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
