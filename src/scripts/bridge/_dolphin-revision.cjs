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

// ─── chrome stylesheet (one resource, every page links it) ──────────

const CHROME_CSS = `
:root {
  --ink: #0c1622;
  --ink-deep: #07101b;
  --paper: #e8e2d6;
  --paper-strong: #f6f0e2;
  --paper-muted: rgba(232, 226, 214, 0.62);
  --paper-faint: rgba(232, 226, 214, 0.34);
  --accent: #7eb6d6;
  --accent-soft: rgba(126, 182, 214, 0.16);
  --rule: rgba(232, 226, 214, 0.14);
  --rule-strong: rgba(232, 226, 214, 0.32);
  --serif: "Source Serif 4", "Iowan Old Style", Georgia, "Times New Roman", serif;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --easing: cubic-bezier(.2, .7, .2, 1);
}
[data-theme="light"] {
  --ink: #f5ede0;
  --ink-deep: #ece2cf;
  --paper: #1a1f2c;
  --paper-strong: #0a1020;
  --paper-muted: rgba(26, 31, 44, 0.62);
  --paper-faint: rgba(26, 31, 44, 0.36);
  --accent: #1f4376;
  --accent-soft: rgba(31, 67, 118, 0.10);
  --rule: rgba(26, 31, 44, 0.16);
  --rule-strong: rgba(26, 31, 44, 0.34);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    --ink: #f5ede0; --ink-deep: #ece2cf;
    --paper: #1a1f2c; --paper-strong: #0a1020;
    --paper-muted: rgba(26, 31, 44, 0.62);
    --paper-faint: rgba(26, 31, 44, 0.36);
    --accent: #1f4376; --accent-soft: rgba(31, 67, 118, 0.10);
    --rule: rgba(26, 31, 44, 0.16); --rule-strong: rgba(26, 31, 44, 0.34);
  }
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }
html {
  background: var(--ink); color: var(--paper);
  font-family: var(--serif);
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  transition: background-color .25s var(--easing), color .25s var(--easing);
}
body {
  display: flex; justify-content: center;
  padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 4vw, 2rem) 5rem;
}
main { width: 100%; max-width: 38rem; display: grid; gap: 2.6rem; }

.fn-eyebrow {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  font-family: var(--sans); font-size: 0.74rem;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--paper-faint);
}
.fn-eyebrow nav { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.fn-eyebrow nav a { color: inherit; text-decoration: none; transition: color .15s var(--easing); }
.fn-eyebrow nav a:hover { color: var(--paper); }
.fn-eyebrow nav span.sep { opacity: 0.55; }
.fn-eyebrow nav b { color: var(--paper-muted); font-weight: 600; }

.theme-toggle {
  display: inline-grid; place-items: center;
  width: 2rem; height: 2rem;
  border: 1px solid var(--rule); border-radius: 999px;
  background: transparent; color: var(--paper-muted); cursor: pointer;
  transition: color .15s var(--easing), border-color .15s var(--easing), background .15s var(--easing);
}
.theme-toggle:hover { color: var(--paper); border-color: var(--rule-strong); background: var(--accent-soft); }
.theme-toggle svg { width: 1rem; height: 1rem; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.theme-toggle .sun { display: none; } .theme-toggle .moon { display: block; }
[data-theme="light"] .theme-toggle .sun { display: block; }
[data-theme="light"] .theme-toggle .moon { display: none; }

h1.fn-title {
  font-family: var(--serif); font-weight: 400;
  font-size: clamp(1.75rem, 4.6vw, 2.85rem); line-height: 1.08;
  letter-spacing: -0.01em; color: var(--paper-strong);
  margin: -0.2rem 0 0;
}

.fn-lede {
  font-family: var(--serif);
  font-size: clamp(1.1rem, 1.6vw, 1.22rem); line-height: 1.55;
  color: var(--paper-muted); max-width: 36rem;
}

.fn-rule { height: 1px; background: var(--rule); border: 0; margin: 0; }

.fn-body { display: grid; gap: 1.4rem; font-size: 1.04rem; line-height: 1.7; color: var(--paper); }
.fn-body h2 {
  font-family: var(--serif); font-weight: 500;
  font-size: 1.3rem; line-height: 1.25; letter-spacing: -0.005em;
  color: var(--paper-strong); margin-top: 0.6rem;
}
.fn-body p { font-family: var(--serif); }
.fn-body a {
  color: var(--paper-strong); text-decoration: underline;
  text-decoration-color: var(--accent); text-decoration-thickness: 1.5px;
  text-underline-offset: 0.16em;
  transition: text-decoration-color .15s var(--easing), color .15s var(--easing);
}
.fn-body a:hover { color: var(--accent); text-decoration-color: var(--paper); }

.fn-index {
  display: grid; gap: 1.1rem; list-style: none;
  counter-reset: fn-children; padding: 0; margin: 0;
}
.fn-index > li {
  counter-increment: fn-children; position: relative; padding-left: 2.7rem;
}
.fn-index > li::before {
  content: counter(fn-children, decimal-leading-zero);
  position: absolute; left: 0; top: 0.1em;
  font-family: var(--sans); font-size: 0.74rem; letter-spacing: 0.18em;
  color: var(--paper-faint);
}
.fn-index a.fn-index-link {
  display: grid; gap: 0.35rem; color: inherit; text-decoration: none;
  transition: transform .15s var(--easing);
}
.fn-index a.fn-index-link:hover { transform: translateX(2px); }
.fn-index .fn-index-name {
  font-family: var(--serif); font-size: 1.18rem; font-weight: 500;
  letter-spacing: -0.005em; color: var(--paper-strong);
  text-decoration: underline; text-decoration-color: transparent;
  text-decoration-thickness: 1.5px; text-underline-offset: 0.18em;
  transition: text-decoration-color .15s var(--easing);
}
.fn-index a.fn-index-link:hover .fn-index-name { text-decoration-color: var(--accent); }
.fn-index .fn-index-blurb {
  font-family: var(--serif); font-size: 0.99rem; line-height: 1.5;
  color: var(--paper-muted);
}

footer.fn-foot {
  font-family: var(--sans); font-size: 0.74rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--paper-faint); text-align: center;
  margin-top: 1rem;
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

function shellHtml({ chromeSig, segments, title, lede, body, indexLinks }) {
  const breadcrumb = breadcrumbHtml(segments)
  const indexHtml = indexLinks && indexLinks.length
    ? `<ol class="fn-index">${indexLinks.map(({ name, href, blurb }) => `
      <li><a class="fn-index-link" href="${escapeHtml(href)}">
        <span class="fn-index-name">${escapeHtml(name)}</span>
        ${blurb ? `<span class="fn-index-blurb">${escapeHtml(blurb)}</span>` : ''}
      </a></li>`).join('')}</ol>`
    : ''

  const footerLabel = segments.length
    ? '— ' + segments.map(s => s.replace(/-/g, ' ')).join(' / ') + ' —'
    : '— relational intelligence —'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — Relational Intelligence</title>
<script>${PAINT_SCRIPT}</script>
<link rel="stylesheet" href="resource:${chromeSig}/chrome.css">
</head>
<body>
<main>
  <header class="fn-eyebrow">
    <nav>${breadcrumb}</nav>
    <button id="themeToggle" type="button" class="theme-toggle" aria-label="toggle theme">
      <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.5a8 8 0 0 1-11.2-11.2 8 8 0 1 0 11.2 11.2z"/></svg>
      <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>
    </button>
  </header>

  <h1 class="fn-title">${escapeHtml(title)}</h1>
  ${lede ? `<p class="fn-lede">${escapeHtml(lede)}</p>` : ''}

  <hr class="fn-rule">

  <div class="fn-body">${body}</div>

  ${indexHtml ? `<hr class="fn-rule">${indexHtml}` : ''}

  <footer class="fn-foot">${escapeHtml(footerLabel)}</footer>
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
  }))

  const body = `
    <p>Relational Intelligence isn’t a personality trait or a soft skill. It’s a learnable capacity that shows up in how individuals, couples, professionals, organizations, and communities meet each other.</p>
    <p>This is the field — its model, its practice, its evidence, and the people building it together. Each branch below is its own self-contained area of the work; together they hold the whole.</p>
    <h2>The eight branches</h2>
    <p>Each branch grows on its own and composes with the others. Click through to enter.</p>
  `

  return shellHtml({
    chromeSig,
    segments: ['dolphin'],
    title: 'Relating well is an intelligence — name it, train it, live it.',
    lede: 'A field, not a feeling — the model, the practice, the evidence, and the people building it together.',
    body,
    indexLinks,
  })
}

function renderBranch(branch, chromeSig) {
  const meta = BRANCH_META[branch.name]
  const segments = ['dolphin', branch.name]
  const notes = uniqueNotes(branch.notes)

  let body
  if (notes.length === 0) {
    body = `<p>This area is being scoped. The shape is named; the depth is still being written.</p>`
  } else {
    const paragraphs = notes.slice(0, 3).map(n => `<p>${escapeHtml(n)}</p>`).join('')
    body = paragraphs
  }

  const indexLinks = (branch.children || []).map(child => {
    const childNotes = uniqueNotes(child.notes)
    const blurb = childNotes[0] || ''
    return {
      name: titleCase(child.name),
      href: `${child.name}/`,
      blurb: blurb.length > 110 ? blurb.slice(0, 107) + '…' : blurb,
    }
  })

  return shellHtml({
    chromeSig,
    segments,
    title: meta.title,
    lede: meta.lede,
    body,
    indexLinks,
  })
}

function renderLeaf(leaf, branchName, chromeSig) {
  const segments = ['dolphin', branchName, leaf.name]
  const notes = uniqueNotes(leaf.notes)
  const title = titleCase(leaf.name)
  const branchTitle = BRANCH_META[branchName]?.title?.replace(/^The /, '') ?? titleCase(branchName)

  let body
  if (notes.length === 0) {
    body = `<p>This area is being scoped.</p>`
  } else if (notes.length === 1) {
    body = `<p>${escapeHtml(notes[0])}</p>`
  } else {
    body = notes.map(n => {
      const m = /^([^:]{2,40}):\s*(.+)$/.exec(n)
      if (m) {
        return `<div><h2>${escapeHtml(m[1].trim())}</h2><p>${escapeHtml(m[2].trim())}</p></div>`
      }
      return `<p>${escapeHtml(n)}</p>`
    }).join('')
  }

  return shellHtml({
    chromeSig,
    segments,
    title,
    lede: `Part of ${branchTitle}.`,
    body,
    indexLinks: [],
  })
}

function renderDashboard({ chromeSig, qaItems }) {
  const segments = ['dashboard']
  const indexLinks = qaItems.map(({ path, question }) => ({
    name: '/' + path.join('/'),
    href: '/' + path.join('/') + '/',
    blurb: question.length > 130 ? question.slice(0, 127) + '…' : question,
  }))

  const body = qaItems.length === 0
    ? `<p>No open questions right now. As pages get built and Claude needs your input, items will surface here for fast review.</p>`
    : `<p>Open questions surfaced from the current revision. Each links to the cell that’s waiting on you. Answer in the cell’s notes; Claude resumes from there.</p>`

  return shellHtml({
    chromeSig,
    segments,
    title: 'Dashboard',
    lede: 'Open questions across the revision. One place to navigate the work that’s waiting on you.',
    body,
    indexLinks,
  })
}

// ─── main ───────────────────────────────────────────────────────────

;(async () => {
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
    await mintAndStamp(['dolphin', branch.name], renderBranch(branch, chromeSig))
  }

  console.log('5) Stamping leaves...')
  for (const branch of tree.data.children || []) {
    if (!BRANCH_META[branch.name]) continue
    for (const leaf of branch.children || []) {
      await mintAndStamp(['dolphin', branch.name, leaf.name], renderLeaf(leaf, branch.name, chromeSig))
    }
  }

  console.log('6) Attaching Q&A notes...')
  const qaItems = [
    { path: ['dolphin'], question: 'Primary CTA — book a session, podcast subscribe, register for next event, or something else? This determines the root page’s call-to-action.' },
    { path: ['dolphin', 'practice', 'certification'], question: 'Is the certification program live and accepting applicants, or is this aspirational structure for the site to communicate the long-term plan?' },
    { path: ['dolphin', 'business', 'sales'], question: 'Same question — is sales an active operation, or is this section roadmap-stage for now?' },
  ]
  for (const { path, question } of qaItems) {
    const cellName = path[path.length - 1]
    const parentSegments = path.slice(0, -1)
    const text = `[Q] ${question}`
    const r = await withRenderer({ op: 'note-add', cell: cellName, segments: parentSegments, text })
    if (r.ok) console.log(`   Q on /${path.join('/')}`)
    else console.log(`   FAILED Q on /${path.join('/')}: ${r.error}`)
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
