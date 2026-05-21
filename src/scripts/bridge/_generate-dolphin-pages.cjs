// Generates per-cell HTML pages for Dolphin's eight branches and the
// dolphin root, then stamps each into the cell's `context` slot via
// the bridge. Run with: node scripts/bridge/_generate-dolphin-pages.cjs
//
// One template, 8+1 substitutions. Inline CSS per page (dev shell has
// no /@resource/<sig> service worker; in production hypercomb-web has
// the worker so a future pass can switch to a shared chrome resource).

const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'

let counter = 0
const nextId = () => `gen-${Date.now()}-${++counter}`

const send = (req) => new Promise((resolve, reject) => {
  const id = nextId()
  const msg = { ...req, id }
  const ws = new WebSocket(BRIDGE)
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
  ws.on('open', () => ws.send(JSON.stringify(msg)))
  ws.on('message', (raw) => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ; ws.close() })
  ws.on('error', (err) => { clearTimeout(timer); reject(err) })
})

// ─── icon library (inline SVGs, scoped to currentColor) ──────────

const ICONS = {
  // Cell heading icons
  dolphin: '<circle cx="12" cy="12" r="9"/><path d="M3 12c4 0 4-4 9-4s5 4 9 4M3 12c4 0 4 4 9 4s5-4 9-4"/>',
  model: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="9"/>',
  practice: '<path d="M4 18c4-6 12-6 16 0"/><circle cx="12" cy="8" r="3"/>',
  evidence: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4M9 8h4"/>',
  audience: '<circle cx="9" cy="9" r="3.5"/><circle cx="17" cy="11" r="2.5"/><path d="M2 19c1-3 4-5 7-5s6 2 7 5M14 19c.5-2 2.5-3 4.5-3s3 1 3.5 3"/>',
  voice: '<path d="M12 3v12"/><path d="M8 11a4 4 0 0 0 8 0"/><path d="M12 19v2M9 21h6"/>',
  network: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M6 6L12 18 18 6"/>',
  platform: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6M12 17v4"/>',
  business: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M10 21v-7h4v7"/>',
  // Generic card icons (cycled per child)
  dot: '<circle cx="12" cy="12" r="3.5"/>',
  arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  spark: '<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  hex: '<path d="M12 3l8 5v8l-8 5-8-5V8z"/>',
  signal: '<path d="M3 12h3M9 12h3M15 12h3M21 12h-1"/><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/>',
  // Section heading "rule" lines
  branches: '<path d="M3 7h18M3 12h18M3 17h12"/>',
}

const cardIconKeys = ['dot', 'spark', 'layers', 'hex', 'signal', 'arrow']
const pickCardIcon = (i) => cardIconKeys[i % cardIconKeys.length]

// ─── shared CSS (inline per page; dev has no /@resource/ worker) ──

const CSS = `
:root {
  --bg: #0a0e14;
  --bg-deep: #06090d;
  --surface: rgba(18, 25, 35, 0.72);
  --surface-raised: rgba(255, 255, 255, 0.04);
  --surface-hover: rgba(120, 170, 220, 0.10);
  --border: rgba(170, 200, 240, 0.16);
  --border-soft: rgba(170, 200, 240, 0.10);
  --border-strong: rgba(200, 220, 255, 0.42);
  --text: #e8edf5;
  --text-strong: #f8fbff;
  --text-muted: rgba(232, 237, 245, 0.74);
  --text-faint: rgba(170, 200, 240, 0.55);
  --text-eyebrow: rgba(170, 200, 240, 0.70);
  --accent: #88aef7;
  --accent-soft: rgba(136, 174, 247, 0.18);
  --backdrop-tint: rgba(60, 100, 180, 0.22);
  --shadow-panel: 0 24px 80px rgba(0, 0, 0, 0.36);
  --radius-sm: 0.85rem;
  --radius-md: 1.4rem;
  --radius-pill: 999px;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-serif: "Source Serif 4", Georgia, "Times New Roman", serif;
  --easing: cubic-bezier(.2,.7,.2,1);
}
[data-theme="light"] {
  --bg: #f6f8fc;
  --bg-deep: #e8edf5;
  --surface: rgba(255, 255, 255, 0.86);
  --surface-raised: rgba(15, 25, 40, 0.04);
  --surface-hover: rgba(60, 100, 180, 0.08);
  --border: rgba(15, 25, 40, 0.14);
  --border-soft: rgba(15, 25, 40, 0.08);
  --border-strong: rgba(40, 70, 130, 0.36);
  --text: #0c1422;
  --text-strong: #050a14;
  --text-muted: rgba(12, 20, 34, 0.74);
  --text-faint: rgba(12, 20, 34, 0.5);
  --text-eyebrow: rgba(40, 70, 130, 0.72);
  --accent: #2a4f9e;
  --accent-soft: rgba(42, 79, 158, 0.14);
  --backdrop-tint: rgba(120, 160, 220, 0.16);
  --shadow-panel: 0 18px 60px rgba(20, 40, 80, 0.10);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    --bg: #f6f8fc; --bg-deep: #e8edf5;
    --surface: rgba(255, 255, 255, 0.86);
    --surface-raised: rgba(15, 25, 40, 0.04);
    --surface-hover: rgba(60, 100, 180, 0.08);
    --border: rgba(15, 25, 40, 0.14); --border-soft: rgba(15, 25, 40, 0.08); --border-strong: rgba(40, 70, 130, 0.36);
    --text: #0c1422; --text-strong: #050a14;
    --text-muted: rgba(12, 20, 34, 0.74); --text-faint: rgba(12, 20, 34, 0.5); --text-eyebrow: rgba(40, 70, 130, 0.72);
    --accent: #2a4f9e; --accent-soft: rgba(42, 79, 158, 0.14);
    --backdrop-tint: rgba(120, 160, 220, 0.16);
    --shadow-panel: 0 18px 60px rgba(20, 40, 80, 0.10);
  }
}
* , *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { min-height: 100%; }
html {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  transition: background-color .25s var(--easing), color .25s var(--easing);
}
body {
  display: flex; flex-direction: column; align-items: center;
  padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 4vw, 2.5rem);
  gap: 2rem;
}
.ri-backdrop {
  position: fixed; inset: 0; pointer-events: none; z-index: -1;
  background:
    radial-gradient(60vmax 60vmax at 12% -10%, var(--backdrop-tint), transparent 55%),
    radial-gradient(50vmax 50vmax at 100% 100%, var(--backdrop-tint), transparent 55%),
    linear-gradient(180deg, var(--bg-deep), var(--bg));
}
main { width: min(72rem, 100%); display: grid; gap: 2rem; }
.ri-eyebrow {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  color: var(--text-eyebrow); font-size: 0.78rem; letter-spacing: 0.16em; text-transform: uppercase;
}
.ri-eyebrow b { font-weight: 600; }
.ri-eyebrow a { color: inherit; text-decoration: none; transition: color .15s var(--easing); }
.ri-eyebrow a:hover { color: var(--text-strong); }
.theme-toggle {
  display: inline-grid; place-items: center; width: 2.1rem; height: 2.1rem;
  padding: 0; border: 1px solid var(--border); border-radius: var(--radius-pill);
  background: var(--surface-raised); color: var(--text-muted); cursor: pointer;
  transition: background .15s var(--easing), color .15s var(--easing), border-color .15s var(--easing);
}
.theme-toggle:hover { color: var(--text-strong); border-color: var(--border-strong); background: var(--surface-hover); }
.theme-toggle svg { width: 1.05rem; height: 1.05rem; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.theme-toggle .sun { display: none; } .theme-toggle .moon { display: block; }
[data-theme="light"] .theme-toggle .sun { display: block; } [data-theme="light"] .theme-toggle .moon { display: none; }

h1.ri-title {
  display: flex; align-items: center; gap: 0.85rem;
  font-family: var(--font-serif); font-weight: 400;
  font-size: clamp(1.8rem, 5.2vw, 3.4rem); line-height: 1.06; letter-spacing: -0.01em;
  color: var(--text-strong);
}
h1.ri-title .icon { flex-shrink: 0; width: 1em; height: 1em; color: var(--accent); }
h1.ri-title .icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
.ri-lede { color: var(--text-muted); font-size: clamp(1.05rem, 1.6vw, 1.2rem); line-height: 1.55; max-width: 48rem; }

.ri-divider { height: 1px; background: var(--border-soft); margin: 0.25rem 0; }

h2.ri-section-title {
  display: flex; align-items: center; gap: 0.6rem;
  font-family: var(--font-serif); font-weight: 400;
  font-size: clamp(1.2rem, 2.4vw, 1.7rem); color: var(--text-strong);
}
h2.ri-section-title .icon { flex-shrink: 0; width: 1em; height: 1em; color: var(--accent); }
h2.ri-section-title .icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }

.ri-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.ri-card {
  display: grid; gap: 0.55rem; align-content: start;
  padding: 1.1rem 1.2rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(12px);
  transition: transform .18s var(--easing), border-color .18s var(--easing), background .18s var(--easing);
  text-decoration: none; color: inherit;
}
.ri-card:hover { transform: translateY(-2px); border-color: var(--border-strong); background: var(--surface-hover); }
.ri-card-head {
  display: flex; align-items: center; gap: 0.55rem;
  color: var(--text-strong); font-weight: 600; font-size: 1.02rem; letter-spacing: -0.005em;
}
.ri-card-head .icon { flex-shrink: 0; width: 1em; height: 1em; color: var(--accent); }
.ri-card-head .icon svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.ri-card-blurb { color: var(--text-muted); font-size: 0.92rem; line-height: 1.5; }

footer.ri-foot { color: var(--text-faint); font-size: 0.82rem; text-align: center; padding-top: 1rem; }
`

const PAINT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('hc:dolphin:theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (_) {}
})();
`

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
`

const titleCase = (s) => s.split(/[-\s]/).map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ')

const renderPage = ({ name, iconKey, eyebrow, title, lede, sectionTitle, cards, chromeSig }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Relational Intelligence</title>
  <script>${PAINT_SCRIPT}</script>
  <link rel="stylesheet" href="resource:${chromeSig}/chrome.css">
</head>

<body>
  <div class="ri-backdrop" aria-hidden="true"></div>
  <main>
    <div class="ri-eyebrow">
      <span><a href="/dolphin">Relational Intelligence</a> · ${eyebrow}</span>
      <button type="button" class="theme-toggle" id="themeToggle" aria-label="toggle theme">
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 14.5a8 8 0 0 1-11.2-11.2 8 8 0 1 0 11.2 11.2z"/></svg>
        <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>
      </button>
    </div>

    <h1 class="ri-title">
      <span class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">${ICONS[iconKey] ?? ICONS.dot}</svg>
      </span>
      <span>${title}</span>
    </h1>
    <p class="ri-lede">${lede}</p>

    <div class="ri-divider"></div>

    <section>
      <h2 class="ri-section-title">
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">${ICONS.branches}</svg>
        </span>
        <span>${sectionTitle}</span>
      </h2>
      <div class="ri-grid" style="margin-top:1.2rem;">
        ${cards.map((c, i) => `
          <a class="ri-card" href="${c.href}">
            <div class="ri-card-head">
              <span class="icon"><svg viewBox="0 0 24 24">${ICONS[c.iconKey ?? pickCardIcon(i)] ?? ICONS.dot}</svg></span>
              <span>${c.title}</span>
            </div>
            <p class="ri-card-blurb">${c.blurb}</p>
          </a>
        `).join('')}
      </div>
    </section>

    <footer class="ri-foot">Right-click anywhere to step back · ${name} · merkle contract</footer>
  </main>

  <script>${TOGGLE_SCRIPT}</script>
</body>
</html>
`

// ─── per-cell content ───────────────────────────────────────────────

const childCard = (name, blurb, iconKey) => ({ title: titleCase(name), href: `${name}/`, blurb, iconKey })

const PAGES = [
  {
    segments: ['dolphin'],
    iconKey: 'dolphin',
    eyebrow: 'the field',
    title: 'Relating well is an intelligence — name it, train it, live it.',
    lede: 'Relational Intelligence isn’t a personality trait or a soft skill. It’s a learnable capacity that shows up in how individuals, couples, professionals, organizations, and communities meet each other. This is the field — the model, the practice, the evidence, and the people building it together.',
    sectionTitle: 'The eight branches',
    cards: [
      { title: 'Model',     href: 'model/',     blurb: 'The conceptual core: vision, philosophy, the four pillars, and the relational capacities that develop.', iconKey: 'model' },
      { title: 'Practice',  href: 'practice/',  blurb: 'How the model becomes lived experience. Programs, events, trainings, and certification.',                iconKey: 'practice' },
      { title: 'Evidence',  href: 'evidence/',  blurb: 'The proof: foundational science, applied research, academic partnerships, humanity outcomes.',            iconKey: 'evidence' },
      { title: 'Audience',  href: 'audience/',  blurb: 'Who this is for: individuals, couples, professionals, organizations, communities.',                       iconKey: 'audience' },
      { title: 'Voice',     href: 'voice/',     blurb: 'Outward expression — podcast, writing, video, social, resources. How the work reaches people.',           iconKey: 'voice' },
      { title: 'Network',   href: 'network/',   blurb: 'The people around the work: collaborators, governance, engagement. Co-created, not solo.',                iconKey: 'network' },
      { title: 'Platform',  href: 'platform/',  blurb: 'The tech infrastructure: learning, community hub, practitioner tools, AI automation, integrations.',      iconKey: 'platform' },
      { title: 'Business',  href: 'business/',  blurb: 'How RI sustains itself: brand, operations, marketing, sales, client experience, growth phases.',          iconKey: 'business' },
    ],
  },
  {
    segments: ['dolphin', 'model'],
    iconKey: 'model',
    eyebrow: 'Model',
    title: 'The model',
    lede: 'The conceptual core: vision, philosophy, the four pillars, and the relational capacities that develop. The thesis is simple — relating well is a learnable intelligence, not a personality trait.',
    sectionTitle: 'What’s in the model',
    cards: [
      childCard('pillars', 'The four supporting structures the whole field rests on.'),
      childCard('capacities', 'Relational capacities people grow through deliberate practice.'),
      childCard('frameworks', 'Working frameworks practitioners and learners use day to day.'),
      childCard('intellectual-property', 'Authored work — naming, attribution, license.'),
    ],
  },
  {
    segments: ['dolphin', 'practice'],
    iconKey: 'practice',
    eyebrow: 'Practice',
    title: 'The practice',
    lede: 'How the model becomes lived experience — programs, events, trainings, certification. The bridge from idea to embodied skill, where audiences actually meet the work.',
    sectionTitle: 'How people meet the work',
    cards: [
      childCard('live', 'In-person events, workshops, retreats — the unmediated room.'),
      childCard('online', 'Cohorts and self-paced learning that scale beyond the room.'),
      childCard('certification', 'A path for practitioners to teach the work themselves.'),
    ],
  },
  {
    segments: ['dolphin', 'evidence'],
    iconKey: 'evidence',
    eyebrow: 'Evidence',
    title: 'The evidence',
    lede: 'Proof that the work moves people. Foundational science, applied research, academic partnerships, humanity outcomes, systemic change. Without research credibility, RI is opinion.',
    sectionTitle: 'Where the proof lives',
    cards: [
      childCard('foundational-science', 'Source theory and the science RI builds from.'),
      childCard('applied-research', 'Studies on RI in practice — measured outcomes.'),
      childCard('academic-partnerships', 'Universities and labs co-authoring the field.'),
      childCard('humanity-outcomes', 'Individual and group results — people changed.'),
      childCard('systemic-change', 'Organizations and communities shifting.'),
      childCard('legacy', 'Long-arc proof — what holds across decades.'),
    ],
  },
  {
    segments: ['dolphin', 'audience'],
    iconKey: 'audience',
    eyebrow: 'Audience',
    title: 'Who this is for',
    lede: 'Same underlying skill, different presenting concerns: individuals seeking depth, couples doing the work together, professionals carrying it into their craft, organizations remaking culture, communities held in common.',
    sectionTitle: 'The five segments',
    cards: [
      childCard('individuals', 'Solo practitioners deepening their relational range.'),
      childCard('couples', 'Two people building shared capacity together.'),
      childCard('professionals', 'Coaches, therapists, leaders — carrying it into work.'),
      childCard('organizations', 'Teams and companies remaking how they relate.'),
      childCard('communities', 'Groups holding the work in common.'),
    ],
  },
  {
    segments: ['dolphin', 'voice'],
    iconKey: 'voice',
    eyebrow: 'Voice',
    title: 'Outward expression',
    lede: 'How the work reaches people who haven’t found it yet. Podcast, writing, video, social, resources — each surface speaks to a different way of arriving.',
    sectionTitle: 'The five surfaces',
    cards: [
      childCard('podcast', 'The Relational Intelligence Podcast — long-form conversations with collaborators in the field.'),
      childCard('writing', 'Book manuscript, articles, newsletter, white papers, case studies. The book is the anchor.'),
      childCard('video', 'YouTube, course videos, social clips, documentary, live streams. Modeling teaches faster than telling.'),
      childCard('social', 'The everyday surface — short-form, conversational, at-the-edge-of-the-conversation.'),
      childCard('resources', 'Free and paid downloads — worksheets, guides, tools.'),
    ],
  },
  {
    segments: ['dolphin', 'network'],
    iconKey: 'network',
    eyebrow: 'Network',
    title: 'The people around the work',
    lede: 'Collaborators in the field, community members, governance structures. Dolphin builds with peers — RI is co-created, not solo.',
    sectionTitle: 'Who shows up',
    cards: [
      childCard('collaborators', 'Co-authors, co-teachers, co-builders. Named contribution.'),
      childCard('roles', 'Defined positions — who does what, where authority lives.'),
      childCard('governance', 'Decision rules, conflict patterns, succession.'),
      childCard('engagement', 'How people enter, contribute, level up, leave well.'),
    ],
  },
  {
    segments: ['dolphin', 'platform'],
    iconKey: 'platform',
    eyebrow: 'Platform',
    title: 'The platform',
    lede: 'The tech infrastructure that hosts the practice — learning environment, community hub, practitioner tools, AI automation, integrations. A future-proof home for the field.',
    sectionTitle: 'The five layers',
    cards: [
      childCard('learning', 'Where lessons, cohorts, and progress live.'),
      childCard('community-hub', 'Threads, groups, presence, ongoing conversation.'),
      childCard('practitioner-tools', 'Working surfaces certified practitioners use.'),
      childCard('ai-automation', 'Where AI carries weight without taking the work’s soul.'),
      childCard('integrations', 'Connections to the wider tools people already use.'),
    ],
  },
  {
    segments: ['dolphin', 'business'],
    iconKey: 'business',
    eyebrow: 'Business',
    title: 'How it sustains itself',
    lede: 'Brand, operations, marketing, sales, client experience, growth phases. The discipline of running it well so the work can keep showing up.',
    sectionTitle: 'The six pillars',
    cards: [
      childCard('brand', 'Voice, identity, story — how the work is recognized.'),
      childCard('operations', 'Day-to-day mechanics, contracts, compliance.'),
      childCard('marketing', 'Reach — finding and inviting new participants.'),
      childCard('sales', 'Conversations that turn interest into commitment.'),
      childCard('client-experience', 'What it feels like to be inside the work.'),
      childCard('phases', 'Growth stages — what changes as the field scales.'),
    ],
  },
]

// ─── stamp loop ─────────────────────────────────────────────────────

;(async () => {
  // Mint the shared chrome stylesheet ONCE. Every page links it via
  // `<link href="resource:<sig>">`; the renderer rewrites that to
  // `/@resource/<sig>` and the service worker serves it as text/css
  // from OPFS __resources__/. Same content → same sig → browser
  // caches one stylesheet across every cell.
  process.stdout.write('chrome.css ... ')
  const chromePut = await send({ op: 'put-resource', text: CSS })
  if (!chromePut.ok) {
    console.log(`FAILED: ${chromePut.error}`)
    process.exit(1)
  }
  const chromeSig = chromePut.data.sig
  console.log(`sig=${chromeSig.slice(0, 12)} (${CSS.length} bytes)`)

  let ok = 0
  let failed = 0
  for (const page of PAGES) {
    const html = renderPage({
      name: page.segments.slice(-1)[0],
      iconKey: page.iconKey,
      eyebrow: page.eyebrow,
      title: page.title,
      lede: page.lede,
      sectionTitle: page.sectionTitle,
      cards: page.cards,
      chromeSig,
    })
    process.stdout.write(`/${page.segments.join('/')} (${html.length} bytes) ... `)
    try {
      const put = await send({ op: 'put-resource', text: html })
      if (!put.ok) throw new Error(put.error || 'put-resource failed')
      const sig = put.data.sig
      // Write the page as a visual-bee DECORATION (kind
      // `visual:website:page`) rather than a raw entry in the cell's
      // `context` slot. `decoration-add` with `replaceKind: true` drops
      // any prior website decoration on this cell and appends the new
      // one to the cell's `decorations` slot. site-view.drone's
      // `#findDecorationPage` resolves the decoration → payload.htmlSig
      // → resource bytes → renders.
      const dec = await send({
        op: 'decoration-add',
        segments: page.segments,
        kind: 'visual:website:page',
        appliesTo: page.segments,
        payload: { htmlSig: sig, order: 0, createdAt: Date.now() },
        mark: 'persistent',
        replaceKind: true,
      })
      if (!dec.ok) throw new Error(dec.error || 'decoration-add failed')
      console.log(`sig=${sig.slice(0, 12)} dec=${dec.data.sig.slice(0, 12)}`)
      ok++
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed++
    }
  }
  console.log(`\nDone. chrome=${chromeSig.slice(0, 12)}, ${ok} pages stamped, ${failed} failed.`)
})()
