// Mirror pass for PEER IMAGES — in a swarm everybody brings their own picture
// for the same tile, and the tile's images icon opens a little hive of every
// version the room is carrying so you can pick the one you want.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile under the
// `swarm` collection and its parts, 1:1 with the source files the behaviour
// actually lives in:
//
//   behaviors/swarm/peer-images
//     ├── peer-images             the candidates — who is offering what
//     ├── image-choice-drone      the hive of pictures, and the one revision
//     ├── tile-images-drone       the icon on the tile, and when it appears
//     └── i18n-catalogs           the words, en + ja
//
// Pheromones (declared, never minted on the fly): `behavior` + `swarm` on the
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
const COLLECTION = norm('swarm')
const BEHAVIOR = norm('peer-images')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'swarm'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Peer images — in a swarm everybody brings their own picture for the same tile, and this is how you see them all and choose.',
  '',
  'Each participant publishes their own version of a tile, and the picture rides along with it as a pointer. Until now the screen showed one of them and every other version stayed invisible on the wire. Now a tile you hold shows an IMAGES icon whenever somebody in the room is carrying a picture for it — and only then; with nobody around, or nobody offering a picture, there is no icon at all.',
  '',
  'Clicking it REPLACES the mesh with those pictures, as ordinary tiles: your own in the middle slot, then one tile for every distinct picture the room is offering, each wearing the name of whoever offers it. They sit on the same grid, at the same size, as any other layer — the choice looks like the hive it came from, not like a window over it. Two participants carrying the SAME picture are one tile with both names on it, not two identical choices.',
  '',
  'Click a tile and it becomes your tile\'s picture — one revision, undoable like any other change, and republished to the room the same way. Escape, or a click on empty space, snaps everything back with nothing written. The bytes are pulled before the change is committed, so a picture nobody can serve is never worn: it paints as a labelled hexagon that refuses to be picked. Nothing is fetched or changed by looking; only your click moves anything.',
  '',
  `source: ${E}/sharing/peer-images.ts, ${E}/sharing/image-choice.drone.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['peer-images.ts', [
    'The candidates. Reads what every participant is currently publishing at this location, keeps the entries for this tile that actually carry a picture, and folds identical pictures into one choice carrying every name that offers it. Pointers only — it never fetches an image, writes anything, or follows a value that is not a signature, so looking at the room can never move a byte of your hive. The tile icon asks this the moment you hover, so the answer is always live.',
    '',
    `source: ${E}/sharing/peer-images.ts`,
  ].join('\n')],
  ['image-choice.drone.ts', [
    'The hive of pictures. Hides the mesh and paints the choices as tiles on the very same grid a real layer uses — yours in the middle — fetching each picture through the usual local-then-room cascade and decoding them all before the hive lands, so it appears once and complete rather than trickling in. The tile under the cursor lights up; anything that never arrived stays a labelled hexagon that cannot be chosen. Choosing one pulls its bytes again as a guarantee, then writes ONE revision carrying the new picture, drops the old full-size original and the substrate default mark (a picture you chose on purpose is not filler), and points the local index at the new revision so the tile repaints at once. While the choice is up it owns the pointer, so nothing can act on the hidden mesh underneath, and every exit path — pick, Escape, empty space, navigating away, the behaviour being turned off — puts the mesh back.',
    '',
    `source: ${E}/sharing/image-choice.drone.ts`,
  ].join('\n')],
  ['tile-images.drone.ts', [
    'The icon. Registers the images affordance on tiles you HOLD — your own hive and your own tile with the mesh open — and shows it only when the room is actually offering another picture for that tile. A tile that is not yours is not yours to dress: there the verb is adopt, which brings the whole tile over with its owner\'s picture. Clicking opens the hive for the tile under the pointer.',
    '',
    `source: ${E}/sharing/tile-images.drone.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. `action.images` and its description — what the icon says when you rest on it — plus the picker\'s own labels (`images.title`, `images.yours`, `images.empty`, `images.unavailable`, `images.failed`), in English and Japanese.',
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
    console.error(`[peer-images] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[peer-images] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + `swarm` mark
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

  console.log(`[peer-images] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
