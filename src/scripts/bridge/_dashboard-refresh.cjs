// Refresh the /dashboard cell with the current open Q&A across the
// tree. Walks every branch via `inflate`, pairs `[Q ...]` notes with
// their matching `[A:<qId>]` answers, filters to unanswered, and
// generates a dashboard page whose links use the path-bracket URL
// form (`/parent/[name]`) so clicking opens the editor for that
// tile with its notes visible (Phase 2 auto-open).
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

// ─── Q&A walk (reads the `qa` slot, not notes) ─────────────────────
//
// Q&A items live in a dedicated `qa` slot on each cell layer. The
// inflated layer surfaces it as an array of resource stubs (same shape
// as `context`). Each Q resource carries `{ qId, question, askedAt }`.
// Walks the tree, parses each cell's qa stubs, returns the open
// questions with their lineage path. "Open" is implicit: when a Q is
// answered, it's bag-removed from the qa slot, so anything still here
// is open.

function walkForQa(rootCell, basePath = []) {
  const items = []
  const visit = (cell, path) => {
    const here = cell.name ? [...path, cell.name] : path
    const slot = Array.isArray(cell.qa) ? cell.qa : []
    for (const item of slot) {
      if (!item || typeof item !== 'object') continue
      // inflate resolves the qa slot's resource sigs into JSON, so
      // entries arrive as `{ qId, question, ... }` objects directly.
      // Fallback to stub form for resilience.
      let q = (typeof item.question === 'string') ? item : null
      if (!q) {
        try { q = JSON.parse(item.$preview ?? '') } catch { /* ignore */ }
      }
      if (!q || typeof q.question !== 'string') continue
      items.push({
        qId: q.qId || item.$sig?.slice(0, 16) || String(items.length),
        question: q.question.trim(),
        answer: null,  // qa slot only carries OPEN Qs by design
        path: here,
        sig: item.$sig,
        source: 'qa-slot',
      })
    }
    for (const child of cell.children || []) visit(child, here)
  }
  visit(rootCell, basePath)
  return { items, answered: 0 }
}

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
//   1. Reads the answer text from the textarea
//   2. Calls NotesService.addAtSegments(parent, cell, '[A:<qId>] <text>')
//      — same upsert path user-typed notes use, so the merkle cascade,
//      `notes:changed` event, and Claude-visible note all happen.
//   3. If the source is the layer's `qa` slot, calls
//      LayerCommitter.commitSlotRemove(cellSegments, 'qa', sig) so the
//      question disappears from the dashboard's next refresh and from
//      the notes-strip's yellow-row surface immediately.
//   4. Marks the card answered in the UI (button → "answered ✓", inputs
//      disabled, card dimmed) — no full reload required.
const ANSWER_SCRIPT = `
(function(){
  function getSvc(key){ try { return window.ioc && window.ioc.get && window.ioc.get(key); } catch(_) { return null; } }
  function setStatus(card, msg, isErr){
    var s = card.querySelector('.dash-q-status');
    if (s) { s.textContent = msg || ''; s.classList.toggle('is-err', !!isErr); }
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
  document.querySelectorAll('.dash-q-card').forEach(function(card){
    var btn = card.querySelector('.dash-q-done');
    var input = card.querySelector('.dash-q-input');
    if (!btn || !input) return;
    btn.addEventListener('click', async function(){
      var text = (input.value || '').trim();
      if (!text) { setStatus(card, 'type an answer first', true); input.focus(); return; }
      var qId = card.dataset.qId || '';
      var sig = card.dataset.qSig || '';
      var source = card.dataset.qSource || 'qa-slot';
      var path;
      try { path = JSON.parse(card.dataset.qPath || '[]'); } catch(_) { path = []; }
      if (!Array.isArray(path) || path.length === 0) { setStatus(card, 'missing cell path', true); return; }
      var notes = getSvc('@diamondcoreprocessor.com/NotesService');
      if (!notes || typeof notes.addAtSegments !== 'function') { setStatus(card, 'notes service unavailable', true); return; }
      var parent = path.slice(0, -1);
      var cell = path[path.length - 1];
      btn.disabled = true; input.disabled = true; setStatus(card, 'committing answer…');
      try {
        // Resolved-Q notes are just notes — no provenance prefix, no
        // special styling. Per memory:
        // feedback_layer_purity_optimizations_external.md.
        await notes.addAtSegments(parent, cell, text);
        // Clear the qa source so the question doesn't re-surface.
        if (source === 'qa-slot' && sig) {
          // LayerCommitter has no public commitSlotRemove; mirror what
          // the bridge worker's bag-remove does inline: read current
          // layer, filter the slot, commit a name+slot layer (other
          // slots merge per LayerCommitter's update contract).
          var history = getSvc('@diamondcoreprocessor.com/HistoryService');
          var committer = getSvc('@diamondcoreprocessor.com/LayerCommitter');
          if (history && committer && typeof committer.update === 'function') {
            var locSig = await history.sign({ explorerSegments: function(){ return path; } });
            var layer = await history.currentLayerAt(locSig);
            var prior = Array.isArray(layer && layer.qa) ? layer.qa.map(String) : [];
            var next = prior.filter(function(s){ return s !== sig; });
            var nextLayer = { name: (layer && layer.name) || cell, qa: next };
            await committer.update(path, nextLayer);
          }
        } else if (source === 'optimization' && sig) {
          var store = getSvc('@hypercomb.social/Store');
          if (store && typeof store.removeOptimization === 'function') {
            try { await store.removeOptimization(sig); } catch(_) {}
          }
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

// Builds a direct link to the cell that owns the question, with the
// `#q-<qId>` anchor so the inline Q&A render on that cell's page
// scrolls to the specific row on arrival. Plain paths only — no
// bracket-selection markup. The previous designs (`?[name]` query
// form, `/parent/[name]` path-tail form) both leaked encoding /
// normalization artifacts into the address bar (`%5B…%5D=`, stray
// brackets) and the Q&A is already rendered inline on each cell
// page, so the simpler URL gets the user to the same content
// without the extra syntax to read.
function cellUrl(path, qId) {
  if (path.length === 0) return '/'
  return '/' + path.join('/') + (qId ? `#q-${qId}` : '#qa')
}

// Trailing arrow svg (kept in sync with dolphin-revision's TILE_ARROW_SVG).
const TILE_ARROW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
const HELP_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>'
const DASHBOARD_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.2"/><rect x="13" y="3" width="8" height="5" rx="1.2"/><rect x="13" y="10" width="8" height="11" rx="1.2"/><rect x="3" y="13" width="8" height="8" rx="1.2"/></svg>'

function renderDashboard({ openItems, answeredCount, totalCount, manifestSigPreview }) {
  // Each open Q becomes a Material 3 elevated tile card with an INLINE
  // answer composer — type, click Done, the answer commits to the
  // source cell's lineage and the qa entry disappears from the
  // dashboard. The card also keeps a small `↗` link to the source
  // cell page for users who want to read more context before
  // answering. Data attrs carry everything the in-page script needs
  // to dispatch the right writes; the answer pipeline runs entirely
  // in the renderer's JS context (cell pages are mounted inline, so
  // window.ioc is reachable directly — no postMessage / iframe).
  const tiles = openItems.map(({ path, question, qId, sig, source }) => {
    const pathStr = '/' + path.join('/')
    return `
    <li class="md-tile dash-q-card"
        data-q-id="${escapeHtml(qId)}"
        data-q-path="${escapeHtml(JSON.stringify(path))}"
        data-q-sig="${escapeHtml(sig || '')}"
        data-q-source="${escapeHtml(source || 'qa-slot')}">
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
<script>${ANSWER_SCRIPT}</script>
</body>
</html>`
}

// ─── main ───────────────────────────────────────────────────────────

;(async () => {
  console.log('1) Reading top-level cells...')
  const root = await withRenderer({ op: 'list-at', segments: [] })
  if (!root.ok) { console.log('   FAILED:', root.error); process.exit(1) }
  const topCells = (root.data || []).filter(name => name !== 'dashboard')
  console.log(`   ${topCells.join(', ')}`)

  console.log('2) Walking each tree, collecting open Q items from `qa` slots...')
  const allItems = []
  for (const name of topCells) {
    const inf = await withRenderer({ op: 'inflate', segments: [name] })
    if (!inf.ok) {
      console.log(`   skipping /${name}: ${inf.error}`)
      continue
    }
    const { items } = walkForQa(inf.data, [])
    // `inflate` drops the underlying qa-slot sigs (they're resolved into
    // their JSON content), but the dashboard's in-page answer composer
    // needs the sig to bag-remove the entry on submit. Fetch each
    // path's raw layer separately and zip the sigs back onto the items
    // in question order. Same source-of-truth (the layer's qa slot) —
    // just a non-resolving read.
    const byPath = new Map()
    for (const it of items) {
      const key = it.path.join('/')
      if (!byPath.has(key)) byPath.set(key, [])
      byPath.get(key).push(it)
    }
    for (const [key, group] of byPath) {
      const segs = key === '' ? [] : key.split('/')
      const raw = await withRenderer({ op: 'layer-at', segments: segs })
      const sigs = raw.ok && Array.isArray(raw.data?.qa) ? raw.data.qa.filter(s => typeof s === 'string') : []
      for (let i = 0; i < group.length && i < sigs.length; i++) {
        group[i].sig = sigs[i]
      }
    }
    if (items.length > 0) console.log(`   /${name}: ${items.length} open Q`)
    allItems.push(...items)
  }

  // 2b) Also pull qa-kind optimizations from `__optimization__/` — the
  // architecturally-correct home for Q&A (layer-untouched). Cell qa-slot
  // walk above is legacy and gets retired once the dolphin pipeline
  // migrates over.
  console.log('2b) Listing qa-kind optimizations from __optimization__/...')
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
        source: 'optimization',
      }))
    if (optItems.length > 0) console.log(`   __optimization__/: ${optItems.length} open Q`)
    allItems.push(...optItems)
  } else if (!opts.ok) {
    console.log(`   skipping optimization-list: ${opts.error}`)
  }

  // Dedupe: same path + same question text counts as one row even if
  // there are multiple [Q] notes (we double-seeded some earlier). The
  // group resolves to answered if ANY member has an [A] — answering
  // one auto-clears the duplicate's row, but the other underlying
  // notes still exist and can be cleaned up via a follow-up sweep.
  const seen = new Set()
  const openItems = []
  for (const item of allItems) {
    const key = item.path.join('/') + '\n' + item.question
    if (seen.has(key)) continue
    seen.add(key)
    openItems.push(item)
  }
  const answeredCount = 0  // qa slot is open-only; answered → bag-removed.
  console.log(`3) ${openItems.length} open Q${openItems.length === 1 ? '' : 's'} (qa slot is open-only — answered Qs are bag-removed).`)

  // 4) Build intel manifest first so we know its sig before rendering
  //    the dashboard footer.
  console.log('4) Minting intel manifest...')
  const manifest = {
    schemaVersion: 1,
    kind: 'dashboard-intel',
    generatedAt: new Date().toISOString(),
    chromeSig: CHROME_SIG,
    branchesWalked: topCells,
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

  console.log('5) Rendering dashboard HTML...')
  const html = renderDashboard({
    openItems,
    answeredCount,
    totalCount: allItems.length,
    manifestSigPreview: manifestSig.slice(0, 12),
  })
  const htmlPut = await withRenderer({ op: 'put-resource', text: html })
  if (!htmlPut.ok) { console.log('   FAILED:', htmlPut.error); process.exit(1) }
  const htmlSig = htmlPut.data.sig
  console.log(`   dashboard html sig=${htmlSig.slice(0, 12)} (${html.length} bytes)`)

  // 6) Compute one child cell per open Q. The dashboard cell is supposed
  //    to be drillable in the hex grid — clicking it should reveal a tile
  //    for each open question, not an empty cell. Label uses the source
  //    path's last segment (closest to the user's mental model — "the
  //    question about certification lives at tile 'certification'"), with
  //    a numeric suffix when multiple Qs share the same source segment so
  //    every label is unique. normalizeCell on the bridge side strips any
  //    stray punctuation and lowercases.
  const childLabels = []
  const labelCounts = new Map()
  const labelToItem = []
  for (const item of openItems) {
    const base = (item.path.length === 0 ? 'root' : item.path[item.path.length - 1]) || 'q'
    const n = (labelCounts.get(base) ?? 0) + 1
    labelCounts.set(base, n)
    const label = n === 1 ? base : `${base}-${n}`
    childLabels.push(label)
    labelToItem.push({ label, item })
  }

  console.log('6) Updating /dashboard layer — context [html, manifest] + children for each open Q...')
  // One layer-as-primitive update preserves both slots in a single cascade.
  // Using `bag-set` here would only carry `context`, wiping `children` on
  // every refresh (and vice versa). `update` is the canonical surface for
  // multi-slot writes.
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

  // 7) Stamp each child's `link` property so the tile shows the link
  //    badge and clicking the open action opens the source cell page.
  //    Stays best-effort — a failed stamp doesn't break the dashboard;
  //    the cell still exists and can be linked manually later.
  if (childLabels.length > 0) {
    console.log('7) Stamping child link properties...')
    let linked = 0
    for (const { label, item } of labelToItem) {
      const href = cellUrl(item.path, item.qId)
      const res = await withRenderer({
        op: 'stamp',
        segments: ['dashboard', label],
        layer: { link: href },
      })
      if (res.ok) linked++
      else console.log(`   /${label}: ${res.error}`)
    }
    console.log(`   ${linked}/${childLabels.length} children linked`)
  }

  console.log('\nDone.')
  console.log(`  ${allItems.length} Q total, ${answeredCount} answered, ${openItems.length} still open.`)
  console.log(`  Dashboard URL: http://localhost:4250/dashboard`)
  console.log(`  Refresh the dev shell to load the new context.`)
  if (openItems.length > 0) {
    console.log('\nOpen Qs (click any to open in the editor):')
    for (let i = 0; i < openItems.length; i++) {
      const { path, question, qId } = openItems[i]
      const label = childLabels[i]
      const url = cellUrl(path, qId)
      const preview = question.length > 70 ? question.slice(0, 67) + '…' : question
      console.log(`  /dashboard/${label}  →  ${url}\n    ${preview}`)
    }
  }
})().catch(err => { console.error('FATAL:', err); process.exit(1) })
