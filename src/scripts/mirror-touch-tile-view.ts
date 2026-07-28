// Mirror pass for the TOUCH REACH work — the fullscreen tile view a tap opens,
// sampling a swarm, marking a selection, and the first-run card that finally
// offers the tour on a phone.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds FOUR behaviour tiles and their
// parts, 1:1 with the source files each behaviour actually lives in:
//
//   behaviors/views/tile-view
//     ├── tile-view-drone         the fullscreen surface, its actions, its exits
//     ├── tile-overlay-drone      the leaf terminus: rank first, then the view
//     └── i18n-catalogs           the words, en + ja
//
//   behaviors/swarm/sample-and-keep
//     ├── sample-swarm-drone      the pill: arm, count, keep
//     ├── tile-overlay-drone      picking instead of entering
//     ├── selection-input-drone   "pick this too" without a held key
//     ├── swarm-adopt-drone       fold quietly, land on the screen once
//     └── features-viewer         the screen you land on, as a sheet
//
//   behaviors/input/mark-the-selection
//     ├── tags-viewer             tap a mark to put it on what you picked
//     └── i18n-catalogs           the words, en + ja
//
//   behaviors/guidance/first-run-card
//     ├── collection-empty-prompt-drone   the root variant + "Show me how"
//     ├── bee-tutorial-drone              the .touch narration funnel
//     └── i18n-catalogs                   the words, en + ja
//
// Pheromones (declared, never minted on the fly): `behavior` + the collection
// keyword on each behaviour tile — the same marks every other member of those
// collections carries — and `part` on each child. Merge mode: children union
// into what is already there, and notes/marks are only written for cells this
// run creates, so a second run adds nothing.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    // Pin IPv4 loopback: a second listener on 2401 (0.0.0.0) swallows
    // `localhost` dials without answering — only 127.0.0.1 has the renderer.
    const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

// Mirror of @hypercomb/core normalizeCell so segments == children keys.
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const S = 'hypercomb-shared'

const ROOT_KEY = norm('behaviors')
const BEHAVIOR_KEYWORD = 'behavior'
const PART_KEYWORD = 'part'

type Part = [name: string, note: string]
type Behaviour = {
  /** An EXISTING collection under `behaviors` (mirror-behaviors.ts CATEGORIES:
   *  games, views, assistant, swarm, appearance, structure, input, guidance). */
  collection: string
  /** That collection's declared KEYWORD — the mark its members carry. It is not
   *  always the collection's name (`views` marks its members `view`). */
  keyword: string
  name: string
  note: string
  parts: Part[]
}

const BEHAVIOURS: Behaviour[] = [
  {
    collection: 'views',
    keyword: 'view',
    name: 'tile-view',
    note: [
      'Tile view — tapping a tile opens it full screen, with everything that acts on it in reach of a thumb.',
      '',
      'On a pointer, every per-tile action lives on the band that appears when you HOVER a tile. A finger never hovers, so on a phone that band could not be reached at all, and a plain tile was a dead end: tapping it did nothing. Tapping now opens the tile itself — its picture large, its name, its notes, and a row of buttons: make this yours, edit, share.',
      '',
      'It is LAST in the takeover order. A tile carrying a deck opens as slides, a tile carrying a gallery opens as a lightbox; this is what opens when nothing richer claims the tap. It needs no mark of its own, which is exactly why it cannot be one more ranked behaviour — the picker only considers behaviours a tile has been decorated with, and this one is for the tiles that carry nothing.',
      '',
      'It opens IN PLACE and never navigates, so closing puts you back exactly where you tapped. A tile with children still opens as a page — a doorway stays a doorway.',
      '',
      'Every way out is its own: the button, a tap on the backdrop, Escape, right-click, and the BACK button — the one a phone reaches for first, and the one no other full-screen view answers.',
      '',
      `source: ${E}/presentation/tiles/tile-view.drone.ts`,
    ].join('\n'),
    parts: [
      ['tile-view.drone.ts', [
        'The surface. Builds the full-screen host, paints the tile\'s display picture as a background layer (an SVG with no intrinsic size collapses an <img> to nothing), reads its notes, and lays out the action row. Make-this-yours appears only on a tile published by somebody else, share only on one of your own, and a button whose bee has not registered yet is shown dimmed rather than left to fail silently. Hides the chrome by taking an owner-counted turn in `view:active` rather than announcing it, so a dialog closing on top can never uncover a view that is still open. It deliberately holds no view MODE: a mode string would have to be added to a hand-kept list to survive a reload, and an adopt finishing would drop the view mid-action.',
        '',
        `source: ${E}/presentation/tiles/tile-view.drone.ts`,
      ].join('\n')],
      ['tile-overlay.drone.ts', [
        'The tap. A tile with no children used to end its click by asking for "open", which only a link or a contact answers — every other tile fell through in silence. That end now asks the takeover order first, so a childless tile carrying a deck or a gallery opens ITS view like any page would, and only when nothing claims it does the tile view open. It records whether the press was a FINGER, because the click that follows carries no such fact, and a mouse keeps the behaviour it always had.',
        '',
        `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
      ].join('\n')],
      ['i18n-catalogs', [
        'The words. The action row borrows what the hover band already says — make this yours, edit, share, back to the hive — so the same button reads the same way whichever hand opens it. English and Japanese.',
        '',
        `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
      ].join('\n')],
    ],
  },
  {
    collection: 'swarm',
    keyword: 'swarm',
    name: 'sample-and-keep',
    note: [
      'Sample and keep — pick several of somebody else\'s tiles while browsing a swarm, then keep the ones you want.',
      '',
      'Browsing a swarm shows other participants\' tiles beside your own. You do not hold them; you are looking. Sampling is the verb that turns some of what you are looking at into yours: arm it, tap the tiles you want, keep them. Nothing is written until you say keep — which is the whole point of looking first.',
      '',
      'SELECTION IS THE SUBSTRATE. This mints no picked-set of its own. Tapping puts tiles in the ordinary selection, so they ring with the marks selection already draws, and every other verb that reads a selection — putting a pheromone on it, the command line\'s bracket form — sees the same tiles. The only thing added is a way for a FINGER to build one: a pointer says "pick this too" by holding a key, and a finger has no keys to hold.',
      '',
      'It appears only where there is something to sample, so it takes no permanent room on a screen that has little.',
      '',
      'Keeping several used to open the behaviours screen once per tile, each one wiping the one before it — five tiles meant five flashes and you landed on whichever finished last. Now the tiles fold quietly and the screen opens once, on the first one that landed.',
      '',
      'A name offered by two publishers cannot be settled from a tap: the hive draws one hexagon but two people stand behind it. That case asks, on the surface built for asking.',
      '',
      `source: ${E}/sharing/sample-swarm.drone.ts, ${E}/sharing/swarm-adopt.drone.ts`,
    ].join('\n'),
    parts: [
      ['sample-swarm.drone.ts', [
        'The pill. Watches which tiles on screen belong to somebody else and offers to pick them; arms the picking, counts what is picked, and keeps it. Resolves each name to the hand that published it before asking for the fold, and stands the picking down whenever you leave the page, the swarm, or the moment.',
        '',
        `source: ${E}/sharing/sample-swarm.drone.ts`,
      ].join('\n')],
      ['tile-overlay.drone.ts', [
        'The tap. While picking, a press no longer walks into a tile — somebody else\'s tile is a doorway like any other, so without this the first pick would carry you into their tree instead of picking it — and the tap that follows says "pick this too" rather than "this one instead".',
        '',
        `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
      ].join('\n')],
      ['selection-input.drone.ts', [
        'The intent. Picking one more tile without dropping the last was something only a held key could say. It can now be said outright, which is what lets a finger build a set at all — before this, a second tap replaced the first.',
        '',
        `source: ${E}/selection/selection-input.drone.ts`,
      ].join('\n')],
      ['swarm-adopt.drone.ts', [
        'The fold. Keeps a set of tiles one after another so they land in the order they were picked, quietly, and opens the behaviours screen once at the end instead of once per tile.',
        '',
        `source: ${E}/sharing/swarm-adopt.drone.ts`,
      ].join('\n')],
      ['features-viewer', [
        'The screen you land on. Turning what you kept on and off was a tall column pinned to the right edge, wide enough on a phone to leave the hive a sliver beside it, with controls too small to hit. It is a sheet along the bottom now, with rows a thumb can reach.',
        '',
        `source: ${S}/ui/features-viewer/features-viewer.component.scss`,
      ].join('\n')],
    ],
  },
  {
    collection: 'input',
    keyword: 'input',
    name: 'mark-the-selection',
    note: [
      'Mark the selection — pick tiles, then tap a pheromone to put it on all of them.',
      '',
      'Putting a mark on tiles was a pointer\'s gesture: pick a colour, then drag across the hive. A finger cannot do that, because on a touch screen a drag is how you scroll — so painting was withheld rather than shipped badly.',
      '',
      'This is the other way round, and it needs no drag at all: pick the tiles first, then tap the mark. The tiles you picked are the target. One tap, one change, however many tiles.',
      '',
      'The same row still filters the hive when nothing is picked — you asked a different question, so it answers a different one.',
      '',
      `source: ${S}/ui/tags-viewer/tags-viewer.component.ts`,
    ].join('\n'),
    parts: [
      ['tags-viewer', [
        'The list, and the second question it answers. With tiles picked, a tap on a pheromone puts it on all of them in a single change rather than filtering the hive to it — and says so above the list, because the same row now means two things depending on what you have picked.',
        '',
        `source: ${S}/ui/tags-viewer/tags-viewer.component.ts, ${S}/ui/tags-viewer/tags-viewer.component.html`,
      ].join('\n')],
      ['i18n-catalogs', [
        'The words. What the pill offers while sampling, and what the pheromone list says once tiles are picked. English and Japanese.',
        '',
        `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
      ].join('\n')],
    ],
  },
  {
    collection: 'guidance',
    keyword: 'guidance',
    name: 'first-run-card',
    note: [
      'First run — the empty hive finally says something, and offers to show you around.',
      '',
      'An empty layer has always explained itself. The one place that stayed silent was the empty HIVE ROOT: the very first thing a new participant sees. It was skipped in favour of an onboarding path that was never built. It is now that path — a card naming what a tile is, with two buttons: add one, or be shown.',
      '',
      '"Show me how" starts the guided tour. That matters most on a phone, where the bee that starts it lives on a rail that never appears, so the tour could only be reached by typing `/tutorial` — by already knowing the thing it teaches.',
      '',
      'The tour also speaks differently to a finger. Every line it says passes through one place, so a line with a touch wording written for it is preferred there and the rest are unchanged: "just left-click it" becomes "just tap it", "Shift+click to come back out" becomes the Back button, "hold the Space bar and drag" becomes one finger. No lesson was edited to make that true.',
      '',
      `source: ${E}/presentation/tiles/collection-empty-prompt.drone.ts, ${E}/tutorial/bee-tutorial.drone.ts`,
    ].join('\n'),
    parts: [
      ['collection-empty-prompt.drone.ts', [
        'The card. Grew a root variant for the empty hive and a second button beside "Add a tile". The panel claims every press inside it to open the command line, so the tour button stands that handler down for its own press — otherwise the card would answer the wrong question. The button comes and goes with the variant, so walking into an empty page shows the plain notice, not the welcome.',
        '',
        `source: ${E}/presentation/tiles/collection-empty-prompt.drone.ts`,
      ].join('\n')],
      ['bee-tutorial.drone.ts', [
        'The voice. Every bubble in every lesson resolves its words in one place, so preferring a touch wording there retunes the whole tour without touching a single lesson. Falls straight back to the written line when no touch wording exists, and reads the same source of truth the rest of the shell reads — so `/mobile on` rehearses the phone tour on a desktop.',
        '',
        `source: ${E}/tutorial/bee-tutorial.drone.ts`,
      ].join('\n')],
      ['i18n-catalogs', [
        'The words. The welcome card, and the touch wordings for going in, coming out, creating, travelling, zooming, panning, editing and the closing recap. English and Japanese.',
        '',
        `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
      ].join('\n')],
    ],
  },
]

async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'inflate', segments })
  if (!res.ok) return []
  const data = res.data as { children?: unknown } | undefined
  const kids = data?.children
  if (Array.isArray(kids)) return kids.map(k => String(typeof k === 'string' ? k : (k as { name?: string })?.name ?? '')).filter(Boolean)
  if (kids && typeof kids === 'object') return Object.keys(kids as Record<string, unknown>)
  return []
}

async function mirror(b: Behaviour): Promise<void> {
  const collectionKey = norm(b.collection)
  const behaviourKey = norm(b.name)
  const collectionSeg = [ROOT_KEY, collectionKey]

  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[${b.name}] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[${b.name}] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

  const isNew = !members.includes(behaviourKey)
  const behaviourSeg = [...collectionSeg, behaviourKey]
  const partNames = b.parts.map(([name]) => norm(name.replace(/\.ts$/, '')))

  // Phase 1 — structure. Union into what is there; never replace membership.
  if (isNew) {
    process.stdout.write(`[struct] ${collectionSeg.join('/')} ← +${behaviourKey} ... `)
    const res = await send({ op: 'update', segments: collectionSeg, layer: { name: collectionKey, children: [...members, behaviourKey] } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exit(1)
  } else {
    console.log(`[struct] ${behaviourKey} already present — merging parts only`)
  }

  const havePart = await childrenOf(behaviourSeg)
  const newParts = partNames.filter(p => !havePart.includes(p))
  process.stdout.write(`[struct] ${behaviourSeg.join('/')} ← ${havePart.length + newParts.length} children ... `)
  const up = await send({ op: 'update', segments: behaviourSeg, layer: { name: behaviourKey, children: [...havePart, ...newParts] } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const part of newParts) {
    process.stdout.write(`[struct] ${behaviourSeg.join('/')}/${part} ... `)
    const res = await send({ op: 'update', segments: [...behaviourSeg, part], layer: { name: part } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 2 — notes. Only for cells THIS run created: note-add is not
  // idempotent, so re-noting an existing tile would stack duplicates.
  const notes: { segments: string[]; text: string }[] = []
  if (isNew) notes.push({ segments: behaviourSeg, text: b.note })
  for (const [name, note] of b.parts) {
    const key = norm(name.replace(/\.ts$/, ''))
    if (newParts.includes(key)) notes.push({ segments: [...behaviourSeg, key], text: note })
  }
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + the
  // collection keyword mark the member (the collection's keywords ARE its
  // parameters), `part` marks each implementation cell. Tags stack.
  const marks: { segments: string[]; tag: string }[] = []
  if (isNew) {
    marks.push({ segments: behaviourSeg, tag: BEHAVIOR_KEYWORD })
    marks.push({ segments: behaviourSeg, tag: b.keyword })
  }
  for (const part of newParts) marks.push({ segments: [...behaviourSeg, part], tag: PART_KEYWORD })
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.tag } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[${b.name}] DONE — behaviour ${isNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

async function main(): Promise<void> {
  for (const b of BEHAVIOURS) await mirror(b)
  console.log('[touch-tile-view] mirror pass complete')
}

main().catch(err => { console.error(err); process.exit(1) })
