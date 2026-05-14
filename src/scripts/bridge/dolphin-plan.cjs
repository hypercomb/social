// Build the "dolphin" hub via the Hypercomb bridge.
//
// Dolphin (Jaime's brother) is the founder of Relational Intelligence —
// a framework + practice teaching how relational dynamics shape
// individuals, teams, and communities. He's building:
//   - coaching (1:1 + group)
//   - certifications (training other practitioners)
//   - live events (workshops, retreats)
//   - a community co-creation platform
//
// This script seeds a hub at /dolphin/ that mirrors that structure and
// drops descriptive notes on each tile so the surface is browseable
// before any per-cell pages exist. Idempotent against re-runs (bridge
// add ops are non-destructive — re-running just no-ops).
//
// Prereqs:
//   - bridge listening on :2401 (run scripts/bridge/run-bridge.cjs)
//   - a renderer connected (open dev shell with ?claudeBridge=1)
//
// Usage:
//   NODE_PATH=/c/Projects/hypercomb/social/src/node_modules \
//     node scripts/bridge/dolphin-plan.cjs

const WebSocket = require('ws')

const BRIDGE = 'ws://127.0.0.1:2401'
const TIMEOUT_MS = 10_000

let counter = 0
const nextId = () => `dolphin-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const msg = { ...req, id }
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) }
      ws.close()
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

async function add(segments, cells) {
  const r = await send({ op: 'add', segments, cells })
  if (!r.ok) throw new Error(`add ${segments.join('/') || '/'} ${cells.join(',')}: ${r.error}`)
  console.log(`  + ${segments.join('/') || '/'} ← ${cells.join(', ')}`)
}

async function note(segments, cell, text) {
  const r = await send({ op: 'note-add', segments, cell, text })
  if (!r.ok) console.warn(`  ! note ${segments.join('/')}/${cell}: ${r.error}`)
}

async function main() {
  console.log('dolphin hub — building via bridge\n')

  // ── root: dolphin ──────────────────────────────────────────────
  await add([], ['dolphin'])
  await note([], 'dolphin',
    'Dolphin Mojica — founder of Relational Intelligence. Coaching, ' +
    'certifications, live events, and a community co-creation platform ' +
    'organised around how relational dynamics shape individuals, teams, ' +
    'and communities.')

  // ── top-level sections ─────────────────────────────────────────
  await add(['dolphin'], [
    'about',
    'relational-intelligence',
    'coaching',
    'certifications',
    'events',
    'community',
    'resources',
    'contact',
  ])

  await note(['dolphin'], 'about',
    'Who Dolphin is, where this work comes from, the through-line from ' +
    'lived practice to teaching practice. Bio + origin story + the people ' +
    'who shaped the framework.')

  // ── relational-intelligence (the framework) ────────────────────
  await note(['dolphin'], 'relational-intelligence',
    'The framework. RI maps the patterns that show up between people — ' +
    'the moves, the misses, the moments that change a relationship. ' +
    'Children: principles, practices, language, case-studies.')
  await add(['dolphin', 'relational-intelligence'], [
    'principles', 'practices', 'language', 'case-studies',
  ])
  await note(['dolphin', 'relational-intelligence'], 'principles',
    'Foundational ideas — the load-bearing pillars of the framework. ' +
    'Why RI matters, what it claims, what it doesn\'t.')
  await note(['dolphin', 'relational-intelligence'], 'practices',
    'The exercises and protocols that make RI a practice instead of a ' +
    'theory. Daily, weekly, in-the-moment.')
  await note(['dolphin', 'relational-intelligence'], 'language',
    'Vocabulary. The terms RI uses to name patterns participants need ' +
    'to talk about — naming a thing makes it discussable.')
  await note(['dolphin', 'relational-intelligence'], 'case-studies',
    'Examples from real coaching engagements (anonymised). What the ' +
    'pattern looked like, what intervention helped, what changed.')

  // ── coaching ───────────────────────────────────────────────────
  await note(['dolphin'], 'coaching',
    'Working with Dolphin. 1:1 and group formats. Outcomes-led — every ' +
    'engagement starts with a clear contract about what you\'re trying ' +
    'to shift.')
  await add(['dolphin', 'coaching'], [
    'one-on-one', 'group', 'team-engagements', 'pricing', 'enquire',
  ])
  await note(['dolphin', 'coaching'], 'one-on-one',
    'Individual coaching. 6 / 12 / open-ended engagements. Cadence is ' +
    'weekly with async support between sessions.')
  await note(['dolphin', 'coaching'], 'group',
    'Small-group cohorts (4–8 people). Structured around a single arc; ' +
    'participants do their work in front of and with each other.')
  await note(['dolphin', 'coaching'], 'team-engagements',
    'Team-level work. Diagnostic + intervention + follow-through. ' +
    'Best fit for teams stuck in a recurring relational pattern.')
  await note(['dolphin', 'coaching'], 'pricing',
    'Transparent rates. Sliding scale available for individuals; ' +
    'organisations pay full freight.')
  await note(['dolphin', 'coaching'], 'enquire',
    'Application + intake form. 30-min discovery call to confirm fit ' +
    'before any commitment.')

  // ── certifications ─────────────────────────────────────────────
  await note(['dolphin'], 'certifications',
    'Training programmes for practitioners who want to teach RI in ' +
    'their own contexts (coaches, therapists, organisational ' +
    'consultants, educators).')
  await add(['dolphin', 'certifications'], [
    'foundation', 'practitioner', 'master', 'requirements', 'cohorts',
  ])
  await note(['dolphin', 'certifications'], 'foundation',
    'Entry-level certification. ~6 months. Covers principles, language, ' +
    'and basic interventions. Required for further levels.')
  await note(['dolphin', 'certifications'], 'practitioner',
    'Practitioner certification. ~12 months. Supervised practice + ' +
    'case write-ups + evaluation panel.')
  await note(['dolphin', 'certifications'], 'master',
    'Master certification. By invitation. Includes teaching component ' +
    'and contribution back to the framework (case studies, writings).')
  await note(['dolphin', 'certifications'], 'requirements',
    'Prerequisites + reading list + expected hours of supervised ' +
    'practice. Same shape across levels with different depth.')
  await note(['dolphin', 'certifications'], 'cohorts',
    'Active and upcoming cohorts. Apply via the form linked from each ' +
    'cohort page.')

  // ── events ─────────────────────────────────────────────────────
  await note(['dolphin'], 'events',
    'Live experiences. Workshops, retreats, conferences. The format ' +
    'where RI shows up most viscerally — relational dynamics in real ' +
    'time among strangers.')
  await add(['dolphin', 'events'], [
    'upcoming', 'workshops', 'retreats', 'past-events',
  ])
  await note(['dolphin', 'events'], 'upcoming',
    'Calendar of confirmed events. Click through for venue, dates, ' +
    'cost, application form.')
  await note(['dolphin', 'events'], 'workshops',
    'Day or weekend workshops. Themed (conflict, belonging, leadership, ' +
    'partnership). 12–24 participants.')
  await note(['dolphin', 'events'], 'retreats',
    'Multi-day immersive retreats. Smaller groups (8–14). Held in ' +
    'natural settings; phones-off culture.')
  await note(['dolphin', 'events'], 'past-events',
    'Archive. Photos, summaries, reflections from prior gatherings — ' +
    'sets expectations for newcomers.')

  // ── community ──────────────────────────────────────────────────
  await note(['dolphin'], 'community',
    'The co-creation platform. RI isn\'t a one-way curriculum — ' +
    'practitioners contribute language, case studies, refinements. The ' +
    'community is where that gets done.')
  await add(['dolphin', 'community'], [
    'platform', 'practitioners', 'circles', 'contributions',
  ])
  await note(['dolphin', 'community'], 'platform',
    'How the platform works. Roles, contribution flows, curation. ' +
    'Tech-honest: surfaces the editing model, not just the polished ' +
    'output.')
  await note(['dolphin', 'community'], 'practitioners',
    'Directory of certified practitioners and contributors, with ' +
    'their specialties and locations.')
  await note(['dolphin', 'community'], 'circles',
    'Local + topical practice circles. Where practitioners + ' +
    'students show up to do reps together between formal training.')
  await note(['dolphin', 'community'], 'contributions',
    'How to contribute. Writings, case studies, language proposals, ' +
    'event hosting. Each contribution path with clear next steps.')

  // ── resources ──────────────────────────────────────────────────
  await note(['dolphin'], 'resources',
    'Writings, podcasts, recommended reading. The slow-cooked content ' +
    'that lives on past any single workshop or session.')
  await add(['dolphin', 'resources'], [
    'writings', 'podcasts', 'reading-list', 'glossary',
  ])
  await note(['dolphin', 'resources'], 'writings',
    'Long-form essays + short notes from Dolphin. Organised by theme.')
  await note(['dolphin', 'resources'], 'podcasts',
    'Audio interviews + dialogues. Long-form conversations about RI ' +
    'and adjacent fields.')
  await note(['dolphin', 'resources'], 'reading-list',
    'Curated bibliography. The books and papers that shaped RI, with ' +
    'short rationales for each.')
  await note(['dolphin', 'resources'], 'glossary',
    'Quick-reference for RI vocabulary. Cross-linked to the relational-' +
    'intelligence/language tile for the longer treatment.')

  // ── contact ────────────────────────────────────────────────────
  await note(['dolphin'], 'contact',
    'Get in touch. Form for general enquiries, direct email for press, ' +
    'application links for coaching/certifications, social handles.')

  console.log('\ndone.')
}

main().catch(err => { console.error(err); process.exit(1) })
