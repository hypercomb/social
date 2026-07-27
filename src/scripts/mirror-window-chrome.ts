// Mirror pass for the TOOL-WINDOW CHROME — the settings gear and the window
// group that every docked tool window carries (hypercomb-shared/ui/docked-panel).
//
// The `behaviors` mirror's eight collections are the slash.* census; this adds a
// ninth, `tool-windows`, for shell chrome that is NOT a slash behaviour: the
// gear that stands in every window's header, the group model behind it, and the
// windows that carry it.
//
// Structure (mirror-paradigm.md — tiles + collection + pheromones + notes):
//
//   behaviors/tool-windows              collection, keyword `window`
//   ├── window-settings                 the gear: always visible, left of ×
//   │   ├── hc-docked-panel             part — the shared chrome directive
//   │   └── toolwindow                  part — the shared header band geometry
//   ├── window-group                    a group is JUST TEXT; matching text shares width
//   │   └── panel-groups                part — membership + shared attributes
//   ├── notes                           tool window — the notes strip
//   └── clipboard                       tool window — the clipboard panel
//
// The tool windows that ALREADY have a behaviour tile are not duplicated here —
// they are PAINTED with `window` where they live, so the collection gathers them
// by mark rather than by folder (the same way `game` grows the games
// collection). That is the point of the pheromone: membership is data.
//
// Merge mode + idempotent: existing children are unioned (tile order stays
// still), and note-presence gates the note + mark so a re-run cannot duplicate
// them (`note-add` and `decoration-add` are not idempotent on their own).

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
// Declared, never minted on the fly. `part` already exists (mirror-behavior-
// parts.ts) and is reused verbatim.
const WINDOW_KEYWORD = 'window'
const WINDOW_COLOR = '#5a8fa8'   // steel — the tool-window chrome's own colour
const PART_KEYWORD = 'part'

const ROOT = norm('behaviors')
const COLLECTION = norm('tool-windows')

const SHARED = 'hypercomb-shared/ui'

interface Cell { key: string; note: string; marks: string[]; parts?: Cell[] }

const MEMBERS: Cell[] = [
  {
    key: 'window-settings',
    marks: [WINDOW_KEYWORD],
    note: [
      'window-settings — the gear in every tool window\'s header.',
      '',
      'It STANDS, always, a hair to the left of the close button — dim at rest,',
      'brightening on hover, steel once the window belongs to a group. It used to',
      'appear only while the header band was hovered; a control nobody can see is a',
      'control nobody finds.',
      '',
      'Clicking it opens a small popover of per-window settings. Today that is one',
      'setting: the window\'s group.',
      '',
      `source: ${SHARED}/docked-panel/hc-docked-panel.directive.ts`,
    ].join('\n'),
    parts: [
      {
        key: 'hc-docked-panel',
        marks: [PART_KEYWORD],
        note: [
          'hc-docked-panel.directive.ts — the shared docked-window chrome.',
          '',
          'Builds the gear and its popover, and (for windows that have no sizing of',
          'their own) the resize grip, the persisted width and the content scale.',
          '',
          'A window that already sizes itself stamps `[ownsSize]="false"` and gets the',
          'settings half only — same gear, same group, its own size. Windows holding',
          'their width in a signal also pass `[sizeOwner]="this"`, because an inline',
          'width write would be clobbered by the next change detection.',
          '',
          `source: ${SHARED}/docked-panel/hc-docked-panel.directive.ts`,
        ].join('\n'),
      },
      {
        key: 'toolwindow',
        marks: [PART_KEYWORD],
        note: [
          '_toolwindow.scss — the one shared header band.',
          '',
          'Fixed height, centered content, consistent padding. Every tool window\'s',
          'header takes it, which is why the gear lands at the same spot in all of',
          'them — including the notes strip, whose band is a dragbar rather than a',
          '<header>.',
          '',
          `source: ${SHARED}/_toolwindow.scss`,
        ].join('\n'),
      },
    ],
  },
  {
    key: 'window-group',
    marks: [WINDOW_KEYWORD],
    note: [
      'window-group — windows that travel together.',
      '',
      'A group is JUST TEXT. Type the same word into two windows\' settings and they',
      'share attributes (the width, for now); leave it blank and a window is on its',
      'own. There is no registry, no group objects, nothing to create, name or',
      'delete — matching text IS the grouping, which is why a group may span dock',
      'sides.',
      '',
      'A window joining text that already has a width TAKES it; text nobody has used',
      'yet gets DEFINED from the window that used it first.',
      '',
      `source: ${SHARED}/docked-panel/panel-groups.ts`,
    ].join('\n'),
    parts: [
      {
        key: 'panel-groups',
        marks: [PART_KEYWORD],
        note: [
          'panel-groups.ts — the group model.',
          '',
          'Two participant-local records: each window\'s group text, and each group\'s',
          'shared attributes. The attributes are one JSON blob per group, so a new',
          'shared attribute needs no new key and no migration.',
          '',
          `source: ${SHARED}/docked-panel/panel-groups.ts`,
        ].join('\n'),
      },
    ],
  },
  {
    key: 'notes',
    marks: [WINDOW_KEYWORD],
    note: [
      'notes — the notes strip, as a tool window.',
      '',
      'It sizes itself: its own edge handles, its own store, and a float mode the',
      'shared chrome knows nothing about. So it carries the settings half only, and',
      'can join a group without surrendering any of that — the group hands it a',
      'width, its own machinery persists it.',
      '',
      'Its header is a dragbar, not a <header>, which is why the chrome looks for',
      'both.',
      '',
      `source: ${SHARED}/notes-strip/notes-strip.component.ts`,
    ].join('\n'),
  },
  {
    key: 'clipboard',
    marks: [WINDOW_KEYWORD],
    note: [
      'clipboard — the clipboard panel, as a tool window.',
      '',
      'Holds its width in a signal, so the group reaches it through the window',
      'itself rather than through the element: the same clamp and the same store as',
      'a drag of its own grip. A width arriving from a group mate is not a different',
      'kind of width.',
      '',
      `source: ${SHARED}/clipboard-panel/clipboard-panel.component.ts`,
    ].join('\n'),
  },
]

const COLLECTION_NOTE = [
  'tool-windows — the shell\'s docked windows and the chrome they share.',
  '',
  'Not slash behaviours: this is the furniture the behaviours open into. Every',
  'tool window carries the same header band, the same always-visible settings',
  'gear right of its close button, and the same group.',
  '',
  'Collection keyword: window',
].join('\n')

/** Tool windows that ALREADY have a behaviour tile — painted where they live
 *  instead of duplicated here, so the mark is what gathers them. */
const PAINT: { path: string[]; why: string }[] = [
  { path: [ROOT, 'views', 'history'], why: 'history viewer' },
  { path: [ROOT, 'views', 'tags'], why: 'tags viewer' },
  { path: [ROOT, 'structure', 'files'], why: 'files viewer' },
  { path: [ROOT, 'swarm', 'observe'], why: 'observe viewer' },
  { path: [ROOT, 'assistant', 'workflow'], why: 'workflow designer' },
]

async function noted(segments: string[], text: string): Promise<boolean> {
  const check = await send({ op: 'note-list', segments })
  return check.ok && Array.isArray(check.data) && check.data.some((x: any) => x?.text === text)
}

async function marked(segments: string[], name: string): Promise<boolean> {
  const check = await send({ op: 'layer-at', segments })
  const decs = (check.data?.decorations ?? []) as string[]
  return check.ok && decs.includes(decorationSig(name))
}

let okCells = 0, okNotes = 0, okMarks = 0, skipped = 0, failed = 0

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
  // Preflight: confirm we are talking to the hive that HAS the mirror, and read
  // the collection list for the merge.
  const beh = await send({ op: 'inflate', segments: [ROOT] }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!beh.ok) {
    console.error(`[windows] ABORT: cannot read "${ROOT}" (${beh.error}). Open the app with ?claudeBridge=1.`)
    process.exit(1)
  }
  const collections = ((beh.data?.children ?? []) as any[]).map(k => String(k?.name ?? '')).filter(Boolean)
  if (!collections.length) {
    console.error('[windows] ABORT: behaviors has no collections — wrong renderer?')
    process.exit(1)
  }
  console.log(`[windows] existing collections: ${collections.join(', ')}`)

  // Root update: union, never replace — a children slot is REPLACED wholesale,
  // so a partial list would drop the other eight collections.
  const merged = collections.includes(COLLECTION) ? collections : [...collections, COLLECTION]
  process.stdout.write(`[windows] ${ROOT} ← ${merged.length} collections ... `)
  const rootUp = await sendRetry({ op: 'update', segments: [ROOT], layer: { name: ROOT, children: merged } })
  console.log(rootUp.ok ? 'ok' : `FAIL: ${rootUp.error}`)
  if (!rootUp.ok) process.exit(1)

  // The collection tile + its members.
  const collSeg = [ROOT, COLLECTION]
  console.log(`[windows] ${collSeg.join('/')} ← ${MEMBERS.length} members`)
  const collUp = await sendRetry({
    op: 'update', segments: collSeg,
    layer: { name: COLLECTION, children: MEMBERS.map(m => norm(m.key)) },
  })
  if (!collUp.ok) { console.error(`[windows] ABORT: collection update failed (${collUp.error})`); process.exit(1) }
  okCells++
  await writeNote(collSeg, COLLECTION_NOTE)
  await writeMark(collSeg, WINDOW_KEYWORD)

  for (const m of MEMBERS) await writeCell([...collSeg, norm(m.key)], m)

  // Paint the tool windows that already have a tile elsewhere.
  console.log('[windows] painting existing tool-window tiles')
  for (const p of PAINT) {
    console.log(`  ${p.path.join('/')} (${p.why})`)
    await writeMark(p.path, WINDOW_KEYWORD)
  }

  // Declare the vocabulary (registry-only /keyword), then neutralize the sticky
  // submit replay so a reload of the bridged tab does not re-run it.
  process.stdout.write(`[windows] registering vocabulary: ${WINDOW_KEYWORD}(${WINDOW_COLOR}) ... `)
  const reg = await send({ op: 'submit', text: `/keyword [${WINDOW_KEYWORD}(${WINDOW_COLOR})]` })
  console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
  await send({ op: 'submit', text: '' })

  console.log(`[windows] DONE — ${okCells} cells, ${okNotes} notes, ${okMarks} marks (${skipped} already present)`)
  if (failed > 0) console.warn(`[windows] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
