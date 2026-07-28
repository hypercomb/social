// Mirror pass for the EXAMPLE HIVES first-boot offer — the behaviour that
// keeps a brand-new install from landing on an empty canvas: when the hive
// root is genuinely empty, the shell offers the published example hives, and
// an explicit accept folds the chosen one through the ordinary adopt
// machinery. Nothing is ever auto-written; dismissing persists locally.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile under the
// `swarm` collection (adoption is the sharing verb it rides) and its parts,
// 1:1 with the source resources the behaviour actually lives in:
//
//   behaviors/swarm/example-hives
//     ├── example-hives-worker      detection, roster, the adopt calls
//     ├── offer-card                the shell surface (cold chrome, two gestures)
//     ├── example-hives-roster      the deployed data: heads, covers, blurbs
//     └── i18n-catalogs             the words, every locale
//
// The example CONTENT is mirrored where it lives: the /examples branch itself
// (tiles + notes + `example`/`mobile:friendly` marks + group signatures),
// built by scripts/build-example-hives.ts — this pass mirrors the BEHAVIOUR.
//
// Pheromones (declared, never minted on the fly): `behavior` + `swarm` on the
// behaviour tile, `part` on each child. Merge mode: children union into what
// is already there; notes/marks only for cells this run creates.

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
const W = 'hypercomb-web'

const ROOT_KEY = 'behaviors'
const COLLECTION = 'swarm'
const BEHAVIOR = 'example-hives'
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'swarm'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Example hives — the first-boot offer. A brand-new install boots onto an empty hive root; instead of a blank canvas, a quiet card offers the published example hives (small, media-rich, mobile-friendly — the /examples branch of this hive, published to content.jwize.com).',
  '',
  'Adoption rides the ordinary machinery end to end: an explicit Add folds the chosen example at the hive root through the same closure pull + import cascade every adopt uses, with the CDN hosts pre-seeded so it works on any origin. Nothing folds without a click; closing the card writes nothing (a local flag remembers "no thanks"). The offer never appears over existing content — emptiness is cold-miss-aware, so "couldn\'t see" is never treated as "empty".',
  '',
  'The examples are content-only by construction: no code rides the fold, so the code-consent gate has nothing to ask. Every member carries mobile:friendly (the phone renders it the moment it folds) and its group signature (one gesture deletes the whole example).',
  '',
  'doctrine: documentation/example-hives-first-boot.md',
  `source: ${E}/sharing/example-hives.worker.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['example-hives-worker', [
    'The decision and the verbs. Waits for the core services, reads the hive root through the canonical placement path (cold-miss-aware — a cold read never counts as empty), fetches the shell\'s roster, and emits the offer. On an accepted example it pre-seeds the CDN hosts on the broker and calls the adopt drone\'s ordinary resolved-branch fold at the hive root, silent (no Beehaviors routing for a fresh participant\'s content-only fold). Dismiss persists one local flag and writes nothing.',
    '',
    `source: ${E}/sharing/example-hives.worker.ts`,
  ].join('\n')],
  ['offer-card', [
    'The face. A registry-fed shell surface (never an app.html tag): centered frosted card, one row per example — cover, name, blurb, tile count, Add. Counts climb while a fold pulls its closure (loaders always show counts). The backdrop takes no click handler on purpose: only the explicit buttons act, because a passive close is not consent. On phones it becomes a bottom sheet.',
    '',
    `source: ${S}/ui/example-hives/example-hives-offer.component.ts`,
  ].join('\n')],
  ['example-hives-roster', [
    'The data. Signatures live in deployed data, never in code: the roster names each example\'s branch head, cover image, tile count, and per-locale blurb, and the CDN domains they resolve from. Updating the examples is a republish plus a roster edit — no code change. Absent roster (offline, a shell without the file) means no offer and no error.',
    '',
    `source: ${W}/public/example-hives.json`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. The offer title, the invitation, Add / Adding / Added / Retry, the tile counts, and the two exits — in every catalog the shell carries. Example blurbs travel in the roster instead (they must render before any adopted content exists).',
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
    console.error(`[example-hives] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[example-hives] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + `swarm`
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

  console.log(`[example-hives] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
