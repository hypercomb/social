// Mirror pass for the SWARM PARTICIPANT FILTER — click participant names at
// the top to filter the canvas to those participants' tiles (no selection =
// everyone shows), and adopt the selected participants' offered branches in
// one gesture. Jaime's directive: in a big swarm you never want to adopt an
// entire hierarchy across everyone — filter first, then adopt individually
// or by participant.
//
// Extends the existing `behaviors` mirror — never re-runs it. Adds ONE
// behaviour tile under the `swarm` collection and its parts, 1:1 with the
// source resources the behaviour lives in:
//
//   behaviors/swarm/participant-filter
//     ├── swarm-filter-service      the selection (session-only, multi-select)
//     ├── source-filter             swarm.drone: filter before the dedup
//     ├── render-guard              show-cell: belt-and-braces + invalidation
//     ├── presence-badges           the badge toggles + the adopt chip
//     └── i18n-catalogs             the words, every locale
//
// Pheromones (declared, never minted on the fly): `behavior` + `swarm` on
// the behaviour tile, `part` on each child. Merge mode: children union into
// what is already there; notes/marks only for cells this run creates.

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

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const S = 'hypercomb-shared'

const ROOT_KEY = 'behaviors'
const COLLECTION = 'swarm'
const BEHAVIOR = 'participant-filter'
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'swarm'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Participant filter — in a busy swarm you never want to adopt an entire hierarchy across everyone. Click a participant\'s badge at the top (or their name in the expanded panel) to filter the canvas to just the selected participants\' tiles; click again to release. No selection = everyone shows. Your own tiles are never filtered.',
  '',
  'With participants selected, one chip adopts every branch they offer at the current location — individual tile adoption stays exactly as it was. The chip feeds the existing adopt verb; every gate (code consent, complete-or-defer closure, read-back, receipts) applies per branch, unchanged. Adopt is adopt: the filter is a view affordance, never a decision surface.',
  '',
  'The selection is session-only and in-memory — a filter surviving a reload while the peers who justified it are gone is a trap. Departed participants drop out of the selection automatically.',
  '',
  'doctrine: documentation/swarm-participant-filter.md',
  `source: ${E}/sharing/swarm-filter.service.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['swarm-filter-service', [
    'The selection. A multi-select set of participant pubkeys, in-memory and session-only (the same posture as spotlight and session hides — no storage, no pool, no lineage writes). Toggling a departed participant is refused; peer churn reconciles the selection so a set of ghosts can never filter the canvas down to nothing. Every change fires the swarm:filter effect, whose last value seeds late subscribers.',
    '',
    `source: ${E}/sharing/swarm-filter.service.ts`,
  ].join('\n')],
  ['source-filter', [
    'The authoritative filter point. The swarm\'s tile source applies the selection BEFORE the tile-source registry dedupes same-named entries — which is what keeps a name two peers both publish resolvable to a SELECTED publisher, with that publisher\'s layer signature, image, and slot. Filtering after the dedup would drop the tile whenever the race was won by an unselected peer.',
    '',
    `source: ${E}/sharing/swarm.drone.ts`,
  ].join('\n')],
  ['render-guard', [
    'Belt-and-braces. The render pass re-applies the selection in the same union-delete chain every other visibility rule uses, catching entries served from a stale source cache in the frame a toggle lands; names that are also the participant\'s own tiles are exempt. The toggle invalidates exactly what a peers-changed burst invalidates — layer cells, source entries, the rendered key, and the slot machine — or a stale slot snapshot would keep unselected peers painted.',
    '',
    `source: ${E}/presentation/tiles/show-cell.drone.ts`,
  ].join('\n')],
  ['presence-badges', [
    'The face. The presence strip\'s participant badges become the filter toggles — selected identities wear their own hue as a ring; the caret owns panel expansion now. Row names in the panel toggle the same selection. While participants are selected, a quiet green chip offers their branches: it builds participant-grouped picks (valid layer signatures only) and emits the existing adopt-selected verb.',
    '',
    `source: ${S}/ui/presence-banner/presence-banner.component.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. The filter-toggle hint and the adopt chip label — composed per catalog from that language\'s own adopt verb and tile plural, so terminology stays native — in every catalog the shell carries.',
    '',
    `source: ${S}/i18n/en.json … ${S}/i18n/tr.json`,
  ].join('\n')],
]

/** Child NAMES via raw layer bytes — no recursive inflate. */
async function childrenOf(segments: string[]): Promise<string[]> {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) return []
  const sigs: string[] = Array.isArray(layer.data?.children) ? layer.data.children.map(String) : []
  const names: string[] = []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const name = JSON.parse(res.data.text)?.name
      if (typeof name === 'string' && name.trim()) names.push(name.trim())
    } catch { /* skip unreadable child */ }
  }
  return names
}

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[participant-filter] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[participant-filter] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

  const behaviorIsNew = !members.includes(BEHAVIOR)
  const behaviorSeg = [...collectionSeg, BEHAVIOR]
  const partNames = PARTS.map(([name]) => name)

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
    if (newParts.includes(name)) notes.push({ segments: [...behaviorSeg, name], text: note })
  }
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only. No replaceKind — tags stack.
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

  console.log(`[participant-filter] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
