// Mirror pass for the HOLD-TO-ENTER gesture + the empty-layer notice.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as
// `part` cells) — it never re-runs them. This pass adds ONE behaviour tile
// under the `input` collection and its parts, 1:1 with the source files the
// gesture actually lives in:
//
//   behaviors/input/hold-to-enter
//     ├── tile-overlay-drone       the hold timer, jitter box, entry commit
//     ├── collection-empty-prompt-drone   the "No tiles yet" notice
//     └── i18n-catalogs            the words, en + ja
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

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('input')
const BEHAVIOR = norm('hold-to-enter')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'input'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Hold to enter — press and keep still on a tile for 450ms and its layer opens, even when the tile has nothing inside it yet.',
  '',
  'A tile that already has children opens on the press itself (instant). A CHILDLESS tile had no pointer path into its layer at all: the only way in was typing `/name` at the command line. The hold closes that gap, and both gestures commit through the same entry choke point, so filters, reference portals, view takeovers and the navigation guard all behave identically.',
  '',
  'Mouse and pen only. On touch a 300ms hold already means drag-to-move, so arming there would fight the move gesture.',
  '',
  'Cancelled by anything that is not a still hold: travel past an 8px jitter box, the release, a pointercancel, the window losing focus, or a render rebuilding the tile map underneath the pointer.',
  '',
  `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['tile-overlay.drone.ts', [
    'The gesture. Arms the hold on a pointerdown over a childless tile, tracks the jitter box on pointermove, cancels on release/cancel/blur, and on expiry consumes the pointer and enters the tile through the same #navigateInto choke point clicking a branch uses.',
    '',
    `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
  ].join('\n')],
  ['collection-empty-prompt.drone.ts', [
    'The notice. Landing on a layer with no tiles now happens deliberately, so the empty hex field says where you are instead of staying blank: "No tiles yet", the name of the tile you are inside, and a way to add the first one. Silent at the hive root, on the /sets landing, on launch-group pages, and under any takeover view that hides the hexagons.',
    '',
    `source: ${E}/presentation/tiles/collection-empty-prompt.drone.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. `layer.empty.title` / `layer.empty.body` / `layer.empty.action` in English and Japanese, alongside the collection wording the same panel uses on a collection root.',
    '',
    `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
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
    console.error(`[hold-to-enter] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[hold-to-enter] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  console.log(`[hold-to-enter] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
