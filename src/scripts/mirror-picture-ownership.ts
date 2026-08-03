// Mirror pass for PICTURE OWNERSHIP — a picture a person puts on a tile is
// theirs, in stone, and nothing automatic may ever overwrite it again — plus
// `/heal`, which puts back the ones a default already took.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells; mirror-background-themes.ts / mirror-nature-default.ts described the
// themes). It never re-runs them. This pass adds ONE behaviour tile under the
// `appearance` collection with its parts, 1:1 with the source files:
//
//   behaviors/appearance/heal
//     ├── picture-ownership       the two marks, and which one wins
//     ├── heal-pass               the whole-hive repair
//     ├── tile-small-render       redrawing a small from the original
//     ├── heal-queen              /heal and /heal check
//     └── i18n-catalogs           the words, en + ja
//
// and appends ONE note to `behaviors/appearance/background` — the reach of
// `force` / `force-global` is now bounded by ownership, which is a change to
// what that behaviour means, not a new behaviour.
//
// Pheromones (declared, never minted on the fly): `behavior` + `appearance` on
// the behaviour tile, `part` on each child. Merge mode: children union into
// what is there; notes and marks are written only for cells this run creates,
// so a second run adds nothing. The one note on an existing tile carries an id
// and is sent only when named — note-add is not idempotent.
//
//   npx tsx scripts/mirror-picture-ownership.ts            structure + parts
//   npx tsx scripts/mirror-picture-ownership.ts background  the reach note

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
const COLLECTION = norm('appearance')
const BEHAVIOR = norm('heal')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'appearance'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Heal — put back the pictures a default took, and make sure it can never take one again.',
  '',
  'A picture a participant puts on a tile is THEIRS. Not a suggestion, not a placeholder a theme may improve on: once a person has chosen it, no default, no theme, no force and no boot-time pass may touch it, ever. That was always the intent — but the mark that said so leaked. Tile properties are written by merging over what is already there, so a tile that once wore a theme default carried the default\'s mark forward into every later edit. The person\'s own picture then LOOKED like a default, and a hive-wide re-dress replaced it across the whole tree.',
  '',
  'The fix is a positive mark rather than the absence of one. A write that sets a picture and does not declare itself a default now marks the tile as the participant\'s and clears the default mark in the same merge — so the two can never both be true, and a tile can never drift back to being fair game. Every overwrite path asks the tile\'s own canonical properties first, and an unreadable answer counts as theirs.',
  '',
  'The pictures already lost are recoverable, and the reason is worth keeping in mind: a re-dress only ever replaced the two SMALL renders — the full-resolution original and the framing chosen for it were never touched. That is why the edit screen still shows the right picture on a tile whose hexagon shows a default. `/heal` walks the whole hive and draws those small renders again from the original, exactly as the editor would have, and marks every tile it repairs as the participant\'s. `/heal check` reports the same walk without writing anything.',
  '',
  `source: ${E}/editor/tile-properties.ts, ${E}/substrate/substrate.service.ts, ${E}/substrate/heal.queen.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['picture-ownership', [
    'The two marks, and which one wins. A picture on a tile came from one of two places and the difference has to survive in the BYTES, because every other way of telling them apart is participant-local and forgettable: a browser\'s ledger is gone on a new device, and the pool that supplied a default is gone the moment the theme changes.',
    '',
    'So: `substrate: true` means this app placed it from a theme\'s pool, and themes may move it. `participant: true` means a person put it there, and nothing automatic touches it again. The mark is written on the ONE canonical write path rather than by each of the twenty-odd callers that can set a picture — editor, file drop, paste, link preview, peer image choice, the assistant. A caller that means "this is a default" says so; everyone else setting a picture is, by definition, a person doing it.',
    '',
    'Three ways to read as theirs, any one enough: the mark says so; the tile has a full-resolution original (only the editor writes one, so a hive edited before the mark existed still reads correctly); or it has a picture and is not marked as a default. The second outranks the default mark deliberately — that is exactly the leaked-mark case, and the original is the proof of whose picture it is.',
    '',
    `source: ${E}/editor/tile-properties.ts`,
  ].join('\n')],
  ['heal-pass', [
    'The repair. Walks every location in the hive — places, not names, because a picture assignment is keyed by full lineage and a flat list of labels resolves only the page you happen to be standing on. A tile qualifies only when it is MARKED as a default and yet holds a participant original underneath; anything honestly ours, and anything already marked theirs, is left exactly as it is.',
    '',
    'For each one it draws both hexagon renders again from the original at the framing that was saved with it, writes them to the tile\'s canonical properties with the default mark dropped — which earns the participant mark in the same merge — and points the local index at the result so the tile repaints without waiting for the reconciler. Idempotent: a healed tile stops matching.',
    '',
    'A tile with no original kept cannot be redrawn and nothing is invented for it. Those are counted and NAMED in the report, because a picture only the participant can put back is worth being told about rather than quietly skipped.',
    '',
    `source: ${E}/substrate/substrate.service.ts`,
  ].join('\n')],
  ['tile-small-render', [
    'Drawing a small from the original. The editor stores the full-resolution picture and the framing chosen for it, and the two hexagon renders it also writes are DERIVED from exactly those — the original, at that framing, cropped to the hexagon box. Nothing about that derivation needs the editor\'s canvas to be open, so it is restated here as plain drawing: same geometry, same hexagon ring, same background, and the same webp the editor would have produced. This is what makes healing possible at all.',
    '',
    `source: ${E}/substrate/tile-small-render.ts`,
  ].join('\n')],
  ['heal-queen', [
    '`/heal` repairs every tile in the hive; `/heal check` reports what it would repair and writes nothing — the same walk with the writes skipped, so the count can never disagree with what the repair then does. Progress is logged as it goes, healed tiles are listed, and tiles that keep no original are named separately.',
    '',
    `source: ${E}/substrate/heal.queen.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. `slash.heal` — what the command line says the behaviour does — in English and Japanese.',
    '',
    `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
  ].join('\n')],
]

// Notes on tiles that ALREADY exist. Sent only when named on the command
// line, because note-add stacks rather than replaces.
const EXISTING_NOTES: { id: string; segments: string[]; text: string }[] = [
  {
    id: 'background',
    segments: [ROOT_KEY, COLLECTION, norm('background')],
    text: [
      'THE REACH OF FORCE IS BOUNDED BY OWNERSHIP. `force` re-dresses this layer and `force-global` re-dresses the whole hive, and both mean exactly one thing: replace the pictures THIS APP placed. A picture the participant attached, pasted, edited or chose is untouchable at any reach — and that is now decided by a mark in the tile\'s own bytes rather than by a browser-local ledger that could forget.',
      '',
      'It did not hold before. Tile properties merge over what is already there, so an edit on a tile that had once worn a default inherited the default\'s mark, and a hive-wide force then re-dressed hand-made tiles. The pictures survived underneath — only the small renders were replaced — and `/heal` draws them back from the originals.',
      '',
      `source: ${E}/presentation/background/background-theme.service.ts, ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
]

async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'inflate', segments })
  if (!res.ok) return []
  const kids = res.data?.layer?.children ?? res.data?.children ?? []
  return Array.isArray(kids) ? kids.map((k: unknown) => String(k)) : []
}

async function main(): Promise<void> {
  const named = new Set(process.argv.slice(2))
  if (named.size) {
    const send_ = EXISTING_NOTES.filter(n => named.has(n.id))
    for (const n of send_) {
      process.stdout.write(`[note] ${n.segments.join('/')} ... `)
      const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
      console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
      if (!res.ok) process.exitCode = 1
    }
    console.log(`[picture-ownership] DONE — ${send_.length} notes on existing tiles`)
    return
  }

  const collectionSeg = [ROOT_KEY, COLLECTION]
  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[picture-ownership] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[picture-ownership] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 2 — notes, only for cells THIS run created.
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

  // Phase 3 — pheromones. Declared vocabulary only, no replaceKind (tags stack).
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

  console.log(`[picture-ownership] DONE — ${newParts.length} new parts, ${notes.length} notes, ${marks.length} marks`)
  console.log('[picture-ownership] the note for the existing background tile is NOT sent by default:')
  console.log('    npx tsx scripts/mirror-picture-ownership.ts background')
}

main().catch(err => { console.error(err); process.exit(1) })
