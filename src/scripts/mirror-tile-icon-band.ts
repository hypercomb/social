// Mirror pass for the TILE ICON BAND — the tile's label background doubles on
// hover into two rows (name above, action icons below), and a ⟳ cycle walks the
// tile through its icon SETS one line at a time.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile under the
// `appearance` collection and its parts, 1:1 with the source files the
// behaviour actually lives in:
//
//   behaviors/appearance/tile-icon-band
//     ├── hex-sdf-shader          the doubled band + the lifted name
//     ├── tile-overlay-drone      the sets, the one line, the ⟳, the stickiness
//     ├── tile-actions-drone      the ⟳ glyph, the set marks, the row height
//     └── i18n-catalogs           the words, en + ja
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

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('appearance')
const BEHAVIOR = norm('tile-icon-band')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'appearance'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Tile icon band — hovering a tile doubles the background behind its name, and the action icons live in the new second row.',
  '',
  'At rest the band is one row: the dark strip a tile draws behind its name so the letters read over a picture. On hover it doubles in height, balanced equally above and below the tile centre, and becomes two rows — the name balances UP into the top one, the icons take the bottom one. There is no separate tray behind the icons any more; the tile\'s own label background is their background.',
  '',
  'One line of icons shows at a time, and the ⟳ (cycle) icon at the end of the line walks the tile to the next SET: actions, then features, then delete. Sets are read off the marks the icons already carry, so a new set is a mark on an icon rather than a change to the layout. The old ⋮ reveal, which stacked extra rows below the tile, is gone.',
  '',
  'The chosen set is STICKY PER TILE and survives a refresh. It is a view preference, not content: it lives in local storage only and never enters the tile\'s history or its signature, the same rule hide and per-tile public follow.',
  '',
  `source: ${E}/presentation/grid/hex-sdf.shader.ts, ${E}/presentation/tiles/tile-overlay.drone.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['hex-sdf.shader.ts', [
    'The band. The hex fragment shader knows which tile is hovered (u_hoveredIndex vs the per-tile cell index), so it draws the label background at one row height at rest and two on hover, centred on the tile so the extra height is balanced upward and downward in equal parts. The name is sampled one half-row lower in the quad while hovered, which puts the letters in the top row. The band is composited BEFORE the glyphs, so it can never paint over the letters, and hovering shows it on every tile — even one with no picture and no name — because the icons need their backing.',
    '',
    `source: ${E}/presentation/grid/hex-sdf.shader.ts`,
  ].join('\n')],
  ['tile-overlay.drone.ts', [
    'The sets. Groups the icons that passed their per-tile visibility test into sets, chunks each set into lines, and shows exactly one line — with the ⟳ toggle trailing it whenever the tile has somewhere to cycle to. Holds the sticky choice per tile, re-reads it when the pointer lands on a new tile, and writes the new one on each ⟳ tap. A stale choice — a set the tile no longer carries — falls back to the first line rather than showing nothing.',
    '',
    `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
  ].join('\n')],
  ['tile-actions.drone.ts', [
    'The catalog. Carries the ⟳ glyph itself and registers it on every profile that owns more than one set, marks the trash bin as belonging to the delete set so it is never a one-tap misclick, and pins the icon row to the band\'s second row.',
    '',
    `source: ${E}/presentation/tiles/tile-actions.drone.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. `action.cycle` and `action.cycle.description` — what the ⟳ says when you rest on it — in English and Japanese.',
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
    console.error(`[tile-icon-band] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[tile-icon-band] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  console.log(`[tile-icon-band] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
