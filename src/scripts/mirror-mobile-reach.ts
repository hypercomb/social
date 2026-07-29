// Mirror pass for the MOBILE REACH work — the chrome a phone actually holds,
// the picker that is always there, the tile in close-up, and the screen that
// asks whether to trust somebody else's feature.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. Four behaviour tiles and their parts:
//
//   behaviors/input/mobile-chrome
//   behaviors/input/select-mode
//   behaviors/views/tile-view
//   behaviors/swarm/feature-review
//
// RUN THIS BEFORE `mirror-touch-tile-view.ts`. Both define
// `behaviors/views/tile-view`; whichever runs first writes the note, and the
// note here is the current one (the close-up is a hexagon now, laid out two
// ways). The other script's parts merge in afterwards without duplicating it —
// notes are written only for cells the run creates, since `note-add` stacks.
//
// Pheromones (declared, never minted on the fly): `behavior` + the collection
// keyword on each behaviour tile, `part` on each child.

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
    collection: 'input',
    keyword: 'input',
    name: 'mobile-chrome',
    note: [
      'Mobile chrome — what a phone holds under its thumb, and what it says next to what you are typing.',
      '',
      'THE BAR, bottom of the screen in portrait and down the left edge in landscape, is five things: back, centre the screen, TAKE A PICTURE, fullscreen, and solo-or-swarm. The middle one is the picture because on a phone the act worth putting under the thumb is the one that MAKES something. Centring the screen took the microphone\'s old place — "put the hive back where I can see it" is what you reach for over and over. Fullscreen took centring\'s: a phone gives up a fifth of its screen to browser chrome, and this takes it back. It is a button and not something the first touch does for you — a page that silently swallows the address bar on contact reads as a page misbehaving.',
      '',
      'THE MICROPHONE moved off the bar and into the command line, because the words it dictates land in that text box. Tap it to start listening, hold it to speak and let go — the same two gestures it always had, now beside the thing it fills in.',
      '',
      'THE ICON ROW came out of the command line and sits UNDER it in portrait. On a phone those icons and the text box were fighting over the same few hundred pixels: the box shrank to a sliver and the icons wrapped into two and three cramped rows inside the bar. On its own row it is one line, scrolled sideways, with boxes a finger can hit — and there is room for more of them. Landscape keeps them inside the line, where a wide short screen has the width to spare and the height is what is scarce.',
      '',
      'None of this touches the pointer. Every rule is a phone rule.',
      '',
      `source: ${S}/ui/controls-bar, ${S}/ui/command-shell, ${S}/ui/command-line, ${S}/ui/_header-bar.scss`,
    ].join('\n'),
    parts: [
      ['controls-bar', [
        'The bar. Holds the five buttons and the orientation it is in; the fullscreen one watches the document so its glyph says which way it will go — a toggle that always shows the same icon cannot say that. The microphone\'s handlers left with it.',
        '',
        `source: ${S}/ui/controls-bar/controls-bar.component.html, .ts, .scss`,
      ].join('\n')],
      ['command-shell', [
        'The prompt, and the rail beside it. The microphone joined the rail as one more standing tool — same box, same gap, same baseline as notes and pheromones, red only while it is listening, because "is this thing recording me" must never be a guess. In portrait the whole rail breaks onto a line of its own beneath the text box and scrolls sideways rather than wrapping; the shell reports the press and the command line owns what dictation does with it.',
        '',
        `source: ${S}/ui/command-shell/command-shell.component.html, .ts, .scss`,
      ].join('\n')],
      ['command-line', [
        'What the rail is wired to. Passes the microphone down to the shell only on a phone, and stands the older flush-right one down there so there are never two. The dictation machine underneath is untouched — the button moved, the behaviour did not.',
        '',
        `source: ${S}/ui/command-line/command-line.component.html, .ts, .scss`,
      ].join('\n')],
      ['header-bar-styles', [
        'The bar the prompt lives in. It can GROW now: with the icons on a second row the header is taller, so its height became a floor rather than a ceiling, and everything anchored below it follows the measured bottom edge automatically. The row\'s box, glyph and gap are set once here, for every icon on it — the rail never resizes one button, it resizes all of them or none.',
        '',
        `source: ${S}/ui/_header-bar.scss`,
      ].join('\n')],
    ],
  },
  {
    collection: 'input',
    keyword: 'input',
    name: 'select-mode',
    note: [
      'Select — picking tiles with a finger, and a picker that is always there.',
      '',
      'A pointer says "pick this one too" by holding a key. A finger has no keys, and on a phone a press on a tile with children walks into it before any hold can mature. So nothing on a phone could pick a tile at all: no marking a set, no bulk remove, no clipboard, no bracket form.',
      '',
      'The picker is a small bar above the controls: tap Select, tap the tiles you want, then Options — or Done. While it is armed the whole screen is ringed in steel, so which mode you are in is never a question you have to answer by trying something.',
      '',
      'IT IS ALWAYS THERE on a phone. It used to hide itself on a page that had not reported its tiles yet, and to stand down entirely wherever other participants\' tiles were on screen — a swarm, which is exactly where picking matters most. A picker that comes and goes is a picker you cannot rely on.',
      '',
      'AND IT IS BUILT ONCE. It used to be thrown away and rebuilt on every pick. A tap is a press, then a release: rebuild in between and the release lands on nothing, so the tap does nothing. That is why picking "worked sometimes". The bar and its buttons are made once now and only ever change what they say.',
      '',
      'KEEPING somebody else\'s tiles is one of its verbs rather than a second bar beside it — picking your own tile and picking a peer\'s is the same gesture, so it is the same control. Resolving whose copy you meant still belongs to the swarm, and is still asked there when two people publish the same name.',
      '',
      'Selection is the substrate: tiles land in the ordinary selection, so every verb that reads one — a pheromone, remove, the clipboard, the options ring — sees the same tiles.',
      '',
      `source: ${E}/selection/select-mode.drone.ts, ${E}/sharing/sample-swarm.drone.ts`,
    ].join('\n'),
    parts: [
      ['select-mode.drone.ts', [
        'The picker. Arms the mode, holds no set of its own, and keeps one bar built from first render to last — idle, hinting, counting — because rebuilding it under a finger is what ate the taps. Draws the armed frame, folds in the keep verb when a picked tile belongs to somebody else, and stands down when a full-screen view takes the viewport (it is drawn on the page itself, so the chrome-hiding a takeover does never reaches it).',
        '',
        `source: ${E}/selection/select-mode.drone.ts`,
      ].join('\n')],
      ['sample-swarm.drone.ts', [
        'The keeping. On a phone its own bar stands down and it lends the picker one verb: keep these. It still resolves each name to the hand that published it, and still asks when two hands offer the same name — the hive draws one hexagon but two people stand behind it. On a pointer it keeps its own bar, because there is no always-there picker to lend it to.',
        '',
        `source: ${E}/sharing/sample-swarm.drone.ts`,
      ].join('\n')],
    ],
  },
  {
    collection: 'views',
    keyword: 'view',
    name: 'tile-view',
    note: [
      'Tile view — a tile in close-up: the same hexagon, large, with everything that acts on it in reach of a thumb.',
      '',
      'On a pointer, every per-tile action lives on the band that appears when you HOVER a tile. A finger never hovers, so on a phone that band could not be reached at all and a plain tile was a dead end. Tapping one now opens the tile itself.',
      '',
      'AS A HEXAGON, not a rectangle with the picture letterboxed into it — the same point-top shape it has on the hive, carrying its own picture (the hex thumbnail the hive already draws, framed for exactly this). Tapping a hexagon and getting a hexagon back is what makes this read as "that tile, up close" rather than a separate screen about it. With no picture it carries its first letter rather than sitting there as a black shape.',
      '',
      'TWO LAYOUTS, one structure. Portrait stacks: the hexagon wide across the screen, its name, its notes and its options underneath. Landscape is short, so the hexagon is sized off the height and sits DEAD CENTRE of the screen with the same column beside it. It re-lays itself out by measuring its own box rather than waiting to be told the screen turned — measuring cannot miss what listening can.',
      '',
      'THE OPTIONS are what you would otherwise have had to hover for: go inside (a doorway is still a doorway — asked of the surface that owns every readiness gate, rather than reimplemented here), make this yours, edit, share, what this tile can do, and select it — which arms the picker with this tile already in, so the set verbs reach it.',
      '',
      'It opens IN PLACE and never navigates, so closing puts you back exactly where you tapped. It is LAST in the takeover order: a tile carrying a deck opens as slides, a gallery as a lightbox; this is what opens when nothing richer claims the tap.',
      '',
      'Every way out is its own: the button, a tap on the backdrop, Escape, right-click, and the BACK button — the one a phone reaches for first, and the one no other full-screen view answers.',
      '',
      `source: ${E}/presentation/tiles/tile-view.drone.ts`,
    ].join('\n'),
    parts: [
      ['tile-view.drone.ts', [
        'The surface. Builds the hexagon (a clipped box inside a clipped box — a clip erases borders, so the steel edge has to be the shape behind the shape), paints the tile\'s hex thumbnail into it, reads its notes, and lays out the options. Landscape is a three-track grid with one empty track, which is what puts the hexagon in the middle of the screen instead of against the left edge. Hides the chrome by taking an owner-counted turn rather than announcing it, and deliberately holds no view MODE — a mode string would have to be kept in a hand-written list to survive a reload, and an adopt finishing would drop the view mid-action.',
        '',
        `source: ${E}/presentation/tiles/tile-view.drone.ts`,
      ].join('\n')],
      ['tile-overlay.drone.ts', [
        'The tap, and going back in. A tile with no children used to end its click by asking for "open", which only a link or a contact answers — every other tile fell through in silence; that end now asks the takeover order first and opens this view when nothing claims it. It records whether the press was a FINGER, because the click that follows carries no such fact, so a mouse keeps the behaviour it always had. And it answers the close-up\'s "go inside": every readiness gate and deferred-entry queue that entering a tile needs already lives here, so a second caller re-uses them rather than growing a second copy that drifts.',
        '',
        `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
      ].join('\n')],
    ],
  },
  {
    collection: 'swarm',
    keyword: 'swarm',
    name: 'feature-review',
    note: [
      'Feature review — deciding whether to let somebody else\'s beehaviour run, on a screen small enough to be honest about it.',
      '',
      'Something you took from another participant can carry code. It stays inert until you say otherwise, and this is where you say it.',
      '',
      'ON A PHONE IT IS THE WHOLE PAGE, and the code is somewhere you GO — never both at once. The other version showed the source and the buttons together, which on a phone means a wall of unread code above two choices: an invitation to pretend you read it. Here the screen asks the question in words, says the risk plainly once — anything you allow runs with the same reach as the rest of your hive, so one bad one could reach all of it — and gives two answers and a door.',
      '',
      'TWO ANSWERS, no numbers: Allow, or Pending community verification. Waiting writes nothing, so the thing stays inert and the gate will ask again the next time it matters. Reading the code first is the third button, and accepting from in there is recorded as reviewed rather than as an unread override.',
      '',
      'While there is a decision to make, the decision IS the page: the search box, the subject line, the lists and the footer all stand down. Clutter around a "should I allow this?" question is what makes people tap the first button.',
      '',
      `source: ${S}/ui/features-viewer/features-viewer.component.ts`,
    ].join('\n'),
    parts: [
      ['features-viewer', [
        'The screen. On a phone it is the whole viewport rather than a slab pinned to one edge or a sheet peeking up from the bottom — turning beehaviours on and off, and deciding whether to trust one, are decisions, and they get the screen while they are being made. Holds whether the code is open, so the decision and the source are never on it together, and says the gated state in full words instead of a shorthand chip with a count beside it.',
        '',
        `source: ${S}/ui/features-viewer/features-viewer.component.ts, .html, .scss`,
      ].join('\n')],
      ['i18n-catalogs', [
        'The words. The question, the warning, the two answers, the door to the code — and what the close-up\'s options say. All fourteen languages.',
        '',
        `source: ${S}/i18n/*.json`,
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
  // collection keyword mark the member, `part` marks each implementation cell.
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
  console.log('[mobile-reach] mirror pass complete')
}

main().catch(err => { console.error(err); process.exit(1) })
