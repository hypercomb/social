// Mirror pass for PLACES — the substrate Organizer became Places, and its
// storage moved off the bare word `substrate` onto colon-scoped pools.
//
// What changed in the code, and therefore here:
//   1. The Organizer modal is now the Places surface (`places:open`, hc-places,
//      the ⌖ marker instead of the substrate diamond).
//   2. sign('substrate') is RETIRED. The registry and the per-location
//      overrides live in sign('places:sources'); the old address is a
//      read-fallback that drains itself per record and then removes itself.
//   3. A new collection type, `places`, resolves from sign('places:references')
//      — one file per copied reference, NAMED BY THE IMAGE SIGNATURE. A place
//      is a reference, not a copy.
//
// Extends the existing `behaviors/appearance` collection, which already holds
// the substrate/backgrounds/reroll behaviours. Union-only: this pass adds one
// behaviour tile and its parts and leaves every other member alone. It never
// re-runs mirror-behaviors.ts.

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
const C = 'hypercomb-core/src'

const APPEARANCE_SEG = [norm('behaviors'), norm('appearance')]
const PLACES_KEY = norm('places')
const PLACES_SEG = [...APPEARANCE_SEG, PLACES_KEY]

const BEHAVIOR_KEYWORD = 'behavior'
const PART_KEYWORD = 'part'

const PLACES_NOTE = [
  'Places — where a tile\'s background comes from, and the one collection that is the participant\'s own.',
  '',
  'Every other collection names somewhere to go LOOK: a hive path, a linked folder, a remote bundle, a layer. Each resolves by walking that somewhere, and each stays bound to it — rename the page, revoke the folder, move the bundle, and the collection goes quiet. A PLACE is different. A place is a SIGNATURE. The bytes already sit at the content root under that signature, so copying a place in copies a reference and nothing else: no fetch, no handle, no permission prompt, and the same image referenced from two collections is still stored exactly once. Copy references out of a page and the collection keeps working after that page is renamed, re-homed, or deleted — the reference was never pointing at the page, only at the image.',
  '',
  'The pool listing IS the collection. One file per reference, named by the image signature, so copying the same image in twice lands on the same filename and the set dedupes itself with no list to maintain. Dropping a place removes the MARKER only — the image is content, and may still be on a tile or in someone else\'s collection.',
  '',
  'This was called the Organizer and it stored everything under sign(\'substrate\'). That was a bare word, and a bare word hashes to the same directory as a root tile of the same name — a page called `substrate` and the pool were literally one folder, where flattening the page would have deleted the pool. The spelling now carries a colon, which no location can ever produce: `places:sources` for the registry and the per-location overrides, `places:references` for the copied references. The old address stays readable and drains itself one record at a time, then removes itself once empty.',
  '',
  `source: ${E}/substrate/places.drone.ts, ${E}/substrate/substrate.service.ts, ${C}/substrate.types.ts, ${C}/core/pool-registry.ts`,
].join('\n')

const PARTS: { key: string; note: string }[] = [
  {
    key: norm('places-drone'),
    note: [
      'The surface. The overlay that shows every collection as a card in one horizontal strip, previews the active one as a grid of thumbnails, and switches between them on a click. Plain DOM appended to the body, opened and closed over the bus — no framework underneath it.',
      '',
      'Two of its affordances exist only while PLACES is the selected collection, because they only mean anything there: copy references from the page you are standing on, and drop a reference from the grid. The other collections are views onto somewhere else, so their contents are not this surface\'s to remove. The copy button never has to say where things will land — they land in what you are looking at.',
      '',
      `source: ${E}/substrate/places.drone.ts`,
    ].join('\n'),
  },
  {
    key: norm('substrate-service'),
    note: [
      'The resolution and the drain. Holds the registry, walks the per-location overrides, and turns whichever collection is active into a set of image signatures. Places is the one branch that does no walking at all: the pool listing already IS the answer, and every member is already root-addressed.',
      '',
      'It also carries the migration off the retired address. Reads try the new pool first, then the old one; a hit in the old one is copied forward, VERIFIED at the new address, and only then dropped — per record, never a wipe. A failed verify simply leaves the record where it was for the next boot to retry. The old directory is removed only once nothing is left in it, and it is never re-created: a drained pool must stay gone, or the collision it was moved to escape comes back.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
  {
    key: norm('substrate-types'),
    note: [
      'What a collection can BE. Four of the shapes name a location to walk — a layer signature, a hive path, a folder handle, a bundle URL. The fifth, places, names nothing: its record is empty because the pool is the list. That emptiness is the point, and it is why the record never goes stale.',
      '',
      `source: ${C}/substrate.types.ts`,
    ].join('\n'),
  },
  {
    key: norm('pool-registry'),
    note: [
      'Why the spelling had to change. Pools of meaning and lineage sigbags share one flat root, and nothing on disk tells them apart: a pool is sign(meaning), a bag is sign(lineageKey(segments)), and for a bare word those two preimages are byte-identical. So sign(\'substrate\') was the same directory as a page named `substrate`.',
      '',
      'A colon fixes it by construction — the lineage key folds every non-letter and non-digit to a dash, so no location can ever produce one. The bare-word list here is frozen and may only SHRINK, which is exactly what this pass did to it: `substrate` came off, `places:sources` and `places:references` went on as scoped meanings. Shrinking it is only honest with a drain plan behind it, because sign() of a new spelling mints a different address forever and an unplanned rename strands every existing member.',
      '',
      `source: ${C}/core/pool-registry.ts`,
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
  const siblings = await childrenOf(APPEARANCE_SEG)
  if (!siblings.length) {
    console.error(`[places] "${APPEARANCE_SEG.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[places] ${APPEARANCE_SEG.join('/')} currently holds: ${siblings.join(', ')}`)

  // Phase 1 — structure. Union only: add the behaviour if it isn't there, then
  // its parts, leaving every existing member of both levels alone.
  if (!siblings.includes(PLACES_KEY)) {
    process.stdout.write(`[struct] ${APPEARANCE_SEG.join('/')} ← +${PLACES_KEY} ... `)
    const up = await send({
      op: 'update',
      segments: APPEARANCE_SEG,
      layer: { name: APPEARANCE_SEG[APPEARANCE_SEG.length - 1], children: [...siblings, PLACES_KEY] },
    })
    console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
    if (!up.ok) process.exit(1)
  } else {
    console.log(`[struct] ${PLACES_KEY} already present — extending it`)
  }

  const have = await childrenOf(PLACES_SEG)
  const missing = PARTS.filter(p => !have.includes(p.key)).map(p => p.key)
  process.stdout.write(`[struct] ${PLACES_SEG.join('/')} ← ${missing.length ? `+${missing.join(', ')}` : 'no new parts'} ... `)
  const mk = await send({
    op: 'update',
    segments: PLACES_SEG,
    layer: { name: PLACES_KEY, children: [...have, ...missing] },
  })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) process.exit(1)
  for (const key of missing) {
    process.stdout.write(`[struct] ${PLACES_SEG.join('/')}/${key} ... `)
    const res = await send({ op: 'update', segments: [...PLACES_SEG, key], layer: { name: key } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 2 — notes. The explanation lives on the tile, not only in a file.
  const notes: { segments: string[]; text: string }[] = [{ segments: PLACES_SEG, text: PLACES_NOTE }]
  for (const p of PARTS) notes.push({ segments: [...PLACES_SEG, p.key], text: p.note })
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` on the tile
  // that joins the appearance collection, `part` on each implementation cell.
  const marks: { segments: string[]; keyword: string }[] = [
    { segments: PLACES_SEG, keyword: BEHAVIOR_KEYWORD },
    { segments: PLACES_SEG, keyword: 'appearance' },
    ...PARTS.map(p => ({ segments: [...PLACES_SEG, p.key], keyword: PART_KEYWORD })),
  ]
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.keyword} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.keyword } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[places] DONE — ${missing.length} new part(s), ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
