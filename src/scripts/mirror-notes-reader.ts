// Mirror pass for THE NOTES READER — one tile's notes read as hexagons, with
// side tabs per hierarchy, a wrapping prev/next cycle, and pheromones that
// land on a NOTE by drag.
//
// The `tool-windows` collection (mirror-window-chrome.ts) already carries the
// windows themselves and, since mirror-notes-dock-drag.ts, the gesture that
// moves one between its modes. This adds the reader: a second surface over the
// same notes, for reading rather than authoring.
//
// Structure (mirror-paradigm.md — tiles + collection + pheromones + notes):
//
//   behaviors/tool-windows/notes-reader            marked `window`
//   ├── notes-viewer-component     part — scope, hierarchies, focus, tagging
//   ├── notes-viewer-template      part — rail, big hexagon, cycle, outline
//   ├── notes-viewer-styles        part — the hexagon point item at 3 sizes
//   ├── note-cycle                 part — flatten + the wrapping step
//   ├── note-tags                  part — the pheromone guard + tree rewrite
//   └── notes-drone-tags           part — the `tags` slot on the note layer
//
// Merge mode + idempotent, same as the dock-drag pass: the collection's
// children are UNIONED (a children slot is replaced wholesale, so a partial
// list would drop its siblings), and note/mark presence is checked before
// writing because `note-add` and `decoration-add` are not idempotent alone.

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
const MEMBER = norm('notes-reader')

const SHARED = 'hypercomb-shared/ui'
const NOTES_DOMAIN = 'hypercomb-essentials/src/diamondcoreprocessor.com/notes'

interface Cell { key: string; note: string; marks: string[]; parts?: Cell[] }

const CREATION: Cell = {
  key: MEMBER,
  marks: [WINDOW_KEYWORD],
  note: [
    'notes-reader — one tile\'s notes, read as hexagons.',
    '',
    'The strip AUTHORS: a dense tree you edit in place. The reader READS: one',
    'note at a time, big, with its place in the tree shown around it. Open it',
    'from the book button in the strip\'s header.',
    '',
    'Three moves, and only three.',
    '',
    'SIDE TABS pick the HIERARCHY. A hierarchy is one root note plus everything',
    'nested under it, so a tile with four root notes reads as four small',
    'documents rather than one long list. Each tab shows that root\'s hexagon,',
    'its opening words, and how many notes the hierarchy holds. With only one',
    'hierarchy the rail does not render at all — a chooser of one is just lost',
    'width.',
    '',
    'PREV / NEXT walk the notes inside that hierarchy, depth-first, and WRAP at',
    'both ends. There is no first note and no last one; the cycle closes.',
    'Running off the end is how you get back to the top, so neither button is',
    'ever disabled — a dead button would be a lie about the behaviour.',
    '',
    'CLICKING a row in the outline jumps the focus straight there.',
    '',
    'The hexagon is the point item everywhere — rail tab, big focus, outline',
    'bullet — at three sizes off one shape, with the note\'s mark icon riding on',
    'top of it. Notes written before marks existed keep their old shape glyph.',
    '',
    'PHEROMONES LAND ON NOTES, by drag. The header\'s pheromone button opens the',
    'Pheromones panel beside the reader; drag a keyword out of it onto any row',
    'and it goes onto that NOTE, not onto the tile. Each chip\'s × takes it back',
    'off. The reader\'s backdrop is pointer-transparent precisely so the panel',
    'stays reachable while it is open.',
    '',
    `source: ${SHARED}/notes-viewer/notes-viewer.component.ts`,
  ].join('\n'),
  parts: [
    {
      key: 'notes-viewer-component',
      marks: [PART_KEYWORD],
      note: [
        'notes-viewer.component.ts — scope, hierarchies, focus, tagging.',
        '',
        'The reader is scoped to ONE tile. `notes:open { cellLabel, noteId? }` opens',
        'it; with a noteId it lands ON that note, selecting the hierarchy that',
        'contains it and focusing its row, and warms the cache first so the whole',
        'subtree is hydrated before the search runs.',
        '',
        'Focus is held by POSITION, not by note id. That is deliberate and it is',
        'what makes tagging feel steady: a note id IS its content signature, so',
        'putting a pheromone on a note rewrites its bytes and mints a new id. A',
        'reader holding the old id would strand itself on a note that no longer',
        'exists; holding row 3 means the note at row 3 is still the note at row 3',
        'after the write.',
        '',
        `source: ${SHARED}/notes-viewer/notes-viewer.component.ts`,
      ].join('\n'),
    },
    {
      key: 'notes-viewer-template',
      marks: [PART_KEYWORD],
      note: [
        'notes-viewer.component.html — rail, big hexagon, cycle, outline.',
        '',
        'Every row that can take a pheromone advertises itself with',
        '`data-pheromone-note` and `data-pheromone-note-cell`. That pair IS the',
        'drop contract: the Pheromones panel\'s existing drag-out gesture looks for',
        'it on release and writes to the note instead of falling through to the hex',
        'map. The focused note carries the same attributes, so the big hexagon is a',
        'drop target too.',
        '',
        `source: ${SHARED}/notes-viewer/notes-viewer.component.html`,
      ].join('\n'),
    },
    {
      key: 'notes-viewer-styles',
      marks: [PART_KEYWORD],
      note: [
        'notes-viewer.component.scss — the hexagon point item, at three sizes.',
        '',
        'One `.hexdot` element: a clipped `.hexdot-face` for the shape, with the',
        'mark icon layered ON TOP un-clipped, because clipping the glyph would',
        'shave its corners off. 16px in the rail and the outline, 72px for the',
        'focus. Legacy shapes swap the face\'s clip-path rather than being redrawn',
        'as hexagons — a note written before marks must not silently change shape.',
        '',
        'The backdrop is pointer-transparent and must stay that way, or dragging a',
        'pheromone in from the right-hand dock becomes impossible.',
        '',
        `source: ${SHARED}/notes-viewer/notes-viewer.component.scss`,
      ].join('\n'),
    },
    {
      key: 'note-cycle',
      marks: [PART_KEYWORD],
      note: [
        'note-cycle.ts — flatten the hierarchy, and step the cycle.',
        '',
        'Pure, and tested without an Angular harness (the wave-layout idiom).',
        '`flattenHierarchy` is depth-first — a node, then its children — which is',
        'both the reading order and the order prev/next walks. `stepIndex` wraps in',
        'both directions.',
        '',
        'The double modulo in stepIndex is not decoration: JavaScript keeps the',
        'sign of the left operand, so `-1 % 5` is -1, not 4. Stepping backwards off',
        'the front with a single modulo lands on a negative index and renders',
        'nothing. It also clamps its input, because a held focus can outlive the',
        'hierarchy it pointed into.',
        '',
        `source: ${SHARED}/notes-viewer/note-cycle.ts`,
      ].join('\n'),
    },
    {
      key: 'note-tags',
      marks: [PART_KEYWORD],
      note: [
        'note-tags.ts — the pheromone guard and the tree rewrite.',
        '',
        'Keeps the same free-form keyword vocabulary tile decorations use, so a',
        'pheromone means one thing wherever it lands. The list is SORTED, so two',
        'notes carrying the same set materialize to the same bytes.',
        '',
        'THE INVARIANT: an untagged note normalizes to an EMPTY list, and the drone',
        'omits the slot entirely when the list is empty. That is what lets a note',
        'written before pheromones existed still sign to exactly its old bytes — so',
        're-materializing an untouched subtree (every nest, mark and delete does',
        'this) dedups back to its existing sig instead of re-signing the tree.',
        'Verified live: tag a note, untag it, and its signature returns to the',
        'original.',
        '',
        `source: ${NOTES_DOMAIN}/note-tags.ts`,
      ].join('\n'),
    },
    {
      key: 'notes-drone-tags',
      marks: [PART_KEYWORD],
      note: [
        'notes.drone.ts — the `tags` slot on the note layer.',
        '',
        'Notes now carry their own pheromones. The slot lives ON THE NOTE rather',
        'than in a side pool because a note id is its content signature: a mapping',
        'keyed by id would be orphaned the moment the note was edited.',
        '',
        '`note:tag { cellLabel, noteId, tag, add }` rewrites one node at any depth',
        'and re-materializes from the leaves up, exactly as `note:mark` does, so a',
        'tagged parent keeps its children and its position. Re-dropping a keyword a',
        'note already carries is a no-op — no new revision. The direction is the',
        'caller\'s to decide, so a second drop never silently un-tags.',
        '',
        'An edit CARRIES PHEROMONES FORWARD. Re-typing a note\'s text is not a',
        'request to strip what the participant put on it.',
        '',
        `source: ${NOTES_DOMAIN}/notes.drone.ts`,
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
    console.error(`[notes-reader] ABORT: cannot read "${ROOT}/${COLLECTION}" (${coll.error}).`)
    console.error('[notes-reader] Run mirror-window-chrome.ts first, and open the app with ?claudeBridge=1.')
    process.exit(1)
  }
  const members = ((coll.data?.children ?? []) as any[]).map(k => String(k?.name ?? '')).filter(Boolean)
  if (!members.length) {
    console.error('[notes-reader] ABORT: tool-windows has no members — wrong renderer?')
    process.exit(1)
  }
  console.log(`[notes-reader] existing members: ${members.join(', ')}`)

  // Union, never replace — a children slot is REPLACED wholesale, so a partial
  // list would drop the gear, the group and every other window.
  const merged = members.includes(MEMBER) ? members : [...members, MEMBER]
  process.stdout.write(`[notes-reader] ${ROOT}/${COLLECTION} ← ${merged.length} members ... `)
  const collUp = await sendRetry({
    op: 'update', segments: [ROOT, COLLECTION], layer: { name: COLLECTION, children: merged },
  })
  console.log(collUp.ok ? 'ok' : `FAIL: ${collUp.error}`)
  if (!collUp.ok) process.exit(1)

  await writeCell([ROOT, COLLECTION, MEMBER], CREATION)

  console.log(`[notes-reader] DONE — ${okCells} cells, ${okNotes} notes, ${okMarks} marks (${skipped} already present)`)
  if (failed > 0) console.warn(`[notes-reader] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
