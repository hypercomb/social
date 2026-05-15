// Stamps a fresh "Field Notes" editorial revision over the entire
// dolphin tree. Reads the live tree from the bridge, generates per-cell
// HTML (root + 8 branches + 39 leaves), mints all signatures via
// put-resource, stamps each cell's `context` slot, attaches strategic
// Q&A notes, and creates a `dashboard` cell at root that aggregates
// links to the Q&A tiles.
//
//   node scripts/bridge/_dolphin-revision.cjs
//
// Requires: bridge server on ws://localhost:2401 + a connected renderer
// (dev shell with `localStorage['hypercomb.claudeBridge.enabled']='1'`).

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'

// ─── bridge plumbing ────────────────────────────────────────────────

let counter = 0
const nextId = () => `gen-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function withRenderer(req, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) {
      if (i === attempts - 1) throw e
    }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

// ─── note dedupe + extract ──────────────────────────────────────────

function noteText(note) {
  if (typeof note === 'string') return note
  if (note && typeof note === 'object') {
    const body = note.body
    if (Array.isArray(body) && body.length) return String(body[0]?.text ?? '')
    if (typeof body === 'string') return body
    if (typeof note.text === 'string') return note.text
  }
  return ''
}

function uniqueNotes(notes) {
  const seen = new Set()
  const out = []
  for (const n of notes || []) {
    const t = noteText(n).trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

// ─── Q&A as a dedicated `qa` slot (decoration, not notes) ────────────
//
// Each question is its own content-addressed JSON resource:
//   { qId, question, askedAt }
// The cell's `qa` slot holds an array of those sigs — the same
// participant pattern notes use, just on a different slot. When the
// user answers a Q, the answer text becomes a regular note (user
// content) and the Q's sig is bag-remove'd from the qa slot; the Q
// disappears from "open questions" everywhere automatically.
//
// Reading: bridge `inflate` returns the slot as `qa: [...resource stubs]`
// where each stub has $sig, $contentType, $preview. The full Q JSON is
// fetchable by sig if needed.

function parseQaSlot(cell) {
  // The inflated layer expands the qa slot's resource sigs into the
  // JSON they point at — items arrive as resolved `{ qId, question }`
  // objects directly (no $preview/$sig wrapping). Defensive against
  // both shapes in case inflate's behavior shifts.
  const raw = cell?.qa
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    // Resolved JSON form (current inflate behavior).
    let q = (typeof item.question === 'string') ? item : null
    // Stub form fallback.
    if (!q) {
      try { q = JSON.parse(item.$preview ?? '') } catch { /* ignore */ }
    }
    if (!q || typeof q.question !== 'string') continue
    const question = q.question.trim()
    if (!question || seen.has(question)) continue
    seen.add(question)
    out.push({
      qId: q.qId || item.$sig?.slice(0, 16) || String(out.length),
      question,
      sig: item.$sig,
    })
  }
  return out
}

// ─── per-branch heading icons (stroke-only line SVGs, 1em-sized) ────
//
// Per /instructions/styles: "Heading-icon shape — every heading splits
// into __title-icon + __title-text spans; flex wrapper; align-center;
// small gap; inline SVG sized via heading font-size (1em square);
// stroke-only line icons keep weight light against display type."
// One icon per branch, plus a root icon, a default for leaves with no
// specific symbol, and one for the dashboard cell.

const BRANCH_ICONS = {
  root:     '<circle cx="12" cy="12" r="9"/><path d="M3 12c4 0 4-4 9-4s5 4 9 4M3 12c4 0 4 4 9 4s5-4 9-4"/>',
  model:    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  practice: '<circle cx="12" cy="8" r="3"/><path d="M4 19c4-6 12-6 16 0"/>',
  evidence: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5M9 8h5"/>',
  audience: '<circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="11" r="2.4"/><path d="M2 19c1-3 4-5 7-5s6 2 7 5M14 19c.5-2 2.5-3 4.5-3s3 1 3.5 3"/>',
  voice:    '<path d="M12 4v11"/><path d="M8 11a4 4 0 0 0 8 0"/><path d="M12 19v2M9 21h6"/>',
  network:  '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6.5 7.3 11 16.3M17.5 7.3 13 16.3"/>',
  platform: '<path d="M12 3 21 8l-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  business: '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M10 21v-7h4v7"/>',
  // generic fallback for leaves
  leaf:     '<circle cx="12" cy="12" r="3"/>',
  // dashboard cell
  dashboard:'<rect x="3" y="3" width="8" height="8" rx="1.2"/><rect x="13" y="3" width="8" height="5" rx="1.2"/><rect x="13" y="10" width="8" height="11" rx="1.2"/><rect x="3" y="13" width="8" height="8" rx="1.2"/>',
}

// Section heading icon — a quiet "list of items" mark for `<h2>`s.
const SECTION_ICON = '<path d="M4 7h12M4 12h16M4 17h10"/>'

function iconSvg(name) {
  const path = BRANCH_ICONS[name] ?? BRANCH_ICONS.leaf
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`
}

// ─── chrome stylesheet (one resource, every page links it) ──────────

const CHROME_CSS = `
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

const PAINT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('hc:dolphin:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (_) {}
})();
`.trim()

const TOGGLE_SCRIPT = `
(function () {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  function current() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('hc:dolphin:theme', t); } catch (_) {}
  }
  btn.addEventListener('click', function () { apply(current() === 'light' ? 'dark' : 'light'); });
})();
`.trim()

// ─── HTML helpers ───────────────────────────────────────────────────

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])

function titleCase(s) {
  return String(s).split(/[-_\s]/).filter(Boolean)
    .map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function labelFor(seg, fullPathToHere) {
  if (seg === 'dolphin' && fullPathToHere.length === 1) return 'Relational Intelligence'
  if (seg === 'dashboard' && fullPathToHere.length === 1) return 'Dashboard'
  return titleCase(seg)
}

function breadcrumbHtml(segments) {
  const parts = []
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1
    const label = labelFor(segments[i], segments.slice(0, i + 1))
    if (isLast) parts.push(`<b>${escapeHtml(label)}</b>`)
    else {
      const up = '../'.repeat(segments.length - i - 1) || './'
      parts.push(`<a href="${escapeHtml(up)}">${escapeHtml(label)}</a>`)
    }
  }
  return parts.map((p, i) => i === 0 ? p : `<span class="sep">·</span> ${p}`).join(' ')
}

// ─── shared shell ───────────────────────────────────────────────────

function renderQaSection(qaItems) {
  if (!qaItems || qaItems.length === 0) return ''
  const items = qaItems.map(({ qId, question, answer }) => `
    <div id="q-${escapeHtml(qId)}" class="md-qa-item ${answer ? 'md-qa-answered' : 'md-qa-open'}">
      <p class="md-qa-q">${escapeHtml(question)}</p>
      ${answer
        ? `<p class="md-qa-a">${escapeHtml(answer)}</p>`
        : `<span class="md-qa-foot">Open in editor to answer</span>`}
    </div>`).join('')
  const openCount = qaItems.filter(i => !i.answer).length
  const total = qaItems.length
  const headLabel = openCount > 0
    ? `${openCount} open ${openCount === 1 ? 'question' : 'questions'}`
    : `${total} ${total === 1 ? 'question' : 'questions'}`
  const chipClass = openCount > 0 ? 'md-chip md-chip-primary' : 'md-chip'
  return `
    <section class="md-qa" id="qa" aria-labelledby="qa-head">
      <div class="md-qa-head" id="qa-head">
        <span>Questions</span>
        <span class="${chipClass}">${escapeHtml(headLabel)}</span>
      </div>
      ${items}
    </section>`
}

// Material-style trailing arrow (chevron-right) for tile cards.
const TILE_ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'

function renderTileGrid(indexLinks) {
  if (!indexLinks || indexLinks.length === 0) return ''
  const tiles = indexLinks.map(({ name, href, blurb, iconName }) => `
    <li class="md-tile">
      <a class="md-tile-link" href="${escapeHtml(href)}">
        <div class="md-tile-number">
          <span aria-hidden="true"></span>
          ${iconName ? `<span class="md-tile-icon">${iconSvg(iconName)}</span>` : ''}
        </div>
        <div class="md-tile-name">${escapeHtml(name)}</div>
        ${blurb ? `<div class="md-tile-blurb">${escapeHtml(blurb)}</div>` : ''}
        <div class="md-tile-trail">
          <span>Open</span>
          <span class="md-arrow">${TILE_ARROW_SVG}</span>
        </div>
      </a>
    </li>`).join('')
  return `<ul class="md-tile-grid" role="list">${tiles}</ul>`
}

function renderRail(headLabel, items, currentName) {
  if (!items || items.length === 0) return ''
  const listItems = items.map(({ name, href }) => {
    const isCurrent = currentName && name === currentName
    return `<li><a href="${escapeHtml(href)}"${isCurrent ? ' class="current" aria-current="page"' : ''}>${escapeHtml(name)}</a></li>`
  }).join('')
  return `<nav class="md-rail" aria-label="${escapeHtml(headLabel)}">
    <div class="md-rail-head">${escapeHtml(headLabel)}</div>
    <ul class="md-rail-list">${listItems}</ul>
  </nav>`
}

function shellHtml({
  chromeSig, segments, title, titleIconName, lede, body,
  qaItems, indexLinks,
  leftRails = [],   // [{ heading, items: [{ name, href }], currentName? }, ...]
  rightRails = [],  // additional rails to render in the right column (e.g. cross-links)
}) {
  const breadcrumb = breadcrumbHtml(segments)
  const qaHtml = renderQaSection(qaItems)
  const tilesHtml = renderTileGrid(indexLinks)

  const leftHtml = leftRails
    .map(r => renderRail(r.heading, r.items, r.currentName))
    .filter(Boolean)
    .join('')

  const extraRightHtml = rightRails
    .map(r => renderRail(r.heading, r.items, r.currentName))
    .filter(Boolean)
    .join('')

  const footerLabel = segments.length
    ? segments.map(s => s.replace(/-/g, ' ')).join(' · ')
    : 'relational intelligence'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Relational Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block">
<script>${PAINT_SCRIPT}</script>
<link rel="stylesheet" href="resource:${chromeSig}/chrome.css">
</head>
<body>
<main>
  <header class="md-top-bar">
    <nav>${breadcrumb}</nav>
    <button id="themeToggle" type="button" class="md-icon-btn" aria-label="toggle theme">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.5a8 8 0 0 1-11.2-11.2 8 8 0 1 0 11.2 11.2z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>
    </button>
  </header>

  <aside class="md-aside-left">${leftHtml}</aside>

  <section class="md-content">
    <h1 class="md-headline">
      <span class="md-headline-icon">${iconSvg(titleIconName ?? 'leaf')}</span>
      <span class="md-headline-text">${escapeHtml(title)}</span>
    </h1>
    ${lede ? `<p class="md-lede">${escapeHtml(lede)}</p>` : ''}
    <hr class="md-divider">
    <div class="md-prose">${body}</div>
    ${qaHtml}
  </section>

  <aside class="md-aside-right">
    ${tilesHtml}
    ${extraRightHtml}
  </aside>

  <footer class="md-foot">${escapeHtml(footerLabel)}</footer>
</main>
<script>${TOGGLE_SCRIPT}</script>
</body>
</html>`
}

// ─── per-cell metadata ──────────────────────────────────────────────

const BRANCH_META = {
  model: {
    title: 'The Model',
    lede: 'The conceptual core: vision, philosophy, the four pillars, and the relational capacities that develop. The thesis that relating well is an intelligence — nameable, trainable.',
    summary: 'Relational Intelligence as a learnable capacity, not a personality trait. Pillars, capacities, frameworks.',
  },
  practice: {
    title: 'The Practice',
    lede: 'How the model becomes lived experience — programs, events, trainings, certification. The bridge from idea to embodied skill.',
    summary: 'Programs, events, trainings, certification. Where the model meets a room.',
  },
  evidence: {
    title: 'The Evidence',
    lede: 'The proof: foundational science, applied research, academic partnerships, humanity outcomes, systemic change. Without research credibility, the work is opinion.',
    summary: 'Research credibility — foundational, applied, partnerships, outcomes, legacy.',
  },
  audience: {
    title: 'The Audience',
    lede: 'Who this is for: individuals, couples, professionals, organizations, communities. Same underlying skill — different presenting concerns.',
    summary: 'Individuals, couples, professionals, organizations, communities.',
  },
  voice: {
    title: 'The Voice',
    lede: "Outward expression — podcast, writing, video, social, resources. How the work reaches people who haven't found it yet.",
    summary: 'Podcast, writing, video, social, resources — outward expression.',
  },
  network: {
    title: 'The Network',
    lede: 'The people around the work: collaborators, governance, engagement. Co-created, not solo.',
    summary: 'Collaborators, roles, governance, engagement — co-created.',
  },
  platform: {
    title: 'The Platform',
    lede: 'The tech infrastructure that hosts the practice — learning, community, practitioner tools, AI automation, integrations. A future-proof home for the field.',
    summary: 'Learning, community, practitioner tools, AI, integrations.',
  },
  business: {
    title: 'The Business',
    lede: 'How RI sustains itself: brand, operations, marketing, sales, client experience, growth phases. The discipline of running it well so the work can keep showing up.',
    summary: 'Brand, operations, marketing, sales, client experience, growth phases.',
  },
}

const BRANCH_ORDER = ['model', 'practice', 'evidence', 'audience', 'voice', 'network', 'platform', 'business']

// ─── renderers ──────────────────────────────────────────────────────

function renderRoot(tree, chromeSig) {
  const branches = (tree.children || []).filter(c => BRANCH_META[c.name])
  branches.sort((a, b) => BRANCH_ORDER.indexOf(a.name) - BRANCH_ORDER.indexOf(b.name))

  const indexLinks = branches.map(b => ({
    name: BRANCH_META[b.name].title.replace(/^The /, ''),
    href: `${b.name}/`,
    blurb: BRANCH_META[b.name].summary,
    iconName: b.name,
  }))

  // Compact body — single paragraph for zero-scroll. The lede already
  // sets up the "field, not a feeling" angle; the body adds one beat.
  const body = `
    <p>This is the field — its model, its practice, its evidence, and the people building it together. Each branch below is its own self-contained area; together they hold the whole.</p>
  `

  // Left rail at root surfaces the same branches as a flat list so the
  // user can hop sideways without going through the tile grid. Mirrors
  // the right-column tile cards but in compact-link form.
  const leftRails = [
    {
      heading: 'Branches',
      items: branches.map(b => ({
        name: BRANCH_META[b.name].title.replace(/^The /, ''),
        href: `${b.name}/`,
      })),
    },
    {
      heading: 'Tools',
      items: [{ name: 'Dashboard', href: '/dashboard/' }],
    },
  ]

  return shellHtml({
    chromeSig,
    segments: ['dolphin'],
    title: 'Relating well is an intelligence — name it, train it, live it.',
    titleIconName: 'root',
    lede: 'A field, not a feeling — the model, the practice, the evidence, and the people building it together.',
    body,
    qaItems: parseQaSlot(tree),
    indexLinks,
    leftRails,
  })
}

function renderBranch(branch, chromeSig, tree) {
  const meta = BRANCH_META[branch.name]
  const segments = ['dolphin', branch.name]
  const notes = uniqueNotes(branch.notes)

  // Compact body — top 2 notes for zero-scroll, the lede already sets
  // up the section's premise.
  let body
  if (notes.length === 0) {
    body = `<p>This area is being scoped. The shape is named; the depth is still being written.</p>`
  } else {
    body = notes.slice(0, 2).map(n => `<p>${escapeHtml(n)}</p>`).join('')
  }

  const indexLinks = (branch.children || []).map(child => {
    const childNotes = uniqueNotes(child.notes)
    const blurb = childNotes[0] || ''
    return {
      name: titleCase(child.name),
      href: `${child.name}/`,
      blurb: blurb.length > 90 ? blurb.slice(0, 87) + '…' : blurb,
      iconName: 'leaf',
    }
  })

  // Left rail = lateral nav across all 8 branches with current one
  // highlighted. Gives the reader a clear "where am I" + 1-click hops
  // to siblings, per /instructions/layout cross-linking doctrine.
  const allBranches = (tree?.children || []).filter(c => BRANCH_META[c.name])
  allBranches.sort((a, b) => BRANCH_ORDER.indexOf(a.name) - BRANCH_ORDER.indexOf(b.name))
  const branchTitle = meta.title.replace(/^The /, '')
  const leftRails = [
    {
      heading: 'Branches',
      items: allBranches.map(b => ({
        name: BRANCH_META[b.name].title.replace(/^The /, ''),
        href: b.name === branch.name ? './' : `../${b.name}/`,
      })),
      currentName: branchTitle,
    },
  ]

  return shellHtml({
    chromeSig,
    segments,
    title: meta.title,
    titleIconName: branch.name,
    lede: meta.lede,
    body,
    qaItems: parseQaSlot(branch),
    indexLinks,
    leftRails,
  })
}

function renderLeaf(leaf, branchName, chromeSig, branchNode, tree) {
  const segments = ['dolphin', branchName, leaf.name]
  const notes = uniqueNotes(leaf.notes)
  const title = titleCase(leaf.name)
  const branchTitle = BRANCH_META[branchName]?.title?.replace(/^The /, '') ?? titleCase(branchName)

  // Promote "Heading: text" notes into Material 3 section cards. Bare
  // paragraphs render inline; structured notes become discrete cards
  // so the leaf reads as a tile composition rather than a wall of text.
  let body
  if (notes.length === 0) {
    body = `<p>This area is being scoped.</p>`
  } else if (notes.length === 1) {
    body = `<p>${escapeHtml(notes[0])}</p>`
  } else {
    body = notes.map(n => {
      const m = /^([^:]{2,40}):\s*(.+)$/.exec(n)
      if (m) {
        return `<section class="md-section">
          <h2><span class="md-section-icon">${iconSvg(branchName)}</span><span>${escapeHtml(m[1].trim())}</span></h2>
          <p>${escapeHtml(m[2].trim())}</p>
        </section>`
      }
      return `<p>${escapeHtml(n)}</p>`
    }).join('')
  }

  // Left rail = sibling leaves under the same branch. Current leaf is
  // highlighted. Lateral hops within the section without going up to
  // the branch page first.
  const siblings = (branchNode?.children || []).map(s => ({
    name: titleCase(s.name),
    href: s.name === leaf.name ? './' : `../${s.name}/`,
  }))
  const leftRails = [
    {
      heading: branchTitle,
      items: siblings,
      currentName: title,
    },
  ]

  // Leaves have no children, so the right column's tile grid would be
  // empty. Surface cross-links to other branches' parallel sections
  // instead — gives the reader a way to jump laterally across the tree
  // without going back to root, per /instructions/layout cross-linking.
  const allBranches = (tree?.children || []).filter(c => BRANCH_META[c.name] && c.name !== branchName)
  allBranches.sort((a, b) => BRANCH_ORDER.indexOf(a.name) - BRANCH_ORDER.indexOf(b.name))
  const crossLinks = allBranches.slice(0, 6).map(b => ({
    name: BRANCH_META[b.name].title.replace(/^The /, ''),
    href: `../../${b.name}/`,
  }))
  const rightRails = crossLinks.length > 0
    ? [{ heading: 'Other branches', items: crossLinks }]
    : []

  return shellHtml({
    chromeSig,
    segments,
    title,
    titleIconName: branchName,
    lede: `Part of ${branchTitle}.`,
    body,
    qaItems: parseQaSlot(leaf),
    indexLinks: [],
    leftRails,
    rightRails,
  })
}

function renderDashboard({ chromeSig, qaItems }) {
  const segments = ['dashboard']
  const indexLinks = qaItems.map(({ path, question }) => ({
    name: '/' + path.join('/'),
    href: '/' + path.join('/') + '/',
    blurb: question.length > 130 ? question.slice(0, 127) + '…' : question,
    iconName: BRANCH_META[path[1]] ? path[1] : 'leaf',
  }))

  const body = qaItems.length === 0
    ? `<p>No open questions right now. As pages get built and Claude needs your input, items will surface here for fast review.</p>`
    : `<p>Open questions surfaced from the current revision. Each links to the cell that’s waiting on you. Answer in the cell’s notes; Claude resumes from there.</p>`

  return shellHtml({
    chromeSig,
    segments,
    title: 'Dashboard',
    titleIconName: 'dashboard',
    lede: 'Open questions across the revision. One place to navigate the work that’s waiting on you.',
    body,
    indexHeadingTitle: qaItems.length > 0 ? 'Open questions' : '',
    indexHeadingIconName: 'leaf',
    indexLinks,
  })
}

// ─── main ───────────────────────────────────────────────────────────

// ─── instructions/styles decisions (committed each run so they persist) ─

// Pin the concrete design decisions back to /instructions/styles as
// notes so any future regen reads them as rules. Idempotent-by-text:
// the script checks existing notes and skips identical ones.
const STYLE_DECISIONS = [
  '[design] Color palette — dark mode: ink #0c1622, paper #e8e2d6, accent #7eb6d6 (ocean light), rule rgba(232,226,214,0.14). Light mode: cream #f5ede0, ink #1a1f2c, accent #1f4376 (deep ocean), rule rgba(26,31,44,0.16). Codegen reads these via CSS custom properties on :root + [data-theme="light"] override.',
  '[design] Typography — display + body: serif (Source Serif 4 → Iowan Old Style → Georgia → Times New Roman). UI sans only for the eyebrow tag and the index numbering. Headline scale: clamp(1.75rem, 4.6vw, 2.85rem). Body 1.04rem at line-height 1.7. Lede clamp(1.1rem, 1.6vw, 1.22rem).',
  '[design] Layout — single-column, max-width 38rem, centered. Body padding: clamp(2.5rem, 6vw, 5rem) top / clamp(1rem, 4vw, 2rem) sides / 5rem bottom. Main grid gap 2.6rem between major sections.',
  '[design] Branch icons — Model=concentric-circle, Practice=figure-with-arc, Evidence=document-with-lines, Audience=people-grouped, Voice=microphone, Network=connected-nodes, Platform=stacked-layers, Business=building. Root=field-disk-with-rings. Leaf default=small-disk. Dashboard=four-rect-grid. All stroke-only line SVGs, 1.4-1.5 stroke-width, rendered at 1em square in heading.',
  '[design] Numbered index — children listed as `<ol class="fn-index">` with decimal-leading-zero counters. Each item: name (serif, 1.18rem) + one-line blurb (serif, 0.99rem, muted). Underline-on-hover via text-decoration-color accent. Slight translateX(2px) on hover for kinetic affordance.',
]

async function pinStyleDecisions() {
  console.log('0) Pinning style decisions to /instructions/styles...')
  // Read existing notes; skip texts that already exist verbatim.
  const inf = await withRenderer({ op: 'inflate', segments: ['instructions', 'styles'] })
  const existingTexts = new Set()
  if (inf.ok) {
    for (const n of inf.data?.notes || []) {
      const t = noteText(n).trim()
      if (t) existingTexts.add(t)
    }
  }
  let added = 0
  for (const text of STYLE_DECISIONS) {
    if (existingTexts.has(text)) continue
    const r = await withRenderer({
      op: 'note-add',
      cell: 'styles',
      segments: ['instructions'],
      text,
    })
    if (r.ok) added++
    else console.log(`   FAILED to add: ${r.error}`)
  }
  console.log(`   ${added} new note(s) added (${existingTexts.size} already present, skipped)`)
}

;(async () => {
  await pinStyleDecisions()

  console.log('1) Reading dolphin tree...')
  const tree = await withRenderer({ op: 'inflate', segments: ['dolphin'] })
  if (!tree.ok) { console.log('   FAILED:', tree.error); process.exit(1) }
  const branchCount = (tree.data.children || []).filter(c => BRANCH_META[c.name]).length
  let leafCount = 0
  for (const b of tree.data.children || []) leafCount += (b.children || []).length
  console.log(`   ${branchCount} branches, ${leafCount} leaves`)

  console.log('2) Minting chrome.css...')
  const chromeMint = await withRenderer({ op: 'put-resource', text: CHROME_CSS })
  if (!chromeMint.ok) { console.log('   FAILED:', chromeMint.error); process.exit(1) }
  const chromeSig = chromeMint.data.sig
  console.log(`   sig=${chromeSig.slice(0, 12)} (${CHROME_CSS.length} bytes)`)

  let stamped = 0, failed = 0

  async function mintAndStamp(segments, html) {
    const put = await withRenderer({ op: 'put-resource', text: html })
    if (!put.ok) {
      console.log(`   FAILED to mint /${segments.join('/')}: ${put.error}`)
      failed++; return null
    }
    const sig = put.data.sig
    const set = await withRenderer({ op: 'bag-set', segments, cells: [sig] })
    if (!set.ok) {
      console.log(`   FAILED to stamp /${segments.join('/')}: ${set.error}`)
      failed++; return null
    }
    console.log(`   /${segments.join('/')} → ${sig.slice(0, 12)} (${html.length}B)`)
    stamped++
    return sig
  }

  console.log('3) Stamping root...')
  await mintAndStamp(['dolphin'], renderRoot(tree.data, chromeSig))

  console.log('4) Stamping branches...')
  for (const branch of tree.data.children || []) {
    if (!BRANCH_META[branch.name]) continue
    await mintAndStamp(['dolphin', branch.name], renderBranch(branch, chromeSig, tree.data))
  }

  console.log('5) Stamping leaves...')
  for (const branch of tree.data.children || []) {
    if (!BRANCH_META[branch.name]) continue
    for (const leaf of branch.children || []) {
      await mintAndStamp(['dolphin', branch.name, leaf.name], renderLeaf(leaf, branch.name, chromeSig, branch, tree.data))
    }
  }

  console.log('6) Pushing Q&A items into the `qa` slot (decorations, not notes)...')
  const qaItems = [
    { path: ['dolphin'], question: 'Primary CTA — book a session, podcast subscribe, register for next event, or something else? This determines the root page’s call-to-action.' },
    { path: ['dolphin', 'practice', 'certification'], question: 'Is the certification program live and accepting applicants, or is this aspirational structure for the site to communicate the long-term plan?' },
    { path: ['dolphin', 'business', 'sales'], question: 'Same question — is sales an active operation, or is this section roadmap-stage for now?' },
  ]
  // Each Q is its own content-addressed resource; the cell's `qa`
  // slot collects their sigs. bag-set replaces the slot wholesale so
  // re-runs don't duplicate (same Q content → same sig → same array).
  for (const { path, question } of qaItems) {
    const qId = require('crypto').createHash('sha256').update(path.join('/') + ':' + question).digest('hex').slice(0, 16)
    // No askedAt in the payload — keeps the resource content stable
    // across runs so bag-set is idempotent (same content → same sig).
    const payload = JSON.stringify({ qId, question })
    const put = await withRenderer({ op: 'put-resource', text: payload })
    if (!put.ok) { console.log(`   FAILED mint Q for /${path.join('/')}: ${put.error}`); continue }
    const qSig = put.data.sig
    const r = await withRenderer({ op: 'bag-set', segments: path, slot: 'qa', cells: [qSig] })
    if (r.ok) console.log(`   /${path.join('/')} ← Q ${qSig.slice(0, 12)}`)
    else console.log(`   FAILED bag-set qa on /${path.join('/')}: ${r.error}`)
  }

  console.log('7) Creating /dashboard cell...')
  const dashboardHtml = renderDashboard({ chromeSig, qaItems })
  const dashPut = await withRenderer({ op: 'put-resource', text: dashboardHtml })
  if (!dashPut.ok) { console.log('   FAILED dashboard mint:', dashPut.error); process.exit(1) }
  const dashboardSig = dashPut.data.sig
  // Use update to create dashboard cell at root if it doesn't exist, then bag-set the context.
  const dashUpdate = await withRenderer({
    op: 'update',
    segments: ['dashboard'],
    layer: { name: 'dashboard' },
  })
  if (!dashUpdate.ok && !/already|exists/i.test(String(dashUpdate.error || ''))) {
    console.log(`   note: dashboard update returned: ${dashUpdate.error}`)
  }
  const dashSet = await withRenderer({ op: 'bag-set', segments: ['dashboard'], cells: [dashboardSig] })
  if (dashSet.ok) console.log(`   /dashboard → ${dashboardSig.slice(0, 12)}`)
  else console.log(`   FAILED dashboard stamp: ${dashSet.error}`)

  console.log(`\nDone. chrome=${chromeSig.slice(0, 12)}, ${stamped} pages stamped, ${failed} failed.`)
  console.log('Refresh the dev shell to see the new revision (or navigate away + back).')
})().catch(err => { console.error('FATAL:', err); process.exit(1) })
