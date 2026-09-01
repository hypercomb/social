// Build the EXAMPLE HIVES — the small published hives a brand-new install is
// offered on first boot, so nobody lands on an empty canvas.
//
//   npx tsx scripts/build-example-hives.ts
//
// Authors ONE `examples` branch in the live hive over the Claude bridge
// (broker ws://127.0.0.1:2401 + a renderer tab), holding three small hives:
//
//   examples
//     ├── honey-garden     a garden of image tiles (look, zoom, wander)
//     ├── bee-facts        one true thing about bees per tile
//     └── postcards        three places with postcards inside — depth demo
//
// Every tile gets a generated image face (scripts/example-hives-assets/ — run
// scripts/example-hives-art.cjs first), a note, the declared `example` keyword,
// and — on every member of a hive — `mobile:friendly` (the mobile load gate's
// vocabulary; tags are in-layer, so a phone renders the hive the moment it
// folds) plus the hive's GROUP SIGNATURE (`group:examples:<name>`) so each
// example adds/deletes as one unit.
//
// Merge-safe and resumable: `update` unions children; notes gate on note-list;
// decorations gate on a read-back key set; the image face gates on the props
// blob already holding this run's image sig. Ends with ONE build-record on
// /examples, per the atomicity standard.
//
// After this pass: `npx tsx scripts/publish-content.ts /examples/<name> --r2`
// per hive, then bake the printed head sigs into
// hypercomb-web/public/example-hives.json (the first-boot offer roster).

import WebSocket from 'ws'
import { hiveChildren } from './lib/hive-children.mjs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'example-hives-assets')
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
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const groupSignature = (meaning: string): string =>
  createHash('sha256').update(`group:${meaning.trim()}`, 'utf8').digest('hex')

const ROOT_BRANCH = 'examples'
const EXAMPLE_KEYWORD = 'example'
const EXAMPLE_COLOR = '#d96f32'
const MOBILE_FRIENDLY = 'mobile:friendly'

// ── the census ───────────────────────────────────────────────────────

type Tile = {
  name: string
  image: string          // scripts/example-hives-assets/<image>.png
  note: string
  leaf?: boolean         // leaves get link:/@resource/<imgSig> (tap → photo view)
  children?: Tile[]
}

type Hive = { root: Tile; group: string }

const PARENT_NOTE = [
  'Example hives — small, self-contained hives published for brand-new',
  'participants, so a first boot can offer something alive instead of an',
  'empty canvas. Each child is one example: adopted as a unit, deletable as',
  'a unit (every member carries its group signature), and marked',
  'mobile:friendly throughout so the mobile gate renders it the moment it',
  'folds.',
  '',
  'Published to content.jwize.com via scripts/publish-content.ts; offered on',
  'first boot by the example-hives worker (see',
  'documentation/example-hives-first-boot.md).',
].join('\n')

const HIVES: Hive[] = [
  {
    group: 'examples:honey-garden',
    root: {
      name: 'honey-garden', image: 'honey-garden-cover',
      note: 'Welcome to your first hive! This is an example — a small garden of '
        + 'image tiles. Tap a tile to look closer, pinch or scroll to zoom, and '
        + 'drag to wander. Everything here is yours now: rename it, rearrange '
        + 'it, or delete it whenever you like.',
      children: [
        { name: 'sunrise', image: 'honey-garden-sunrise', leaf: true, note: 'Every tile can hold an image and a note like this one. Notes are where a hive keeps its thoughts.' },
        { name: 'meadow', image: 'honey-garden-meadow', leaf: true, note: 'Tiles sit on a honeycomb. There is no feed and no timeline — just places, side by side.' },
        { name: 'comb', image: 'honey-garden-comb', leaf: true, note: 'A hive grows cell by cell. Add a tile next to this one and the garden is already yours.' },
        { name: 'bloom', image: 'honey-garden-bloom', leaf: true, note: 'Open a tile to see its image full screen. On a phone, everything here works with one thumb.' },
        { name: 'dusk', image: 'honey-garden-dusk', leaf: true, note: 'Hives can be private, shared with a few people, or published for anyone. This one was published as an example — in your hive it is private, and only you can see it.' },
        { name: 'pollen', image: 'honey-garden-pollen', leaf: true, note: 'When you are done exploring, this whole garden can be deleted in one gesture. Nothing here is precious — it exists so your hive is not empty.' },
      ],
    },
  },
  {
    group: 'examples:bee-facts',
    root: {
      name: 'bee-facts', image: 'bee-facts-cover',
      note: 'A tiny hive of true things about bees. Each tile holds one fact in '
        + 'its note. This is the simplest shape a hive can take: one idea per '
        + 'cell, side by side.',
      children: [
        { name: 'the-waggle-dance', image: 'bee-facts-dance', leaf: true, note: 'Bees tell each other where the good flowers are by dancing. The angle of the waggle points at the food, measured against the sun; the length of the dance says how far to fly.' },
        { name: 'five-eyes', image: 'bee-facts-eyes', leaf: true, note: 'A honeybee has five eyes: two huge compound eyes built from thousands of tiny lenses, and three small simple eyes on top of its head that read the brightness of the sky.' },
        { name: 'the-queen', image: 'bee-facts-queen', leaf: true, note: 'In spring a queen bee can lay around two thousand eggs in a single day — more than her own body weight. Every worker in the hive is her daughter.' },
        { name: 'honey-keeps', image: 'bee-facts-honey', leaf: true, note: 'Honey essentially never spoils. Sealed pots found in ancient Egyptian tombs, thousands of years old, were still perfectly edible.' },
        { name: 'two-hundred-beats', image: 'bee-facts-flight', leaf: true, note: 'A bee beats its wings about two hundred times every second — that hum you hear is the wings themselves, faster than any muscle should manage.' },
      ],
    },
  },
  {
    group: 'examples:postcards',
    root: {
      name: 'postcards', image: 'postcards-cover',
      note: 'Hives have depth. Each tile below is a place, and inside each place '
        + 'are more postcards. Tap into a tile to descend; swipe back (or press '
        + 'Escape) to climb out.',
      children: [
        {
          name: 'mountains', image: 'postcards-mountains',
          note: 'This tile is a place of its own. Step inside to find more postcards.',
          children: [
            { name: 'dawn', image: 'postcards-mountains-dawn', leaf: true, note: 'First light on the ridgeline. You are now two levels deep — the path back is one swipe away.' },
            { name: 'the-peak', image: 'postcards-mountains-peak', leaf: true, note: 'Thin air, long views. A hive can go as deep as your ideas do.' },
          ],
        },
        {
          name: 'sea', image: 'postcards-sea',
          note: 'Another branch, another mood. Branches keep their own children.',
          children: [
            { name: 'storm', image: 'postcards-sea-storm', leaf: true, note: 'Grey water, white wind. Tiles this deep are still just tiles — image, note, place.' },
            { name: 'calm', image: 'postcards-sea-calm', leaf: true, note: 'Flat water at dusk. Nothing to do here. That is allowed.' },
          ],
        },
        {
          name: 'forest', image: 'postcards-forest',
          note: 'The last of the three places. When you can navigate this, you can navigate any hive.',
          children: [
            { name: 'night-walk', image: 'postcards-forest-night', leaf: true, note: 'Fireflies between the trunks. Try climbing all the way back to your hive root from here.' },
            { name: 'spring', image: 'postcards-forest-spring', leaf: true, note: 'One flower on the forest floor. Plant a tile of your own somewhere — that is how every hive begins.' },
          ],
        },
      ],
    },
  },
]

const PARENT_TILE: Tile = { name: ROOT_BRANCH, image: 'examples-cover', note: PARENT_NOTE }

// ── read helpers (gates for idempotent re-runs) ──────────────────────

// Child reads and child creation come from ONE implementation, shared with
// every other bridge script: scripts/lib/hive-children.mjs. It carries the
// trap (a parent's `children` slot holds LAYER sigs, and a layer sig is NOT a
// resource, so `get-resource` on one answers "resource not found") and the
// two rules that retire it: existence per CHILD PATH, creation via `op:'add'`,
// which the committer applies as an APPEND. Never a `children:` SET to grow a
// parent — that op REPLACES the slot.
const hive = hiveChildren(send)

/** Child NAMES, or `[]` when there is no layer at `segments` at all. The
 *  shared reader prefers the one-hop `layer-by-sig` op and falls back to
 *  `inflate` only on a renderer that predates it. */
async function childrenOf(segments: string[]): Promise<string[]> {
  return (await hive.childNamesOf(segments)) ?? []
}

async function noteCount(segments: string[]): Promise<number> {
  const res = await send({ op: 'note-list', segments })
  if (!res.ok) return 0
  const data = res.data
  if (Array.isArray(data)) return data.length
  if (Array.isArray((data as { notes?: unknown[] })?.notes)) return (data as { notes: unknown[] }).notes.length
  return 0
}

/** `${kind}|${JSON.stringify(payload)}` for every decoration on the cell. */
async function decorationKeys(segments: string[]): Promise<Set<string>> {
  const keys = new Set<string>()
  const layer = await send({ op: 'layer-at', segments })
  const sigs: string[] = Array.isArray(layer.data?.decorations) ? layer.data.decorations.map(String) : []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const rec = JSON.parse(res.data.text)
      if (typeof rec?.kind === 'string') keys.add(`${rec.kind}|${JSON.stringify(rec.payload ?? null)}`)
    } catch { /* not a JSON decoration record */ }
  }
  return keys
}

async function currentProps(segments: string[]): Promise<Record<string, unknown>> {
  const layer = await send({ op: 'layer-at', segments })
  const sig = Array.isArray(layer.data?.properties) ? String(layer.data.properties[0] ?? '') : ''
  if (!/^[a-f0-9]{64}$/.test(sig)) return {}
  const res = await send({ op: 'get-resource', sig })
  if (!res.ok) return {}
  try {
    const parsed = JSON.parse(res.data.text)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

// ── write phases ─────────────────────────────────────────────────────

const fail = (label: string, res: { error?: string }): never => {
  console.error(`${label} FAILED: ${res.error}`)
  process.exit(1)
}

async function ensureStructure(segments: string[], tile: Tile): Promise<void> {
  const wanted = (tile.children ?? []).map(c => c.name)
  process.stdout.write(`[struct] /${segments.join('/')} (${wanted.length} wanted) ... `)
  const res = await hive.ensureChildren(segments, wanted)
  console.log(res.ok ? `ok (+${res.added})` : fail('update', res))
  for (const child of tile.children ?? []) {
    await ensureStructure([...segments, child.name], child)
  }
}

async function ensureFace(segments: string[], tile: Tile): Promise<void> {
  const png = readFileSync(join(ASSETS, `${tile.image}.png`))
  const put = await send({ op: 'put-resource', base64: png.toString('base64') })
  if (!put.ok) fail(`put-resource ${tile.image}`, put)
  const imgSig = String(put.data.sig)

  const props = await currentProps(segments)
  const face = {
    small: { image: imgSig },
    flat: { small: { image: imgSig }, large: { x: 0, y: 0, scale: 1 } },
    large: { image: imgSig, x: 0, y: 0, scale: 1 },
    ...(tile.leaf ? { link: `/@resource/${imgSig}` } : {}),
  }
  const already = JSON.stringify((props as { small?: { image?: string } }).small?.image) === JSON.stringify(imgSig)
    && (!tile.leaf || props['link'] === face.link)
  if (already) { console.log(`[face]   /${segments.join('/')} — already ${imgSig.slice(0, 12)}`); return }

  const mergedProps = { ...props, ...face }
  const putProps = await send({ op: 'put-resource', text: JSON.stringify(mergedProps) })
  if (!putProps.ok) fail('put-resource props', putProps)
  process.stdout.write(`[face]   /${segments.join('/')} ← ${imgSig.slice(0, 12)} ... `)
  const res = await send({ op: 'bag-set', segments, slot: 'properties', cells: [String(putProps.data.sig)] })
  console.log(res.ok ? 'ok' : fail('bag-set properties', res))
}

async function ensureNote(segments: string[], text: string): Promise<void> {
  if (await noteCount(segments) > 0) return
  process.stdout.write(`[note]   /${segments.join('/')} ... `)
  const res = await send({ op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text })
  console.log(res.ok ? 'ok' : fail('note-add', res))
}

async function ensureDecorations(
  segments: string[],
  decorations: { kind: string; payload: Record<string, unknown> }[],
): Promise<void> {
  const have = await decorationKeys(segments)
  for (const deco of decorations) {
    if (have.has(`${deco.kind}|${JSON.stringify(deco.payload)}`)) continue
    process.stdout.write(`[mark]   /${segments.join('/')} ← ${deco.kind}:${JSON.stringify(deco.payload)} ... `)
    // No replaceKind — tags stack; wiping the first mark to add a second is the classic footgun.
    const res = await send({ op: 'decoration-add', segments, kind: deco.kind, appliesTo: [], payload: deco.payload })
    console.log(res.ok ? 'ok' : fail('decoration-add', res))
  }
}

async function walkTiles(
  segments: string[],
  tile: Tile,
  visit: (segments: string[], tile: Tile) => Promise<void>,
): Promise<void> {
  await visit(segments, tile)
  for (const child of tile.children ?? []) await walkTiles([...segments, child.name], child, visit)
}

async function main(): Promise<void> {
  // sanity: census names must already be in normalized (address) form
  for (const hive of HIVES) {
    await walkTiles([hive.root.name], hive.root, async (_s, t) => {
      if (norm(t.name) !== t.name) { console.error(`census name not normalized: "${t.name}"`); process.exit(1) }
    })
  }

  // 0. preflight — a renderer must answer, and we need the live root membership
  const rootRes = await send({ op: 'layer-at', segments: [] })
  if (!rootRes.ok) { console.error(`no renderer: ${rootRes.error}`); process.exit(1) }
  const rootName = String(rootRes.data?.name ?? '/')
  const rootKids = await childrenOf([])
  console.log(`[preflight] root "${rootName}" holds ${rootKids.length} children`)

  // 1. structure — union `examples` into the root, then the whole census
  if (!rootKids.includes(ROOT_BRANCH)) {
    process.stdout.write(`[struct] / ← +${ROOT_BRANCH} ... `)
    const res = await hive.ensureChildren([], [ROOT_BRANCH])
    console.log(res.ok ? 'ok' : fail('root update', res))
  }
  await ensureStructure([ROOT_BRANCH], { ...PARENT_TILE, children: HIVES.map(h => h.root) })

  // 2. image faces — every tile renders with a picture (no imageless tiles)
  await ensureFace([ROOT_BRANCH], PARENT_TILE)
  for (const hive of HIVES) await walkTiles([ROOT_BRANCH, hive.root.name], hive.root, ensureFace)

  // 3. notes
  await ensureNote([ROOT_BRANCH], PARENT_TILE.note)
  for (const hive of HIVES) await walkTiles([ROOT_BRANCH, hive.root.name], hive.root, (s, t) => ensureNote(s, t.note))

  // 4. pheromones + group signatures. `example` on every tile of the tree;
  // `mobile:friendly` + the hive's group signature on every member of a hive.
  await ensureDecorations([ROOT_BRANCH], [{ kind: 'tag', payload: { name: EXAMPLE_KEYWORD } }])
  for (const hive of HIVES) {
    const groupSig = groupSignature(hive.group)
    await walkTiles([ROOT_BRANCH, hive.root.name], hive.root, (s) => ensureDecorations(s, [
      { kind: 'tag', payload: { name: EXAMPLE_KEYWORD } },
      { kind: 'tag', payload: { name: MOBILE_FRIENDLY } },
      { kind: 'group', payload: { sig: groupSig, meaning: hive.group } },
    ]))
    console.log(`[group]  ${hive.group} = ${groupSig}`)
  }

  // 5. vocabulary — register the declared keyword's colour, then neutralize
  // the sticky command-line replay
  await send({ op: 'submit', text: `/keyword [${EXAMPLE_KEYWORD}(${EXAMPLE_COLOR})]` })
  await send({ op: 'submit', text: '' })

  // 6. one build revision for the whole pass
  process.stdout.write(`[build-record] /${ROOT_BRANCH} ... `)
  const record = await send({ op: 'build-record', segments: [ROOT_BRANCH], label: 'example hives build' })
  console.log(record.ok ? `ok (${record.data?.unchanged ? 'unchanged' : 'sealed'})` : fail('build-record', record))

  console.log('\n[example-hives] DONE. Next:')
  for (const hive of HIVES) console.log(`  npx tsx scripts/publish-content.ts /${ROOT_BRANCH}/${hive.root.name} --r2`)
}

main().catch(err => { console.error(err); process.exit(1) })
