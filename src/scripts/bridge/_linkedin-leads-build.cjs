// Mirror the 2026-07-28 LinkedIn paradigm-fit lead research into the hive.
//
//   node scripts/bridge/_linkedin-leads-build.cjs
//
// Requires: bridge on ws://localhost:2401 + connected renderer.
//
// Shape (mirror paradigm — tiles + collection + pheromones + notes):
//   linkedin-leads/                 the collection
//     paradigm-twins/               tier 1 — building the same thing, other name
//     builders/                     tier 2 — malleable / local-first scene
//     conveners/                    tier 3 — events + communities (one intro = many)
//     capital/                      tier 4 — investors who already hold the premise
//     nostr/                        protocol builders on the relay side
//     philosophy/                   sovereignty voices + the audience that would USE it
//     search-seams/                 the method: which keywords are live, which are dead
//
// Ops used: `add` at root (APPEND — preserves every existing top-level tile),
// `update` inside the subtree we own (SET), `note-add`, `decoration-add`.
// note-add and decoration-add are NOT idempotent — the script preflights on a
// build-unique cell and refuses to run twice.

const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT = 60_000
const ROOT = 'linkedin-leads'
const SENTINEL = 'search-seams'

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const id = `leads-${Date.now()}-${++counter}`
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

// ─── declared vocabulary (never minted on the fly) ──────────────────
const VOCAB = [
  ['lead',          '#d9a514'],  // every person tile
  ['paradigm-twin', '#c05b4d'],
  ['builder',       '#4d7fae'],
  ['convener',      '#4f9d6e'],
  ['capital',       '#c98f2f'],
  ['nostr',         '#8a63c9'],
  ['philosophy',    '#b06a9e'],
  ['warm',          '#579fa5'],  // cross-cutting: a real path exists to this person
]

// ─── the research ───────────────────────────────────────────────────
// note[0] = who they are + where to find them
// note[1] = why they fit the paradigm / what to open with
// warm    = a mutual connection or 2nd-degree path exists today

const GROUPS = [
  {
    key: 'paradigm-twins',
    keyword: 'paradigm-twin',
    notes: [
      'Tier 1 — people building the same architecture Hypercomb is, under a different name. Signed content as identity, agents as first-class members, history you can branch and merge. These are peers and possible co-conspirators, not prospects.',
      'Collection keyword: paradigm-twin — painting this keyword on any tile makes it a member.',
    ],
    members: [
      ['chad-fowler', [
        'Investor, software engineer, author, former CTO. Building Freeq (freeq.at) and writing The Phoenix Architecture series on regenerative software. https://www.linkedin.com/in/chadfowler/',
        'The closest architectural match found anywhere on LinkedIn. Freeq: cryptographic identity, everything signed, agent-native SDK that can MINT new agents which participate as full members, end-to-end encryption, peer-to-peer via Iroh, decoupled policy via verifiable credentials. That is drones + signatures + IoC with different words. He also writes cheques. Open with the signature-algebra doctrine, not with the hexagons. If only one conversation happens off this research, make it this one.',
      ]],
      ['anselm-eickhoff', [
        'Founder of garden.co, creator of jazz.tools — one of the two serious local-first sync frameworks. https://www.linkedin.com/in/anselm-eickhoff/',
        'Posted a week before this research: "People have been yapping about Malleable Software forever now. I think we are finally actually entering its golden age." He is betting his own future on this thesis and relocating focus to the US to do it. Peer, not prospect. The conversation worth having: what a signature-addressed module system gives you that a sync framework does not.',
      ]],
      ['peter-van-hardenberg', [
        'Ink & Switch — the lab that coined "local-first software". Creator of Patchwork, demoed at Local-First Conf 2026. https://www.linkedin.com/in/petervanhardenberg/',
        'Patchwork solves editable, branchable, mergeable document history — the same problem layers, lineage and sigbags solve, approached from the CRDT side instead of the signature side. The most valuable DISAGREEMENT available: why signatures instead of CRDTs. Reachable through Boris Mann, who does community and ops for the same lab.',
      ]],
      ['michael-taylor', [
        'Founder & CEO, EcoPIVOT Technologies. Qualicum Beach, British Columbia. 2nd degree — mutuals Chang Han and Abhishek Sharma. https://www.linkedin.com/in/michael-taylor-5aab1a383/',
        'His headline is Hypercomb vocabulary unprompted: "Governed AI Runtime Infrastructure | Local-First Autonomous Systems | Auditability, Lineage, Controlled Execution". Someone a ferry ride away is already using the word lineage for the same idea. Warmest technical lead on the list — a mutual can introduce today.',
      ]],
      ['ritesh-kadmawala', [
        'Founder, Vertexcover Labs. Builds AI agents and generative AI products. https://www.linkedin.com/in/riteshkadmawala/',
        'Wrote: "For 40 years, end-user programming was a dream that never worked. Normal people bending their software to fit them, instead of accepting whatever the makers shipped. The wall was always the same. Coding agents move that wall." That is the exact premise behind externalizing every feature as a forkable, signature-addressed module.',
      ]],
    ],
  },
  {
    key: 'builders',
    keyword: 'builder',
    notes: [
      'Tier 2 — the working malleable-software and local-first scene. Shipping product against the same constraints: user agency, offline truth, structure you can rearrange without an engineer. Peers, integration partners, and the people whose objections are worth more than any customer\'s praise.',
      'Collection keyword: builder — painting this keyword on any tile makes it a member.',
    ],
    members: [
      ['aurelien-franky', [
        'Stockholm. Former Klarna engineer. LinkedIn headline is literally "Building malleable software". https://www.linkedin.com/in/au-re/',
        'Pure paradigm fit with no translation needed — the headline IS the pitch. Small surface area to open a conversation: ask what he means by malleable, and say what a signature makes possible that a plugin API does not.',
      ]],
      ['jacob-duval', [
        'Rough.app — "Add features without adding code." https://www.linkedin.com/in/jladuval/',
        'Publicly honest about the gap between the malleable-software vision and what ships today: he estimates maybe 25% of features can live on a malleable surface, the rest still go through normal product. Worth arguing with — his 25% ceiling is exactly what a module system addressed by signature is meant to lift.',
      ]],
      ['zixuan-chen', [
        'Founder & CEO of Loro.dev (CRDT engine) and Lody.ai. Shanghai. https://www.linkedin.com/in/z1xuanch3n/',
        'Infrastructure peer on the merge problem. Loro is a serious CRDT implementation; Hypercomb answers the same question with content addressing and history markers instead. Technical exchange, not a sale.',
      ]],
      ['harsh-sahu', [
        'Founder at singularity works and asocialmedia. India. Web, infra, real-time and distributed systems. Project: Lumen — a local-first, infinite-canvas Kanban system. https://www.linkedin.com/in/hashk/',
        'Closest UI-shape match found: local-first plus infinite canvas plus real-time collaboration. Someone who already believes both halves of the bet — spatial interface AND local truth.',
      ]],
      ['aryan-shaw', [
        'Building Melina Studio — an AI-native infinite canvas. https://www.linkedin.com/in/aryan-shaw-66784418b/',
        'His description: "an AI-native infinite canvas where LLMs operate directly on visual structures, not just text. It maintains edit continuity, meaning the model continues from the existing canvas state instead of regenerating." That is bees pulsing on the hive, described by someone who arrived at it independently.',
      ]],
      ['sylve-chevet', [
        'Co-founder at Hyli. https://www.linkedin.com/in/sylve-chevet/',
        'Wrote: "Local-first software is not just about sovereignty. It is about speed and simplicity. When your app depends on a remote API, you wait. When it does not, you type and it responds instantly." The performance argument for local-first, which is the argument that actually converts people who do not care about ideology.',
      ]],
      ['victor-brodeur', [
        'Founder & CEO at EMPHOS Group. Chilliwack, British Columbia. https://www.linkedin.com/in/victor-brodeur-a3aa43401/',
        'Headline: "Building Local-First Intelligence Systems | Designing Next-Generation Cognitive Architecture." Regional (Fraser Valley) and using the same two phrases Hypercomb would use. Unverified beyond the headline — worth a look before investing time.',
      ]],
      ['robert-elves', [
        'Product development leader. Wrote "While Distracted by AI: The Quiet Rise of Local-First Software". https://www.linkedin.com/in/robertelves/',
        'Category evangelist rather than a builder — useful as an amplifier and as a read on how the category is being explained to people who have not heard of it. Not a customer.',
      ]],
      ['jose-morales', [
        'Technology strategist, forty years in storage — from parking drives in the 1980s to cloud object stores. https://www.linkedin.com/in/josemorales/',
        'Landed independently on the signature doctrine: "storage is not just about disks or arrays, it is about how we name, find, and trust our data." A storage lifer who already arrived at content addressing as a philosophy is a rare credibility asset when explaining Hypercomb to enterprise people.',
      ]],
    ],
  },
  {
    key: 'conveners',
    keyword: 'convener',
    notes: [
      'Tier 3 — the convening layer. These people run the conferences, camps, funds and communities where this paradigm gathers. One relationship here reaches hundreds of the right people at once, which is a better return than any single lead on this hive.',
      'Collection keyword: convener — painting this keyword on any tile makes it a member.',
    ],
    members: [
      ['emma-tracey', [
        'Founder, CultRepo and Moat. Organizes Local-First Conf. https://www.linkedin.com/in/emma-tracey/',
        'Local-First Conf 2026 sold out in Berlin — Martin Kleppmann, Steve Ruiz, Armin Ronacher, Ink & Switch, a third un-conf day of demos. Her words: "It is really something special to be in a room full of people who care so deeply about user agency in software." That room is the room. A Hypercomb demo is a Local-First Conf talk.',
      ]],
      ['johanna-dahlroos', [
        'Co-founder of Moat, builds the brand and identity for Local-First Conf. https://www.linkedin.com/in/johannadahlroos/',
        'The other half of the conference. Design and brand oriented — the person who decides what the event feels like before anyone gives a talk. A visual system built out of hexagons is a conversation she would actually enjoy.',
      ]],
      ['boris-mann', [
        'Atmosphere Community + Ops at Ink & Switch; Project Lead at the AT Community Fund. Vancouver. 2nd degree — mutuals Chang Han, Colleen Hardwick and three others. https://www.linkedin.com/in/boris/',
        'The best warm door on the entire list. His job is literally finding and connecting people building local-first software, he runs a funding vehicle alongside it, and he is in Vancouver. His repost feed is a live map of the whole ecosystem — Chad Fowler, Emma Tracey, Bluesky, Internet Archive, Eurosky, Ink & Switch all pass through it. Ask Chang Han or Colleen Hardwick for the introduction.',
      ]],
      ['ana-jamborcic', [
        'Head of Product; Product Lead, Open Source Transition at Socialroots / the Nostr ecosystem. Greater Vancouver. 2nd degree — mutual Martin Montero. https://www.linkedin.com/in/ana-jamborcic-837387a/',
        'Organizes DWeb Camp Cascadia on Salt Spring Island — four days of decentralized technology, food sovereignty and community resilience. Presents on decentralized tech as democratic infrastructure. Wrote a widely-shared piece on network activators: the 9% who turn networks into movements. She is one of those 9% for this scene in British Columbia. Show her the hive at a camp, not in a direct message.',
      ]],
      ['ira-nezhynska', [
        'Creative Director at DWeb Community. Independent creative director working in open-source decentralized tech. https://www.linkedin.com/in/eirena/',
        'Positions decentralized-technology founders for early adoption AND for funding — useful in both directions. The DWeb Community connection makes this a second route into the same gathering Ana Jamborcic runs regionally.',
      ]],
      ['akhilesh-thite', [
        'Distributed systems engineer, formerly Hypha Worker Co-operative. San Francisco Bay Area. Mutual: Darren Gallop. https://www.linkedin.com/in/akhileshthite/',
        'Headline: "Save the internet. One peer at a time." Fediverse and peer-to-peer background with a worker-cooperative history — someone who holds both the technical and the governance half of the argument. Warm via Darren Gallop.',
      ]],
    ],
  },
  {
    key: 'capital',
    keyword: 'capital',
    notes: [
      'Tier 4 — capital that already holds the premise, so the pitch does not have to start by justifying decentralization or local-first. Ordered by warmth of the path, not by cheque size.',
      'Collection keyword: capital — painting this keyword on any tile makes it a member.',
    ],
    members: [
      ['james-fairweather', [
        'Board director and strategic advisor. Technology diligence for private equity and venture capital. Former EVP and Chief Innovation Officer, Pitney Bowes. https://www.linkedin.com/in/jafairweather/',
        'Actively building on the Nostr protocol because he sees agentic AI use cases on it, and publicly recruiting interviews for a community-ownership project on it. Enterprise credibility plus a capital-side network plus an already-converted view of open protocols. The strongest business lead found: he does not need to be sold the premise, only the implementation.',
      ]],
      ['diraj-goel', [
        'Founder, GetFresh Ventures. Agentic GTM architect and investor. North Vancouver. 2nd degree — 21+ mutual connections including Chang Han and Colleen Hardwick. https://www.linkedin.com/in/diraj/',
        'The warmest capital contact found — 21 shared connections is not a cold approach, it is a neighbour. Go-to-market oriented rather than deep tech, so lead with what Hypercomb does for a user, not how signatures work.',
      ]],
      ['hilla-pedramparsi', [
        'Independent investor and deep tech strategist. London. "Exploring the Future of Intelligent Agents & Digital Economies." https://www.linkedin.com/in/hillapedramparsi/',
        'Thesis-level match on agents plus digital economies — the value-for-value and pheromone-economy half of Hypercomb rather than the local-first half. Unverified depth; treat as a research call, not a pitch.',
      ]],
      ['luca-maraschi', [
        'CEO at Platformatic; investor and advisor. Vancouver. 2nd degree. https://www.linkedin.com/in/lucamaraschi/',
        'Enterprise application infrastructure — observability, governance, operability. Adjacent rather than aligned, but local, technical, and invests. Useful as a reality check on the enterprise story before spending a real introduction.',
      ]],
    ],
  },
  {
    key: 'nostr',
    keyword: 'nostr',
    notes: [
      'Protocol builders on the relay side. Hypercomb already publishes over Nostr relays, so this group shares plumbing, not just philosophy — the smallest tight-knit scene found and therefore the highest conversion per conversation.',
      'Collection keyword: nostr — painting this keyword on any tile makes it a member.',
    ],
    members: [
      ['derek-ross', [
        'DevRel at Soapbox Technology. Nostr Protocol Evangelist, decentralized social infrastructure. https://www.linkedin.com/in/derekross/',
        'The scene\'s loudest and most credible amplifier. Writes about zaps as a value-for-value payments layer: "an open protocol for money, meeting an open protocol for speech." If Hypercomb ships anything Nostr-native, he is the distribution.',
      ]],
      ['samuel-manzanera', [
        'Founder & CEO at HexQuarter. France. Ten-plus years crafting decentralized systems. https://www.linkedin.com/in/samuel-manzanera/',
        'Headline: "Building self-sovereign products... Bitcoin & Nostr Advocate", building applications on Bitcoin and Nostr as a unified foundation. Same instinct as Hypercomb: pick a small number of primitives and compose everything from them.',
      ]],
      ['vano-khuroshvili', [
        'CIO and founding engineer at Satlantis. Tbilisi. Golang, Node.js, Nostr stack. https://www.linkedin.com/in/vanokhuroshvili/',
        'Running Nostr in production at a real company. The person to ask what actually breaks at scale on relays before Hypercomb depends on them further.',
      ]],
      ['emre-yilmaz', [
        'Senior generalist web developer. Built NostrBridge — a rule-based webhook transformer that pushes Web2 events into Nostr relays, on Cloudflare Workers with NIP-98 auth and NIP-57 zaps. https://www.linkedin.com/in/delirehberi/',
        'Practical infrastructure peer solving the boundary problem: how existing tools talk to an open protocol without every developer hand-rolling key signing and relay management. Directly reusable thinking for Hypercomb\'s publish path.',
      ]],
      ['neil-chong-kit', [
        'Founder, LessonReach. Vancouver. Previously built AKA Profiles — decentralized identity on the Nostr protocol. 2nd degree — mutuals Chang Han and Priya Tronsgard. https://www.linkedin.com/in/neilchongkit/',
        'A local founder who has already shipped Nostr identity infrastructure and moved on to something else — which means he will tell the truth about what was hard. Coffee, not a pitch.',
      ]],
    ],
  },
  {
    key: 'philosophy',
    keyword: 'philosophy',
    notes: [
      'Sovereignty voices and the tools-for-thought audience — the people who would USE a hive and the people who can articulate why it matters. Audience and amplification, not revenue. Treat accordingly: do not spend a warm introduction here that could go to tier 1.',
      'Collection keyword: philosophy — painting this keyword on any tile makes it a member.',
    ],
    members: [
      ['benton-moss', [
        'CEO, Simmons & Harris. Author of "The New Covenant: Individual Sovereignty and Collective Ethics in the AI Era" — a 12,000-word essay. https://www.linkedin.com/in/benton-moss-1a44a764/',
        'His frame: "AI can either be the great equalizer or the great enslaver. The technology itself will not decide how this goes. Who controls it will." Covers open versus closed models, local models and distributed compute as the architecture of individual sovereignty, and owning your intelligence stack instead of renting it. A megaphone that is already pointed the right way.',
      ]],
      ['javan-ward', [
        'Co-founder at Regen8 — forward-deployed engineering for mid-market companies. https://www.linkedin.com/in/javanward/',
        'Sells "Full Stack Sovereignty" commercially: own your compute, own your data and models, own your intelligence layer, and flip infrastructure from a cost centre to a profit centre. Partner shape rather than lead shape — he already has the customers who need what Hypercomb is.',
      ]],
      ['benny-cheung', [
        'Research scientist (AI systems) and founder. Ontology-driven AI, reasoning systems, agent design. https://www.linkedin.com/in/becheung/',
        'Spent thirty years secretly drawing spatial knowledge maps in meetings because "real engineers" were supposed to think in lists and documents, then digitized 80+ of them with AI and found the insights were in the arrows, not the boxes. He would understand the hexagons in ten seconds and never need the local-first argument at all.',
      ]],
      ['sebastien-dubois', [
        'Author, coach, entrepreneur, fractional CTO. Builds AI and Obsidian tools; runs the PKM Wiki. https://www.linkedin.com/in/sebastiend/',
        'Personal knowledge management with a real audience — Zettelkasten, evergreen notes, second brain, tools for thought. The audience most likely to adopt a hive as a daily-use thinking tool rather than as infrastructure.',
      ]],
      ['jamie-watters', [
        'Runs autonomous agents operating inside a filesystem-based second brain. https://www.linkedin.com/in/jamie-watters-solo/',
        'Already living the pattern: agents acting on structured personal knowledge stored as files. The gap he would feel immediately is exactly what signatures fix — provenance and history for what the agents changed.',
      ]],
      ['oliver-muldoon', [
        'Community strategy. Wrote "Obsidian\'s Missing Why". https://www.linkedin.com/in/olivermuldoon/',
        'Published a curated roll-call of roughly fourteen Obsidian and PKM builders doing "structure in service of thinking" — file-based thinking, personal knowledge graphs, agents inside a second brain, local RAG. That single post is a pre-built prospect list for the tiles, notes and pheromones story. Mine it before spending effort on new searches.',
      ]],
    ],
  },
]

const SEAMS_NOTES = [
  'The method, so this research can be repeated instead of redone. Searched LinkedIn on 2026-07-28 through the logged-in browser: content search and people search, read-only. No connection requests, no messages, no follows were sent.',
  'LIVE SEAMS — every result of value came through five keywords: "malleable software", "local-first", "Local-First Conf", "DWeb", and "nostr". Of these, "malleable software" is the sharpest: it is the outside world\'s name for what Hypercomb does, and it returns founders rather than commentators.',
  'DEAD SEAMS — do not spend time here again. "content-addressed merkle" returns content-MARKETING spam because LinkedIn tokenizes the word content. "CRDT offline-first" returns content-farm company pages with no humans attached. "stigmergy" returns agentic-AI listicle spam. "protocols not platforms" returns blockchain consultants. "merkle" alone reaches only crypto and DeFi architects. "infinite canvas" is mostly AI image-generation noise, with roughly one real builder per page.',
  'THE TECHNIQUE THAT WORKED BEST — find one hub in the scene and read their reposts rather than searching again. Boris Mann\'s activity feed alone surfaced Chad Fowler, Emma Tracey, Local-First Conf, Bluesky, Eurosky, Internet Archive and Ink & Switch. A hub\'s feed is a curated map that no keyword search can reproduce.',
  'STILL UNMINED — Oliver Muldoon\'s roll-call of Obsidian and PKM builders; the attendee and speaker list of Local-First Conf 2026; the DWeb Camp Cascadia participant network; and Chad Fowler\'s own reposts, which should be a second hub feed as rich as Boris Mann\'s.',
]

const ROOT_NOTES = [
  'LinkedIn lead research for Hypercomb, gathered 2026-07-28 — people whose stated technology philosophy already matches the Hypercomb paradigm, plus the events and capital around them. Read-only research: nothing was sent to anyone.',
  'The finding that reframes the rest: this paradigm already has a real, named, currently-converging community — it just does not call itself hexagons and bees. It calls itself malleable software, local-first, and the decentralized web. Hypercomb does not need to create an audience, it needs to be introduced to one that exists.',
  'How to use this hive: paradigm-twins are peers and possible collaborators, capital is where the business conversation lives, conveners are worth more than any single lead because one relationship reaches a whole room, and philosophy is an audience rather than revenue. The warm keyword marks anyone reachable through an existing mutual connection today.',
  'Collection keyword: lead — painting this keyword on any tile makes it a member of this hive.',
]

// warm = a mutual connection or 2nd-degree path exists as of 2026-07-28
const WARM = new Set([
  'michael-taylor', 'boris-mann', 'ana-jamborcic', 'neil-chong-kit',
  'diraj-goel', 'luca-maraschi', 'akhilesh-thite', 'sebastien-dubois',
])

// ─── build ──────────────────────────────────────────────────────────
async function main() {
  // preflight: right renderer, and not already built
  const pre = await send({ op: 'layer-at', segments: [ROOT, SENTINEL] })
  if (pre.ok && pre.data) {
    console.error(`[leads] ABORT — ${ROOT}/${SENTINEL} already exists. note-add and`)
    console.error('        decoration-add are not idempotent; re-running would duplicate.')
    process.exit(1)
  }

  // Phase 1 — structure. `add` at the root APPENDS (preserves every existing
  // top-level tile); `update` inside our own subtree SETS.
  console.log(`[leads] phase 1: structure`)
  let okStruct = 0, failStruct = 0
  const step = async (label, req) => {
    process.stdout.write(`  ${label} ... `)
    const r = await send(req)
    if (r.ok) { okStruct++; console.log('ok') } else { failStruct++; console.log(`FAIL: ${r.error}`) }
    return r
  }

  await step(`root += ${ROOT}`, { op: 'add', segments: [], cells: [ROOT] })
  await step(`${ROOT} children`, {
    op: 'update', segments: [ROOT],
    children: [...GROUPS.map(g => g.key), SENTINEL],
  })
  for (const g of GROUPS) {
    await step(`${ROOT}/${g.key} children (${g.members.length})`, {
      op: 'update', segments: [ROOT, g.key],
      children: g.members.map(([name]) => name),
    })
  }
  console.log(`[leads] phase 1: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2 — notes. note-add takes PARENT segments + cell label.
  console.log(`[leads] phase 2: notes`)
  const notes = []
  for (const text of ROOT_NOTES) notes.push({ parent: [], cell: ROOT, text })
  for (const text of SEAMS_NOTES) notes.push({ parent: [ROOT], cell: SENTINEL, text })
  for (const g of GROUPS) {
    for (const text of g.notes) notes.push({ parent: [ROOT], cell: g.key, text })
    for (const [name, texts] of g.members) {
      for (const text of texts) notes.push({ parent: [ROOT, g.key], cell: name, text })
    }
  }
  let okNotes = 0, failNotes = 0
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    process.stdout.write(`  [note ${i + 1}/${notes.length}] ${[...n.parent, n.cell].join('/')} ... `)
    const r = await send({ op: 'note-add', segments: n.parent, cell: n.cell, text: n.text })
    if (r.ok) { okNotes++; console.log('ok') } else { failNotes++; console.log(`FAIL: ${r.error}`) }
  }
  console.log(`[leads] phase 2: ${okNotes} ok, ${failNotes} failed`)

  // Phase 3 — pheromones. kind 'tag', appliesTo [], payload { name }.
  // NO replaceKind: tags stack, replaceKind would drop the first.
  console.log(`[leads] phase 3: pheromones`)
  const marks = [{ segments: [ROOT], tag: 'lead' }]
  for (const g of GROUPS) {
    marks.push({ segments: [ROOT, g.key], tag: g.keyword })
    for (const [name] of g.members) {
      marks.push({ segments: [ROOT, g.key, name], tag: 'lead' })
      marks.push({ segments: [ROOT, g.key, name], tag: g.keyword })
      if (WARM.has(name)) marks.push({ segments: [ROOT, g.key, name], tag: 'warm' })
    }
  }
  let okMarks = 0, failMarks = 0
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]
    process.stdout.write(`  [mark ${i + 1}/${marks.length}] ${m.segments.join('/')} <- ${m.tag} ... `)
    const r = await send({
      op: 'decoration-add', segments: m.segments, kind: 'tag',
      appliesTo: [], payload: { name: m.tag },
    })
    if (r.ok) { okMarks++; console.log('ok') } else { failMarks++; console.log(`FAIL: ${r.error}`) }
  }
  console.log(`[leads] phase 3: ${okMarks} ok, ${failMarks} failed`)

  // Phase 4 — register the vocabulary (colours + intellisense) in the global
  // TagRegistry via /keyword with no selection, then neutralize the sticky
  // submit replay so a reload does not re-run it.
  const vocab = VOCAB.map(([k, c]) => `${k}(${c})`)
  process.stdout.write(`[leads] phase 4: vocabulary ${vocab.join(', ')} ... `)
  const reg = await send({ op: 'submit', text: `/keyword [${vocab.join(', ')}]` })
  console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
  await send({ op: 'submit', text: '' })

  const people = GROUPS.reduce((n, g) => n + g.members.length, 0)
  console.log(`\n[leads] DONE — ${people} people across ${GROUPS.length} collections under "${ROOT}"`)
  const failed = failStruct + failNotes + failMarks
  if (failed > 0) console.warn(`[leads] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
