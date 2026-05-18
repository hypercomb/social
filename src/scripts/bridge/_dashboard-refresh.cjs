// Refresh the /dashboard cell with the current open Q&A across the
// tree. Reads `kind: 'qa'` optimizations from `__optimization__/`
// (the single source of truth — layer's `qa` slot is retired) and
// generates a dashboard page that renders each open Q as a card
// with an inline answer composer.
//
// One child cell is minted under /dashboard per open Q so the hex
// grid shows pending work spatially. Clicking a child tile in the
// hex grid does NOT navigate — `DashboardQOpenWorker` (in
// essentials/diamondcoreprocessor.com/dashboard) intercepts the
// `tile:action open` effect, looks up the matching
// `dashboard-q-binding` optimization, and opens `QaModalView` — a
// shell-level DOM modal that holds the question and an answer
// composer. The modal works in hexagons mode too; it isn't tied to
// the website-mode HTML overlay. The rendered dashboard HTML's
// inline-card composer is the same flow surfaced for users in
// website mode.
//
// The dashboard is the answer location; we never leave it to "go
// visit" the source cell. Answering mints a `kind: 'qa-answer'`
// optimization (decoration, layer untouched) and removes the
// original `kind: 'qa'`. The next codegen pass reads `qa-answer`
// items, interprets each, and (if warranted) writes a note via the
// state-machine `update(layer)` path as Claude's instruction-form
// interpretation. The user's raw answer never becomes a note
// directly.
//
// Also writes an "intel manifest" — a JSON resource that records
// what this run saw (tree roots walked, Qs total/answered/open, Q
// references with paths). The manifest sig sits as a second entry
// in the /dashboard cell's `context` slot, after the HTML render —
// site-view.drone picks the first HTML-shaped resource for paint,
// so the JSON manifest is harmless for rendering but discoverable
// by subsequent Claude runs as carry-forward context.
//
// Usage:
//   node scripts/bridge/_dashboard-refresh.cjs
//
// Requires the bridge server on :2401 with a connected renderer
// (dev shell at :4250 with claudeBridge enabled).

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'

// ─── bridge plumbing ────────────────────────────────────────────────

let counter = 0
const nextId = () => `dash-${Date.now()}-${++counter}`

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
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

// ─── Q&A source: `__optimization__/` only ──────────────────────────
//
// Q&A is decoration (per `feedback_layer_purity_optimizations_external.md`)
// — it never touches a cell's layer slot. Open questions live as
// `kind: 'qa'` optimizations in OPFS `__optimization__/`, keyed to
// the tile owner via `appliesTo: [...cellPath]`. Answered questions
// become `kind: 'qa-answer'` optimizations (same shape + answer text)
// and the original `kind: 'qa'` is removed. The next codegen pass
// (e.g. `_dolphin-revision.cjs`) reads `qa-answer` items, interprets
// each, optionally writes a note via the state-machine path, and
// removes the optimization once handled.
//
// One source of truth. Dashboard only reflects.

// ─── chrome — reuse the existing Field Notes stylesheet ─────────────

// Kept in sync with the chrome minted by `_dolphin-revision.cjs`. Same
// content → same content-addressed sig, so when the dolphin generator
// runs, the chrome sig only changes if its CSS actually changed.
const CHROME_SIG = '2eda51ad62e1846e9811c2bf8319461d58104c5fe25e467c6986f3fecf8b877c'

const PAINT_SCRIPT = `
(function(){try{var t=localStorage.getItem('hc:dolphin:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(_){};})();
`.trim()

const TOGGLE_SCRIPT = `
(function(){var b=document.getElementById('themeToggle');if(!b)return;function c(){var t=document.documentElement.getAttribute('data-theme');if(t==='light'||t==='dark')return t;return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}function a(t){document.documentElement.setAttribute('data-theme',t);try{localStorage.setItem('hc:dolphin:theme',t);}catch(_){};}b.addEventListener('click',function(){a(c()==='light'?'dark':'light');});})();
`.trim()

// In-page answer pipeline. The dashboard cell page is mounted inline by
// site-view.drone (no iframe, no shadow DOM), so the script runs in the
// shell's JS context and `window.ioc` reaches every registered service
// directly. Clicking a card's Done button:
//   1. Reads the answer text from the textarea.
//   2. Mints a `kind: 'qa-answer'` optimization pairing the question
//      with the raw answer text via `Store.putOptimization` — pure
//      decoration, layer untouched.
//   3. Removes the original `kind: 'qa'` optimization via
//      `Store.removeOptimization` so the open question disappears
//      from the dashboard's next refresh and from any other surface
//      that reads the optimization substrate.
//   4. Marks the card answered in the UI (button → "answered ✓", inputs
//      disabled, card dimmed) — no full reload required.
//
// Notes are NOT written here. The user's raw answer is decoration,
// not canonical content. The next codegen pass reads `qa-answer`
// items, interprets each, and (if warranted) writes a note via the
// state-machine `update(layer)` path as Claude's instruction-form
// interpretation. The `qa-answer` is cleaned up once handled.
const ANSWER_SCRIPT = `
(function(){
  function getSvc(key){ try { return window.ioc && window.ioc.get && window.ioc.get(key); } catch(_) { return null; } }
  function setStatus(card, msg, isErr){
    var s = card.querySelector('.dash-q-status');
    if (s) { s.textContent = msg || ''; s.classList.toggle('is-err', !!isErr); }
  }
  function openCard(card){
    if (!card || card.classList.contains('dash-q-answered')) return;
    var alreadyOpen = card.classList.contains('is-open');
    card.classList.add('is-open');
    if (!alreadyOpen) {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(_) {}
      var input = card.querySelector('.dash-q-input');
      if (input) setTimeout(function(){ try { input.focus(); } catch(_){} }, 100);
    }
  }
  // Toggle-on-click: each card starts collapsed (just path + question
  // preview). Clicking the card body (anywhere outside the composer or
  // the Done button) toggles is-open. Multiple cards can be open at
  // once so the user can answer en masse without losing context.
  // Clicks inside the composer (textarea + Done button) never toggle
  // — they're for entering / submitting the answer.
  document.querySelectorAll('.dash-q-card').forEach(function(card){
    card.addEventListener('click', function(e){
      if (e.target.closest('.dash-q-compose')) return;
      if (e.target.closest('.dash-q-done')) return;
      if (e.target.closest('a')) return;
      if (card.classList.contains('dash-q-answered')) return;
      var willOpen = !card.classList.contains('is-open');
      card.classList.toggle('is-open');
      if (willOpen) {
        var input = card.querySelector('.dash-q-input');
        if (input) setTimeout(function(){ input.focus(); }, 50);
      }
    });
  });
  // Hex-grid tile click → open the matching card inline. The /dashboard
  // cell has one child per open Q (computed at render time), and the
  // mapping label→qId is embedded as window.__hcDashboardLabelToQ.
  // Subscribing to 'tile:action' on the global EffectBus is how we
  // catch a leaf-tile click without taking over the normal click flow:
  // LinkOpenWorker also subscribes to the same effect and no-ops when
  // the tile has no link (which is now the case for dashboard children
  // — we no longer stamp a link to keep clicks from spawning a new
  // tab). The dashboard cell may be re-mounted during a session, so
  // stash the unsub on window and tear down the previous subscription
  // before adding a new one to avoid stacked listeners.
  try {
    if (typeof window.__hcDashboardOpenQUnsub === 'function') {
      try { window.__hcDashboardOpenQUnsub(); } catch(_) {}
    }
    window.__hcDashboardOpenQUnsub = null;
    var bus = (typeof globalThis !== 'undefined' && globalThis.__hypercombEffectBus) || null;
    if (bus && typeof bus.on === 'function') {
      window.__hcDashboardOpenQUnsub = bus.on('tile:action', function(payload){
        if (!payload || payload.action !== 'open') return;
        var label = payload.label;
        var map = window.__hcDashboardLabelToQ || {};
        var qId = map[label];
        if (!qId) return;
        var card = document.querySelector('.dash-q-card[data-q-id="' + qId + '"]');
        openCard(card);
      });
    }
  } catch (err) {
    console.warn('[dashboard] tile:action subscribe failed', err);
  }
  document.querySelectorAll('.dash-q-card').forEach(function(card){
    var btn = card.querySelector('.dash-q-done');
    var input = card.querySelector('.dash-q-input');
    if (!btn || !input) return;
    btn.addEventListener('click', async function(){
      var text = (input.value || '').trim();
      if (!text) { setStatus(card, 'type an answer first', true); input.focus(); return; }
      var qId = card.dataset.qId || '';
      var sig = card.dataset.qSig || '';
      var question = card.dataset.qQuestion || '';
      var path;
      try { path = JSON.parse(card.dataset.qPath || '[]'); } catch(_) { path = []; }
      if (!Array.isArray(path) || path.length === 0) { setStatus(card, 'missing cell path', true); return; }
      var store = getSvc('@hypercomb.social/Store');
      if (!store || typeof store.putOptimization !== 'function') {
        setStatus(card, 'optimization store unavailable', true); return;
      }
      btn.disabled = true; input.disabled = true; setStatus(card, 'recording answer…');
      try {
        // Mint a kind:'qa-answer' optimization pairing question +
        // raw user answer. The next codegen pass reads this, decides
        // whether the answer warrants a note (Claude's interpretation,
        // not the raw text), and cleans it up. Layer is untouched —
        // Q&A is pure decoration.
        var answer = {
          kind: 'qa-answer',
          appliesTo: path,
          payload: {
            qId: qId,
            qSig: sig,
            question: question,
            answer: text,
            answeredAt: Date.now()
          },
          mark: 'persistent'
        };
        var blob = new Blob([JSON.stringify(answer)]);
        await store.putOptimization(blob);
        // Retire the open Q so the dashboard's next refresh drops it.
        if (sig && typeof store.removeOptimization === 'function') {
          try { await store.removeOptimization(sig); } catch(_) {}
        }
        card.classList.add('dash-q-answered');
        btn.textContent = 'answered ✓';
        setStatus(card, '');
      } catch (err) {
        btn.disabled = false; input.disabled = false;
        setStatus(card, 'failed: ' + (err && err.message ? err.message : 'unknown'), true);
      }
    });
  });
})();
`.trim()

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])

// Trailing arrow svg (kept in sync with dolphin-revision's TILE_ARROW_SVG).
const TILE_ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
const HELP_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>'
const DASHBOARD_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.2"/><rect x="13" y="3" width="8" height="5" rx="1.2"/><rect x="13" y="10" width="8" height="11" rx="1.2"/><rect x="3" y="13" width="8" height="8" rx="1.2"/></svg>'

function renderDashboard({ openItems, answeredCount, totalCount, manifestSigPreview, labelToQId }) {
  // Each open Q becomes a Material 3 elevated tile card with an INLINE
  // answer composer — type, click Done, the answer commits to the
  // source cell's lineage and the qa entry disappears from the
  // dashboard. Data attrs carry everything the in-page script needs
  // to dispatch the right writes; the answer pipeline runs entirely
  // in the renderer's JS context (cell pages are mounted inline, so
  // window.ioc is reachable directly — no postMessage / iframe).
  //
  // The `id="q-<qId>"` on each `<li>` is the scroll target when a
  // hex-grid child tile is clicked: the ANSWER_SCRIPT looks up the
  // qId from the label→qId map embedded below, finds the matching
  // card, and scrolls/focuses it. No new tab, no navigation.
  const tiles = openItems.map(({ path, question, qId, sig }) => {
    const pathStr = '/' + path.join('/')
    return `
    <li class="md-tile dash-q-card"
        id="q-${escapeHtml(qId)}"
        data-q-id="${escapeHtml(qId)}"
        data-q-path="${escapeHtml(JSON.stringify(path))}"
        data-q-sig="${escapeHtml(sig || '')}"
        data-q-question="${escapeHtml(question)}">
      <div class="md-tile-link" style="cursor:default">
        <div class="md-tile-number">
          <span aria-hidden="true"></span>
          <span class="md-tile-icon">${HELP_ICON_SVG}</span>
        </div>
        <div class="md-tile-name dash-q-source">${escapeHtml(pathStr)}</div>
        <div class="md-tile-blurb">${escapeHtml(question.length > 320 ? question.slice(0, 317) + '…' : question)}</div>
        <div class="dash-q-compose">
          <textarea class="dash-q-input" rows="2" placeholder="type your answer…"
                    aria-label="answer for ${escapeHtml(qId)}"></textarea>
          <button type="button" class="dash-q-done">Done</button>
        </div>
        <div class="dash-q-status" aria-live="polite"></div>
      </div>
    </li>`
  }).join('')

  // JSON-safe embed of the label→qId mapping. Closing `</script>` in
  // any qId would break out of the `<script>` block; replace `<` with
  // its unicode escape so the embedded string is opaque to the HTML
  // parser. The map is plain ASCII hex in practice (qIds are
  // signature prefixes / generated ids), but the escape is cheap and
  // future-proof.
  const labelMapJson = JSON.stringify(labelToQId || {}).replace(/</g, '\\u003c')

  const body = openItems.length === 0
    ? `<p>No open questions right now. ${answeredCount} of ${totalCount} answered. As Claude needs input, items will surface here.</p>`
    : `<p>${openItems.length} open question${openItems.length === 1 ? '' : 's'} across the revision — ${answeredCount}/${totalCount} answered. Type the answer in the card and click Done; the answer commits to the source cell and the question disappears. Use the path link to read more context before answering.</p>`

  const tilesBlock = openItems.length > 0
    ? `<ul class="md-tile-grid" role="list">${tiles}</ul>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Relational Intelligence</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block">
<script>${PAINT_SCRIPT}</script>
<link rel="stylesheet" href="resource:${CHROME_SIG}/chrome.css">
<style>
.dash-q-card { display: flex; cursor: pointer; transition: box-shadow .15s ease, border-color .15s ease, transform .15s ease; }
.dash-q-card:hover:not(.is-open):not(.dash-q-answered) { transform: translateY(-1px); }
.dash-q-card.is-open { cursor: default; box-shadow: var(--md-elev-3); border-color: var(--md-primary); }
.dash-q-card .md-tile-link { display: flex; flex-direction: column; gap: 0.55rem; width: 100%; }
.dash-q-card .md-tile-name a { color: inherit; opacity: 0.72; text-decoration: none; font-size: 0.78rem; letter-spacing: 0.04em; }
.dash-q-card .md-tile-name a:hover { opacity: 1; text-decoration: underline; }
.dash-q-card .md-tile-blurb {
  padding: 0.55rem 0.7rem;
  background: rgba(255, 225, 74, 0.14);
  border: 1px solid rgba(255, 225, 74, 0.32);
  border-left-width: 3px;
  border-radius: 4px 6px 6px 4px;
  color: inherit;
  font-size: 0.95rem;
  line-height: 1.45;
}
/* Compose UI hidden until the user clicks the card to open it. Multiple
 * cards can be open at once for en-masse answering — the toggle is per-
 * card and clicking the textarea / Done button never collapses it. */
.dash-q-compose {
  display: none;
  align-items: stretch;
  gap: 0.45rem;
  padding: 0.45rem 0.55rem;
  background: rgba(110, 180, 255, 0.07);
  border: 1px solid rgba(110, 180, 255, 0.22);
  border-left-width: 3px;
  border-radius: 4px 6px 6px 4px;
}
.dash-q-card.is-open .dash-q-compose { display: flex; }
.dash-q-card.is-open .dash-q-status:empty { display: none; }
.dash-q-card:not(.is-open) .dash-q-status:empty { display: none; }
.dash-q-input {
  flex: 1; min-width: 0; resize: vertical; min-height: 2.4rem;
  font: inherit; padding: 0.4rem 0.55rem; line-height: 1.45;
  background: rgba(0, 0, 0, 0.18); color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
}
.dash-q-done {
  flex-shrink: 0; align-self: flex-end;
  padding: 0.4rem 1.1rem; cursor: pointer;
  background: rgba(110, 180, 255, 0.22);
  border: 1px solid rgba(110, 180, 255, 0.50);
  border-radius: 6px;
  color: #d4e6ff; font-weight: 600; letter-spacing: 0.02em;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dash-q-done:hover:not(:disabled) {
  background: rgba(110, 180, 255, 0.34); border-color: rgba(110, 180, 255, 0.7);
}
.dash-q-done:disabled { opacity: 0.6; cursor: default; }
.dash-q-status { min-height: 1.1em; font-size: 0.78rem; opacity: 0.7; }
.dash-q-status.is-err { color: #ff9b9b; opacity: 1; }
.dash-q-answered { opacity: 0.55; }
.dash-q-answered .dash-q-compose { background: rgba(110, 180, 255, 0.14); }
</style>
</head>
<body>
<main>
  <header class="md-top-bar">
    <nav><b>Dashboard</b></nav>
    <button id="themeToggle" type="button" class="md-icon-btn" aria-label="toggle theme">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.5a8 8 0 0 1-11.2-11.2 8 8 0 1 0 11.2 11.2z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>
    </button>
  </header>

  <h1 class="md-headline">
    <span class="md-headline-icon">${DASHBOARD_ICON_SVG}</span>
    <span class="md-headline-text">Dashboard</span>
  </h1>
  <p class="md-lede">${openItems.length === 0 ? 'No open questions across the revision.' : `${openItems.length} open · ${answeredCount}/${totalCount} answered.`}</p>

  <hr class="md-divider">

  <div class="md-prose">${body}</div>

  ${tilesBlock}

  <footer class="md-foot">${openItems.length} open · ${answeredCount}/${totalCount} answered · intel ${escapeHtml(manifestSigPreview)}</footer>
</main>
<script>${TOGGLE_SCRIPT}</script>
<script>window.__hcDashboardLabelToQ = ${labelMapJson};</script>
<script>${ANSWER_SCRIPT}</script>
</body>
</html>`
}

// ─── main ───────────────────────────────────────────────────────────

;(async () => {
  console.log('1) Listing open Q optimizations from __optimization__/...')
  const allItems = []
  const opts = await withRenderer({ op: 'optimization-list', kind: 'qa' })
  if (opts.ok && Array.isArray(opts.data?.items)) {
    const optItems = opts.data.items
      .filter(o => o?.payload && typeof o.payload.question === 'string')
      .map(o => ({
        qId: o.payload.qId || o.sig?.slice(0, 16) || '',
        question: String(o.payload.question).trim(),
        answer: null,
        path: Array.isArray(o.appliesTo) ? o.appliesTo : [],
        sig: o.sig,
      }))
    if (optItems.length > 0) console.log(`   ${optItems.length} open Q`)
    allItems.push(...optItems)
  } else if (!opts.ok) {
    console.log(`   FAILED: ${opts.error}`); process.exit(1)
  }

  // Dedupe: same path + same question text counts as one row. The
  // optimization substrate is content-addressed so identical content
  // collapses to one sig already; this dedupe catches the edge case
  // where two `qa` records carry the same logical question with
  // different metadata (e.g. different `askedAt`).
  const seen = new Set()
  const openItems = []
  for (const item of allItems) {
    const key = item.path.join('/') + '\n' + item.question
    if (seen.has(key)) continue
    seen.add(key)
    openItems.push(item)
  }
  const answeredCount = 0  // open-Q optimizations are open-only; answered → `qa-answer` kind.
  console.log(`2) ${openItems.length} open Q${openItems.length === 1 ? '' : 's'}.`)

  // Compute one child cell label per open Q. The dashboard cell is drillable
  // in the hex grid — drilling reveals a tile for each open question, not an
  // empty cell. Label uses the source path's last segment (closest to the
  // user's mental model — "the question about certification lives at tile
  // 'certification'"), with a numeric suffix when multiple Qs share the same
  // source segment so every label is unique. The label→qId map is embedded
  // in the rendered HTML; the in-page script listens for tile clicks via the
  // global EffectBus and opens the matching card inline.
  const childLabels = []
  const labelCounts = new Map()
  const labelToQId = {}
  for (const item of openItems) {
    const base = (item.path.length === 0 ? 'root' : item.path[item.path.length - 1]) || 'q'
    const n = (labelCounts.get(base) ?? 0) + 1
    labelCounts.set(base, n)
    const label = n === 1 ? base : `${base}-${n}`
    childLabels.push(label)
    labelToQId[label] = item.qId
  }

  // 3) Build intel manifest first so we know its sig before rendering
  //    the dashboard footer.
  console.log('3) Minting intel manifest...')
  const manifest = {
    schemaVersion: 1,
    kind: 'dashboard-intel',
    generatedAt: new Date().toISOString(),
    chromeSig: CHROME_SIG,
    totals: { open: openItems.length, answered: 0 },
    open: openItems.map(({ qId, question, path }) => ({ qId, path, question })),
    answered: [],
    note: 'Carry-forward context for the next dashboard refresh. The reverse-name storage primitive is not yet wired through the bridge; for now this manifest sits as a sibling in /dashboard\'s context slot (after the HTML render).',
  }
  const manifestJson = JSON.stringify(manifest, null, 2)
  const manifestPut = await withRenderer({ op: 'put-resource', text: manifestJson })
  if (!manifestPut.ok) { console.log('   FAILED:', manifestPut.error); process.exit(1) }
  const manifestSig = manifestPut.data.sig
  console.log(`   manifest sig=${manifestSig.slice(0, 12)} (${manifestJson.length} bytes)`)

  console.log('4) Rendering dashboard HTML...')
  const html = renderDashboard({
    openItems,
    answeredCount,
    totalCount: allItems.length,
    manifestSigPreview: manifestSig.slice(0, 12),
    labelToQId,
  })
  const htmlPut = await withRenderer({ op: 'put-resource', text: html })
  if (!htmlPut.ok) { console.log('   FAILED:', htmlPut.error); process.exit(1) }
  const htmlSig = htmlPut.data.sig
  console.log(`   dashboard html sig=${htmlSig.slice(0, 12)} (${html.length} bytes)`)

  console.log('5) Updating /dashboard layer — context [html, manifest] + children for each open Q...')
  // One layer-as-primitive update preserves both slots in a single cascade.
  // Using `bag-set` here would only carry `context`, wiping `children` on
  // every refresh (and vice versa). `update` is the canonical surface for
  // multi-slot writes.
  //
  // No `link` property gets stamped on children any more. Tile clicks on
  // /dashboard's children are caught by the rendered page's ANSWER_SCRIPT
  // (which subscribes to `tile:action` on the global EffectBus) and resolved
  // inline against the embedded label→qId map. Clicking opens the matching
  // card inside /dashboard — no new tab, no navigation away from the
  // dashboard, no leaked URL with `%5B…%5D` brackets.
  const stamp = await withRenderer({
    op: 'update',
    segments: ['dashboard'],
    layer: {
      name: 'dashboard',
      context: [htmlSig, manifestSig],
      children: childLabels,
    },
  })
  if (!stamp.ok) { console.log('   FAILED:', stamp.error); process.exit(1) }
  console.log(`   /dashboard stamped — context = [${htmlSig.slice(0, 8)}…, ${manifestSig.slice(0, 8)}…], children = ${childLabels.length}`)

  // 6) Defensive: clear any leftover `link` on the current dashboard children.
  //    Earlier revisions of this script stamped link=`/source#q-<id>` so a
  //    hex-grid tile click would open the source cell in a new tab. We've
  //    moved off that pattern — clicks are caught inline by the dashboard
  //    page's ANSWER_SCRIPT via the EffectBus — but the children's `0000`
  //    files may still carry the old link string from those prior runs.
  //    LinkOpenWorker treats an empty-string link as "no link" and no-ops,
  //    so stamping `link: ''` is the right way to retire the old value
  //    without inventing a "delete-property" bridge op.
  if (childLabels.length > 0) {
    console.log('6) Clearing legacy `link` on dashboard children...')
    let cleared = 0
    for (const label of childLabels) {
      const res = await withRenderer({
        op: 'stamp',
        segments: ['dashboard', label],
        layer: { link: '' },
      })
      if (res.ok) cleared++
      else console.log(`   /${label}: ${res.error}`)
    }
    console.log(`   ${cleared}/${childLabels.length} legacy links cleared`)
  }

  // 7) Write one `dashboard-q-binding` optimization per child so the
  //    in-shell DashboardQOpenWorker can route hex-grid tile clicks to
  //    the QA modal. The binding's `appliesTo` is `['dashboard', label]`
  //    — the worker matches that against `[…explorerSegments, label]`
  //    on click, reads the payload, and hands it to QaModalView.show.
  //    Q&A lives in the optimization substrate per the layer-purity
  //    rule; cells' `0000` files stay clean.
  //
  //    Idempotency: we don't dedupe by content. Re-running the refresh
  //    just adds new binding records; stale ones are tolerated by the
  //    worker (it scans for the first appliesTo match). A periodic GC
  //    over `__optimization__/` can prune kind=`dashboard-q-binding`
  //    records whose qId is no longer present in the open-Q list —
  //    separate sweep, not this script's job.
  if (childLabels.length > 0) {
    console.log('7) Writing dashboard-q-binding optimizations...')
    let written = 0
    for (let i = 0; i < childLabels.length; i++) {
      const label = childLabels[i]
      const item = openItems[i]
      const binding = {
        kind: 'dashboard-q-binding',
        appliesTo: ['dashboard', label],
        payload: {
          qId: item.qId,
          qSig: item.sig || '',
          qPath: item.path,
          question: item.question,
        },
      }
      const res = await withRenderer({
        op: 'optimization-add',
        text: JSON.stringify(binding),
      })
      if (res.ok) written++
      else console.log(`   /${label}: ${res.error}`)
    }
    console.log(`   ${written}/${childLabels.length} bindings written`)
  }

  console.log('\nDone.')
  console.log(`  ${allItems.length} Q total, ${answeredCount} answered, ${openItems.length} still open.`)
  console.log(`  Dashboard URL: http://localhost:4250/dashboard`)
  console.log(`  Refresh the dev shell to load the new context.`)
  if (openItems.length > 0) {
    console.log('\nOpen Qs (click any tile on /dashboard to open its card inline):')
    for (let i = 0; i < openItems.length; i++) {
      const { path, question, qId } = openItems[i]
      const label = childLabels[i]
      const pathStr = path.length === 0 ? '/' : '/' + path.join('/')
      const preview = question.length > 70 ? question.slice(0, 67) + '…' : question
      console.log(`  /dashboard/${label}  (${pathStr}, q=${qId.slice(0, 8)}…)\n    ${preview}`)
    }
  }
})().catch(err => { console.error('FATAL:', err); process.exit(1) })
