// Mirror pass for the PARTICIPANT STACK — the same tile held by several
// participants collapses to ONE hexagon with the others underneath, marked so
// you can see there is depth there, and rolled with the mouse wheel over the
// tile. Jaime's directive: collapse the duplicates, roll through them, and roll
// LAYERS at a time — the order is the participants' order and how they stack.
//
// Extends the existing `behaviors` mirror — never re-runs it. Adds ONE
// behaviour tile under the `swarm` collection and its parts, 1:1 with the
// source resources the behaviour lives in:
//
//   behaviors/swarm/participant-stack
//     ├── tile-stack-model     the stack + the roll (participant order, you first)
//     ├── source-dedup         registry: one entry per publisher, not per name
//     ├── layer-swap           show-cell: build the stacks, surface one layer
//     └── wheel-roll           plain wheel over a stacked tile rolls it
//
// Sibling of `participant-filter` (which participants show) and the spotlight
// (whose layer is surfaced). This is the third face of the same model: how many
// of them hold THIS tile, and how you read the ones underneath.
//
// Pheromones (declared, never minted on the fly): `behavior` + `swarm` on the
// behaviour tile, `part` on each child. Merge mode: children union into what is
// already there; notes/marks only for cells this run creates.

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

const ROOT_KEY = 'behaviors'
const COLLECTION = 'swarm'
const BEHAVIOR = 'participant-stack'
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'swarm'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Participant stack — when several participants hold the same tile, the canvas shows ONE hexagon with theirs underneath yours, not a row of copies. Two trees at the same coordinates are the same tree, so a peer publishing "notes" where you have "notes" is a second implementation of one tile, never a second tile.',
  '',
  'A stacked tile wears a cold grey-blue in its border while your version is the one showing — depth you can see without hovering every hex. Roll it with the plain mouse wheel over the tile: forward from you onto each participant who holds it, and round back to yours. Ctrl/Cmd+wheel still zooms; Alt+wheel still cycles every participant whether they hold this tile or not.',
  '',
  'The roll moves a LAYER, not a tile. Landing on a participant surfaces their version of every tile you both hold — their picture, their border hue — so you read their whole layer at once and the difference between the two layers is what you see. The slot never moves: a stack is depth at one index, and taking the publisher\'s index would slide the tile out from under the pointer rolling it. Tiles only THEY hold keep arriving at their own published slot, as before.',
  '',
  'Order is the participants\' order — you at index 0 wherever you hold the tile, then each publisher in the swarm\'s freshness order, the same order the layer-cycle strip shows. Nothing is stored: a stack is a derivation of who is present, and outliving the peers that justified it would be a trap.',
  '',
  'doctrine: documentation/superimposition.md',
  `source: ${E}/presentation/tiles/tile-stack.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['tile-stack-model', [
    'The stack and the roll. Per render pass the renderer publishes what it resolved: for each tile, the participants holding it — you first whenever you hold it, then each publisher in freshness order. Depth is what the border mark reads; the hovered tile\'s depth is what the wheel gates on.',
    '',
    'Rolling walks THAT tile\'s participants (a wheel over a tile two people hold must not march through six unrelated publishers to get back to yours) but what it moves is the global spotlight — so the whole chosen layer surfaces together and no per-tile state is ever recorded. In-memory and per-pass: a stack is a derivation of live presence.',
    '',
    `source: ${E}/presentation/tiles/tile-stack.ts`,
  ].join('\n')],
  ['source-dedup', [
    'One entry per publisher. The tile-source registry used to union peer contributions by (kind, name), so the second person publishing a name was thrown away before the renderer ever saw it — nothing to collapse, nothing to roll to. Peer entries now key on the publisher as well, and the renderer still draws one hexagon per name: multiplicity became something it can read instead of something already discarded.',
    '',
    `source: ${E}/presentation/tiles/tile-source-registry.ts`,
  ].join('\n')],
  ['layer-swap', [
    'Building the stacks and surfacing one layer. The render pass folds every peer entry — including the names you already hold — into a stack per tile, and marks the ones with depth on their border. While a participant is surfaced, each tile you both hold renders THEIR version: it rides the external path (their streamed image, no local property read that would paint your picture back over it) and takes their identity hue, while keeping your slot.',
    '',
    'Surfacing is a layer move, so the pass clears what a participant-filter toggle clears — layer cells, the rendered key, the slot machine — instead of only recomputing a border colour. Leaving those warm would paint the new layer\'s pictures into the old layer\'s arrangement.',
    '',
    `source: ${E}/presentation/tiles/show-cell.drone.ts`,
  ].join('\n')],
  ['wheel-roll', [
    'The gesture. A stacked tile owns the plain wheel: rolling is the only way to reach the versions underneath, while zoom is reachable from every other pixel on the canvas and from Ctrl/Cmd right there. Alt+wheel keeps cycling every participant (stacked tile or not) and Ctrl/Cmd keeps fine zoom — the three gestures are mutually exclusive on the modifier so they never fight over one event. Over an unstacked tile the wheel is zoom, exactly as before.',
    '',
    `source: ${E}/navigation/zoom/mousewheel-zoom.input.ts`,
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
    console.error(`[participant-stack] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[participant-stack] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  console.log(`[participant-stack] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
