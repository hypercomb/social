// Mirror pass for the LANE LADDER and the VIEW ROW — the phone's zoom, and
// the second row of controls that stopped the first one being squeezed.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. Two behaviour tiles and their parts:
//
//   behaviors/input/lane-ladder
//   behaviors/input/view-row
//
// Idempotent / merge-mode: membership is unioned, and notes are written only
// for cells this run creates (note-add stacks).
//
// RUN STATE 2026-07-31: `lane-ladder` landed (5 parts + notes + the `behavior`
// mark) before the renderer dropped off the bridge; `view-row` and possibly
// lane-ladder's `input` mark did NOT. Re-run with `--remark` to finish it —
// that re-applies marks for a tile that already exists.
//
// Pheromones (declared, never minted on the fly): `behavior` + the collection
// keyword on each behaviour tile, `part` on each child.

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
const BEHAVIOR_KEYWORD = 'behavior'
const PART_KEYWORD = 'part'

type Part = [name: string, note: string]
type Behaviour = {
  /** An EXISTING collection under `behaviors` (mirror-behaviors.ts CATEGORIES:
   *  games, views, assistant, swarm, appearance, structure, input, guidance). */
  collection: string
  /** That collection's declared KEYWORD — the mark its members carry. It is not
   *  always the collection's name (`views` marks its members `view`). */
  keyword: string
  name: string
  note: string
  parts: Part[]
}

const BEHAVIOURS: Behaviour[] = [
  {
    collection: 'input',
    keyword: 'input',
    name: 'lane-ladder',
    note: [
      'Lanes — the phone\'s zoom, and the reason text on a phone is a size you chose rather than a size you landed on.',
      '',
      'A pointer surveys the hive: free zoom, a cursor that can pick one hexagon out of fifty. A phone cannot do that, and copying it is what made everything small. So on a phone the hive is not a map you survey, it is a column you READ.',
      '',
      'THREE RUNGS, not a slider. Three lanes to scan, two to browse, one to read. Each rung fixes the width of a hexagon to a known fraction of the screen — so the name, the picture and the notes have a size you chose, instead of whatever the last pinch happened to leave behind. Tap the lane button to walk the rungs; spread two fingers to read closer and squeeze to scan wider; say /lanes 1 if you would rather type it.',
      '',
      'THE LANES TURN WITH THE DEVICE. They always run across the SHORT side of the screen and the strip scrolls along the LONG one. Held upright that is columns you scroll up and down. Turned on its side it is the same lanes rotated: rows you scroll left and right — not tall columns of very wide tiles that still only move up and down. The hexagons flip between point-top and flat-top with it, because only one of the two packs into a straight lane in each direction; your own choice of shape is put back when you leave lanes.',
      '',
      'A rung is a real arrangement — the tiles MOVE, and that is one change you can undo. So a rung is only ever stepped by something you did on purpose: a button, a pinch that settled, a command. A finger drifting over the glass never mints a run of them.',
      '',
      `source: ${E}/sequence/arrangements.ts, ${E}/sequence/lane-viewport-mode.ts, ${E}/sequence/sequence-cycle.drone.ts`,
    ].join('\n'),
    parts: [
      ['arrangements.ts', [
        'The packing. Lays N lanes out as hex coordinates and knows both directions: straight columns for an upright screen, the nested honeycomb rhythm for a sideways one (a full column, then a shorter one tucked into its gaps, then a full one again — and a single line when there is only one lane). It never invents empty cells and it never strands a tile: more tiles than slots simply overflow into the next free ones.',
        '',
        `source: ${E}/sequence/arrangements.ts`,
      ].join('\n')],
      ['lane-viewport-mode.ts', [
        'Which rung, and which way the strip runs. Remembers the rung between sessions, refuses to hand a lane constraint to a pointer no matter who asks, and stops at both ends of the ladder rather than wrapping from reading straight back to scanning.',
        '',
        `source: ${E}/sequence/lane-viewport-mode.ts`,
      ].join('\n')],
      ['sequence-cycle.drone.ts', [
        'The act. Repacks the tiles at the rung asked for, turns the strip when the device turns, borrows the hexagon\'s orientation while lanes owns the view and gives it back afterwards, and re-frames the screen so the lanes fill it exactly. Lanes are never restored by arriving somewhere — they belong to the view you asked for them on, not to the tile.',
        '',
        `source: ${E}/sequence/sequence-cycle.drone.ts`,
      ].join('\n')],
      ['pinch-zoom.input.ts', [
        'The fingers. In lanes there is nothing to zoom freely, so a pinch STEPS the ladder instead of being swallowed: spread to read, squeeze to scan. It waits until the pinch has genuinely gone somewhere before it counts as a step, because every step moves tiles.',
        '',
        `source: ${E}/navigation/zoom/pinch-zoom.input.ts`,
      ].join('\n')],
      ['lanes.queen.ts', [
        'The words. /lanes for the rung you were last on, /lanes 1 for reading, /lanes off to hand the viewport back to free pan and zoom.',
        '',
        `source: ${E}/commands/lanes.queen.ts`,
      ].join('\n')],
    ],
  },
  {
    collection: 'input',
    keyword: 'input',
    name: 'view-row',
    note: [
      'The view row — a second row of five that pops up above the bar, so the first row never has to be squeezed.',
      '',
      'A phone is about four hundred pixels wide. Six controls on one row is six controls you have to aim at. So the bar stays FIVE — back, centre the screen, TAKE A PICTURE, this button, and solo-or-swarm — with the picture in the middle where a thumb naturally lands, and everything that changes HOW you see moves one row up.',
      '',
      'THAT ROW is fullscreen, the lane ladder, rotating the grid, the other arrangements, and pheromones. It opens on this button and closes on it, or on a tap anywhere on the hive — nothing closes underneath you just because you used it, so you can change two things in a row.',
      '',
      'It is out of the way rather than in the layout: the bottom five keep their spacing whether it is up or not, and the picture stays dead centre. Anything else floating above the bar — the tile picker — lifts while the row is up and drops back when it closes, so the two never sit on the same band of screen.',
      '',
      'Turned on its side the bar is a rail down the left edge, and the row pops out to its RIGHT as a column: the same relationship, rotated with everything else.',
      '',
      `source: ${S}/ui/controls-bar, ${E}/selection/select-mode.drone.ts`,
    ].join('\n'),
    parts: [
      ['controls-bar', [
        'The two rows. Holds whether the view row is up, publishes how far things above the bar must lift while it is, and listens for a tap elsewhere in the capture phase — the hive swallows ordinary taps on its way up, so a listener waiting for one to arrive would never hear it and the row could only ever close from its own button.',
        '',
        `source: ${S}/ui/controls-bar/controls-bar.component.html, .ts, .scss`,
      ].join('\n')],
      ['select-mode.drone.ts', [
        'The picker, moving out of the way. It floats above the bar rather than inside it, so it reads how far to lift from the same measurement the row publishes, and rises and falls with it — one number, no second conversation between them.',
        '',
        `source: ${E}/selection/select-mode.drone.ts`,
      ].join('\n')],
      ['i18n-catalogs', [
        'The words. The view row, the lane ladder, rotating the grid and arranging tiles — all fourteen languages, and the rung a toast names when it changes.',
        '',
        `source: ${S}/i18n/*.json`,
      ].join('\n')],
    ],
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

async function mirror(b: Behaviour): Promise<void> {
  const collectionKey = norm(b.collection)
  const behaviourKey = norm(b.name)
  const collectionSeg = [ROOT_KEY, collectionKey]

  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[${b.name}] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[${b.name}] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

  const isNew = !members.includes(behaviourKey)
  const behaviourSeg = [...collectionSeg, behaviourKey]
  const partNames = b.parts.map(([name]) => norm(name.replace(/\.ts$/, '')))

  // Phase 1 — structure. Union into what is there; never replace membership.
  if (isNew) {
    process.stdout.write(`[struct] ${collectionSeg.join('/')} ← +${behaviourKey} ... `)
    const res = await send({ op: 'update', segments: collectionSeg, layer: { name: collectionKey, children: [...members, behaviourKey] } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exit(1)
  } else {
    console.log(`[struct] ${behaviourKey} already present — merging parts only`)
  }

  const havePart = await childrenOf(behaviourSeg)
  const newParts = partNames.filter(p => !havePart.includes(p))
  process.stdout.write(`[struct] ${behaviourSeg.join('/')} ← ${havePart.length + newParts.length} children ... `)
  const up = await send({ op: 'update', segments: behaviourSeg, layer: { name: behaviourKey, children: [...havePart, ...newParts] } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const part of newParts) {
    process.stdout.write(`[struct] ${behaviourSeg.join('/')}/${part} ... `)
    const res = await send({ op: 'update', segments: [...behaviourSeg, part], layer: { name: part } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 2 — notes. Only for cells THIS run created: note-add is not
  // idempotent, so re-noting an existing tile would stack duplicates.
  const notes: { segments: string[]; text: string }[] = []
  if (isNew) notes.push({ segments: behaviourSeg, text: b.note })
  for (const [name, note] of b.parts) {
    const key = norm(name.replace(/\.ts$/, ''))
    if (newParts.includes(key)) notes.push({ segments: [...behaviourSeg, key], text: note })
  }
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + the
  // collection keyword mark the member, `part` marks each implementation cell.
  // A run that dies mid-pass (renderer disconnects) can leave a behaviour
  // created but under-marked, and a plain re-run would skip it as "already
  // present". `--remark` re-applies the marks for an existing tile.
  const remark = process.argv.includes('--remark')
  const marks: { segments: string[]; tag: string }[] = []
  if (isNew || remark) {
    marks.push({ segments: behaviourSeg, tag: BEHAVIOR_KEYWORD })
    marks.push({ segments: behaviourSeg, tag: b.keyword })
  }
  for (const part of newParts) marks.push({ segments: [...behaviourSeg, part], tag: PART_KEYWORD })
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.tag } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[${b.name}] DONE — behaviour ${isNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

async function main(): Promise<void> {
  for (const b of BEHAVIOURS) await mirror(b)
  console.log('[mobile-lanes] mirror pass complete')
}

main().catch(err => { console.error(err); process.exit(1) })
