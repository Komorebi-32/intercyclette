/**
 * slideshow.js — Roadmap modal "coming soon" feature carousel.
 *
 * Drives the diaporama at the top of the "Développements futurs" modal: one slide
 * visible at a time, navigated with prev/next arrows, dots, or the arrow keys.
 * Slides are plain DOM nodes toggled via an `is-active` class — no images are
 * measured or repositioned — so it behaves correctly whether the modal is open
 * or still hidden.
 *
 * Public API: `window.InterSlideshow`.
 */
(function () {
  "use strict";

  const ACTIVE_CLASS = "is-active";

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

  /**
   * Wire one slideshow: arrow buttons, dots, and arrow-key navigation.
   *
   * @param {HTMLElement} root - The `.roadmap-slideshow` container element.
   * @returns {void} No-op when `root` is missing or has no slides.
   */
  function initSlideshow(root) {
    if (!root) return;
    const slides = Array.prototype.slice.call(root.querySelectorAll(".slideshow-slide"));
    if (slides.length === 0) return;

    const dots = Array.prototype.slice.call(root.querySelectorAll(".slideshow-dot"));
    const prevBtn = root.querySelector(".slideshow-arrow--prev");
    const nextBtn = root.querySelector(".slideshow-arrow--next");

    let index = slides.findIndex(function (slide) {
      return slide.classList.contains(ACTIVE_CLASS);
    });
    if (index < 0) index = 0;

    /**
     * Display the slide at `target`, syncing slide and dot active states.
     *
     * @param {number} target - Index to display (assumed already wrapped).
     * @returns {void}
     */
    function show(target) {
      index = target;
      slides.forEach(function (slide, i) {
        slide.classList.toggle(ACTIVE_CLASS, i === index);
      });
      dots.forEach(function (dot, i) {
        dot.classList.toggle(ACTIVE_CLASS, i === index);
      });
    }

    /**
     * Advance the carousel by `direction` slides, wrapping around.
     *
     * @param {number} direction - +1 (next) or -1 (previous).
     * @returns {void}
     */
    function step(direction) {
      show(nextIndex(index, slides.length, direction));
    }

    if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { step(1); });
    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function () { show(i); });
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") { step(-1); }
      else if (event.key === "ArrowRight") { step(1); }
    });

    show(index);
  }

  /**
   * Initialise every `.roadmap-slideshow` on the page.
   *
   * @returns {void}
   */
  function init() {
    document.querySelectorAll(".roadmap-slideshow").forEach(initSlideshow);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.InterSlideshow = { nextIndex, initSlideshow };
})();
