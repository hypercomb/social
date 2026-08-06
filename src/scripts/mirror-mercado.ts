// Mirror pass for EL MERCADO — the Revolución storefront, its earned
// currency, and the props it sells into the 3D lounge.
//
// The site builder (intel-build-revolucion-site.ts) creates the `store` cell
// and hangs its page; this pass builds the STRUCTURE underneath it, so the
// storefront exists in the hive as tiles and marks, not only as HTML:
//
//   revolucion/store                     ← keyword: mercado
//     ├── embers                         the ledger + the catalogue (part)
//     ├── the-drinks-cart                one tile per good (mercado + part)
//     ├── the-chess-table
//     ├── the-globe-bar
//     ├── the-victrola
//     └── the-band-wall
//
// Declared vocabulary: `mercado` keywords the collection and every good in
// it — painting it on any tile is what makes that tile a good. `part` marks
// the implementation cells, same as every other mirror.
//
// Merge mode: children union into whatever is already there, and notes/marks
// are written ONLY for cells this run creates (note-add is not idempotent),
// so a second run is a no-op.

import WebSocket from 'ws'
import { EARN_RULES, SALE_ITEMS } from './lounge3d/store-items.js'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mercado-${Date.now()}-${++counter}` }
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

const LOUNGE_SRC = 'scripts/lounge3d/lounge-3d.ts'
const ITEMS_SRC = 'scripts/lounge3d/store-items.ts'
const SITE_SRC = 'scripts/intel-build-revolucion-site.ts'

const STORE_SEG = ['revolucion', 'store']
const MERCADO_KEYWORD = 'mercado'
const PART_KEYWORD = 'part'

const STORE_NOTE = [
  'El Mercado — the Revolución storefront. Goods are bought with EMBERS, and embers are earned, never bought: there is no till, no payment rail, and no intention of adding one.',
  '',
  'The ledger is an append-only list in the browser (rev:embers:ledger). The balance is its SUM and the inventory is a `buy:<slot-id>` entry inside it — derived, both of them, exactly the way the hive derives a root from its markers. An earning claim carries the key of its occasion (a moment\'s timestamp, a leg number, the sorted flavor set of a tasting), and a key already in the ledger never pays twice, which is what makes re-scanning safe on every page load.',
  '',
  `Every good is a SLOT in the lounge — the same slot ids the Decorate list drives — so buying a thing and switching a thing on are one mechanism, not two. Unowned goods show their price in the Decorate list and unlock from it. Sources: ${ITEMS_SRC} (catalogue + ledger), ${SITE_SRC} (page, decorate list, earning hooks), ${LOUNGE_SRC} (the props).`,
  '',
  'Earning:',
  ...EARN_RULES.map(r => `  +${r.embers} — ${r.label}: ${r.note}`),
].join('\n')

const EMBERS_NOTE = [
  'Embers — the currency, its ledger, and the catalogue both surfaces read.',
  '',
  'ONE list feeds three consumers: the store page (the shop window), the lounge Decorate list (owned toggles, unowned prices), and the 3D room itself, which imports the slot ids so the catalogue and the renderer can never drift apart. A mistyped id would otherwise sell a slot no renderer knows about.',
  '',
  'The runtime is deliberately ES5-flavoured and dependency-free — these pages render offline from a signature, so nothing may be fetched at read time. Cross-tab coherence comes from the `storage` event: spend in one tab and the purse in the other is looking at the same list.',
  '',
  `source: ${ITEMS_SRC}`,
].join('\n')

const GOOD_NOTE = (label: string, price: number, blurb: string): string => [
  `${label} — ${price} embers.`,
  '',
  blurb,
  '',
  `A slot in the room like any other, dark until the ledger says it is yours. Buying it walks you in and points the camera at it: a purchase that lands off-camera may as well not have happened. Source: ${LOUNGE_SRC}.`,
].join('\n')

async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'children', segments })
  if (res.ok && Array.isArray(res.data?.children)) {
    return (res.data.children as Array<{ name?: string } | string>).map(c =>
      typeof c === 'string' ? c : (c?.name ?? '')).filter(Boolean).map(norm)
  }
  return []
}

async function main(): Promise<void> {
  const pre = await send({ op: 'layer-at', segments: STORE_SEG })
  if (!pre.ok) {
    console.error(`[mercado] ABORT: ${STORE_SEG.join('/')} not reachable (${pre.error}). ` +
      'Run intel-build-revolucion-site.ts first — it creates the store cell — and open localhost:4250/?claudeBridge=1.')
    process.exit(1)
  }

  const goods = SALE_ITEMS.map(i => ({ key: norm(i.label), item: i }))
  const wanted = [{ key: norm('embers'), item: null as null | typeof SALE_ITEMS[number] }, ...goods]

  const have = await childrenOf(STORE_SEG)
  console.log(`[mercado] ${STORE_SEG.join('/')} currently holds: ${have.join(', ') || '(nothing)'}`)
  const fresh = wanted.filter(w => !have.includes(w.key))

  // Phase 1 — structure. Union, never replace.
  process.stdout.write(`[struct] ${STORE_SEG.join('/')} ← ${have.length + fresh.length} children ... `)
  const up = await send({
    op: 'update',
    segments: STORE_SEG,
    layer: { name: 'store', children: [...have, ...fresh.map(f => f.key)] },
  })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const f of fresh) {
    process.stdout.write(`[struct] ${STORE_SEG.join('/')}/${f.key} ... `)
    const res = await send({ op: 'update', segments: [...STORE_SEG, f.key], layer: { name: f.key } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 2 — notes. Only for cells THIS run created.
  const notes: Array<{ segments: string[]; text: string }> = []
  if (!have.length) notes.push({ segments: STORE_SEG, text: STORE_NOTE })
  for (const f of fresh) {
    notes.push({
      segments: [...STORE_SEG, f.key],
      text: f.item ? GOOD_NOTE(f.item.label, f.item.price, f.item.blurb) : EMBERS_NOTE,
    })
  }
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({
      op: 'note-add',
      segments: n.segments.slice(0, -1),
      cell: n.segments[n.segments.length - 1],
      text: n.text,
    })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. `mercado` keywords the collection AND every good in
  // it; `part` marks the implementation cells.
  const marks: Array<{ segments: string[]; tag: string }> = []
  if (!have.length) marks.push({ segments: STORE_SEG, tag: MERCADO_KEYWORD })
  for (const f of fresh) {
    marks.push({ segments: [...STORE_SEG, f.key], tag: PART_KEYWORD })
    if (f.item) marks.push({ segments: [...STORE_SEG, f.key], tag: MERCADO_KEYWORD })
  }
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.tag } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  const rev = await send({ op: 'build-record', segments: ['revolucion'], label: 'el mercado mirror' })
  console.log(rev.ok
    ? `[mercado] build revision: ${(rev.data as any).label} seal=${String((rev.data as any).seal).slice(0, 12)}${(rev.data as any).unchanged ? ' (unchanged)' : ''}`
    : `[mercado] build revision FAILED: ${rev.error}`)
  console.log(`[mercado] DONE — ${fresh.length} new tiles, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
