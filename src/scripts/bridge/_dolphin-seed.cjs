// Comprehensive seed for Dolphin's RI business. Drives the bridge at
// ws://localhost:2401 so whatever browser is the active renderer
// receives the ops. To target YOUR browser, refresh
// http://localhost:4250 with the bridge enabled
// (localStorage.hypercomb.claudeBridge.enabled='1') BEFORE running.
//
// Builds:
//   • dolphin root
//   • 7 top-level branches: coaching, certifications, live-events,
//     community, content, operations, identity
//   • 4-6 mid-level leaves per branch (39 total)
//   • Extra 3rd-level cells on the high-value branches
//     (coaching/1-on-1, certifications/foundational, content/frameworks)
//   • Paragraph note on root + each branch
//   • Sentence note on each leaf and 3rd-level cell
//
//   node scripts/bridge/_dolphin-seed.cjs
//
// Idempotent — re-running converges on the same tree (same names →
// same locSigs → same dedup behavior). Run before _dolphin-revision.cjs.

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'

let counter = 0
const nextId = () => `seed-${Date.now()}-${++counter}`

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

// ─── tree shape ─────────────────────────────────────────────────────

// Branches and their direct leaves (level 2).
const TREE = {
  'coaching':       ['1-on-1', 'group', 'retreats', 'intake', 'pricing', 'outcomes'],
  'certifications': ['foundational', 'advanced', 'mentor', 'curriculum', 'cohorts', 'assessments'],
  'live-events':    ['workshops', 'retreats', 'summits', 'calendar', 'playbook', 'archive'],
  'community':      ['circles', 'practice-spaces', 'members', 'library', 'feedback', 'governance'],
  'content':        ['essays', 'podcasts', 'talks', 'frameworks', 'case-studies', 'publishing'],
  'operations':     ['pipeline', 'team', 'legal', 'finances', 'tools'],
  'identity':       ['manifesto', 'voice', 'audiences', 'visual'],
}

// Extra third-level depth on the high-value branches. Each entry is
// keyed by branch/leaf and lists sub-cells.
const DEEP = {
  'coaching/1-on-1':            ['intake-flow', 'arc-protocol', 'session-formats', 'follow-up'],
  'coaching/group':             ['pod-design', 'facilitation', 'cross-pollination'],
  'coaching/retreats':          ['arc-design', 'format', 'locations'],
  'coaching/pricing':           ['tier-1-individual', 'tier-2-group', 'tier-3-retreat'],
  'certifications/foundational':['curriculum-12wk', 'cohort-schedule', 'application', 'alumni'],
  'certifications/advanced':    ['prerequisites', 'curriculum'],
  'certifications/mentor':      ['selection', 'responsibilities', 'compensation'],
  'certifications/curriculum':  ['ri-fundamentals', 'practice-modules', 'ethics', 'measurement'],
  'certifications/assessments': ['foundation-exam', 'practical-eval', 'mentor-review'],
  'content/frameworks':         ['four-pillars', 'capacity-map', 'practice-arc'],
  'content/essays':             ['cornerstone-essays', 'series', 'editorial-calendar'],
  'live-events/playbook':       ['run-of-show', 'staff-roles', 'materials-list', 'venue-spec'],
  'community/circles':          ['circle-charter', 'facilitator-guide', 'cadence'],
  'operations/pricing-strategy':['ladder-design', 'discount-policy', 'review-cycle'],
}

// ─── notes ──────────────────────────────────────────────────────────

const ROOT_NOTE = 'Relational Intelligence — the body of work, the certification path, the community that grows it. Seven branches: coaching pressure-tests the practice, certifications propagate it, live-events deepen it, community holds it together, content makes it findable, operations keeps it running, identity makes it coherent.'

const TOP_NOTES = {
  'coaching':       'The pressure-test of RI. 1:1 IS the methodology — every session generates evidence of what works, what doesn\'t, what the next cohort needs to learn. Treat coaching engagements as both revenue and R&D. Group cohorts surface relational dynamics 1:1 can\'t. Retreats are the deepest tier.',
  'certifications': 'Multi-tier path that propagates RI without diluting it. Foundational teaches the practice. Advanced teaches teaching. Mentor teaches assessing. Each tier is gated by demonstrated outcomes, not seat-time. The directory of certified practitioners is the public proof of the method.',
  'live-events':    'In-person ritual matters for relational work in ways async media can\'t replicate. Workshops are entry points, retreats deepen practice, summits gather the certified field. Calendar drives the year\'s rhythm; the playbook makes each format reproducible across locations.',
  'community':      'Connective tissue between coaching, certs, and events. Circles run between formal touchpoints. Practice spaces let new graduates flex without high stakes. Library curates what the field is producing. Feedback loops route signal back into curriculum + content updates.',
  'content':        'How RI reaches people who haven\'t signed up for anything yet. Essays make the case. Podcasts let people meet Dolphin\'s voice. Talks plant flags at conferences. Frameworks are the canonical artifacts — the named, drawn, citable models that practitioners point to.',
  'operations':     'The substrate that keeps everything else from breaking. Pricing model determines who can afford the path. Pipeline tracks who\'s mid-journey. Team & roles define hand-offs. Legal protects the certification mark. Tools are the chosen tech stack.',
  'identity':       'Who Dolphin is, in language consistent across every surface. Manifesto is the why. Voice is the how. Audiences names the who. Visual is the look. When all four cohere, every artifact reinforces every other.',
}

const LEAF_NOTES = {
  // coaching
  'coaching/1-on-1':            'Flagship engagement. 6-12 session arcs — intake → diagnostic → working → integration. Where the methodology is sharpest.',
  'coaching/group':             'Pods of 4-6 running parallel arcs with cross-pollination. Lower cost-per-seat; surfaces dynamics 1:1 can\'t.',
  'coaching/retreats':          'Multi-day immersive coaching outside daily life. Deepest tier. Reserved for clients who\'ve done foundational work.',
  'coaching/intake':            'Diagnostic interview, baseline assessment, fit check. Both sides confirm match before money moves. Document the protocol.',
  'coaching/pricing':           'Tier ladder: 1:1, group, retreat. Each has its own revenue role. Set once; revisit annually.',
  'coaching/outcomes':          'How clients describe what changed. Collected systematically — R&D first, marketing second.',
  // certifications
  'certifications/foundational':'Entry tier. Teaches RI practice to people who want to apply it (coaches, leaders, therapists). 12-week format with weekly live calls + practicum.',
  'certifications/advanced':    'Teaches teaching the practice. Required for anyone leading group cohorts under the RI mark. Smaller cohorts, higher rigor.',
  'certifications/mentor':      'Top tier. Mentors assess practitioners and contribute to curriculum. Lifetime commitment to the field.',
  'certifications/curriculum':  'The taught material across all tiers. Lives as canonical documents; updated quarterly from field feedback.',
  'certifications/cohorts':     'Schedule of running cohorts. Capacity caps protect quality. Waitlist policy matters.',
  'certifications/assessments': 'How candidates demonstrate competence. Pass criteria, rubrics, appeal process. Public so it\'s defensible.',
  // live-events
  'live-events/workshops':      '1-2 day formats. Entry point for prospects + tune-up for alumni.',
  'live-events/retreats':       '3-7 day deep formats. Limited capacity, in-person, residential. Premium pricing.',
  'live-events/summits':        'Annual gathering of certified practitioners. Field synchronization.',
  'live-events/calendar':       'Year-ahead schedule. Anchored by foundational cohort starts.',
  'live-events/playbook':       'How to run each event format. Reproducible by trained hosts.',
  'live-events/archive':        'Post-event recordings, photos, notes. Becomes content.',
  // community
  'community/circles':          'Self-organizing groups of 4-8 meeting between events. Peer-led.',
  'community/practice-spaces':  'Sandboxes for new graduates to practice without high stakes.',
  'community/members':          'Directory of every certified practitioner. Public-facing.',
  'community/library':          'Curated practitioner-contributed essays, recordings, case studies.',
  'community/feedback':         'How signal from practice flows back into curriculum and content.',
  'community/governance':       'Who decides what RI is as the field grows.',
  // content
  'content/essays':             'Long-form writing. The intellectual surface. 1-2 per month sustainable cadence.',
  'content/podcasts':           'Conversations with practitioners and adjacent thinkers.',
  'content/talks':              'Conference + summit keynotes. Flag-planting at adjacent fields.',
  'content/frameworks':         'The named, drawn, citable models. Each gets canonical page + diagram + 1-line def.',
  'content/case-studies':       'Anonymized client arcs. Highest evidentiary weight.',
  'content/publishing':         'Cadence, channels, syndication. Where content goes after writing.',
  // operations
  'operations/pipeline':        'CRM of prospects, applicants, active clients, alumni.',
  'operations/team':            'Who does what. Roles, capacities, hand-offs.',
  'operations/legal':           'Cert mark trademark, practitioner agreement, IP, retreat liability.',
  'operations/finances':        'Revenue by tier, cost centers, runway. Monthly review.',
  'operations/tools':           'Tech stack: payments, scheduling, content, community, video.',
  // identity
  'identity/manifesto':         'Why RI exists. What it claims about the world. Unchanging core.',
  'identity/voice':             'How Dolphin sounds. Tone, vocabulary, rhythm.',
  'identity/audiences':         'Who the work is for. Personas, contexts.',
  'identity/visual':            'Color, typography, image style, logo usage.',
}

const DEEP_NOTES = {
  // coaching/1-on-1
  'coaching/1-on-1/intake-flow':         'The intake interview script + diagnostic + alignment check. The protocol every new client runs through before the first paid session.',
  'coaching/1-on-1/arc-protocol':        'The 6-12 session arc shape: diagnostic → working → integration. What changes mark transitions between phases.',
  'coaching/1-on-1/session-formats':     'Standard session length, frequency, modality (in-person / video / phone). The defaults; alternatives by client need.',
  'coaching/1-on-1/follow-up':           'Post-engagement check-ins. Quarterly touch-base for arc graduates. Captures longitudinal outcomes.',
  // coaching/group
  'coaching/group/pod-design':           'How groups get composed — size, diversity criteria, application screening. Bad pod composition breaks the format.',
  'coaching/group/facilitation':         'The facilitator role across an 8-12 week pod cycle. Skills required, training, hand-off protocol.',
  'coaching/group/cross-pollination':    'Pairing exercises, breakout structures, witnessing — how group dynamics get used productively rather than tolerated.',
  // coaching/retreats
  'coaching/retreats/arc-design':        'The shape of a multi-day retreat — opening, deepening, integration. What gets done morning vs evening vs day 3.',
  'coaching/retreats/format':            'Day-by-day structure. Mix of practice, reflection, embodied work, free time.',
  'coaching/retreats/locations':         'Venue criteria. Tested locations. Backup options. Capacity per venue.',
  // coaching/pricing
  'coaching/pricing/tier-1-individual':  'Pricing for 1:1 arcs. Single sessions, packages, retainers. Discount policy.',
  'coaching/pricing/tier-2-group':       'Pricing for group cohorts. Per-seat, scholarship slots, group rates.',
  'coaching/pricing/tier-3-retreat':     'Pricing for retreats. All-in vs venue-only. Travel scholarships.',
  // certifications/foundational
  'certifications/foundational/curriculum-12wk': 'Week-by-week curriculum. Reading, practice assignments, live-call topics. Practicum requirements per week.',
  'certifications/foundational/cohort-schedule': 'Running and upcoming foundational cohorts. Application windows, start dates, capacity.',
  'certifications/foundational/application':     'How candidates apply. Essay prompts, prerequisites, interview, decision timeline.',
  'certifications/foundational/alumni':          'Foundational alumni directory. Where they\'re practicing, what they\'re building.',
  // certifications/advanced
  'certifications/advanced/prerequisites':       'What you need before applying — foundational complete, X clients logged, mentor recommendation.',
  'certifications/advanced/curriculum':          'Pedagogy of teaching, group dynamics at scale, ethics of training others.',
  // certifications/mentor
  'certifications/mentor/selection':             'How mentors get selected from advanced graduates. Criteria, nomination process, training.',
  'certifications/mentor/responsibilities':      'What mentors do — assess candidates, contribute curriculum, hold field standards.',
  'certifications/mentor/compensation':          'How mentor work is compensated. Hourly, retainer, equity in the field.',
  // certifications/curriculum
  'certifications/curriculum/ri-fundamentals':   'The base model — pillars, capacities, frameworks. The shared vocabulary every tier inherits.',
  'certifications/curriculum/practice-modules':  'Hands-on practice exercises. Sequencing, when each is introduced, supervision needs.',
  'certifications/curriculum/ethics':            'Ethics of practice — confidentiality, scope of practice, referral protocols, dual-relationship handling.',
  'certifications/curriculum/measurement':       'How outcomes get measured. Pre/post instruments, longitudinal tracking, what counts as evidence.',
  // certifications/assessments
  'certifications/assessments/foundation-exam':  'Written + scenario-based assessment at foundational tier. Pass criteria. Retake policy.',
  'certifications/assessments/practical-eval':   'Live observed practice session at advanced+. Rubric. Calibration across assessors.',
  'certifications/assessments/mentor-review':    'Mentor sign-off process. What mentors look for. Disagreement-resolution path.',
  // content/frameworks
  'content/frameworks/four-pillars':             'The four core pillars of RI. Each pillar gets its own canonical page with diagram.',
  'content/frameworks/capacity-map':             'The map of relational capacities — what they are, how they develop, how to assess.',
  'content/frameworks/practice-arc':             'The arc of developing RI in practice. Stages, common stuck-points, indicators of growth.',
  // content/essays
  'content/essays/cornerstone-essays':           'The 3-5 essays that anchor the public-facing argument. Most-linked, most-shared.',
  'content/essays/series':                       'Themed multi-part essay series. Lets readers go deep on a single concept.',
  'content/essays/editorial-calendar':           'What\'s coming, when, by whom. Rolling 90-day horizon.',
  // live-events/playbook
  'live-events/playbook/run-of-show':            'Minute-by-minute schedule template for each event format. Adapt per event.',
  'live-events/playbook/staff-roles':            'Who does what during an event. Host, facilitators, AV, registration, hospitality.',
  'live-events/playbook/materials-list':         'Required physical + digital materials per format. Sourcing notes.',
  'live-events/playbook/venue-spec':             'Venue requirements — capacity, layout, AV, breakout rooms, accessibility, accommodation tiers.',
  // community/circles
  'community/circles/circle-charter':            'The minimum agreement for a circle to exist under the RI banner. Size, cadence, confidentiality, exit norms.',
  'community/circles/facilitator-guide':         'How to facilitate a circle without it becoming therapy. Scope, redirection, escalation.',
  'community/circles/cadence':                   'Recommended meeting cadence — weekly, bi-weekly, monthly. Trade-offs.',
  // operations/pricing-strategy
  'operations/pricing-strategy/ladder-design':   'How the price ladder is shaped across tiers. Anchors, jumps, sustainability checks.',
  'operations/pricing-strategy/discount-policy': 'When discounts apply — early-bird, scholarship, alumni, multi-event.',
  'operations/pricing-strategy/review-cycle':    'Annual pricing review. Inputs, decision criteria, communication plan.',
}

// ─── runner ─────────────────────────────────────────────────────────

;(async () => {
  console.log('1) Probing bridge + renderer...')
  const probe = await send({ op: 'list' }).catch(e => ({ ok: false, error: String(e?.message ?? e) }))
  if (!probe.ok && probe.error !== 'no renderer connected' && !/cell|name/i.test(String(probe.error || ''))) {
    console.error('Bridge not reachable:', probe.error)
    console.error('Start `claude bridge` and refresh http://localhost:4250 with ?claudeBridge=1 or localStorage flag set.')
    process.exit(1)
  }
  console.log(`   bridge OK (renderer ${probe.ok ? 'connected' : 'will retry on each op'})`)

  console.log('2) Minting dolphin root + 7 branches + leaves (3-level cascade)...')
  let made = 0
  for (const [branch, leaves] of Object.entries(TREE)) {
    for (const leaf of leaves) {
      const r = await withRenderer({ op: 'update', segments: ['dolphin', branch, leaf], layer: { name: leaf, children: [] } })
      if (r.ok) { made++ } else { console.log(`   FAILED ${branch}/${leaf}: ${r.error}`) }
    }
  }
  console.log(`   ${made} mid-level leaves committed`)

  console.log('3) Minting 3rd-level deep cells (richer business surface)...')
  let deepMade = 0
  for (const [parent, kids] of Object.entries(DEEP)) {
    const segs = parent.split('/')
    for (const kid of kids) {
      const r = await withRenderer({ op: 'update', segments: ['dolphin', ...segs, kid], layer: { name: kid, children: [] } })
      if (r.ok) { deepMade++ } else { console.log(`   FAILED ${parent}/${kid}: ${r.error}`) }
    }
  }
  console.log(`   ${deepMade} 3rd-level cells committed`)

  console.log('4) Attaching root note...')
  await withRenderer({ op: 'note-add', segments: [], cell: 'dolphin', text: ROOT_NOTE })

  console.log('5) Attaching top-level notes (7)...')
  for (const [cell, text] of Object.entries(TOP_NOTES)) {
    await withRenderer({ op: 'note-add', segments: ['dolphin'], cell, text })
  }

  console.log('6) Attaching leaf notes (39)...')
  for (const [path, text] of Object.entries(LEAF_NOTES)) {
    const parts = path.split('/')
    const cell = parts.pop()
    await withRenderer({ op: 'note-add', segments: ['dolphin', ...parts], cell, text })
  }

  console.log('7) Attaching deep notes (3rd-level)...')
  let deepNotes = 0
  for (const [path, text] of Object.entries(DEEP_NOTES)) {
    const parts = path.split('/')
    const cell = parts.pop()
    const r = await withRenderer({ op: 'note-add', segments: ['dolphin', ...parts], cell, text })
    if (r.ok) deepNotes++
  }
  console.log(`   ${deepNotes} deep notes attached`)

  console.log('\nSeed complete.')
  console.log(`  Mid-level cells: ${made}`)
  console.log(`  3rd-level cells: ${deepMade}`)
  console.log(`  Notes attached:  ${1 + Object.keys(TOP_NOTES).length + Object.keys(LEAF_NOTES).length + deepNotes}`)
  console.log('\nNow run: node scripts/bridge/_dolphin-revision.cjs')
})()
