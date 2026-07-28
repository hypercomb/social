// Mirror pass for the CAMERA capture creation (documentation/mirror-paradigm.md).
//
//   behaviors/input/camera                          ↔ camera-capture.component.ts (queen)
//   behaviors/input/camera/camera-capture-component-html ↔ …/camera-capture.component.html
//   behaviors/input/camera/camera-capture-component-scss ↔ …/camera-capture.component.scss
//
// Collection: the existing `input` collection — membership IS the `input`
// keyword painted on the tile, so nothing new is minted. Marks used are all
// already declared: `behavior`, `input` (mirror-behaviors.ts) and `part`
// (mirror-behavior-parts.ts).
//
// Deliberately NOT mirrored as parts (shared subsystems / packaging, named in
// the camera tile's note instead):
//   - hypercomb-shared/ui/controls-bar/*        shell chrome shared by every control
//   - clipboard/image-paste.worker.ts           the image router — serves paste too
//   - ui/shell-surfaces/shell-surfaces.barrel   packaging, like an index.ts barrel
//   - i18n/en.json                              catalog
//
// Merge mode + idempotent: existing children are unioned (never replaced away),
// and note presence on a cell gates its note + mark writes, so a re-run after an
// interruption resumes instead of duplicating.

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cam-${Date.now()}-${++counter}` }
    // Pin IPv4 loopback — a second listener on 2401 (0.0.0.0) swallows
    // `localhost` dials without answering.
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

// A timeout does NOT mean the op failed — after a commit burst the renderer's
// idle pass can swallow the response. Non-idempotent ops verify what landed.
async function sendRetry(
  request: Record<string, unknown>,
  landed?: () => Promise<boolean>,
): Promise<BridgeRes> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(request) }
    catch (e) {
      if (landed && await landed().catch(() => false)) return { id: '', ok: true, data: 'landed after timeout' }
      if (attempt >= 3) throw e
      process.stdout.write(`(timeout — retry ${attempt}) `)
    }
  }
}

const COLLECTION = ['behaviors', 'input']
const BEHAVIOR = 'camera'
const S = 'hypercomb-shared/ui/camera-capture'

const BEHAVIOR_NOTE = [
  'camera — take a picture, get a tile.',
  '',
  "The mobile control bar's CENTRE button. It opens a full-screen viewfinder; the shutter takes the",
  'centre square of the frame (capped at 1024px, WebP), stops the camera, creates a new cell at the',
  'location you are standing on, and opens the tile editor on it with the photo already loaded — so',
  'framing and naming happen where they always have.',
  '',
  'Not a slash behaviour: a shell surface plus the bar\'s centre control. Registered through',
  'registerShellSurface (never an <hc-*> tag in app.html) and it holds view:active while open, so the',
  'chrome hides behind it.',
  '',
  `source: ${S}/camera-capture.component.ts`,
  'bar slot: hypercomb-shared/ui/controls-bar — centre button; fit moved out to the fourth slot and',
  'pheromones came off the bar entirely (it lives in the header rail).',
  'creates the tile via: diamondcoreprocessor.com/clipboard/image-paste.worker.ts → createTileFromImage',
  '(the shared image router — the same path a pasted image takes, so it is not a part of this behaviour).',
].join('\n')

type Part = [cell: string, file: string, role: string]

const PARTS: Part[] = [
  [
    'camera-capture-component-html',
    'camera-capture.component.html',
    'viewfinder markup — the video surface, the hexagon frame guide that shows what the tile will keep, the close / shutter / flip row, and the hint that says the picture becomes a tile',
  ],
  [
    'camera-capture-component-scss',
    'camera-capture.component.scss',
    'viewfinder styling — black field, dimmed surround with a hexagon cut-out, centred shutter with a busy state, safe-area padding, and the mirrored preview on the front lens',
  ],
]

const MARKS = { behavior: 'behavior', category: 'input', part: 'part' } as const

const decorationSig = (name: string): string =>
  createHash('sha256')
    .update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } }))
    .digest('hex')

async function hasNote(segments: string[]): Promise<boolean> {
  const res = await send({ op: 'note-list', segments })
  return res.ok && Array.isArray(res.data) && res.data.length > 0
}

async function addNote(segments: string[], text: string): Promise<boolean> {
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    async () => {
      const check = await send({ op: 'note-list', segments })
      return check.ok && Array.isArray(check.data) && check.data.some((x: any) => x?.text === text)
    },
  )
  return res.ok
}

async function mark(segments: string[], name: string): Promise<boolean> {
  // NO replaceKind — it would nuke the sibling tag.
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } },
    async () => {
      const check = await send({ op: 'layer-at', segments })
      const decs = (check.data?.decorations ?? []) as string[]
      return check.ok && decs.includes(decorationSig(name))
    },
  )
  return res.ok
}

async function main(): Promise<void> {
  const col = await send({ op: 'inflate', segments: COLLECTION }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!col.ok) {
    console.error(`[camera] ABORT: cannot read ${COLLECTION.join('/')} (${col.error}). Open the hive with ?claudeBridge=1.`)
    process.exit(1)
  }

  const existing: string[] = (col.data?.children ?? []).map((k: any) => String(k?.name ?? '')).filter(Boolean)
  const merged = existing.includes(BEHAVIOR) ? existing : [...existing, BEHAVIOR]
  process.stdout.write(`[camera] ${COLLECTION.join('/')} ← ${merged.length} members ... `)
  const up = await sendRetry({
    op: 'update', segments: COLLECTION,
    layer: { name: String(col.data?.name ?? COLLECTION[COLLECTION.length - 1]), children: merged },
  })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  // The behaviour tile, carrying its parts as children.
  const behaviorSeg = [...COLLECTION, BEHAVIOR]
  process.stdout.write(`[camera] ${behaviorSeg.join('/')} ← ${PARTS.length} parts ... `)
  const beh = await sendRetry({
    op: 'update', segments: behaviorSeg,
    layer: { name: BEHAVIOR, children: PARTS.map(([cell]) => cell) },
  })
  console.log(beh.ok ? 'ok' : `FAIL: ${beh.error}`)
  if (!beh.ok) process.exit(1)

  let notes = 0, marks = 0, skipped = 0

  if (await hasNote(behaviorSeg)) {
    skipped++
    console.log('[camera] behaviour tile already noted — skipping note + marks')
  } else {
    console.log(`[note] ${behaviorSeg.join('/')} ... ${await addNote(behaviorSeg, BEHAVIOR_NOTE) ? (notes++, 'ok') : 'FAIL'}`)
    for (const name of [MARKS.behavior, MARKS.category]) {
      console.log(`[mark] ${behaviorSeg.join('/')} ← ${name} ... ${await mark(behaviorSeg, name) ? (marks++, 'ok') : 'FAIL'}`)
    }
  }

  for (const [cell, file, role] of PARTS) {
    const seg = [...behaviorSeg, cell]
    process.stdout.write(`[camera]   ${cell} ... `)
    const res = await sendRetry({ op: 'update', segments: seg, layer: { name: cell } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) continue

    if (await hasNote(seg)) { skipped++; console.log(`[camera]   ${cell} already noted — skip`); continue }
    const text = `${file} — ${role}\n\npart of camera\nsource: ${S}/${file}`
    console.log(`[note] ${seg.join('/')} ... ${await addNote(seg, text) ? (notes++, 'ok') : 'FAIL'}`)
    console.log(`[mark] ${seg.join('/')} ← ${MARKS.part} ... ${await mark(seg, MARKS.part) ? (marks++, 'ok') : 'FAIL'}`)
  }

  console.log(`[camera] DONE — ${notes} notes, ${marks} marks (${skipped} already present)`)
}

main().catch(err => { console.error(err); process.exit(1) })
