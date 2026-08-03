// Mirror pass for THE MOBILE TILE MENU — what a tile offers when there is no
// pointer to hover it with.
//
// The desktop hover band is retired in mobile mode. That is the creation: not
// "a screen got some more buttons", but a whole affordance surface being taken
// off one platform and its contents re-homed on another, without either side
// keeping a hand-written list of what those contents are. The tile's own screen
// ASKS the overlay what the tile carries and renders the answer, so a bee that
// registers an icon for the desktop band appears on a phone with no edit to
// the phone's code at all.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells; mirror-touch-grammar.ts added the grammar this refines) — it never
// re-runs them. This pass adds ONE behaviour tile and its parts, 1:1 with the
// source files the change actually lives in:
//
//   behaviors/input/mobile-tile-menu
//     ├── tile-overlay-drone     the band, and where it stops
//     ├── tile-view-drone        the menu that replaced it
//     ├── quick-menu-input       the hold that no longer claims anything
//     ├── controls-bar-component the pin, which had no way back
//     └── i18n-catalogs          the words
//
// It then stacks CORRECTIVE notes onto the cells this change made partly
// untrue — `touch-grammar` says the hold summons a ring carrying the tile,
// which is now the DESKTOP half of the story only. Notes stack, so each cell
// keeps both what was true and what changed.
//
// Pheromones (declared, never minted on the fly): `behavior` + `input` on the
// behaviour tile — the marks every member of that collection carries — and
// `part` on each child. Merge mode: children union into what is already there,
// and notes/marks are only written for cells this run creates, so a second run
// adds nothing.

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
const Q = `${E}/quickmenu`
const T = `${E}/presentation/tiles`

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('input')
const BEHAVIOR = norm('mobile-tile-menu')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'input'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'The mobile tile menu — what a tile offers when there is no pointer to hover it with.',
  '',
  'THE BAND IS RETIRED ON A PHONE. Everything a tile can do used to live on the hover band: the strip of small icons that appears under a hexagon when a cursor rests on it. That surface asks for two things a finger cannot give. It asks to be HOVERED, and a stationary touch produces no hover at all. Then it asks for a second press accurate to seven pixels. So on a phone the band was either invisible or unhittable, and the tile screen carried a hand-written five of the twenty-odd affordances a tile can actually have — chosen once, by hand, and unable to grow.',
  '',
  'THE SCREEN IS WHERE THEY WENT, and it does not list them. It ASKS. The overlay owns the affordance registry — every provider bee registers into it and nowhere else — so the screen requests the set for one tile by name and renders the answer, already filtered by each affordance\'s own visibility rule and ordered the way the band orders it: ordinary verbs, then features, then the dangerous one last. A bee that adds an icon to the desktop band appears on the phone with no edit to the phone\'s code. That is the difference between porting a feature and moving where it is read from.',
  '',
  'FIVE TO A ROW, GROWING DOWNWARD, NO CAP. The band stops at two rows and warns about what it dropped, because a hexagon is only so tall. A screen is not. The menu wraps at five — the same place the band chunks, so a tile\'s set breaks in the same places on both surfaces — and simply keeps adding rows, scrolling if it ever outgrows the panel. Views a tile can adopt sit in the same grid, one block down.',
  '',
  'ONE HOLD, THREE OUTCOMES, and the hand picks between them. Tap goes INTO the tile. Hold and PULL moves it. Hold and LET GO opens this menu. On a phone the ring never appears over a tile, which is precisely what leaves the pull free to be a move — see the correction on touch-grammar, where the ring used to take the drag\'s reservation at 380ms on the theory that a still finger is not a drag. On a phone the still finger has not finished deciding, and taking the reservation meant a late pull aimed a ring instead of moving the tile, with the input gate left locked behind it. That was the page that would not drag.',
  '',
  'The sideways swipe that walks to the next tile is now the screen\'s own, not the browser\'s: without refusing the browser\'s back gesture, a horizontal drag started near an edge navigated the hive out from under the view and the step never happened.',
  '',
  `source: ${T}/tile-overlay.drone.ts, ${T}/tile-view.drone.ts, ${Q}/quick-menu.input.ts, ${S}/ui/controls-bar/controls-bar.component.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['tile-overlay.drone.ts', [
    'The band, and where it stops. In mobile mode its visibility pass returns early and it never shows — one branch, above the ordinary hover logic and below arrange mode, because laying the icons out is still how you choose what the band shows on the desktop where it exists.',
    '',
    'It also grew the way OFF it. Two methods answer questions about a tile by NAME rather than by hover: what does this tile carry, and run this one. The first resolves the tile\'s profile from that tile — a peer\'s adopt/hide set is decided by the tile being asked about, not by whatever the pointer last touched — and applies each affordance\'s own visibility rule against a context built for it. The second exists so the action payload, and the one action that is not a plain emit at all, keep exactly one definition.',
    '',
    'Uncapped, deliberately. The band truncates at two rows because of the hexagon; that is a constraint of the surface and not of the tile, so the answer to "what does this carry" does not inherit it.',
    '',
    `source: ${T}/tile-overlay.drone.ts`,
  ].join('\n')],
  ['tile-view.drone.ts', [
    'The menu that replaced it. What is written here is only what the band cannot express: going inside a branch, picking the tile into the selection, walking to the neighbouring tile, and the way out. Everything else — edit, note, share, features, adopt, hide, block, files, invite, remove — arrives from the overlay at mount time and is rendered from the provider\'s own icon markup.',
    '',
    'A cell is the icon with its name in small type underneath. Icon-first because five words across a phone are unreadable and five icons are not; the word stays because an icon nobody recognises is a control nobody presses. The whole cell is the target, not the glyph inside it.',
    '',
    'The surface refuses the browser\'s touch gestures outright and grants scrolling back only where scrolling is wanted — the menu and the notes. Without that, a sideways swipe near a screen edge is claimed as a back navigation and the hive moves out from under the view.',
    '',
    `source: ${T}/tile-view.drone.ts`,
  ].join('\n')],
  ['quick-menu.input.ts', [
    'The hold that no longer claims anything. On a phone, over a tile, the summon does not open the ring: it records what the hold was over and gets out of the way — no gate lock, no input-mode push, no pointer lock. The haptic still fires, because the hand has to be told the hold landed; from that moment a pull means something different than a drift.',
    '',
    'Travel then decides, and drag-to-move\'s reservation is still sitting where it left it. Pull and the move takes the finger; stay still and let go and the tile\'s screen opens. Nothing is claimed on the way there, so nothing has to be given back — which is the whole reason a lost pointerup can no longer strand the page with the gate held.',
    '',
    'Off a tile, and on every other platform, the ring is untouched.',
    '',
    `source: ${Q}/quick-menu.input.ts`,
  ].join('\n')],
  ['controls-bar.component.ts', [
    'The pin, which had no way back. Pinning a layer locks the input gate so the viewport stops answering a drag — that is what it is for. On a phone the button was in the desktop rail only, so the state was reachable (a slash command, a carried-over preference) and the release was not: the page simply stopped dragging and nothing on screen said why or offered to undo it.',
    '',
    'It is the sixth control in the row above the bar, and therefore the first on a second row. That row became a five-column grid anchored by its bottom edge, so the sixth control starts a row ABOVE the first rather than pushing the bar down, and the bottom row keeps its five slots with the camera dead centre. Anything floating above the bar lifts by a published CSS variable that follows the row count, so adding a control is one button in the template.',
    '',
    `source: ${S}/ui/controls-bar/controls-bar.component.ts, ${S}/ui/controls-bar/controls-bar.component.html`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. `tile-view.exit` names the menu\'s way out in English and Japanese — its own key rather than the slide deck\'s, because "back to the hive" is right for a deck\'s screen-reader label and far too long to sit under an icon. Every other caption in the menu is the provider\'s own label, resolved through the same catalog the desktop band reads.',
    '',
    `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
  ].join('\n')],
]

/** Cells whose existing note is now partly untrue. The delta only — never a
 *  restatement, never a rewrite. */
const CORRECTIONS: { segments: string[]; text: string }[] = [
  {
    segments: [ROOT_KEY, COLLECTION, norm('touch-grammar')],
    text: [
      'CHANGED ON A PHONE — the hold over a tile no longer summons the ring at all.',
      '',
      'The grammar\'s three meanings survive exactly; what changed is who arbitrates them. On a phone, over a tile, the summon records the tile and claims NOTHING — no gate, no mode, no pointer lock — and leaves drag-to-move\'s reservation where it is. Pull and it is a move; let go still and the tile\'s screen opens; tap and you go inside. Off a tile, and everywhere that is not a phone, the ring is unchanged and the screen is still its zero-travel centre.',
      '',
      'This supersedes the arbitration note on this cell in one respect. Taking the drag\'s claim at the moment the summon matured was correct reasoning about a still finger on a desktop and wrong about a thumb: the phone hand had not finished deciding, so a pull that started late aimed a ring instead of moving the tile — and the ring then held the input gate, which is the page that would not drag.',
      '',
      'See behaviors/input/mobile-tile-menu.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, COLLECTION, norm('touch-grammar'), norm('tile-view.drone')],
    text: [
      'CHANGED — it is the only per-tile surface on a phone, so it carries the whole of what a tile offers rather than a chosen few. The set is asked for from the overlay by tile name and rendered as icon rows, five across, growing downward with no cap. Nothing is hand-listed: a bee that registers an icon for the desktop band appears here too.',
      '',
      'The sideways swipe is now the view\'s own — the surface refuses the browser\'s back gesture, which used to claim any horizontal drag begun near a screen edge.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, COLLECTION, norm('touch-grammar'), norm('quick-menu.input')],
    text: [
      'CHANGED — the gate hand-off has a phone case, and it hands off nothing. Over a tile in mobile mode the summon takes no claim and releases none: it notes the tile and waits to see whether the finger travels. A still-armed drag keeps its reservation, which is what makes the pull a move; a release without travel opens the tile\'s screen; a travel cancels the screen and the drag proceeds. Everywhere else the hand-off is as described above.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, norm('views'), norm('tile-view'), norm('tile-overlay.drone')],
    text: [
      'CHANGED — the hover band does not render on a phone. It needs a pointer to rest on a tile before it appears and a seven-pixel-accurate press to use, so on touch it was either invisible or unhittable. Its contents did not move: they are still registered here and still ordered here, and the tile\'s own screen asks for them by tile name.',
    ].join('\n'),
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

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[mobile-tile-menu] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[mobile-tile-menu] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

  const behaviorIsNew = !members.includes(BEHAVIOR)
  const behaviorSeg = [...collectionSeg, BEHAVIOR]
  const partNames = PARTS.map(([name]) => norm(name.replace(/\.ts$/, '')))

  // Phase 1 — structure. Union into what is there; never replace membership.
  if (behaviorIsNew) {
    process.stdout.write(`[struct] ${collectionSeg.join('/')} ← +${BEHAVIOR} ... `)
    const res = await send({ op: 'update', segments: collectionSeg, layer: { name: COLLECTION, children: [...members, BEHAVIOR] } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exit(1)
  } else {
    console.log(`[struct] ${BEHAVIOR} already present — merging parts only`)
  }

  const havePart = await childrenOf(behaviorSeg)
  const newParts = partNames.filter(p => !havePart.includes(p))
  process.stdout.write(`[struct] ${behaviorSeg.join('/')} ← ${havePart.length + newParts.length} children ... `)
  const up = await send({ op: 'update', segments: behaviorSeg, layer: { name: BEHAVIOR, children: [...havePart, ...newParts] } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const part of newParts) {
    process.stdout.write(`[struct] ${behaviorSeg.join('/')}/${part} ... `)
    const res = await send({ op: 'update', segments: [...behaviorSeg, part], layer: { name: part } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 2 — notes. Only for cells THIS run created: note-add is not
  // idempotent, so re-noting an existing tile would stack duplicates.
  const notes: { segments: string[]; text: string }[] = []
  if (behaviorIsNew) notes.push({ segments: behaviorSeg, text: BEHAVIOR_NOTE })
  for (const [name, note] of PARTS) {
    const key = norm(name.replace(/\.ts$/, ''))
    if (newParts.includes(key)) notes.push({ segments: [...behaviorSeg, key], text: note })
  }
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + `input` mark
  // the member (the collection's keywords ARE its parameters), `part` marks
  // each implementation cell. No replaceKind — tags stack.
  const marks: { segments: string[]; tag: string }[] = []
  if (behaviorIsNew) {
    marks.push({ segments: behaviorSeg, tag: BEHAVIOR_KEYWORD })
    marks.push({ segments: behaviorSeg, tag: COLLECTION_KEYWORD })
  }
  for (const part of newParts) marks.push({ segments: [...behaviorSeg, part], tag: PART_KEYWORD })
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.tag } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 4 — corrections. Skipped when a cell already carries this exact
  // delta, so the pass can be re-run without stacking it twice.
  let corrected = 0
  for (const c of CORRECTIONS) {
    const path = c.segments.join('/')
    const existing = await send({ op: 'note-list', segments: c.segments })
    const already = existing.ok && Array.isArray(existing.data)
      && existing.data.some((x: any) => String(x?.text ?? x?.note ?? '') === c.text)
    if (already) { console.log(`[note] ${path} — correction already present`); continue }
    process.stdout.write(`[note] ${path} ← correction ... `)
    const res = await send({ op: 'note-add', segments: c.segments.slice(0, -1), cell: c.segments[c.segments.length - 1], text: c.text })
    if (res.ok) corrected++
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[mobile-tile-menu] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks, ${corrected} corrections`)
}

main().catch(err => { console.error(err); process.exit(1) })
