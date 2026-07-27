// Mirror pass for the READINESS SHADE — a tile stays dim and un-clickable
// until what is inside it is proven loaded, and brightens the moment it is, so
// bright always means "click me, this lands instantly". The tiles you actually
// meet are counted, and their insides are loaded first.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile under the
// `appearance` collection and its parts, 1:1 with the source files the
// behaviour actually lives in:
//
//   behaviors/appearance/readiness-shade
//     ├── show-cell-drone         the shade, the children gate, the fail-open
//     ├── tile-overlay-drone      the inertness, and counting the tiles you meet
//     ├── usage-tracker           interactions + dwell, and the write-ahead queue
//     ├── usage-types             the contract essentials reads without shared
//     └── history-service         best-first preload: most-met path first
//
// Pheromones (declared, never minted on the fly): `behavior` + `appearance` on
// the behaviour tile — the same marks every other member of that collection
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
const C = 'hypercomb-core/src'

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('appearance')
const BEHAVIOR = norm('readiness-shade')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'appearance'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Readiness shade — a tile is dim and un-clickable until what is inside it is proven loaded, and brightens the moment it is. Bright always means the same thing: click me, this lands instantly.',
  '',
  'Dim is the DEFAULT and bright is EARNED. A tile brightens only on positive proof, never on the absence of bad news — so a tile whose insides have not arrived can never masquerade as ready. A branch waits on the tiles INSIDE it: its direct children\'s pictures must be present locally (or concluded absent) before it opens up. A leaf waits on its own picture.',
  '',
  'Tiles brighten ONE BY ONE, not all at once: each is released the moment its own insides finish, and the ones you use most are checked and loaded first. A page shades at most once per visit — coming back to it paints bright on the first frame — and brightness is one-way within a visit, so a late arrival can never dim a tile you can already click.',
  '',
  'Burden of proof has a DEADLINE. Whatever cannot prove itself within a few seconds — an unreachable host, bytes that never come — brightens anyway. A tile that opens slowly is always better than a tile you cannot open.',
  '',
  'Which tiles come first is decided by the ones you actually MEET. Every entry is counted against that tile, kept only on this device, never shared and never part of history — and the count is written down the instant it happens, so nothing is lost if the app stops. Preloading then descends the path you use most.',
  '',
  `source: ${E}/presentation/tiles/show-cell.drone.ts, ${S}/core/usage-tracker.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['show-cell.drone.ts', [
    'The shade. Decides, per tile and per frame, whether it has earned its brightness: a branch needs the pictures of the tiles inside it, a leaf needs its own. Resolves the children of each visible branch, releases each one individually the moment its insides are present, and warms what is missing through a small ordered queue — most-met tile first — so tiles brighten one at a time instead of all together at the end.',
    '',
    'Reads the address of the render pass it belongs to, stamped with the tiles it painted, and never asks where we are a second time — asking twice was how it used to end up describing a page the participant had already left, wiping what it had proven and leaving tiles dim forever.',
    '',
    'Carries the deadline too: whatever is unproven after a few seconds brightens regardless, so the shade can never lock anyone out of their own hive.',
    '',
    `source: ${E}/presentation/tiles/show-cell.drone.ts`,
  ].join('\n')],
  ['tile-overlay.drone.ts', [
    'The inertness, and the counting. A shaded tile is not just dim — it does not press, click, select, hover or show its icons, so a click can never land on something that is not ready. And at the one place every way of entering a tile passes through, it counts the meeting: the tile you open is the tile whose insides deserve to be loaded first next time.',
    '',
    `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
  ].join('\n')],
  ['usage-tracker.ts', [
    'The counting itself. Per tile: how often you meet it, and how long you stay, faded by age so old habits stop steering. Stays on this device — never shared, never written into history, never part of a signature — and pauses its clock while the tab is hidden so a forgotten window cannot invent interest.',
    '',
    'Every increment is written down FIRST, in a queue, and only leaves that queue once the real record has been saved. A crash, a kill or a refresh between the two loses nothing: the next start reads the queue back and carries on counting.',
    '',
    `source: ${S}/core/usage-tracker.ts`,
  ].join('\n')],
  ['usage.types.ts', [
    'The contract. Weigh a tile, rank a set of them, count a meeting. Lives in core so a module can consult the counting without reaching into the shell — the same shape the translations use.',
    '',
    `source: ${C}/usage.types.ts`,
  ].join('\n')],
  ['history.service.ts', [
    'The preloading order. Instead of loading a level at a time, it always takes the heaviest tile it knows about next — so a participant who returns to their hive walks straight down the path they use most, warming each tile fully before descending. Someone arriving cold has no history to steer by, and simply gets the old shallow-first order.',
    '',
    `source: ${E}/history/history.service.ts`,
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
    console.error(`[readiness-shade] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[readiness-shade] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + `appearance`
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

  console.log(`[readiness-shade] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
