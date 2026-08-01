// Mirror pass for the REWIND WINDOW — the two-stage visual undo picker.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections) — it never re-runs it. This pass adds ONE behaviour tile
// under the `structure` collection and its parts, 1:1 with the source
// files the behaviour lives in:
//
//   behaviors/structure/rewind-window
//     ├── rewind-window-component   the window: filmstrip + behaviour stepper
//     ├── rewind-queen              /rewind, the way in
//     └── i18n-catalogs             the words, in fourteen languages
//
// Pheromones (declared, never minted on the fly): `behavior` + `structure`
// on the behaviour tile, `part` on each child. Merge mode: children union
// into what is already there; notes/marks only for cells this run creates,
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

const S = 'hypercomb-shared/ui/rewind-window'
const E = 'hypercomb-essentials/src/diamondcoreprocessor.com/commands'

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('structure')
const BEHAVIOR = norm('rewind-window')
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'structure'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Rewind window — undo you can SEE. `/rewind` opens a glass deck at the bottom of the screen; the canvas above stays live, because the hive itself is the preview and the deck only picks the moment.',
  '',
  'Undo is TWO-STAGE, and the stages are deliberately unequal. Stage one is BY TILES — the natural way people remember their work. The deck shows a filmstrip of MOMENTS: every point in this page\'s history where the tile membership actually changed, each drawn as a mosaic of hex thumbnails so a state is recognised by picture, not by timestamp. Click a moment and the cursor seeks there.',
  '',
  'Stage two is BY BEHAVIOURS, and it only exists INSIDE the range stage one selected. Between the chosen moment and the next lie the intermediate layers — content edits, tags, notes — and a stepper walks those boundaries, clamped to the range. The tile undo picks the window; the behaviour undo picks the position inside it. There is never a free global behaviour timeline, because behaviours are the precision axis, not the front door.',
  '',
  'Everything is a pure READ over the lineage pool plus cursor seeks — no new truth, no new records, history stays append-only. Thumbnails come from the thumbnails:hex derived pool keyed by SOURCE IMAGE SIG; a miss falls back to the full image bytes, a further miss renders an initial-letter hex. Nothing is load-bearing.',
  '',
  'Tile identity is the NAME, never the sig — a downstream edit swaps child sigs while the tiles stay put, so moment boundaries compare name sets. Arrow keys step behaviours; Escape closes; clicking outside closes without touching the cursor.',
  '',
  `source: ${S}/rewind-window.component.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['rewind-window.component.ts', [
    'The window itself — a registry-fed shell surface (never an app.html tag), portaled to the body, listening on rewind:open/close/toggle. Duck-typed IoC to HistoryService, HistoryCursorService, Store and Navigation, so shared stays downstream of essentials.',
    '',
    'It classifies each history entry against its predecessor: a change in the child NAME set is a tile boundary (a stage-one moment); otherwise the first moved slot names the behaviour — tags, notes, or content. The classification is a display heuristic, computed fresh on every load, never persisted.',
    '',
    'Thumbnail resolution is the documented two-hop: child layer → properties[0] → props → small.image → the thumbnails:hex pool record, with the full image bytes as the always-correct fallback. Object URLs are cached per image sig and revoked on teardown.',
    '',
    `source: ${S}/rewind-window.component.ts, ${S}/rewind-window.component.html, ${S}/rewind-window.component.scss`,
  ].join('\n')],
  ['rewind.queen.ts', [
    'The way in. /rewind emits rewind:toggle over the EffectBus — the same string-contract pattern as /history, so essentials never imports the shared component and the dependency direction stays unviolated.',
    '',
    `source: ${E}/rewind.queen.ts`,
  ].join('\n')],
  ['i18n-catalogs', [
    'The words. slash.rewind plus the window strings (title, close, step labels, the two-line hint) in all fourteen catalogs; missing keys fall back to English through the LocalizationService.',
    '',
    'source: hypercomb-shared/i18n/en.json (and the 13 sibling catalogs)',
  ].join('\n')],
]

async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'children', segments })
  if (res.ok && Array.isArray(res.data?.children)) {
    return (res.data.children as Array<{ name?: string } | string>).map(c =>
      typeof c === 'string' ? c : (c?.name ?? '')).filter(Boolean).map(norm)
  }
  return []
}

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[rewind] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[rewind] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

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

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` +
  // `structure` mark the member, `part` marks each implementation cell.
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

  console.log(`[rewind] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
