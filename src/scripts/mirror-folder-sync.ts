// Mirror pass for /folder-sync — the portable folder backup.
//
// The behaviour predates this pass and was never mirrored at all: there was no
// `folder-sync` cell anywhere under `behaviors`, so the hardening work done on
// it had nowhere to land. This pass creates the behaviour tile beside its
// siblings in `structure` (snapshot, restore, files) and spreads its five
// source resources across child cells, one tile per file.
//
//   behaviors/structure/folder-sync/
//     folder-sync-queen            the slash behaviour
//     folder-sync-service          the pass itself
//     folder-sync-view             the surface
//     folder-sync-spec             the invariants
//     folder-sync-drain-spec       the drain invariant, isolated
//     folder-sync-closure-spec     what "everything" means, held as tests
//
// Merge mode + idempotent: children are unioned, and a cell that already
// carries a note is left alone. That skip is deliberate — this pass may not
// overwrite what is already in the hive — so a cell noted by an EARLIER run
// keeps its older text even when the note below has moved on. Check the log
// for "already noted" lines and update those cells by hand if the behaviour
// has changed underneath them.

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
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

// `--dry-run` performs every READ and prints every intended write without
// sending one. The guard below is fail-closed, but "trust me, it will abort"
// is not something you should have to take on faith about your own hive.
const DRY_RUN = process.argv.includes('--dry-run')
const MUTATIONS = new Set(['update', 'note-add', 'decoration-add', 'submit'])

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  if (DRY_RUN && MUTATIONS.has(String(request['op'] ?? ''))) {
    const seg = Array.isArray(request['segments']) ? (request['segments'] as string[]).join('/') : ''
    const detail = request['op'] === 'update'
      ? `children=[${((request['layer'] as { children?: string[] })?.children ?? []).join(', ')}]`
      : request['op'] === 'decoration-add'
        ? `mark=${String((request['payload'] as { name?: string })?.name ?? '')}`
        : request['op'] === 'note-add'
          ? `note=${String(request['text'] ?? '').split('\n')[0].slice(0, 60)}…`
          : `text=${String(request['text'] ?? '')}`
    console.log(`  [dry-run] ${String(request['op'])} ${seg} ${detail}`)
    return { id: 'dry-run', ok: true, data: 'dry-run' }
  }
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

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

function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const S = 'hypercomb-essentials/src/diamondcoreprocessor.com/sharing'

const PART_KEYWORD = 'part'
const PART_COLOR = '#7d8471'
const BEHAVIOR_SEG = [norm('behaviors'), norm('structure'), norm('folder-sync')]
const BEHAVIOR_MARKS = ['behavior', 'structure', 'window']

const BEHAVIOR_NOTE = [
  '/folder-sync — Back up the complete local hive to a private folder, USB disk, NAS, or cloud-synced directory',
  '',
  'Two modes. `local` copies the exact bytes this browser already holds and never touches the network. `hard-copy` first makes every referenced layer and resource local, then copies the expanded tree — so the folder is portable, not a set of pointers into somewhere you might not have next time.',
  '',
  'A hard copy means EVERYTHING. A layer is a contract: it names content by signature. So do many resources — a thread manifest names its message bodies, manifests and presets name what they configure. A walk that fetches the contracts and stops looks like success while the bytes they name are still somewhere else, which is how a backup that reports complete can restore to almost nothing. So the hard copy follows those chains to the end, and it also follows content named by pool records that no layer points at at all.',
  '',
  'Copying and PROVING are separate acts. A pass copies what is new or changed; `/folder-sync verify` re-hashes every backed-up file against its recorded signature and is the only thing that may claim the backup was checked.',
  '',
  'A backup has two halves and only one of them is required. The participant tree is always written; the profile snapshot exists only when this browser has DCP attached. A browser without it — including any private window, where DCP can never be present — writes a complete participant backup and no profile half, and importing one is a normal restore rather than a refusal.',
  '',
  'What makes a snapshot importable is a SEAL, not a claim: the manifest is hashed, the seal names that hash, and import re-hashes every listed file before accepting any of it. An interrupted pass is marked as in flight and is never mistaken for a finished one.',
  '',
  `source: ${S}/folder-sync.queen.ts, ${S}/folder-sync.service.ts, ${S}/folder-sync.view.ts`,
].join('\n')

const PARTS: { key: string; note: string }[] = [
  {
    key: norm('folder-sync-queen'),
    note: [
      'The command. connect, resume, sync, verify, status, import, disconnect — and bare `/folder-sync`, which opens the surface.',
      '',
      '`verify` is the one that costs something: it re-reads and re-hashes every file the backup claims to hold. It exists because a copy pass deliberately does not — content is named by its own hash, so a file present at the right name and size is already correct, and re-reading the whole mirror on every drain proved nothing. What the participant can no longer be told is that a copy pass verified anything. It did not; verify does.',
      '',
      'The directory picker is always participant-driven. No filesystem permission is ever requested during a passive boot: a backup destination is a thing you choose, not a thing the app asks for while you are doing something else.',
      '',
      'Where the browser cannot grant directory access at all, it says so and points at the one-file snapshot instead of failing silently.',
      '',
      `part of /folder-sync`,
      `source: ${S}/folder-sync.queen.ts`,
    ].join('\n'),
  },
  {
    key: norm('folder-sync-service'),
    note: [
      'The pass itself: closure materialization, the copy, the manifest, the seal, and the import.',
      '',
      'A pass copies only what is NEW OR CHANGED. Content here is named by its own signature, so a root-level sig-named file that is present at the right size is already correct — its bytes cannot have changed without changing its name. Re-hashing the whole mirror on every drain bought nothing; the verification that matters happens at import, where every listed file is re-hashed before anything is accepted, and on demand through `/folder-sync verify`. Mutable paths (markers, records) still fall back to size and modification time against the recorded stamp.',
      '',
      'Because of that, `verifiedAt` is a claim only a real re-hash may make. A copy pass moves `updatedAt` and leaves it alone. The distinction is the whole point: a timestamp that advances every time bytes are written says nothing about whether those bytes are still there and still right.',
      '',
      'The closure follows CHAINS, not one hop. A layer names content by signature and so do many resources, so any fetched resource that parses as a JSON record is read again for further signatures until nothing new appears. Records only — bytes that are not JSON are leaves, because scanning binary content for 64-hex runs would drag in whatever unrelated resource happened to be spelled inside an image. Cycles terminate on the visited set.',
      '',
      'Pool records are closure sources too. Threads, clipboard, and manifests name content that NO layer references; their record files were being copied verbatim while the bytes they pointed at stayed remote. If that content cannot be made local it counts as missing, and if there is no resource-rooted entry point at all the whole set counts as missing — an unaudited closure is not a clean pass.',
      '',
      'The deep walk is opt-in and this pass is the only caller that asks for it. Interactive adopt stays slim on purpose: eager resource pulls are exactly what once dragged hundreds of files into a single adopt.',
      '',
      'The manifest is the RESUME CURSOR. It is checkpointed mid-walk and flagged as an active pass, so an interrupted run resumes where it stopped instead of starting over — and a partial record can never be read as a completion.',
      '',
      'Closure accounting learned to distinguish "one item short" from "unmeasured". A root that produces no layer at all stopped the walk AT the root, so nothing beneath it was ever enumerated — reporting that as a single missing item hid a potentially enormous unfetched subtree behind a number that looked almost complete. Failed roots and unread markers are now counted and reported separately, and either one keeps the copy from being called portable.',
      '',
      'A full pass is expensive and idempotent, so a second request while one is in flight JOINS it instead of queueing a repeat — connect and the boot-time reconciliation used to each run a complete pass back to back. And an incremental drain only ADDS bytes, so it no longer restates closure facts: overwriting them erased what the full pass reported and quietly dropped the snapshot below the bar import requires.',
      '',
      `part of /folder-sync`,
      `source: ${S}/folder-sync.service.ts`,
    ].join('\n'),
  },
  {
    key: norm('folder-sync-view'),
    note: [
      'The surface: which folder, what mode, what the pass is doing right now, and what it found.',
      '',
      'It reports counts, not reassurance — files scanned and copied, bytes, closure roots checked, roots that produced no layer, items named by pool records, missing referenced items, and after a verify, how many files were re-hashed and how many did not match. A backup you cannot audit is a backup you are trusting rather than one you have.',
      '',
      `part of /folder-sync`,
      `source: ${S}/folder-sync.view.ts`,
    ].join('\n'),
  },
  {
    key: norm('folder-sync-spec'),
    note: [
      'The invariants, held as tests, because every one of them is a way to lose data quietly.',
      '',
      'A partial pass is never sealed. A snapshot whose closure failed is never importable. A backup with no profile half still imports. An empty profile directory is never minted by the report writer, because at import time one reads as a snapshot that fails verification.',
      '',
      'Also pinned here: a second full pass over unchanged content-addressed files copies nothing; a root that produced no layer leaves the copy unmeasured and unimportable; content named only by a pool record is still followed, and still blocks a portable claim when it cannot be fetched; and a file tampered with in the mirror is invisible to a copy pass but caught by verify — which is precisely the trade the fast path makes, written down so nobody has to rediscover it.',
      '',
      `part of /folder-sync`,
      `source: ${S}/folder-sync.spec.ts`,
    ].join('\n'),
  },
  {
    key: norm('folder-sync-drain-spec'),
    note: [
      'The drain invariant, deliberately alone in its own file.',
      '',
      'The incremental drain is driven by the effect bus, which replays its last value to every new subscriber. In a shared spec file that replay leaks across tests and makes it ambiguous which service instance did what — so this invariant gets one module registry, one bus, one service, and an answer that means something.',
      '',
      'What it protects: a drain adds bytes and NEVER restates closure facts.',
      '',
      `part of /folder-sync`,
      `source: ${S}/folder-sync-drain.spec.ts`,
    ].join('\n'),
  },
  {
    key: norm('folder-sync-closure-spec'),
    note: [
      'What "everything" means, held as tests. The hard copy is only as good as the closure underneath it, and that closure lives in the content broker rather than here — so these are the specs that stop it quietly shrinking.',
      '',
      'They pin four things. A record that names further content is followed, chain after chain, until nothing new appears. Bytes that are not JSON are a leaf: an image containing a 64-hex run does NOT drag that resource in, because a walk that harvests signatures out of binary content will happily fetch anything. Content that cannot be resolved is counted as failed rather than passing silently. And a reference cycle terminates.',
      '',
      'The fifth is the one that protects everybody else: with descent OFF the walk still stops at the contract. The deep walk belongs to the backup, not to interactive adopt, and this is what keeps the two from drifting into each other.',
      '',
      `part of /folder-sync`,
      `source: ${S}/resource-closure.spec.ts`,
    ].join('\n'),
  },
]

const decorationSig = (name: string): string =>
  createHash('sha256').update(JSON.stringify({ kind: 'tag', appliesTo: [], payload: { name } })).digest('hex')

async function childrenOf(segments: string[]): Promise<string[] | null> {
  const res = await send({ op: 'inflate', segments }).catch(() => ({ ok: false } as BridgeRes))
  if (!res.ok) return null
  const kids = (res.data as { children?: unknown } | undefined)?.children
  if (Array.isArray(kids)) return kids.map(k => String(typeof k === 'string' ? k : (k as { name?: string })?.name ?? '')).filter(Boolean)
  if (kids && typeof kids === 'object') return Object.keys(kids as Record<string, unknown>)
  return []
}

/**
 * Read children twice and require the same answer.
 *
 * Every structural write here is read-modify-write: we read the children, add
 * ours, and write the whole list back. That means a PARTIAL read does not fail
 * — it silently deletes whatever it failed to see. Two agreeing reads is the
 * cheap way to refuse to act on a list we are not confident in.
 */
// `absent` and `unstable` are NOT the same answer, and conflating them turns
// the guard into a bug: absent means "create it", unstable means "do not touch
// this at all". Only a cell that reads the same way twice may be acted on.
type ChildRead =
  | { state: 'present'; children: string[] }
  | { state: 'absent' }
  | { state: 'unstable' }

async function stableChildrenOf(segments: string[]): Promise<ChildRead> {
  const first = await childrenOf(segments)
  const second = await childrenOf(segments)
  if (first === null && second === null) return { state: 'absent' }
  if (first === null || second === null) {
    console.error(`[guard] "${segments.join('/')}" read as present once and absent once`)
    return { state: 'unstable' }
  }
  const a = [...first].sort().join(' ')
  const b = [...second].sort().join(' ')
  if (a !== b) {
    console.error(`[guard] "${segments.join('/')}" read differently twice`)
    console.error(`[guard]   read 1 (${first.length}): ${first.join(', ')}`)
    console.error(`[guard]   read 2 (${second.length}): ${second.join(', ')}`)
    return { state: 'unstable' }
  }
  return { state: 'present', children: first }
}

/**
 * Union children into a cell and PROVE nothing was lost.
 *
 * Additive by construction, verified after the fact: the post-write read must
 * still contain every child that was there before. A mirror pass may only ever
 * add to the hive — losing a cell here would be silent and unrecoverable, so a
 * loss aborts the run rather than reporting a cheerful summary.
 */
async function unionChildren(
  segments: string[],
  name: string,
  add: string[],
): Promise<string[] | null> {
  const read = await stableChildrenOf(segments)
  if (read.state === 'unstable') {
    console.error(`[guard] ABORT: refusing to rewrite "${segments.join('/')}" from a read I do not trust`)
    return null
  }
  const existing = read.state === 'present' ? read.children : []
  const missing = add.filter(k => !existing.includes(k))
  if (missing.length === 0) return existing

  const next = [...existing, ...missing]
  process.stdout.write(`[struct] ${segments.join('/')} ← +${missing.join(', ')} ... `)
  const res = await sendRetry({ op: 'update', segments, layer: { name, children: next } })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) return null

  const confirm = await stableChildrenOf(segments)
  if (confirm.state !== 'present') {
    console.error(`[guard] ABORT: cannot confirm "${segments.join('/')}" after writing it`)
    return null
  }
  const after = confirm.children
  const lost = existing.filter(k => !after.includes(k))
  if (lost.length > 0) {
    console.error(`[guard] ABORT: writing "${segments.join('/')}" DROPPED: ${lost.join(', ')}`)
    console.error('[guard] the hive lost children this pass was supposed to leave alone — stopping.')
    return null
  }
  return after
}

async function main(): Promise<void> {
  console.log(DRY_RUN
    ? '[folder-sync] DRY RUN — reads only; every write below is printed, not sent.'
    : '[folder-sync] LIVE — this writes to the hive. Re-run with --dry-run to preview.')
  const parent = BEHAVIOR_SEG.slice(0, -1)
  const siblingRead = await stableChildrenOf(parent)
  if (siblingRead.state !== 'present' || siblingRead.children.length === 0) {
    console.error(`[folder-sync] ABORT: cannot read "${parent.join('/')}" twice and agree — is a renderer connected?`)
    process.exit(1)
  }
  console.log(`[folder-sync] ${parent.join('/')} holds: ${siblingRead.children.join(', ')}`)

  // Phase 1 — the behaviour tile, unioned into its collection.
  const key = BEHAVIOR_SEG[BEHAVIOR_SEG.length - 1]
  if (!(await unionChildren(parent, parent[parent.length - 1], [key]))) process.exit(1)

  // Phase 2 — the parts, one tile per source resource.
  const have = await unionChildren(BEHAVIOR_SEG, key, PARTS.map(p => p.key))
  if (have === null) process.exit(1)

  const targets: { segments: string[]; note: string; marks: string[] }[] = []
  const behaviourNoted = await sendRetry({ op: 'note-list', segments: BEHAVIOR_SEG })
  if (!(behaviourNoted.ok && Array.isArray(behaviourNoted.data) && behaviourNoted.data.length > 0)) {
    targets.push({ segments: BEHAVIOR_SEG, note: BEHAVIOR_NOTE, marks: BEHAVIOR_MARKS })
  } else {
    console.log(`[struct] ${BEHAVIOR_SEG.join('/')} already noted — skip note+marks`)
  }

  for (const part of PARTS) {
    const segments = [...BEHAVIOR_SEG, part.key]
    // `{ name }` alone carries no children, so writing it over a cell that
    // already has some would erase them. A part tile is a leaf by design, so
    // an existing one is left exactly as it is: this pass creates, it never
    // reshapes what is already there.
    const partRead = await stableChildrenOf(segments)
    if (partRead.state === 'unstable') {
      console.error(`[guard] ${segments.join('/')} — inconsistent read, skipping`)
      continue
    }
    // EXISTS is the test, not "has children". A part tile is a leaf, so an
    // existing one reads as zero children — and rewriting it with `{ name }`
    // alone carries no notes and no decorations, which is how a pass that
    // "created nothing" can still erase the marks and notes it wrote last
    // time. Create only what is genuinely absent.
    if (partRead.state === 'present') {
      console.log(`[struct] ${segments.join('/')} already exists — leaving its layer alone`)
    } else {
      process.stdout.write(`[struct] ${segments.join('/')} ... `)
      const res = await sendRetry({ op: 'update', segments, layer: { name: part.key } })
      console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
      if (!res.ok) continue
    }
    const noted = await sendRetry({ op: 'note-list', segments })
    if (noted.ok && Array.isArray(noted.data) && noted.data.length > 0) console.log(`[struct] ${segments.join('/')} already noted — skip note+mark`)
    else targets.push({ segments, note: part.note, marks: [PART_KEYWORD] })
  }

  // Phase 3 — notes.
  let okNotes = 0, failNotes = 0
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    process.stdout.write(`[note ${i + 1}/${targets.length}] ${t.segments.join('/')} ... `)
    const res = await sendRetry(
      { op: 'note-add', segments: t.segments.slice(0, -1), cell: t.segments[t.segments.length - 1], text: t.note },
      async () => {
        const check = await send({ op: 'note-list', segments: t.segments })
        return check.ok && Array.isArray(check.data) && check.data.some((x: any) => (x?.text ?? x?.note) === t.note)
      },
    )
    if (res.ok) { okNotes++; console.log('ok') } else { failNotes++; console.log(`FAIL: ${res.error}`) }
  }

  // Phase 4 — pheromones. Declared vocabulary only.
  let okMarks = 0, failMarks = 0
  for (const t of targets) {
    for (const mark of t.marks) {
      process.stdout.write(`[mark] ${t.segments.join('/')} ← ${mark} ... `)
      const res = await sendRetry(
        { op: 'decoration-add', segments: t.segments, kind: 'tag', appliesTo: [], payload: { name: mark } },
        async () => {
          const check = await send({ op: 'layer-at', segments: t.segments })
          const decs = (check.data?.decorations ?? []) as string[]
          return check.ok && decs.includes(decorationSig(mark))
        },
      )
      if (res.ok) { okMarks++; console.log('ok') } else { failMarks++; console.log(`FAIL: ${res.error}`) }
    }
  }

  if (targets.length) {
    process.stdout.write(`[folder-sync] registering vocabulary: ${PART_KEYWORD}(${PART_COLOR}) ... `)
    const reg = await send({ op: 'submit', text: `/keyword [${PART_KEYWORD}(${PART_COLOR})]` })
    console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
    await send({ op: 'submit', text: '' })
  }

  console.log(`[folder-sync] DONE — ${targets.length} cells written, ${okNotes} notes, ${okMarks} marks`)
  const failed = failNotes + failMarks
  if (failed > 0) console.warn(`[folder-sync] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
