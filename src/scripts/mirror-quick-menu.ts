// Mirror pass for the QUICK MENU — seven hexagons summoned under a hidden
// pointer, chosen by the direction you flick rather than the place you click.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile under the
// `input` collection and its parts, 1:1 with the source files the behaviour
// actually lives in:
//
//   behaviors/input/quick-menu
//     ├── quick-menu-types             the seven directions and the geometry
//     ├── quick-menu-registry-service  which seven, and where they lead
//     ├── quick-menu-overlay           the drawn ring, prebuilt and cached
//     ├── quick-menu-input             the gesture itself
//     ├── quickmenu-queen              /menu, for hands without a middle button
//     └── i18n-catalogs                the words
//
// Pheromones (declared, never minted on the fly): `behavior` + `input` on the
// behaviour tile — the same marks every other member of that collection
// carries — and `part` on each child. Merge mode: children union into what is
// already there, and notes/marks are only written for cells this run creates,
// so a second run adds nothing.

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

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('input')
const BEHAVIOR = norm('quick-menu')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'input'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Quick menu — hold, flick a direction, release. Seven hexagons appear under the pointer: one in the middle and six around it, each one a pathway to the next honeycomb.',
  '',
  'The pointer is HIDDEN while the menu is up, and that is the whole idea. With no cursor to aim, motion stops meaning "where" and starts meaning "which way" — so a slot is chosen by the ANGLE you travel from where you summoned, at any distance past a small dead zone. The ring works the same at the edge of the screen as in the middle, and the hand learns hold-flick-east-release as one motion instead of a place to look for.',
  '',
  'Two speeds, one motion. Direction tracking starts the instant the press lands, but the ring is not drawn for 130ms. Flick faster than that and the menu never paints — the same press-direction-release still fires the same slot. Someone learning reads the hexagons; someone who knows has the geometry in their hand and never sees them. Neither learns a different gesture, and that is the property a command palette can never have.',
  '',
  'Point-top hexagons, so the six neighbours sit east, south-east, south-west, west, north-west and north-east. Left and right are true horizontal flicks — the two easiest directions a hand makes.',
  '',
'The ring always appears in the MIDDLE OF THE SCREEN, never where the pointer happened to be. That is the reason the cursor is hidden rather than merely ignored: the real pointer is locked away for the duration, a small drawn cursor does the aiming, and when the menu closes the real one is handed back exactly where it was picked up, having never visibly moved. Locking it also means the aim is fed by raw movement rather than position, so it cannot die against the edge of the screen.',
  '',
  'You roll over a hexagon to choose it — nothing is clicked, and there is no line drawn back to where you started, because the lit hexagon and the drawn cursor already say everything the line would. Rolling onto one of the six that leads somewhere CHANGES THE MENU there and then: the next honeycomb takes the same place in the middle of the screen and the cursor returns to the centre, so every ring is a fresh reach from the same spot. Only the doorways behave that way — a hexagon that runs a command still waits for you to let go, because merely passing over something must never set it off.',
  '',
  'Crossing between hexagons has a little resistance in it: the highlight does not move the moment you pass the boundary, it waits until you are properly inside the next one. Without that the menu changes its mind under your hand while the pointer still looks like it is over the hexagon you are leaving.',
  '',
  'There is a keyboard summon too — HOLD q. The ring blooms wherever the pointer already is and the gesture is the same one the mouse makes: aim by moving, let go of the key to choose. A quick tap of q is different on purpose: it leaves the ring up so you can look at it, because someone pressing a key to find out what it does should get a menu rather than a command.',
  '',
  'Crossing the far edge of a slot that opens another ring DESCENDS into it mid-gesture: the next honeycomb blooms under your hand, and the direction you arrived from becomes the way back. Releasing at the centre without ever leaving fires the centre slot; leaving and coming back cancels, and the centre relabels itself the moment you cross out so the way out is visible exactly when it is needed.',
  '',
'Menus are DATA, not features. The gesture and the renderer know nothing about any particular menu — the registry holds them, keyed by the surface they claim, so the hexagons follow the ground you are standing on. Five ship: the hive vocabulary, a nested view ring, a workflow one inside the designer, and one each for the website and slide surfaces. Those last two are the clearest case for a ring at all — both hide the chrome on purpose, so there is no toolbar to reach for and a direction is the only fast way to act. Their centre slot is EXIT, because in a view with no chrome the verb you want most is the way out, and the centre is the slot that costs no travel. A module adds a sixth by registering a definition; it never touches the input path. We do not make one of these for everything — they are added as needed.',
  '',
  'The slide deck is the clearest argument for point-top there is: east steps forward, west steps back, and the two easiest flicks a hand makes are the two verbs a presentation is made of.',
  '',
  `source: ${Q}/quick-menu.input.ts, ${Q}/quick-menu-registry.service.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['quick-menu.types.ts', [
    'The vocabulary and the geometry. Seven directions — centre plus east, south-east, south-west, west, north-west, north-east — their unit vectors in screen space, and which one a displacement selects: inside the dead zone it is the centre, outside it is the nearest of six sixty-degree sectors at ANY distance, because direction is the whole signal.',
    '',
    'Point-top is the deliberate choice here. A point-top hexagon has a flat vertical edge on its left and right, so its neighbours sit at 0, 60, 120, 180, 240 and 300 degrees — which puts true east and west on the ring. Flat-top would trade those for up and down.',
    '',
    'Also holds what a slot can DO: run a slash behaviour, broadcast an effect, or open another ring. Because a slot can name any slash behaviour, every queen a module ships is already reachable from a menu with no code here.',
    '',
    `source: ${Q}/quick-menu.types.ts`,
  ].join('\n')],
  ['quick-menu-registry.service.ts', [
    'Which seven, and where they lead. Menus are registered definitions keyed by the ViewMode surface they claim, so the ring that appears follows the ground you are standing on — hive verbs on the hexagons, workflow verbs in the designer — and nothing in the input path ever branches on a feature name.',
    '',
    'The shipped menus are declared in code on purpose. This is a gesture: it has to answer in the first frame after the bloom on the very first summon of a cold session, with no OPFS read and no network on the path. Hive-authored menus are additive — adopt() swaps a cached definition by name, resolved in the background, and the previous one keeps answering until the replacement is whole. A menu is never half-built.',
    '',
    `source: ${Q}/quick-menu-registry.service.ts`,
  ].join('\n')],
  ['quick-menu.overlay.ts', [
    'The drawn ring. Plain DOM and inline SVG, deliberately not Pixi — the menu has to appear over every surface, and only one of those is a Pixi stage. A DOM overlay is the one renderer that is correct everywhere and cannot be caught behind a view that swapped the canvas out from under it.',
    '',
    'Every registered menu is built ONCE, at warm time, and kept detached in memory. Summoning is an appendChild of an existing subtree plus seven style writes; highlighting rewrites two attributes on two cached element references. No element creation, no measurement, nothing built on the gesture. If a summon somehow beats the warm pass it builds on demand, so a first gesture is correct even when it is slow.',
    '',
    `source: ${Q}/quick-menu.overlay.ts`,
  ].join('\n')],
  ['quick-menu.input.ts', [
    'The gesture. Middle-mouse press on a pointer, long-press on touch; the ring paints after 130ms but the direction is tracked from the first instant, so a fast flick fires without ever drawing. Travel past the far edge on a slot that opens a ring descends into it and re-anchors the origin to the hand — which is also what stops an ascend from immediately re-descending the way it came.',
    '',
    'Holds the input mode stack AND the input gate for the duration. The stack suspends whatever mode is on top; the gate locks the systems that have not migrated onto it yet. Both are needed, or a flick across the canvas would also pan it.',
    '',
    'Releasing on a slot that opens a ring leaves it up STICKY — pointer free, aim still by direction, click to fire, Escape to dismiss. That is also how /menu opens one on hardware with no middle button.',
    '',
    `source: ${Q}/quick-menu.input.ts`,
  ].join('\n')],
  ['quickmenu.queen.ts', [
    '/menu — summon the ring without the gesture, so it is discoverable from the command line and reachable on hardware with no middle button. /menu <name> opens a particular vocabulary; /menu list prints every registered menu and which surface each one claims.',
    '',
    `source: ${Q}/quickmenu.queen.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. Every slot label, plus `back` and `cancel`, under the `quickmenu.*` keys — and `slash.menu` for the behaviour itself. Labels are resolved when a ring is BUILT, not when it is summoned, so a locale change invalidates the prebuilt subtrees and re-warms them rather than paying for translation on the gesture.',
    '',
    `source: ${S}/i18n/en.json`,
  ].join('\n')],
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
    console.error(`[quick-menu] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[quick-menu] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + `input`
  // mark the member (the collection's keywords ARE its parameters), `part`
  // marks each implementation cell. No replaceKind — tags stack.
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

  console.log(`[quick-menu] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
