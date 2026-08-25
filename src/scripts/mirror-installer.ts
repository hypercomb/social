// mirror-installer — the DCP installer's mirror structure in the hive.
//
// Mirror paradigm: every creation gets tiles for its parts, a collection
// gathering them, pheromones marking what each part IS, and notes explaining
// it. This is the installer's root, a sibling of `behaviors` — installer
// surfaces are not slash behaviours and do not belong in that themed-card
// language.
//
// EXTEND, NEVER RE-RUN. `note-add` is additive: a second run lands every note
// twice. New installer work adds a COLLECTION to the table below and is run
// with `--only <collection>`; the guard refuses a collection whose tiles are
// already present.
//
// Structure written by `op:'add'` — an APPEND that preserves every prior
// child verbatim. Never `update` with a `children` array: `children` is a
// NAME slot, so a SET both wipes unlisted siblings and (fed sigs) mints
// {name:<sig>} husk tiles. That is the 2026-08-02 incident; do not repeat it.
//
//   npx tsx scripts/mirror-installer.ts               # all pending collections
//   npx tsx scripts/mirror-installer.ts --only client-registry
//   npx tsx scripts/mirror-installer.ts --dry-run

import WebSocket from 'ws'

const BRIDGE = process.env.HC_BRIDGE ?? 'ws://localhost:2401'
const TIMEOUT_MS = 20_000

const ROOT_KEY = 'installer'
/** The universal mark: every tile under this root carries it. */
const ROOT_MARK = 'installer'
const ROOT_COLOR = '#d8b26a'
/** Implementation parts of a creation — the mark CLAUDE.md names for the
 *  child cells a multi-file creation spreads its source resources across. */
const PART_MARK = 'part'
const PART_COLOR = '#8b909a'

interface Part {
  /** Tile name — what the part IS, for a person. The path lives in the note. */
  name: string
  /** The source resource this tile is 1:1 with. */
  source: string
  /** What it does and why it is the way it is. */
  note: string
}
interface Collection {
  name: string
  keyword: string
  color: string
  note: string
  parts: Part[]
}

const COLLECTIONS: Collection[] = [
  {
    name: 'client-registry',
    keyword: 'client-registry',
    color: '#4d7fae',
    note: [
      'The installer\'s list of CLIENT INSTALLS — one entry per isolated storage world (a browser profile, a native --instance, a Store install). They can each run a different package version on one machine, so managing them requires knowing which install is talking. Identity travels in the portal handoff URL, because no storage is shared across clients.',
      '',
      'It had degenerated into twenty-seven indistinguishable chips reading "edge WEB" / "chrome WEB". Four causes, all fixed here:',
      '1. The display name is a BROWSER BRAND, not an identity — every dev origin, profile and storage clear mints a new id under the same name.',
      '2. The only distinguishing field, the id, was hidden in a title tooltip.',
      '3. The version rendered as NOTHING whenever the package would not resolve.',
      '4. Nothing ever pruned; lastSeen was recorded and never shown.',
      '',
      'The resting list is now ONE row: the install you are managing FROM. Everything else waits behind a count. More rows than that answer no question you arrived with — they only restate that browsers have opened the installer before.',
    ].join('\n'),
    parts: [
      {
        name: 'registry-model',
        source: 'diamond-core-processor/src/app/home/home.component.ts',
        note: [
          'What an install IS to the installer, and when it stops being one.',
          '',
          'Three bands on lastSeen: CURRENT (the opener, or the most recent when DCP was opened directly), DORMANT past 30 days (real, probably still installed, dimmed inside the reveal), and DEAD past 180 days — purged from storage on read, along with any rename override left behind. A record whose timestamp will not parse cannot be PROVEN dead, so it survives as dormant rather than being thrown away.',
          '',
          'The rename is a DCP-LOCAL override keyed by client id. The installer cannot write the install\'s own hc:client-name — different origin, no shared storage — so a name typed here is the installer\'s handle for that install, never a rewrite of what the install calls itself.',
        ].join('\n'),
      },
      {
        name: 'row-list-view',
        source: 'diamond-core-processor/src/app/home/home.component.html',
        note: [
          'One row at rest, and a count for the rest.',
          '',
          'Rows, not chips: an install carries four facts (handle, platform, version, last seen) and a chip holds one legibly. Twenty-seven chips holding one fact each hold none.',
          '',
          'TRAP: every row must emit the SAME cells, empty ones included. A skipped cell slides the rest of the row into the wrong column and the list goes ragged again — which is the exact failure this rework exists to fix. The "this client" mark is the one exception: it rides INSIDE the handle cell rather than claiming a column, because only one row ever carries it and an empty column across every other row is a river of dead space.',
        ].join('\n'),
      },
      {
        name: 'column-tracks',
        source: 'diamond-core-processor/src/app/home/home.component.scss',
        note: [
          'The SECTION owns the column tracks; every row borrows them with `grid-template-columns: subgrid`.',
          '',
          'TRAP: a per-row grid computes its own widths, so columns do not line up between rows. That looks like a styling nitpick and is actually the whole defect.',
          '',
          'TRAP: `minmax(0, 15rem)` on the handle does NOT cap-to-content — the grid algorithm\'s maximize-tracks step grows a definite growth limit to its full size whether the content needs it or not, opening a river between the name and everything else. `fit-content(15rem)` is the one that sizes to content and still caps a sixty-character instance name.',
          '',
          'No 1fr spacer: a content-sized block packing left beats pinning the time to the far edge and ruling dead space across every row. Actions arrive with the pointer, so the resting state carries no grid of × buttons.',
        ].join('\n'),
      },
      {
        name: 'roster-handoff',
        source: 'hypercomb-shared/ui/portal/portal-overlay.component.ts',
        note: [
          'The relay-aggregated roster rides into the installer on the handoff URL — the participant\'s OTHER installs, announced over the mesh, so the installer can list clients this browser has never opened it from.',
          '',
          'It now carries each install\'s OWN lastSeen as `s`. Without it the installer had to stamp every roster entry "now" on each handoff, so nothing could ever go dormant and the whole tiering above would have been decorative. The compaction is capped and short-keyed because it travels in a URL fragment.',
        ].join('\n'),
      },
      {
        name: 'wording',
        source: 'hypercomb-shared/i18n/*.json',
        note: [
          'Seven keys across all fourteen catalogs: dcp.clients, -this, -rename, -forget, -others.one/.other, -others-hide.',
          '',
          'The relative times are NOT catalog keys — Intl.RelativeTimeFormat, given the participant\'s locale, produces the wording and the plural in every language for free. Japanese renders 一昨日 and 9 時間前 with nothing added to any catalog. Per-unit keys would have been eight more strings times fourteen catalogs, drifting silently.',
          '',
          'Catalogs are inserted after their nearest existing neighbour so the diff stays additive and existing lines do not relocate.',
        ].join('\n'),
      },
    ],
  },
]

const ROOT_NOTES = [
  'The mirror of the DIAMOND CORE PROCESSOR — the installer where code is reviewed, trusted and installed before a hive runs it. One tile per source resource, gathered into collections, marked with pheromones, explained here. Built alongside the code: the hive is the living specification.',
  'A sibling of `behaviors`, deliberately. Those tiles are slash behaviours in a themed-card language; installer surfaces are not behaviours and would be misfiled among them.',
  `Every tile here carries the \`${ROOT_MARK}\` keyword; each collection carries its own; implementation parts carry \`${PART_MARK}\`. The pheromones ARE the parameters of the collections — paint the same keyword anywhere to grow them.`,
]

let counter = 0
function send(req: Record<string, unknown>): Promise<{ ok: boolean; error?: string; data?: any }> {
  return new Promise((resolve, reject) => {
    const id = `mirror-installer-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) }
      ws.close()
    })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

/** Child NAMES at a path. Child sigs are historical snapshots — they are used
 *  ONLY to learn names; never to read a decoration or a slot. */
async function namesAt(segments: string[]): Promise<string[]> {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) return []
  const names: string[] = []
  for (const sig of layer.data?.children ?? []) {
    const inf = await send({ op: 'inflate', cell: sig })
    const name = inf?.data?.name
    if (typeof name === 'string' && name) names.push(name)
  }
  return names
}

async function main(): Promise<void> {
  const only = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : null
  const dryRun = process.argv.includes('--dry-run')

  const alive = await send({ op: 'ui-state' })
  if (!alive.ok) { console.error('[mirror-installer] no renderer on the bridge — nothing written.'); process.exit(1) }

  const wanted = only ? COLLECTIONS.filter(c => c.name === only) : COLLECTIONS
  if (!wanted.length) { console.error(`[mirror-installer] no collection named "${only}"`); process.exit(1) }

  const rootNames = await namesAt([])
  const rootExists = rootNames.includes(ROOT_KEY)
  const existing = rootExists ? await namesAt([ROOT_KEY]) : []

  // EXTEND, NEVER RE-RUN — note-add is additive, so a collection already
  // present is refused rather than re-noted.
  const pending = wanted.filter(c => !existing.includes(c.name))
  const skipped = wanted.filter(c => existing.includes(c.name))
  for (const c of skipped) console.warn(`[mirror-installer] SKIP "${c.name}" — already mirrored (re-running would double its notes)`)
  if (!pending.length) { console.log('[mirror-installer] nothing to do.'); return }

  console.log(`[mirror-installer] root "${ROOT_KEY}" ${rootExists ? 'exists' : 'will be created'}; ${pending.length} collection(s): ${pending.map(c => c.name).join(', ')}`)
  if (dryRun) { console.log('[mirror-installer] --dry-run — nothing written.'); return }

  let ok = 0, fail = 0
  const step = async (label: string, req: Record<string, unknown>) => {
    process.stdout.write(`  ${label} ... `)
    const res = await send(req)
    if (res.ok) { ok++; console.log('ok') } else { fail++; console.log(`FAIL: ${res.error}`) }
  }

  // Phase 1 — structure. `add` APPENDS; it never rewrites a children slot.
  console.log('[mirror-installer] phase 1: structure')
  if (!rootExists) await step(`root/${ROOT_KEY}`, { op: 'add', segments: [], cells: [ROOT_KEY] })
  for (const c of pending) {
    await step(`${ROOT_KEY}/${c.name}`, { op: 'add', segments: [ROOT_KEY], cells: [c.name] })
    await step(`${ROOT_KEY}/${c.name} ← ${c.parts.length} parts`,
      { op: 'add', segments: [ROOT_KEY, c.name], cells: c.parts.map(p => p.name) })
  }

  // Phase 2 — notes. The explanation lives on the tile, not only in markdown.
  console.log('[mirror-installer] phase 2: notes')
  if (!rootExists) {
    for (const text of ROOT_NOTES) await step(`note ${ROOT_KEY}`, { op: 'note-add', segments: [], cell: ROOT_KEY, text })
  }
  for (const c of pending) {
    await step(`note ${c.name}`, {
      op: 'note-add', segments: [ROOT_KEY], cell: c.name,
      text: `${c.note}\n\nCollection keyword: ${c.keyword} — painting this keyword on any tile makes it a member.`,
    })
    for (const p of c.parts) {
      await step(`note ${c.name}/${p.name}`, {
        op: 'note-add', segments: [ROOT_KEY, c.name], cell: p.name,
        text: `${p.note}\n\nsource: ${p.source}`,
      })
    }
  }

  // Phase 3 — pheromones. kind:'tag', the same shape DecorationService.addTag
  // writes. NO replaceKind: tags stack, and replaceKind would drop the first
  // mark when the second lands.
  console.log('[mirror-installer] phase 3: pheromones')
  const mark = (segments: string[], tag: string) =>
    step(`${segments.join('/')} ← ${tag}`, { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name: tag } })
  if (!rootExists) await mark([ROOT_KEY], ROOT_MARK)
  for (const c of pending) {
    await mark([ROOT_KEY, c.name], ROOT_MARK)
    await mark([ROOT_KEY, c.name], c.keyword)
    for (const p of c.parts) {
      await mark([ROOT_KEY, c.name, p.name], ROOT_MARK)
      await mark([ROOT_KEY, c.name, p.name], c.keyword)
      await mark([ROOT_KEY, c.name, p.name], PART_MARK)
    }
  }

  // Phase 4 — register the vocabulary (colours + intellisense) in the global
  // TagRegistry. `/keyword` with NO selection is registry-only: no tile writes.
  const vocab = [
    `${ROOT_MARK}(${ROOT_COLOR})`,
    `${PART_MARK}(${PART_COLOR})`,
    ...pending.map(c => `${c.keyword}(${c.color})`),
  ]
  console.log('[mirror-installer] phase 4: vocabulary')
  await step(`/keyword [${vocab.join(', ')}]`, { op: 'submit', text: `/keyword [${vocab.join(', ')}]` })
  await send({ op: 'submit', text: '' })  // neutralize the sticky replay

  console.log(`[mirror-installer] DONE — ${ok} ops ok, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
