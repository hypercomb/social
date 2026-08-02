// Mirror the UPGRADE creation into the hive — the other half of building it.
//
// The behaviour: the header pill announces a newer build, already holding a
// name for it (two words minted from the package signature by the same service
// the breadcrumb uses for its secret words). You overwrite the name or leave
// it, then Adopt / Save / Discard. Adopt goes NOWHERE — it snapshots under that
// name, installs the newer files and reloads.
//
// Structure: `behaviors/structure/upgrade` is the collection; one child tile
// per source resource, each marked `part`. Notes carry the explanation and the
// source pointer. Keywords are already declared (`behavior`, `structure`,
// `part`) — nothing new is minted here.
//
// Merge-only + re-run sentinel: note-add and decoration-add are NOT idempotent,
// so this aborts if the collection already exists. Extend, never re-run.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 60_000

const SHARED = 'hypercomb-shared'
const WEB = 'hypercomb-web/src'
const ESSENTIALS = 'hypercomb-essentials/src/diamondcoreprocessor.com'

const PARENT = ['behaviors', 'structure']
const COLLECTION = 'upgrade'
const SEGMENTS = [...PARENT, COLLECTION]

const COLLECTION_MARKS = ['behavior', 'structure']
const PART_MARK = 'part'

const COLLECTION_NOTE = [
  '/upgrade — take the newest build this shell is serving.',
  '',
  'One click, no detour. The pill announces the update with a NAME already',
  'written for it: two words minted from the package signature, so the same',
  'build reads as the same name on every device and the different times this',
  'hive was updated are remembered as names, not timestamps. Overwrite it or',
  'leave it, then Adopt (take it now), Save (keep it for later) or Discard',
  '(never offer this one again).',
  '',
  'Adopt visits no screen. It snapshots the hive under that name, installs the',
  'newer files and reloads. If the install has to go through DCP, that happens',
  'off-screen in the headless iframe — there is nothing to come back from.',
].join('\n')

interface Part { name: string; note: string; source: string }

const PARTS: Part[] = [
  {
    name: 'upgrade-pill',
    note: 'The header indicator. Writes the revision name the moment an update is announced, then offers the three choices — Adopt, Save, Discard. Adopt dispatches `hypercomb:apply-update` with the name and the package; it never opens the installer.',
    source: `${SHARED}/ui/upgrade-indicator/upgrade-indicator.component.ts`,
  },
  {
    name: 'revision-name',
    note: 'The naming service. Mints "Marsh Bridge · alpha 0.9.4" from the package signature using the same word-pair service the breadcrumb uses for its secret words — deterministic, so one build carries one name everywhere. The build\'s own label rides along, or the date when it has none.',
    source: `${SHARED}/core/revision-name.ts`,
  },
  {
    name: 'revision-name-proof',
    note: 'Proof the name is worth attaching to a revision: the same build always names the same, different builds name differently, and an update still gets a name when the package signature or the label is missing.',
    source: `${SHARED}/core/revision-name.spec.ts`,
  },
  {
    name: 'upgrade-queen',
    note: 'The typed door. `/upgrade` fires the same `hypercomb:apply-update` the pill does, for the hive that has no pill to click — a door, not a mechanism.',
    source: `${ESSENTIALS}/commands/upgrade.queen.ts`,
  },
  {
    name: 'apply-update',
    note: 'The shell\'s half of the work: snapshot under the revision name (minting one if the door that fired carried none), install the bundled package, cache the import map, reload. Nothing is adopted if the restore point cannot be saved.',
    source: `${WEB}/app/app.ts`,
  },
  {
    name: 'update-check',
    note: 'The announcer. Compares the cached install against the shell\'s bundled package after boot and emits `update:available` with the package signature and the changed-bee delta — the signature the name is minted from. Never installs anything.',
    source: `${WEB}/setup/ensure-install.ts`,
  },
]

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mirror-upgrade-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
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

async function main(): Promise<void> {
  const parent = await send({ op: 'inflate', segments: PARENT })
  if (!parent.ok) {
    console.error(`[mirror-upgrade] ABORT: cannot inflate ${PARENT.join('/')}: ${parent.error}`)
    process.exit(1)
  }
  const siblings: string[] = (parent.data?.children ?? [])
    .map((c: any) => String(c?.name ?? '')).filter(Boolean)
  if (siblings.includes(COLLECTION)) {
    console.error(`[mirror-upgrade] ABORT: "${SEGMENTS.join('/')}" already exists — extend it, never re-run.`)
    process.exit(1)
  }
  console.log(`[mirror-upgrade] ${PARENT.join('/')} holds ${siblings.length}: ${siblings.join(', ')}`)

  // 1. Membership — merge, never replace.
  const merged = [...siblings, COLLECTION]
  process.stdout.write(`[struct] ${PARENT.join('/')} ← ${merged.length} children ... `)
  const parentRes = await send({
    op: 'update', segments: PARENT,
    layer: { name: parent.data?.name ?? PARENT[PARENT.length - 1], children: merged },
  })
  console.log(parentRes.ok ? 'ok' : `FAIL: ${parentRes.error}`)
  if (!parentRes.ok) process.exit(1)

  // 2. The collection and its parts.
  const cells: { segments: string[]; name: string; children: string[] }[] = [
    { segments: SEGMENTS, name: COLLECTION, children: PARTS.map(p => p.name) },
    ...PARTS.map(p => ({ segments: [...SEGMENTS, p.name], name: p.name, children: [] as string[] })),
  ]
  let okStruct = 0
  for (const cell of cells) {
    process.stdout.write(`[struct] ${cell.segments.join('/')} ... `)
    const layer: { name: string; children?: string[] } = { name: cell.name }
    if (cell.children.length) layer.children = cell.children
    const res = await send({ op: 'update', segments: cell.segments, layer })
    if (res.ok) { okStruct++; console.log('ok') } else console.log(`FAIL: ${res.error}`)
  }

  // 3. Notes — the explanation lives on the tile.
  const notes: { segments: string[]; text: string }[] = [
    { segments: SEGMENTS, text: COLLECTION_NOTE },
    ...PARTS.map(p => ({ segments: [...SEGMENTS, p.name], text: `${p.note}\n\nsource: ${p.source}` })),
  ]
  let okNotes = 0
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({
      op: 'note-add',
      segments: n.segments.slice(0, -1),
      cell: n.segments[n.segments.length - 1],
      text: n.text,
    })
    if (res.ok) { okNotes++; console.log('ok') } else console.log(`FAIL: ${res.error}`)
  }

  // 4. Pheromones — appended one at a time, never with replaceKind.
  const marks: { segments: string[]; tag: string }[] = [
    ...COLLECTION_MARKS.map(tag => ({ segments: SEGMENTS, tag })),
    ...PARTS.map(p => ({ segments: [...SEGMENTS, p.name], tag: PART_MARK })),
  ]
  let okMarks = 0
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({
      op: 'decoration-add', segments: m.segments, kind: 'tag',
      appliesTo: [], payload: { name: m.tag },
    })
    if (res.ok) { okMarks++; console.log('ok') } else console.log(`FAIL: ${res.error}`)
  }

  console.log(`[mirror-upgrade] DONE — ${okStruct}/${cells.length} cells, ${okNotes}/${notes.length} notes, ${okMarks}/${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
