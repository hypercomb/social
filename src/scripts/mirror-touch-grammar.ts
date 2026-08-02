// Mirror pass for the TOUCH GRAMMAR — what a finger means on the hive.
//
// One press, one meaning, and only three of them: a tap goes INTO the tile, a
// still hold summons the ring whose centre is that tile's own screen, and a
// hold that travels moves the tile. This pass mirrors the grammar itself,
// because the grammar is the creation — no single file holds it, and reading
// any one of them alone tells you the wrong thing about the other two.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile and its
// parts, 1:1 with the source files the grammar actually lives in:
//
//   behaviors/input/touch-grammar
//     ├── tile-overlay-drone   the tap: go to the tile, and arm nothing else
//     ├── quick-menu-input     the hold: the ring, carrying the tile it held
//     ├── quick-menu-overlay   the centre, wearing the tile's name
//     ├── tile-view-drone      the screen, and walking the row it came from
//     └── i18n-catalogs        the words
//
// It then stacks CORRECTIVE notes onto the cells whose text this change made
// partly untrue — `tile-view` said a tap opens it, `quick-menu` said the touch
// summon is bound to nothing in particular. Notes stack, so each cell keeps
// both what was true and what changed, which is the record worth having.
//
// Pheromones (declared, never minted on the fly): `behavior` + `input` on the
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
const Q = `${E}/quickmenu`
const T = `${E}/presentation/tiles`

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('input')
const BEHAVIOR = norm('touch-grammar')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'input'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'The touch grammar — everything a finger can say to the hive, which is three things.',
  '',
  'TAP: go to the tile. Not "open something about it" — go there, into its layer, the same walk a click has always been. A tile with no children is not an exception: it opens its empty layer, so no tile on the hive is a dead end and the gesture never has to be explained twice. The one tile that means something else is a LINK, whose content is somewhere else entirely — going to that tile means following it, and walking into an empty layer instead would be walking straight past the thing.',
  '',
  'HOLD STILL: the ring — and when the press landed on a tile, the ring is carrying it. The seven hexagons appear as they always do, but the centre now wears the tile\'s NAME, and letting go without moving opens that tile\'s own screen. Flick to a neighbour instead and it is the ordinary hive-wide ring, unchanged and free. That is the whole trick: the common thing costs no travel, and the uncommon thing costs no extra gesture to reach.',
  '',
  'HOLD AND TRAVEL: move the tile. Arbitrated from the other two by distance, not by a stopwatch.',
  '',
  'What this replaced is worth keeping, because it is the failure the grammar is shaped around. The tile screen used to open from its OWN hold, deliberately timed to land before the ring\'s — two long presses racing on one finger, where the faster one always won and the ring was therefore unreachable over a tile at all. Two owners of one gesture is not a tuning problem; one of them has to stop. The ring kept the hold, and the screen became what its centre does.',
  '',
  'Entry stays on the RELEASE, never the press. A press that navigates consumes the pointer, and every hold watching that pointer — the drag, the ring — dies with the consume before it can mature. That is why a long press on a phone once did nothing whatsoever: the view had already changed under the finger.',
  '',
  `source: ${T}/tile-overlay.drone.ts, ${Q}/quick-menu.input.ts, ${T}/tile-view.drone.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['tile-overlay.drone.ts', [
    'The tap, and the restraint. On touch this drone now arms NOTHING on the press: it does not navigate, does not start a hold, does not consume the pointer. It simply gets out of the way, because everything else a finger might be starting to say needs that pointer alive. The walk happens on the release.',
    '',
    'And the walk is the same walk everywhere. A childless tile no longer opens a screen about itself — it goes into its empty layer, through the single choke point every other entry gesture uses, so the readiness gates and the phantom-address latches are the ones already written rather than a second copy of them.',
    '',
    'It still records whether the press was a FINGER, because the click that follows carries no such fact and a mouse keeps the behaviour it always had.',
    '',
    `source: ${T}/tile-overlay.drone.ts`,
  ].join('\n')],
  ['quick-menu.input.ts', [
    'The hold, now with a subject. When the long press matures, the tile under it is resolved from the press COORDINATES — a finger produces no hover, so there is no remembered tile to read, only where it landed.',
    '',
    'That tile then owns the zero-travel slot. Releasing at the centre of the root ring opens its screen instead of the ring\'s generic centre verb; descending into another ring gives the centre back, because the tile was the ROOT ring\'s subject and nothing below it. Leaving the dead zone and coming back still cancels — the escape hatch is untouched, and it has to be, since it is the only way out a finger has.',
    '',
    `source: ${Q}/quick-menu.input.ts`,
  ].join('\n')],
  ['quick-menu.overlay.ts', [
    'The centre, wearing a name. The ring is built once and cached, so a word that belongs to ONE summon cannot be written into the build — it is set on the live text node only, and the next paint restores every slot from what it was built with. A tile name is longer than a hexagon is wide, so it is truncated to fit rather than allowed to spill across the ring it sits in.',
    '',
    `source: ${Q}/quick-menu.overlay.ts`,
  ].join('\n')],
  ['tile-view.drone.ts', [
    'The screen, and the row. It is no longer what a tap produces — it is what the ring\'s centre opens — and it is no longer about one tile either. The layer you were looking at is a ROW, and the screen walks it: swipe left or right, or use the two chevrons, and the close-up re-points to the tile beside it.',
    '',
    'Walking is a re-point, not a close and reopen. The synthetic history entry that catches the BACK button and the counted turn in the chrome takeover both survive the step, so a walk along ten tiles leaves the BACK button meaning what it meant at the first one instead of ten presses of unwinding.',
    '',
    'The swipe commits on the release, on distance with a horizontal bias — a mostly-vertical drag is someone scrolling the notes and must not become a step. Nothing is consumed until it has actually committed, so a plain tap on a button is untouched; once it has, the trailing click is swallowed so the chip the finger happened to start on never fires. The backdrop tap that closes the view moved to the release for the same reason: the backdrop is the widest part of the screen and therefore where most swipes begin, and closing on the press killed every one of them before the finger had travelled.',
    '',
    'The chevrons are hidden outright when there is nowhere to step. They exist mostly to teach the swipe, which is faster and completely invisible.',
    '',
    `source: ${T}/tile-view.drone.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. `tile-view.previous` and `tile-view.next` name the two chevrons that walk the row, in English and Japanese. The centre of the ring borrows no word at all when it is carrying a tile — it wears the tile\'s own name, which is not a translatable string but the participant\'s.',
    '',
    `source: ${S}/i18n/en.json, ${S}/i18n/ja.json`,
  ].join('\n')],
]

/** Cells whose existing note is now partly untrue. The delta only — never a
 *  restatement, never a rewrite. */
const CORRECTIONS: { segments: string[]; text: string }[] = [
  {
    segments: [ROOT_KEY, norm('views'), norm('tile-view')],
    text: [
      'CHANGED — a tap no longer opens this. A tap goes INTO the tile now, childless or not, so one gesture means one thing everywhere on the hive. This screen is a long press away: hold a tile, let go without moving, and the ring\'s centre — wearing that tile\'s name — is what opens it.',
      '',
      'It also stopped being about one tile. The layer it was opened from is a row, and the screen walks it: swipe sideways, or use the two chevrons, without closing and reopening.',
      '',
      'See behaviors/input/touch-grammar for the whole of what a finger means.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, norm('views'), norm('tile-view'), norm('tile-view.drone')],
    text: [
      'CHANGED — it walks the row. Every tile the render put on screen is the row this view steps along, by swipe or by the two chevrons in the action row. Stepping re-points the mounted view rather than closing and opening a new one, so the BACK-button trap and the chrome takeover survive the walk instead of stacking up.',
      '',
      'The backdrop tap that closes it moved from the press to the RELEASE — the backdrop is where most sideways swipes start, and closing on the press killed them all before the finger had travelled.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, norm('views'), norm('tile-view'), norm('tile-overlay.drone')],
    text: [
      'CHANGED — the childless tap goes INTO the tile. It no longer asks the takeover order for a view to open over the tile; it opens the tile\'s own (empty) layer through the same choke point every other entry gesture uses. A LINK tile is the exception and always was: its content is elsewhere, so following it is what going to it means.',
      '',
      'On touch this drone also arms no hold of its own any more. The long press belongs to the ring, which carries the tile screen as its centre.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, COLLECTION, BEHAVIOR],
    text: [
      'THE ARBITRATION, precisely — it is not a stopwatch after all, and finding that out cost a regression caught on the way out.',
      '',
      'Drag-to-move CLAIMS the input gate when its own hold matures at 300ms — on a finger that has not travelled and may never travel — to reserve the gesture in case it becomes a drag. The ring summons 80ms later and used to refuse outright on a claimed gate. So on every tile you can move, which is all of your own, the ring was unreachable: a reservation for a drag that had not happened outranked the gesture actually being made. Nothing appeared, and the tile screen had just stopped being reachable any other way.',
      '',
      'Travel is what tells the two apart, and it already did: travel past the jitter box cancels the summon, and stillness past the timer is not a drag. So a still-armed drag is not a competitor to defer to — it is the SAME PRESS — and the ring takes the claim off it. A drag that has actually started, by travelling first, still owns the finger and the ring never appears over it.',
      '',
      'The consequence, stated plainly: a finger that holds still past the ring and only THEN moves is aiming, not dragging. To move a tile you travel first, which is what a hand does anyway when it means to pick something up.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, COLLECTION, BEHAVIOR, norm('quick-menu.input')],
    text: [
      'The gate hand-off. On a matured touch hold: a LOCK (an editor, a modal) refuses the summon absolutely; a live drag refuses it too, having declared itself by travelling; a claim held by anyone else refuses it. A claim held by a still-armed drag-to-move is RELEASED and taken, because that claim and this summon are the same finger — and leaving it in place would let the next movement both aim the ring and pick the tile up.',
    ].join('\n'),
  },
  {
    segments: [ROOT_KEY, norm('input'), norm('quick-menu'), norm('quick-menu.input')],
    text: [
      'CHANGED — a touch summon that landed on a TILE carries it. The tile is resolved from the press coordinates (a finger leaves no hover to read), and it takes the zero-travel slot: release at the centre of the root ring and that tile\'s own screen opens, instead of the ring\'s generic centre verb. Flick to a neighbour and nothing is different. Descend a ring and the centre is that ring\'s own again — the tile was the root\'s subject, not the hierarchy\'s.',
      '',
      'This is why the tile screen no longer has a hold of its own: it used to arm one timed to fire before this ring, which made the ring unreachable over any tile.',
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
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[touch-grammar] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[touch-grammar] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + `input`
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

  // Phase 4 — corrections. Skipped when a cell already carries this exact
  // delta, so the pass can be re-run without stacking it twice.
  let corrected = 0
  for (const c of CORRECTIONS) {
    const path = c.segments.join('/')
    const existing = await send({ op: 'note-list', segments: c.segments })
    const already = existing.ok && Array.isArray(existing.data)
      && existing.data.some((x: any) => String(x?.text ?? x?.note ?? '') === c.text)
    if (already) { console.log(`[note] ${path} — correction already present`); continue }
    process.stdout.write(`[note] ${path} ← correction ... `)
    const res = await send({ op: 'note-add', segments: c.segments.slice(0, -1), cell: c.segments[c.segments.length - 1], text: c.text })
    if (res.ok) corrected++
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[touch-grammar] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks, ${corrected} corrections`)
}

main().catch(err => { console.error(err); process.exit(1) })
