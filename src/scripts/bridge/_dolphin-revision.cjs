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
  root:           '<circle cx="12" cy="12" r="9"/><path d="M3 12c4 0 4-4 9-4s5 4 9 4M3 12c4 0 4 4 9 4s5-4 9-4"/>',
  coaching:       '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c1-3 4-5 7-5s6 2 7 5M15 19c.5-2 2.5-3 4.5-3s3 1 3.5 3"/>',
  certifications: '<path d="M12 3l2.7 5.5 6.3.9-4.5 4.4 1 6.2L12 17l-5.5 3 1-6.2L3 9.4l6.3-.9z"/>',
  'live-events':  '<rect x="4" y="6" width="16" height="14" rx="1.5"/><path d="M4 10h16M9 4v4M15 4v4"/>',
  community:      '<circle cx="12" cy="12" r="8"/><circle cx="8" cy="9" r="2"/><circle cx="16" cy="9" r="2"/><circle cx="12" cy="16" r="2"/><path d="M8 9l4 7M16 9l-4 7"/>',
  content:        '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5M9 8h5"/>',
  operations:     '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M22 12h-4M6 12H2M19 5l-2.8 2.8M7.8 16.2L5 19M19 19l-2.8-2.8M7.8 7.8L5 5"/>',
  identity:       '<path d="M5 5v15l4-3 3 3 3-3 4 3V5z"/>',
  // generic fallback for leaves
  leaf:           '<circle cx="12" cy="12" r="3"/>',
  // dashboard cell
  dashboard:      '<rect x="3" y="3" width="8" height="8" rx="1.2"/><rect x="13" y="3" width="8" height="5" rx="1.2"/><rect x="13" y="10" width="8" height="11" rx="1.2"/><rect x="3" y="13" width="8" height="8" rx="1.2"/>',
}

// Section heading icon — a quiet "list of items" mark for `<h2>`s.
const SECTION_ICON = '<path d="M4 7h12M4 12h16M4 17h10"/>'

function iconSvg(name) {
  const path = BRANCH_ICONS[name] ?? BRANCH_ICONS.leaf
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`
}

// ─── chrome stylesheet (one resource, every page links it) ──────────

// Bytes live in `_chrome-bytes.cjs` so every consumer (this generator and
// `_dashboard-refresh.cjs`) hashes the SAME bytes and derives the same sig.
const { DOLPHIN_CHROME_CSS: CHROME_CSS } = require('./_chrome-bytes.cjs')

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
<!-- No web fonts: a Google link hands them every reader's IP, UA and Referer.
     --serif/--sans resolve to faces the reader already has, and the Material
     Symbols link was dead weight — icons here render as inline SVG via
     iconSvg(), never as ligatures. See documentation/no-third-party-requests.md. -->
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
  coaching: {
    title: 'Coaching',
    lede: 'The pressure-test of Relational Intelligence. 1:1 and group work IS the methodology — every session generates evidence of what works, what doesn\'t, what the next cohort needs to learn. Treat coaching engagements as both revenue and R&D.',
    summary: 'One-on-one, group, retreats. Where the methodology gets sharpened.',
  },
  certifications: {
    title: 'Certifications',
    lede: 'Multi-tier path that propagates RI without diluting it. Foundational teaches the practice. Advanced teaches teaching. Mentor teaches assessing. Each tier is gated by demonstrated outcomes, not seat-time. The directory of certified practitioners is the public proof of the method.',
    summary: 'Foundational → advanced → mentor. Curriculum, cohorts, assessments.',
  },
  'live-events': {
    title: 'Live Events',
    lede: 'In-person ritual matters for relational work in ways async media can\'t replicate. Workshops are entry points, retreats deepen practice, summits gather the certified field. Calendar drives the year\'s rhythm; the playbook makes each format reproducible.',
    summary: 'Workshops, retreats, summits — the in-person ritual side of RI.',
  },
  community: {
    title: 'Community',
    lede: 'Connective tissue between coaching, certs, and events. Circles run between formal touchpoints. Practice spaces let new graduates flex without high stakes. Library curates what the field is producing. Feedback loops route signal back into curriculum + content.',
    summary: 'Circles, practice spaces, members, library, feedback, governance.',
  },
  content: {
    title: 'Content',
    lede: 'How RI reaches people who haven\'t signed up for anything yet. Essays make the case. Podcasts let people meet Dolphin\'s voice. Talks plant flags at adjacent conferences. Frameworks are the canonical artifacts — the named, drawn, citable models practitioners can point to.',
    summary: 'Essays, podcasts, talks, frameworks, case studies, publishing.',
  },
  operations: {
    title: 'Operations',
    lede: 'The substrate that keeps everything else from breaking. Pricing model determines who can afford the path. Pipeline tracks who\'s mid-journey. Team & roles define who handles what. Legal protects the certification mark. Tools are the tech stack supporting the practice.',
    summary: 'Pipeline, team, legal, finances, tools — back-of-house.',
  },
  identity: {
    title: 'Identity',
    lede: 'Who Dolphin is, in language consistent across every surface. Manifesto is the why. Voice is the how. Audiences names the who. Visual is the look. When all four cohere, every artifact reinforces every other artifact.',
    summary: 'Manifesto, voice, audiences, visual — the brand spine.',
  },
}

const BRANCH_ORDER = ['coaching', 'certifications', 'live-events', 'community', 'content', 'operations', 'identity']

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
    <p>This is the field — coaching is where it gets pressure-tested, certifications propagate it, live events deepen it, community holds it together, content makes it findable, operations keeps it running, identity makes it coherent. Each branch below is its own self-contained area; together they hold the whole.</p>
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
    lede: 'A field, not a feeling — the practice, the path that propagates it, the people building it together.',
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
  '[design] Color palette — one chord at two brightnesses: azure primary, clay secondary, periwinkle tertiary. Dark mode: ground #0d151e, ink #e3ecf3, accent #7ec3ee, rule rgba(227,237,245,0.18). Light mode: paper #f7f8fa, ink #1a2130, accent #1668c4, rule rgba(26,33,48,0.20). Every neutral carries the ground\'s own blue-slate — no warm ink on a cold ground — and every elevation shadow is tinted (slate rgba(18,34,58,·) light, blue-black rgba(2,8,14,·) dark) rather than black. Codegen reads these via CSS custom properties on :root + [data-theme="dark"] override.',
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
    // Visual-bee path: write the page as a decoration of kind
    // `visual:website:page`. `replaceKind: true` drops any prior
    // website decoration on this cell so re-runs are idempotent.
    // site-view.drone's renderer resolves the decoration → payload.htmlSig
    // → resource bytes.
    const dec = await withRenderer({
      op: 'decoration-add',
      segments,
      kind: 'visual:website:page',
      appliesTo: segments,
      payload: { htmlSig: sig, order: 0, createdAt: Date.now() },
      mark: 'persistent',
      replaceKind: true,
    })
    if (!dec.ok) {
      console.log(`   FAILED to stamp /${segments.join('/')}: ${dec.error}`)
      failed++; return null
    }
    console.log(`   /${segments.join('/')} → ${sig.slice(0, 12)} (${html.length}B, dec=${dec.data.sig.slice(0, 12)})`)
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
    { path: ['dolphin'], question: 'Primary CTA — book a session, podcast subscribe, register for next event, or something else? This determines the root page\'s call-to-action.' },
    { path: ['dolphin', 'certifications', 'foundational'], question: 'Is the foundational certification cohort accepting applicants, or is this aspirational structure for the site to communicate the long-term plan?' },
    { path: ['dolphin', 'coaching', '1-on-1'], question: 'Is 1:1 coaching open for new clients right now, or running closed with current waitlist? The page CTA depends on this.' },
    { path: ['dolphin', 'live-events', 'calendar'], question: 'What\'s the first scheduled event the site should announce? Workshop, retreat, summit — and approximate date?' },
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
  // Use update to create dashboard cell at root if it doesn't exist, then
  // stamp the rendered page as a `visual:website:page` decoration.
  const dashUpdate = await withRenderer({
    op: 'update',
    segments: ['dashboard'],
    layer: { name: 'dashboard' },
  })
  if (!dashUpdate.ok && !/already|exists/i.test(String(dashUpdate.error || ''))) {
    console.log(`   note: dashboard update returned: ${dashUpdate.error}`)
  }
  const dashDec = await withRenderer({
    op: 'decoration-add',
    segments: ['dashboard'],
    kind: 'visual:website:page',
    appliesTo: ['dashboard'],
    payload: { htmlSig: dashboardSig, order: 0, createdAt: Date.now() },
    mark: 'persistent',
    replaceKind: true,
  })
  if (dashDec.ok) console.log(`   /dashboard → ${dashboardSig.slice(0, 12)} (dec=${dashDec.data.sig.slice(0, 12)})`)
  else console.log(`   FAILED dashboard stamp: ${dashDec.error}`)

  // one build revision per root the pass touched (documentation/build-revisions.md)
  for (const root of [['dolphin'], ['dashboard']]) {
    const rev = await withRenderer({ op: 'build-record', segments: root, label: `${root[0]} site build` })
    console.log(rev.ok
      ? `   build revision /${root[0]}: ${rev.data.label} seal=${rev.data.seal.slice(0, 12)}${rev.data.unchanged ? ' (unchanged)' : ''}`
      : `   build revision /${root[0]} FAILED: ${rev.error}`)
  }

  console.log(`\nDone. chrome=${chromeSig.slice(0, 12)}, ${stamped} pages stamped, ${failed} failed.`)
  console.log('Refresh the dev shell to see the new revision (or navigate away + back).')
})().catch(err => { console.error('FATAL:', err); process.exit(1) })
