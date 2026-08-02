// Shared chrome stylesheets for the bridge page generators.
//
// A generated page links `resource:<sig>/chrome.css`, so it needs the
// SIGNATURE of the exact bytes the generator mints. That signature is DERIVED
// here by hashing the bytes at run time — never written down as a literal. A
// literal goes stale silently the moment the CSS changes, and every page
// minted after that points at a resource that no longer exists.
//
// Two distinct chromes live here because two distinct sites use them:
//   - DOLPHIN_CHROME_CSS   minted by _dolphin-revision.cjs; linked by
//                          _dolphin-revision.cjs and _dashboard-refresh.cjs
//   - AI_INSIDE_CHROME_CSS minted by ../ai-inside/build-website.cjs; linked
//                          by _ai-privacy-build.cjs and _ai-privacy-chart.cjs
//
// The hash matches what `put-resource` returns: sha256 over the UTF-8 bytes
// of the text handed to the bridge op (Store.putResource -> SignatureService.sign).

const { createHash } = require('node:crypto')

/**
 * sha256 hex over the UTF-8 bytes of `text` — identical to the sig the
 * `put-resource` bridge op returns for the same text. Async so callers can
 * treat it like every other sig-producing call on the bridge.
 */
async function signText(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

// --- dolphin / dashboard chrome -------------------------------------

const DOLPHIN_CHROME_CSS = `
/* ── Material 3 design tokens ─────────────────────────────────────────
 * Brand-driven palette mapped onto Material's surface/primary/secondary
 * roles. Surface tonal levels mirror Material's elevation hierarchy so
 * cards and chips read as a coherent system. Late-bound friendly: every
 * visual is CSS-driven, so the first paint is the final paint — no JS
 * required for layout, color, or typography. */
:root {
  /* Surface system (LIGHT default — per /instructions/styles doctrine).
   * Fresh sites default to light; dark is the explicit override below. */
  --md-surface:           #f5ede0;
  --md-surface-dim:       #e8dec6;
  --md-surface-bright:    #fdf7ea;
  --md-surface-c-lowest:  #ffffff;
  --md-surface-c-low:     #efe7d4;
  --md-surface-c:         #e9ddc4;
  --md-surface-c-high:    #e0d3b6;
  --md-surface-c-highest: #d7c9a6;
  --md-on-surface:        #1a1f2c;
  --md-on-surface-strong: #0a1020;
  --md-on-surface-var:    #4f566a;
  --md-on-surface-faint:  #8c8a82;

  /* Primary / secondary (Material's accent roles) */
  --md-primary:           #1f4376;
  --md-on-primary:        #ffffff;
  --md-primary-container: #cce0f2;
  --md-on-primary-c:      #062340;

  --md-secondary:         #794c1e;
  --md-on-secondary:      #ffffff;
  --md-secondary-c:       #f4dcc1;
  --md-on-secondary-c:    #2a1a08;

  --md-tertiary:          #5a3d68;
  --md-tertiary-c:        #ead0f1;

  /* Outline / divider */
  --md-outline:           rgba(26, 31, 44, 0.24);
  --md-outline-variant:   rgba(26, 31, 44, 0.10);

  /* State layers (Material's hover/focus/pressed overlay opacities) */
  --md-state-hover:    0.08;
  --md-state-focus:    0.12;
  --md-state-pressed:  0.16;

  /* Shape tokens (Material 3 corner radius scale) */
  --md-shape-xs:    4px;
  --md-shape-s:     8px;
  --md-shape-m:    12px;
  --md-shape-l:    16px;
  --md-shape-xl:   28px;
  --md-shape-full: 999px;

  /* Elevation (Material 3 box-shadow sets, tuned for light surfaces) */
  --md-elev-0: none;
  --md-elev-1: 0 1px 2px rgba(0,0,0,.06), 0 1px 3px 1px rgba(0,0,0,.04);
  --md-elev-2: 0 1px 2px rgba(0,0,0,.06), 0 2px 6px 2px rgba(0,0,0,.04);
  --md-elev-3: 0 4px 8px 3px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.10);
  --md-elev-4: 0 6px 10px 4px rgba(0,0,0,.06), 0 2px 3px rgba(0,0,0,.10);

  /* Typography — serif for editorial, sans for UI/chips */
  --md-font-display: "Source Serif 4", "Iowan Old Style", Georgia, "Times New Roman", serif;
  --md-font-body:    "Source Serif 4", "Iowan Old Style", Georgia, serif;
  --md-font-ui:      Inter, "Segoe UI Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;

  /* Motion */
  --md-easing-emphasized: cubic-bezier(.2, 0, 0, 1);
  --md-easing-standard:   cubic-bezier(.2, 0, .2, 1);
  --md-dur-short:    150ms;
  --md-dur-medium:   250ms;
  --md-dur-long:     400ms;
}

[data-theme="dark"] {
  --md-surface:           #0c1622;
  --md-surface-dim:       #07101b;
  --md-surface-bright:    #19283a;
  --md-surface-c-lowest:  #050b13;
  --md-surface-c-low:     #0e1b29;
  --md-surface-c:         #142233;
  --md-surface-c-high:    #1b2c41;
  --md-surface-c-highest: #233650;
  --md-on-surface:        #e8e2d6;
  --md-on-surface-strong: #f6f0e2;
  --md-on-surface-var:    #b6a99a;
  --md-on-surface-faint:  #7a7060;

  --md-primary:           #7eb6d6;
  --md-on-primary:        #06121c;
  --md-primary-container: #1f4f76;
  --md-on-primary-c:      #c8e1f0;

  --md-secondary:         #d3a47a;
  --md-on-secondary:      #2a1a08;
  --md-secondary-c:       #5a3a18;
  --md-on-secondary-c:    #f3d8b6;

  --md-tertiary:          #b297c2;
  --md-tertiary-c:        #4a3a55;

  --md-outline:           rgba(232, 226, 214, 0.20);
  --md-outline-variant:   rgba(232, 226, 214, 0.10);

  --md-elev-1: 0 1px 2px rgba(0,0,0,.30), 0 1px 3px 1px rgba(0,0,0,.15);
  --md-elev-2: 0 1px 2px rgba(0,0,0,.30), 0 2px 6px 2px rgba(0,0,0,.15);
  --md-elev-3: 0 4px 8px 3px rgba(0,0,0,.15), 0 1px 3px rgba(0,0,0,.30);
  --md-elev-4: 0 6px 10px 4px rgba(0,0,0,.15), 0 2px 3px rgba(0,0,0,.30);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --md-surface:           #0c1622;
    --md-surface-dim:       #07101b;
    --md-surface-bright:    #19283a;
    --md-surface-c-lowest:  #050b13;
    --md-surface-c-low:     #0e1b29;
    --md-surface-c:         #142233;
    --md-surface-c-high:    #1b2c41;
    --md-surface-c-highest: #233650;
    --md-on-surface:        #e8e2d6;
    --md-on-surface-strong: #f6f0e2;
    --md-on-surface-var:    #b6a99a;
    --md-on-surface-faint:  #7a7060;
    --md-primary:           #7eb6d6;
    --md-on-primary:        #06121c;
    --md-primary-container: #1f4f76;
    --md-on-primary-c:      #c8e1f0;
    --md-secondary:         #d3a47a;
    --md-on-secondary:      #2a1a08;
    --md-secondary-c:       #5a3a18;
    --md-on-secondary-c:    #f3d8b6;
    --md-tertiary:          #b297c2;
    --md-tertiary-c:        #4a3a55;
    --md-outline:           rgba(232, 226, 214, 0.20);
    --md-outline-variant:   rgba(232, 226, 214, 0.10);
  }
}

/* ── reset ─────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }

/* Lock the page to one viewport on wide screens so the layout never
 * scrolls — per /instructions/layout doctrine. Each internal column
 * scrolls independently if its content exceeds the available height.
 * On narrow (mobile), the page flows naturally to keep content reachable. */
@media (min-width: 880px) {
  html, body {
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }
}
html {
  background: var(--md-surface);
  color: var(--md-on-surface);
  font-family: var(--md-font-body);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  transition: background-color var(--md-dur-medium) var(--md-easing-standard),
              color var(--md-dur-medium) var(--md-easing-standard);
}
body { margin: 0; }

/* ── layout shell — balanced-in-threes, locked to one viewport ────────
 * "Balanced in threes" reads as a rhythm not a rigid 3-column rule.
 * The shell is a grid with three logical rows (bar / main / foot); the
 * main row is itself either three columns (wide) or a single column
 * (narrow). Internal regions scroll independently — the page never does. */
main {
  width: 100%;
  max-width: 86rem;
  margin: 0 auto;
  padding: clamp(0.6rem, 1.5vw, 1.1rem) clamp(0.8rem, 2vw, 1.4rem);
  display: grid;
  gap: clamp(0.5rem, 1.2vw, 1rem) clamp(0.8rem, 2vw, 1.6rem);
  grid-template-columns: 1fr;
  grid-template-rows: auto auto auto auto;
  grid-template-areas:
    "bar"
    "content"
    "right"
    "foot";
  align-content: start;
}

.md-top-bar     { grid-area: bar; }
.md-content     { grid-area: content; display: grid; gap: 0.7rem; align-content: start; min-width: 0; }
.md-aside-left  { display: none; }
.md-aside-right { grid-area: right; display: grid; gap: 0.65rem; align-content: start; min-width: 0; }
.md-foot        { grid-area: foot; }

/* Wide breakpoint — single-viewport three-column layout. Lateral rail
 * (siblings/ancestors), main content (current cell), explore rail
 * (children + cross-links). Each column scrolls independently if its
 * content overflows; the page itself never scrolls. */
@media (min-width: 880px) {
  main {
    height: 100vh;
    height: 100dvh;
    grid-template-columns: 13rem minmax(0, 1fr) 17rem;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "bar  bar     bar"
      "left content right"
      "foot foot    foot";
    align-content: stretch;
  }
  .md-content {
    min-height: 0;
    overflow-y: auto;
  }
  .md-aside-left {
    display: grid;
    grid-area: left;
    gap: 0.65rem;
    align-content: start;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }
  .md-aside-right {
    min-height: 0;
    overflow-y: auto;
  }
}

/* Subtle scrollbar styling on the internal scroll regions — overflow is
 * the exception not the rule, but when it happens it should feel like
 * the rest of the design, not a default chrome bar. */
.md-content, .md-aside-left, .md-aside-right {
  scrollbar-width: thin;
  scrollbar-color: var(--md-outline-variant) transparent;
}
.md-content::-webkit-scrollbar,
.md-aside-left::-webkit-scrollbar,
.md-aside-right::-webkit-scrollbar { width: 6px; }
.md-content::-webkit-scrollbar-thumb,
.md-aside-left::-webkit-scrollbar-thumb,
.md-aside-right::-webkit-scrollbar-thumb {
  background: var(--md-outline-variant);
  border-radius: var(--md-shape-full);
}

/* ── top app bar (Material small top app bar) ──────────────────────── */
.md-top-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0;
}
.md-top-bar nav {
  display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
  font-family: var(--md-font-ui);
  font-size: 0.78rem;
  letter-spacing: 0.10em;
  color: var(--md-on-surface-var);
}
.md-top-bar nav a {
  color: inherit; text-decoration: none;
  padding: 0.25rem 0.55rem;
  border-radius: var(--md-shape-full);
  position: relative;
  transition: background var(--md-dur-short) var(--md-easing-standard),
              color var(--md-dur-short) var(--md-easing-standard);
}
.md-top-bar nav a:hover {
  background: color-mix(in srgb, var(--md-primary) calc(var(--md-state-hover) * 100%), transparent);
  color: var(--md-on-surface);
}
.md-top-bar nav span.sep { opacity: 0.45; }
.md-top-bar nav b {
  color: var(--md-on-surface); font-weight: 500;
  padding: 0.25rem 0.55rem;
  background: var(--md-surface-c);
  border-radius: var(--md-shape-full);
  letter-spacing: 0.04em;
  text-transform: none;
  font-size: 0.85rem;
}

/* Material icon button — round, state-layered. */
.md-icon-btn {
  display: inline-grid; place-items: center;
  width: 2.5rem; height: 2.5rem;
  border: 0; padding: 0;
  border-radius: var(--md-shape-full);
  background: transparent;
  color: var(--md-on-surface-var);
  cursor: pointer;
  position: relative;
  transition: color var(--md-dur-short) var(--md-easing-standard),
              background var(--md-dur-short) var(--md-easing-standard);
}
.md-icon-btn:hover {
  background: color-mix(in srgb, var(--md-primary) calc(var(--md-state-hover) * 100%), transparent);
  color: var(--md-on-surface);
}
.md-icon-btn:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}
.md-icon-btn svg {
  width: 1.25rem; height: 1.25rem;
  fill: none; stroke: currentColor;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
}
.md-icon-btn .sun { display: none; } .md-icon-btn .moon { display: block; }
[data-theme="light"] .md-icon-btn .sun { display: block; }
[data-theme="light"] .md-icon-btn .moon { display: none; }

/* ── headline (Material 3 display scale, compacted for zero-scroll) ── */
.md-headline {
  display: flex; align-items: flex-start; gap: 0.5em;
  font-family: var(--md-font-display); font-weight: 400;
  font-size: clamp(1.55rem, 3.4vw, 2.3rem);
  line-height: 1.08; letter-spacing: -0.012em;
  color: var(--md-on-surface-strong);
  margin: 0;
}
.md-headline-icon {
  flex-shrink: 0; width: 1em; height: 1em;
  color: var(--md-primary);
  margin-top: 0.05em;
}
.md-headline-icon svg {
  width: 100%; height: 100%; fill: none; stroke: currentColor;
  stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round;
}
.md-headline-text { flex: 1; }

/* ── lede / body-large ─────────────────────────────────────────────── */
.md-lede {
  font-family: var(--md-font-body);
  font-size: clamp(1rem, 1.4vw, 1.12rem);
  line-height: 1.5;
  color: var(--md-on-surface-var);
  max-width: 38rem;
  margin: 0;
}

/* ── prose body ────────────────────────────────────────────────────── */
.md-prose {
  display: grid; gap: 0.9rem;
  font-size: 0.99rem; line-height: 1.55;
  color: var(--md-on-surface);
}
.md-prose p { font-family: var(--md-font-body); }
.md-prose a {
  color: var(--md-on-surface-strong);
  text-decoration: underline;
  text-decoration-color: var(--md-primary);
  text-decoration-thickness: 1.5px;
  text-underline-offset: 0.16em;
  transition: text-decoration-color var(--md-dur-short) var(--md-easing-standard),
              color var(--md-dur-short) var(--md-easing-standard);
}
.md-prose a:hover {
  color: var(--md-primary);
  text-decoration-color: var(--md-on-surface);
}

/* Section card — promoted H2 subsections when a leaf has multiple
 * "Heading: text" notes. Material 3 filled-tonal surface. */
.md-section {
  display: grid; gap: 0.55rem;
  padding: 1.15rem 1.3rem 1.25rem;
  background: var(--md-surface-c-low);
  border-radius: var(--md-shape-l);
  border: 1px solid var(--md-outline-variant);
  transition: background var(--md-dur-short) var(--md-easing-standard),
              border-color var(--md-dur-short) var(--md-easing-standard);
}
.md-section:hover {
  background: var(--md-surface-c);
  border-color: var(--md-outline);
}
.md-section h2 {
  display: flex; align-items: center; gap: 0.55em;
  font-family: var(--md-font-display); font-weight: 500;
  font-size: 1.2rem; line-height: 1.25;
  letter-spacing: -0.005em;
  color: var(--md-on-surface-strong);
  margin: 0;
}
.md-section h2 .md-section-icon {
  flex-shrink: 0; width: 1em; height: 1em; color: var(--md-primary);
}
.md-section h2 .md-section-icon svg {
  width: 100%; height: 100%; fill: none; stroke: currentColor;
  stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
}
.md-section p {
  font-family: var(--md-font-body); font-size: 1.04rem; line-height: 1.65;
  color: var(--md-on-surface);
}

/* ── divider (Material 3 divider) ──────────────────────────────────── */
.md-divider {
  height: 1px;
  background: var(--md-outline-variant);
  border: 0; margin: 0;
}

/* ── Q&A — Material outlined surface with question chips ──────────── */
.md-qa {
  display: grid; gap: 0.95rem;
  padding: 1.2rem 1.35rem 1.3rem;
  background: var(--md-surface-c-low);
  border: 1px solid var(--md-outline);
  border-radius: var(--md-shape-l);
  position: relative;
}
.md-qa-head {
  display: flex; align-items: center; gap: 0.55em;
  font-family: var(--md-font-ui); font-weight: 500;
  font-size: 0.78rem; letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--md-on-surface-var);
}
.md-qa-head .md-chip {
  margin-left: auto;
}
.md-qa-item {
  display: grid; gap: 0.5rem;
  padding: 0.75rem 0 0.85rem;
  border-bottom: 1px solid var(--md-outline-variant);
}
.md-qa-item:first-of-type { padding-top: 0; }
.md-qa-item:last-child { padding-bottom: 0; border-bottom: 0; }
.md-qa-q {
  display: flex; gap: 0.65rem; align-items: flex-start;
  font-family: var(--md-font-body);
  color: var(--md-on-surface-strong);
  font-size: 1.04rem; line-height: 1.55;
  margin: 0;
}
.md-qa-q::before {
  content: 'help';
  font-family: 'Material Symbols Outlined', system-ui;
  font-size: 1.2rem;
  font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  color: var(--md-primary);
  flex-shrink: 0;
  line-height: 1.35;
}
.md-qa-a {
  font-family: var(--md-font-body);
  margin: 0; padding: 0.45rem 0 0.45rem 0.95rem;
  border-left: 3px solid var(--md-primary);
  color: var(--md-on-surface-var);
  font-size: 0.97rem; line-height: 1.55;
  background: color-mix(in srgb, var(--md-primary) 4%, transparent);
  border-radius: 0 var(--md-shape-s) var(--md-shape-s) 0;
}
.md-qa-foot {
  display: inline-flex; align-items: center; gap: 0.4em;
  font-family: var(--md-font-ui); font-size: 0.74rem;
  letter-spacing: 0.06em;
  color: var(--md-on-surface-faint);
  margin-top: 0.1rem;
  padding-left: 1.85rem;
}

/* Material 3 assist chip */
.md-chip {
  display: inline-flex; align-items: center; gap: 0.4em;
  height: 1.75rem;
  padding: 0 0.75rem;
  border-radius: var(--md-shape-s);
  background: var(--md-surface-c-high);
  border: 1px solid var(--md-outline-variant);
  font-family: var(--md-font-ui); font-size: 0.78rem; font-weight: 500;
  color: var(--md-on-surface);
  letter-spacing: 0.02em;
  text-transform: none;
}
.md-chip-primary {
  background: var(--md-primary-container);
  color: var(--md-on-primary-c);
  border-color: transparent;
}

/* ── lateral / cross-link rails (left + right column content) ──────── */
.md-rail {
  display: grid; gap: 0.4rem;
  padding: 0.85rem 0.9rem;
  background: var(--md-surface-c-low);
  border: 1px solid var(--md-outline-variant);
  border-radius: var(--md-shape-l);
}
.md-rail-head {
  font-family: var(--md-font-ui);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--md-on-surface-faint);
  margin-bottom: 0.15rem;
}
.md-rail-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}
.md-rail-list a {
  display: block;
  padding: 0.35rem 0.55rem;
  border-radius: var(--md-shape-s);
  color: var(--md-on-surface);
  text-decoration: none;
  font-family: var(--md-font-body);
  font-size: 0.92rem;
  line-height: 1.3;
  transition:
    background var(--md-dur-short) var(--md-easing-standard),
    color var(--md-dur-short) var(--md-easing-standard);
}
.md-rail-list a:hover {
  background: color-mix(in srgb, var(--md-primary) calc(var(--md-state-hover) * 100%), transparent);
  color: var(--md-on-surface-strong);
}
.md-rail-list a.current {
  background: var(--md-primary-container);
  color: var(--md-on-primary-c);
}

/* ── tile-card grid — the "tile sections" the dashboard / index use ──
 * Material 3 elevated card with hover lift + state-layer overlay. */
.md-tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
  gap: 0.55rem;
  list-style: none;
  counter-reset: md-tiles;
  padding: 0; margin: 0;
}
.md-tile {
  counter-increment: md-tiles;
  position: relative;
  border-radius: var(--md-shape-l);
  overflow: hidden;
  background: var(--md-surface-c);
  border: 1px solid var(--md-outline-variant);
  box-shadow: var(--md-elev-0);
  transition:
    transform var(--md-dur-medium) var(--md-easing-emphasized),
    box-shadow var(--md-dur-medium) var(--md-easing-emphasized),
    background var(--md-dur-short) var(--md-easing-standard),
    border-color var(--md-dur-short) var(--md-easing-standard);
  /* Material 3 state-layer overlay (pseudo) */
}
.md-tile::before {
  content: '';
  position: absolute; inset: 0;
  background: var(--md-primary);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--md-dur-short) var(--md-easing-standard);
}
.md-tile:hover {
  transform: translateY(-2px);
  box-shadow: var(--md-elev-2);
  background: var(--md-surface-c-high);
  border-color: var(--md-outline);
}
.md-tile:hover::before { opacity: var(--md-state-hover); }
.md-tile:focus-within {
  outline: 2px solid var(--md-primary);
  outline-offset: 2px;
}
.md-tile-link {
  display: grid; gap: 0.35rem;
  padding: 0.7rem 0.85rem 0.8rem;
  color: inherit; text-decoration: none;
  height: 100%;
  position: relative; z-index: 1;
}
.md-tile-number {
  font-family: var(--md-font-ui);
  font-size: 0.68rem; letter-spacing: 0.16em;
  color: var(--md-on-surface-faint);
  text-transform: uppercase;
  display: flex; align-items: center; gap: 0.4em;
}
.md-tile-number::before {
  content: counter(md-tiles, decimal-leading-zero);
}
.md-tile-icon {
  width: 1.25rem; height: 1.25rem;
  color: var(--md-primary);
  display: inline-flex;
  margin-left: auto;
}
.md-tile-icon svg {
  width: 100%; height: 100%;
  fill: none; stroke: currentColor;
  stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;
}
.md-tile-name {
  font-family: var(--md-font-display);
  font-size: 1.02rem; font-weight: 500;
  line-height: 1.2; letter-spacing: -0.005em;
  color: var(--md-on-surface-strong);
}
.md-tile-blurb {
  font-family: var(--md-font-body);
  font-size: 0.85rem; line-height: 1.4;
  color: var(--md-on-surface-var);
}
.md-tile-trail {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: auto;
  padding-top: 0.4rem;
  font-family: var(--md-font-ui); font-size: 0.72rem;
  letter-spacing: 0.08em;
  color: var(--md-on-surface-faint);
}
.md-tile-trail .md-arrow {
  width: 1.1rem; height: 1.1rem;
  color: var(--md-on-surface-var);
  transition: transform var(--md-dur-medium) var(--md-easing-emphasized),
              color var(--md-dur-short) var(--md-easing-standard);
}
.md-tile-trail .md-arrow svg {
  width: 100%; height: 100%; fill: none; stroke: currentColor;
  stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round;
}
.md-tile:hover .md-tile-trail .md-arrow {
  transform: translateX(4px);
  color: var(--md-primary);
}

/* ── footer ────────────────────────────────────────────────────────── */
footer.md-foot {
  font-family: var(--md-font-ui);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--md-on-surface-faint);
  text-align: center;
  margin-top: 0.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--md-outline-variant);
}

/* ── reduced motion ────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
  .md-tile:hover { transform: none; }
  .md-tile:hover .md-tile-trail .md-arrow { transform: none; }
}
`.trim()

// --- ai-inside chrome -----------------------------------------------

const AI_INSIDE_CHROME_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#e8eef6;--muted:#9fb0c4;--line:rgba(126,182,214,.18);--bg0:#070b12;--card:rgba(255,255,255,.035)}
html,body{background:var(--bg0);color:var(--ink);font:16px/1.65 'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:#7ec0ff;text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1180px;margin:0 auto;padding:40px 28px 96px}
.crumb{font-size:13px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;margin-bottom:18px;display:flex;gap:8px;align-items:center}
.crumb a{color:var(--muted)}
.hero{position:relative;border:1px solid var(--line);border-radius:22px;padding:54px 44px;overflow:hidden;background:var(--card)}
.hero::after{content:'';position:absolute;inset:0;background-size:cover;background-position:center;opacity:.9;z-index:-1}
.eyebrow{font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
h1{font-size:clamp(34px,6vw,62px);line-height:1.02;font-weight:800;letter-spacing:-.02em}
h1 .dot{color:var(--accentc,#7ec0ff)}
.lede{margin-top:18px;max-width:760px;color:#cdd9e8;font-size:18px}
.sec-title{display:flex;align-items:center;gap:12px;margin:54px 4px 18px;font-size:14px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.sec-title .ms,.chip .ms,.card h3 .ms{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:20px;line-height:1;-webkit-font-feature-settings:'liga';}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:16px}
.card{position:relative;border:1px solid var(--line);border-radius:16px;padding:20px 20px 22px;background:var(--card);overflow:hidden;transition:transform .15s ease,border-color .15s ease}
.card:hover{transform:translateY(-3px);border-color:rgba(126,182,214,.45)}
.card .bar{position:absolute;left:0;top:0;height:4px;width:100%;background:var(--bar,#5b8def)}
.card h3{font-size:18px;font-weight:700;margin:6px 0 8px;display:flex;align-items:center;gap:8px}
.card p{font-size:14px;color:var(--muted);line-height:1.55}
.card .go{margin-top:14px;font-size:13px;color:#7ec0ff;display:inline-flex;align-items:center;gap:4px}
.count{margin-left:auto;font-size:12px;color:var(--muted);letter-spacing:0}
.panel{border:1px solid var(--line);border-radius:18px;padding:26px 28px;background:var(--card);margin-top:16px}
.panel h3{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--accentc,#7ec0ff);margin-bottom:12px;display:flex;align-items:center;gap:10px}
.panel p{color:#d6e1ee;font-size:16px}
.refs{font-size:14px;color:#cdd9e8;line-height:1.9}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:22px}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:6px 12px}
.foot{margin-top:64px;padding-top:22px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
@media(max-width:640px){.wrap{padding:24px 16px 72px}.hero{padding:36px 22px}}
`.trim()

/** Signature of the dolphin/dashboard chrome, derived from its bytes. */
const dolphinChromeSig = () => signText(DOLPHIN_CHROME_CSS)

/** Signature of the ai-inside chrome, derived from its bytes. */
const aiInsideChromeSig = () => signText(AI_INSIDE_CHROME_CSS)

module.exports = {
  DOLPHIN_CHROME_CSS,
  AI_INSIDE_CHROME_CSS,
  dolphinChromeSig,
  aiInsideChromeSig,
  signText,
}
