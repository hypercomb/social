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
const CHROME_SIG = 'e15672dd997e9ba08cdea5af847a6c5e0fad06551e223d34f6353e90c2498c7d'

const PAINT_SCRIPT = `
(function(){try{var t=localStorage.getItem('hc:dolphin:theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(_){};})();
`.trim()

const TOGGLE_SCRIPT = `
(function(){var b=document.getElementById('themeToggle');if(!b)return;function c(){var t=document.documentElement.getAttribute('data-theme');if(t==='light'||t==='dark')return t;return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}function a(t){document.documentElement.setAttribute('data-theme',t);try{localStorage.setItem('hc:dolphin:theme',t);}catch(_){};}b.addEventListener('click',function(){a(c()==='light'?'dark':'light');});})();
`.trim()

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c])

// Builds a direct link to the cell that owns the question, with a
// `#q-<qId>` anchor so the page scrolls to that specific Q&A item on
// load. Each cell page now renders its [Q]-prefixed notes inline (via
// the dolphin generator's renderQaSection), so the user sees the
// question directly on the page they land on — no selection / popup
// juggling. Falls back to a plain `#qa` anchor if no qId.
function cellUrl(path, qId) {
  if (path.length === 0) return '/'
  return '/' + path.join('/') + (qId ? `#q-${qId}` : '#qa')
}

function renderDashboard({ openItems, answeredCount, totalCount, manifestSigPreview }) {
  const lis = openItems.map(({ path, question, qId }) => `
    <li><a class="fn-index-link" href="${escapeHtml(cellUrl(path, qId))}">
      <span class="fn-index-name">/${escapeHtml(path.join('/'))}</span>
      <span class="fn-index-blurb">${escapeHtml(question.length > 200 ? question.slice(0, 197) + '…' : question)}</span>
    </a></li>`).join('')

  const body = openItems.length === 0
    ? `<p>No open questions right now. ${answeredCount} of ${totalCount} answered. As Claude needs input, items will surface here.</p>`
    : `<p>${openItems.length} open question${openItems.length === 1 ? '' : 's'} across the revision — ${answeredCount}/${totalCount} answered. Each row links straight to the cell page where the question is shown inline. To answer, open the editor on that tile and use its Q&A panel.</p>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Relational Intelligence</title>
<script>${PAINT_SCRIPT}</script>
<link rel="stylesheet" href="resource:${CHROME_SIG}/chrome.css">
</head>
<body>
<main>
  <header class="fn-eyebrow">
    <nav><b>Dashboard</b></nav>
    <button id="themeToggle" type="button" class="theme-toggle" aria-label="toggle theme">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.5a8 8 0 0 1-11.2-11.2 8 8 0 1 0 11.2 11.2z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>
    </button>
  </header>
  <h1 class="fn-title">Dashboard</h1>
  <p class="fn-lede">${openItems.length === 0 ? 'No open questions.' : 'Open questions across the revision — one place to navigate them.'} </p>
  <hr class="fn-rule">
  <div class="fn-body">${body}</div>
  ${openItems.length > 0 ? `<hr class="fn-rule"><ol class="fn-index">${lis}</ol>` : ''}
  <footer class="fn-foot">— ${openItems.length} open · ${answeredCount}/${totalCount} answered · intel ${escapeHtml(manifestSigPreview)} —</footer>
</main>
<script>${TOGGLE_SCRIPT}</script>
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
    if (items.length > 0) console.log(`   /${name}: ${items.length} open Q`)
    allItems.push(...items)
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

  console.log('6) Stamping /dashboard context slot [html, manifest]...')
  // Order matters: site-view.drone picks the FIRST HTML-shaped resource
  // for paint; the JSON manifest sits at index 1 and is invisible to
  // the renderer but discoverable on inspection.
  const stamp = await withRenderer({ op: 'bag-set', segments: ['dashboard'], cells: [htmlSig, manifestSig] })
  if (!stamp.ok) { console.log('   FAILED:', stamp.error); process.exit(1) }
  console.log(`   /dashboard stamped — context = [${htmlSig.slice(0, 8)}…, ${manifestSig.slice(0, 8)}…]`)

  console.log('\nDone.')
  console.log(`  ${allItems.length} Q total, ${answeredCount} answered, ${openItems.length} still open.`)
  console.log(`  Dashboard URL: http://localhost:4250/dashboard`)
  console.log(`  Refresh the dev shell to load the new context.`)
  if (openItems.length > 0) {
    console.log('\nOpen Qs (click any to open in the editor):')
    for (const { path, question, qId } of openItems) {
      const url = cellUrl(path, qId)
      const preview = question.length > 70 ? question.slice(0, 67) + '…' : question
      console.log(`  ${url}\n    ${preview}`)
    }
  }
})().catch(err => { console.error('FATAL:', err); process.exit(1) })
