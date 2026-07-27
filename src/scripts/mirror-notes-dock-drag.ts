// Mirror pass for DRAG-TO-REANCHOR — the notes window's header as a drag
// handle: pull it off the right rail to float the window, drop it back inside
// the edge snap zone to re-anchor.
//
// The `tool-windows` collection (mirror-window-chrome.ts) already carries the
// gear, the group, and the windows themselves. This adds the gesture that moves
// a window between its two modes — the float mode the notes strip has always
// had in its state machine but had no affordance to reach.
//
// Structure (mirror-paradigm.md — tiles + collection + pheromones + notes):
//
//   behaviors/tool-windows/drag-to-reanchor        marked `window`
//   ├── notes-strip-component      part — the drag state machine + snap hysteresis
//   ├── notes-strip-template       part — the dragbar wired as the handle
//   └── notes-strip-styles         part — the grab cursor and touch-action
//
// Merge mode + idempotent, same as the chrome pass: the collection's children
// are UNIONED (a children slot is replaced wholesale, so a partial list would
// drop its siblings), and note/mark presence is checked before writing because
// `note-add` and `decoration-add` are not idempotent on their own.

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
// Renderer ops can take minutes right after a commit burst (the optimize pass
// holds the queue) — a short timeout misreads that as a hang.
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

/** Idempotent ops just retry; non-idempotent ones verify whether they actually
 *  landed first, so a lost response never becomes a duplicate write. */
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

/** `update` normalizes `children` names but signs `segments` RAW — pre-normalize
 *  every name so segments === children keys and the tree cannot fork. */
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const decorationSig = (name: string): string => createHash('sha256')
  .update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } }))
  .digest('hex')

// ── vocabulary ──────────────────────────────────────────────────────
// Declared, never minted on the fly. Both keywords already exist —
// `window` from mirror-window-chrome.ts, `part` from mirror-behavior-parts.ts.
const WINDOW_KEYWORD = 'window'
const PART_KEYWORD = 'part'

const ROOT = norm('behaviors')
const COLLECTION = norm('tool-windows')
const MEMBER = norm('drag-to-reanchor')

const SHARED = 'hypercomb-shared/ui'

interface Cell { key: string; note: string; marks: string[]; parts?: Cell[] }

const CREATION: Cell = {
  key: MEMBER,
  marks: [WINDOW_KEYWORD],
  note: [
    'drag-to-reanchor — the window header IS the handle.',
    '',
    'Grab a tool window\'s header band and pull: past the right rail it lets go and',
    'the window floats, following the pointer in two dimensions. Bring it back to',
    'within 72px of the right edge and it re-anchors to the full-height rail. The',
    'window only leaves the rail once the pointer has pulled back past 120px, so the',
    'dock does not flicker on and off along the boundary.',
    '',
    'A press must travel 6px before any of that happens. Below the threshold it is',
    'still a click — reaching for the close button with a twitchy hand must not tear',
    'the window off its rail, and a press that never crossed the line writes nothing',
    'to either store.',
    '',
    'The buttons living in the same band (fullscreen, close, and the settings gear',
    'the shared chrome injects) are excluded by target, so they stay clickable.',
    'Double-clicking a floating window\'s header recentres it; while docked the',
    'double-click does nothing, because the rail is laid out by CSS rather than by',
    'the drag offset.',
    '',
    'Both the dock side and the float offset are participant-local, so a window',
    'reopens where it was left.',
    '',
    `source: ${SHARED}/notes-strip/notes-strip.component.ts`,
  ].join('\n'),
  parts: [
    {
      key: 'notes-strip-component',
      marks: [PART_KEYWORD],
      note: [
        'notes-strip.component.ts — the drag state machine.',
        '',
        'onDragStart / #onDragMove / #onDragEnd, plus the 6px travel threshold and the',
        'snap hysteresis (enter the dock within 72px of the edge, leave it only past',
        '120px). The offset is clamped against the HOST box on every move rather than',
        'on release, which is what keeps a float from flying off screen mid-drag; the',
        'host already clears the header and the controls pill, so the clamp cannot',
        'slide the window under either.',
        '',
        'Leaving the rail re-baselines the offset to the window\'s current right-flush',
        'position before it starts tracking the pointer, so the handoff from dock to',
        'float has no jump.',
        '',
        'The drag pushes a `notes-drag` input mode for its duration, so the hex grid\'s',
        'pan and wheel-zoom stay suspended while the window is moving.',
        '',
        `source: ${SHARED}/notes-strip/notes-strip.component.ts`,
      ].join('\n'),
    },
    {
      key: 'notes-strip-template',
      marks: [PART_KEYWORD],
      note: [
        'notes-strip.component.html — the dragbar wired as the handle.',
        '',
        'One `(pointerdown)` on the `.cv2-dragbar` band and one `(dblclick)` to',
        'recentre. The band had carried no binding at all: the float mode, the offset',
        'store, the snap hysteresis and the clamp were all still in the component,',
        'reachable only by writing localStorage by hand.',
        '',
        `source: ${SHARED}/notes-strip/notes-strip.component.html`,
      ].join('\n'),
    },
    {
      key: 'notes-strip-styles',
      marks: [PART_KEYWORD],
      note: [
        'notes-strip.component.scss — the affordance.',
        '',
        '`cursor: grab` on the header band, `grabbing` while held, and',
        '`touch-action: none` so a touch drag moves the window instead of panning the',
        'page. Without the cursor there is nothing to tell you the band can be pulled,',
        'which is the whole reason the gesture went unfound.',
        '',
        `source: ${SHARED}/notes-strip/notes-strip.component.scss`,
      ].join('\n'),
    },
  ],
}

let okCells = 0, okNotes = 0, okMarks = 0, skipped = 0, failed = 0

async function noted(segments: string[], text: string): Promise<boolean> {
  const check = await send({ op: 'note-list', segments })
  return check.ok && Array.isArray(check.data) && check.data.some((x: any) => x?.text === text)
}

async function marked(segments: string[], name: string): Promise<boolean> {
  const check = await send({ op: 'layer-at', segments })
  const decs = (check.data?.decorations ?? []) as string[]
  return check.ok && decs.includes(decorationSig(name))
}

async function writeNote(segments: string[], text: string): Promise<void> {
  if (await noted(segments, text)) { skipped++; console.log('    note: already present'); return }
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    () => noted(segments, text),
  )
  if (res.ok) { okNotes++; console.log('    note: ok') } else { failed++; console.log(`    note: FAIL ${res.error}`) }
}

async function writeMark(segments: string[], name: string): Promise<void> {
  if (await marked(segments, name)) { skipped++; console.log(`    mark ${name}: already present`); return }
  // NO replaceKind — it would nuke the sibling tags on the same tile.
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } },
    () => marked(segments, name),
  )
  if (res.ok) { okMarks++; console.log(`    mark ${name}: ok`) } else { failed++; console.log(`    mark ${name}: FAIL ${res.error}`) }
}

async function writeCell(segments: string[], cell: Cell): Promise<void> {
  const children = (cell.parts ?? []).map(p => norm(p.key))
  console.log(`  ${segments.join('/')}${children.length ? ` ← ${children.length} parts` : ''}`)
  const layer: Record<string, unknown> = { name: norm(cell.key) }
  if (children.length) layer.children = children
  const res = await sendRetry({ op: 'update', segments, layer })
  if (!res.ok) { failed++; console.log(`    cell: FAIL ${res.error}`); return }
  okCells++
  await writeNote(segments, cell.note)
  for (const m of cell.marks) await writeMark(segments, m)
  for (const p of cell.parts ?? []) await writeCell([...segments, norm(p.key)], p)
}

async function main(): Promise<void> {
  // Preflight: confirm we are talking to the hive that HAS the chrome mirror,
  // and read the collection's members for the merge.
  const coll = await send({ op: 'inflate', segments: [ROOT, COLLECTION] }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!coll.ok) {
    console.error(`[dock-drag] ABORT: cannot read "${ROOT}/${COLLECTION}" (${coll.error}).`)
    console.error('[dock-drag] Run mirror-window-chrome.ts first, and open the app with ?claudeBridge=1.')
    process.exit(1)
  }
  const members = ((coll.data?.children ?? []) as any[]).map(k => String(k?.name ?? '')).filter(Boolean)
  if (!members.length) {
    console.error('[dock-drag] ABORT: tool-windows has no members — wrong renderer?')
    process.exit(1)
  }
  console.log(`[dock-drag] existing members: ${members.join(', ')}`)

  // Union, never replace — a children slot is REPLACED wholesale, so a partial
  // list would drop the gear, the group and the windows.
  const merged = members.includes(MEMBER) ? members : [...members, MEMBER]
  process.stdout.write(`[dock-drag] ${ROOT}/${COLLECTION} ← ${merged.length} members ... `)
  const collUp = await sendRetry({
    op: 'update', segments: [ROOT, COLLECTION], layer: { name: COLLECTION, children: merged },
  })
  console.log(collUp.ok ? 'ok' : `FAIL: ${collUp.error}`)
  if (!collUp.ok) process.exit(1)

  await writeCell([ROOT, COLLECTION, MEMBER], CREATION)

  console.log(`[dock-drag] DONE — ${okCells} cells, ${okNotes} notes, ${okMarks} marks (${skipped} already present)`)
  if (failed > 0) console.warn(`[dock-drag] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
