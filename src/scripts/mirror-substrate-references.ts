// Corrective mirror pass. An earlier run (mirror-places.ts) put this work under
// `behaviors/appearance/places` and described it as PLACES. That was wrong:
// Places is the COLLECTIONS index, a different surface entirely. The substrate
// surface kept its own name, and its new set is REFERENCES.
//
// This pass:
//   1. removes the mis-named `places` child from `behaviors/appearance`
//      (structure is union-only otherwise — every other member is untouched),
//   2. hangs the four implementation parts under the EXISTING
//      `behaviors/appearance/substrate` behaviour, where they belong,
//   3. writes the corrected notes, including why the pool spelling moved twice.
//
// There is no rename in the hive — a mis-named cell is removed and the right
// one is created. Notes stack, so the substrate behaviour keeps its history.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
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
const STALE_KEY = norm('places')
const SUBSTRATE_SEG = [...APPEARANCE_SEG, norm('substrate')]
const PART_KEYWORD = 'part'

const SUBSTRATE_NOTE = [
  'Substrate, and the set that is the participant\'s own.',
  '',
  'A substrate is where a tile\'s background comes from when it has no picture of its own. Most of the sets name somewhere to go LOOK — a hive path, a linked folder, a remote bundle, a layer — and each stays bound to that somewhere: rename the page, revoke the folder, move the bundle, and the set goes quiet. REFERENCES is the exception. A reference is a SIGNATURE. The bytes already sit at the content root under it, so copying one in copies a reference and nothing else: no fetch, no handle, no permission prompt, and the same image referenced from two sets is still stored once. Copy references out of a page and the set keeps working after that page is renamed, re-homed, or deleted.',
  '',
  'The pool listing IS the set. One file per reference, named by the image signature, so copying the same image twice lands on the same filename and it dedupes itself with no list to maintain. Dropping one removes the MARKER only — the image is content, and may still be on a tile or in another set.',
  '',
  'THE SPELLING MOVED TWICE, AND THE SECOND MOVE IS THE INTERESTING ONE. Storage was under sign(\'substrate\') — a bare word, which hashes to the same directory as a root tile of the same name, so a page called `substrate` and the pool were one folder and flattening the page would have deleted the pool. It moved to a colon spelling, which no location can produce. It first moved to `places:*` under a brief rename of this surface — that name belongs to the COLLECTIONS index, not here, so it moved again to `substrate:sources` and `substrate:references`. Both earlier addresses are read-only drain sources now, chained newest-first, because a build did write real records to the middle one; skipping that link would strand whoever ran it. Each record is copied forward, verified, then dropped; the directory goes only when nothing is left in it.',
  '',
  `source: ${E}/substrate/substrate-organizer.drone.ts, ${E}/substrate/substrate.service.ts, ${C}/substrate.types.ts, ${C}/core/pool-registry.ts`,
].join('\n')

const PARTS: { key: string; note: string }[] = [
  {
    key: norm('substrate-organizer-drone'),
    note: [
      'The surface. Shows every set as a card in one horizontal strip, previews the active one as a grid of thumbnails, and switches between them on a click. Plain DOM appended to the body, opened and closed over the bus — no framework underneath it.',
      '',
      'Two of its affordances appear only while the REFERENCES set is selected, because they only mean anything there: copy references from the page you are standing on, and drop one from the grid. The other sets are views onto somewhere else, so their contents are not this surface\'s to remove.',
      '',
      `source: ${E}/substrate/substrate-organizer.drone.ts`,
    ].join('\n'),
  },
  {
    key: norm('substrate-service'),
    note: [
      'The resolution and the drain. Holds the registry, walks the per-location overrides, and turns whichever set is active into image signatures. References is the one branch that does no walking: the pool listing already IS the answer, and every member is already root-addressed.',
      '',
      'It also carries the migration. Reads try the live address, then each retired one in order; a hit is copied forward, VERIFIED at the new address, and only then dropped — per record, never a wipe. A failed verify leaves the record where it is for the next boot. Retired directories are removed only once empty and are never re-created: a drained pool must stay gone, or the collision it escaped comes back.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
  {
    key: norm('substrate-types'),
    note: [
      'What a set can BE. Four shapes name a location to walk — a layer signature, a hive path, a folder handle, a bundle URL. The fifth, references, names nothing: its record is empty because the pool is the list. That emptiness is the point, and it is why the record can never go stale.',
      '',
      `source: ${C}/substrate.types.ts`,
    ].join('\n'),
  },
  {
    key: norm('pool-registry'),
    note: [
      'Why the spelling had to change. Pools of meaning and lineage sigbags share one flat root and nothing on disk tells them apart: a pool is sign(meaning), a bag is sign(lineageKey(segments)), and for a bare word those preimages are byte-identical.',
      '',
      'A colon fixes it by construction — the lineage key folds every non-letter and non-digit to a dash, so no location can ever produce one. The bare-word list here is frozen and may only SHRINK, which is what happened: `substrate` came off it. Shrinking is only honest with a drain plan behind it, because sign() of a new spelling mints a different address forever. The list also carries a warning against the two `places:*` spellings, which were reserved for one build and must never be reserved again.',
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
    console.error(`[substrate-refs] "${APPEARANCE_SEG.join('/')}" has no children — is a renderer connected?`)
    process.exit(1)
  }
  console.log(`[substrate-refs] ${APPEARANCE_SEG.join('/')} holds: ${siblings.join(', ')}`)

  // Phase 1 — remove the mis-named cell, keeping every other member.
  if (siblings.includes(STALE_KEY)) {
    process.stdout.write(`[struct] ${APPEARANCE_SEG.join('/')} ← −${STALE_KEY} (mis-named) ... `)
    const res = await send({
      op: 'update',
      segments: APPEARANCE_SEG,
      layer: {
        name: APPEARANCE_SEG[APPEARANCE_SEG.length - 1],
        children: siblings.filter(s => s !== STALE_KEY),
      },
    })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exit(1)
  } else {
    console.log(`[struct] no ${STALE_KEY} child to remove`)
  }

  // Phase 2 — parts under the behaviour that was always the right home.
  const have = await childrenOf(SUBSTRATE_SEG)
  const missing = PARTS.filter(p => !have.includes(p.key)).map(p => p.key)
  process.stdout.write(`[struct] ${SUBSTRATE_SEG.join('/')} ← ${missing.length ? `+${missing.join(', ')}` : 'no new parts'} ... `)
  const mk = await send({
    op: 'update',
    segments: SUBSTRATE_SEG,
    layer: { name: SUBSTRATE_SEG[SUBSTRATE_SEG.length - 1], children: [...have, ...missing] },
  })
  console.log(mk.ok ? 'ok' : `FAIL: ${mk.error}`)
  if (!mk.ok) process.exit(1)
  for (const key of missing) {
    process.stdout.write(`[struct] ${SUBSTRATE_SEG.join('/')}/${key} ... `)
    const res = await send({ op: 'update', segments: [...SUBSTRATE_SEG, key], layer: { name: key } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — notes. The correcting note stacks on the behaviour's own history.
  const notes: { segments: string[]; text: string }[] = [{ segments: SUBSTRATE_SEG, text: SUBSTRATE_NOTE }]
  for (const p of PARTS) notes.push({ segments: [...SUBSTRATE_SEG, p.key], text: p.note })
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 4 — pheromones. Declared vocabulary only: `part` on the new cells.
  for (const key of missing) {
    process.stdout.write(`[mark] ${SUBSTRATE_SEG.join('/')}/${key} ← ${PART_KEYWORD} ... `)
    const res = await send({ op: 'decoration-add', segments: [...SUBSTRATE_SEG, key], kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[substrate-refs] DONE — ${missing.length} part(s), ${notes.length} notes, ${missing.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
