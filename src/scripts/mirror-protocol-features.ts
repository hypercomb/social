// Re-home the `protocol` mirror onto FEATURE coordinates — superimposition.md.
//
// The first pass (mirror-protocol.ts) took the Rust crate layout as the
// skeleton: protocol/native-client/protocol-crate/sig, and so on. That made one
// project's directory tree authoritative and left the web implementation of the
// same ideas with nowhere to sit. Law 1: coordinates name the CREATION, never
// the implementation.
//
// After this pass one cell per protocol feature, each holding both
// implementations as parts:
//
//   protocol/signatures/signature-service   (web)
//   protocol/signatures/sig                 (windows)
//
// and the deviation is a first-class cell:
//
//   protocol/head-index/head-index          (web)   — marked does-not-port
//
// The Rust-shaped `native-client` subtree is dropped from `protocol`'s children.
// There is no rename in the hive: a mis-addressed cell is removed and the right
// one is created. Its notes are re-written here on the new coordinates.
//
// Run AFTER mirror-protocol.ts. Idempotent: children union, and a cell that
// already carries a note keeps it.

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

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
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

const ROOT = norm('protocol')
const STALE_CHILD = norm('native-client')

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const C = 'hypercomb-core/src'
const SH = 'hypercomb-shared/core'
const R = 'hypercomb-client/crates'

// Vocabulary. Platform says WHICH implementation; parity says what an absence
// means. Both are declared through /keyword, never minted inline.
const VOCAB: [word: string, color: string][] = [
  ['part', '#7d8471'],
  ['protocol', '#4f7d8b'],
  ['web', '#3f7fa8'],
  ['windows', '#7a6fa8'],
  ['ports', '#6f8f6a'],
  ['does-not-port', '#a86f6f'],
]

type Part = { key: string; platform: 'web' | 'windows'; note: string }
type Feature = { key: string; parity: 'ports' | 'does-not-port'; note: string; parts: Part[] }

const FEATURES: Feature[] = [
  {
    key: norm('signatures'),
    parity: 'ports',
    note: [
      'The identity primitive. SHA-256 of the content bytes, lowercase hex, 64 characters — no salt, no prefix, no length framing, no domain separation.',
      '',
      'Unicode normalization is NOT applied here. Signing hashes exactly the bytes it is handed; folding happens upstream in lineage keys and nowhere else. A composed and a decomposed cafe are therefore different signatures but the same bag, and both halves are asserted, because getting it backwards forks either content identity or somebody\'s history.',
    ].join('\n'),
    parts: [
      { key: norm('signature-service'), platform: 'web', note: `The web implementation, over WebCrypto.\n\nsource: ${C}/core/signature.service.ts` },
      { key: norm('sig'), platform: 'windows', note: [
        'The native implementation, and the place the pool-vs-bag bug class is killed.',
        '',
        'A bag address and a pool address are the same 32 bytes on disk — the disk cannot tell them apart, so the compiler must. They are distinct types that do not convert implicitly: a function that prunes bags cannot be handed a pool. Signatures are also 32 raw bytes rather than hex strings — half the memory, no parsing per comparison, hex only at the display edges.',
        '',
        `source: ${R}/protocol/src/sig.rs`,
      ].join('\n') },
    ],
  },
  {
    key: norm('lineage-keys'),
    parity: 'ports',
    note: [
      'The address of a place. A bag\'s identity IS its ancestry: bag = sha256(lineageKey(segments)).',
      '',
      'Two paths a person reads as the same place must hash identically or their history and their mesh slot silently fork. Names arrive typed, pasted, shared, AI-written, or from the back button, carrying invisible variation — en-dash for hyphen, non-breaking space, smart quotes, doubled spaces, trailing punctuation. All of it folds away before hashing.',
      '',
      'The symbol-only guard is not optional: a segment that canonicalizes to nothing falls back to its trimmed raw form. Omit it and the first tile named with an emoji writes its history into the ROOT\'s bag.',
    ].join('\n'),
    parts: [
      { key: norm('lineage-key'), platform: 'web', note: `The web implementation, including the legacy raw key kept read-only for bags minted before canonicalization.\n\nsource: ${E}/history/lineage-key.ts` },
      { key: norm('lineage'), platform: 'windows', note: `The native implementation. Same folding, same guard, asserted against 21 vectors.\n\nsource: ${R}/protocol/src/lineage.rs` },
    ],
  },
  {
    key: norm('pools-of-meaning'),
    parity: 'ports',
    note: [
      'Telling a pool apart from a lineage bag, which the storage root cannot do on its own.',
      '',
      'The root is an untagged union of the two, and for a bare-word meaning the preimages are byte-identical — the pool and a same-named tile ARE one directory. Not theory: flattening a colliding address once hard-deleted a pool.',
      '',
      'A colon in the meaning fixes it by construction, because the lineage key folds every non-letter and non-digit to a dash and so can never produce one. The registry is seeded with the full census and self-extending: deriving an address registers it. The bare-word list is frozen and may only shrink.',
    ].join('\n'),
    parts: [
      { key: norm('pool-registry'), platform: 'web', note: `The web registry — seeded census, self-extending on derivation, frozen bare-word list.\n\nsource: ${C}/core/pool-registry.ts` },
      { key: norm('pool'), platform: 'windows', note: `The native registry, with the address types that make the collision unrepresentable rather than merely documented.\n\nsource: ${R}/protocol/src/pool.rs` },
    ],
  },
  {
    key: norm('canonical-layer-form'),
    parity: 'ports',
    note: [
      'The exact bytes hashed into a layer\'s signature.',
      '',
      '`name` first — the layer\'s only intrinsic — then every other field as a slot, sorted alphabetically so byte output never depends on registration or mutation order. `children` is one slot among many with no special position. Empty arrays, empty objects, undefined and null are dropped, which is what keeps layers sparse.',
      '',
      'Change any field and the bytes change, the signature changes, and the cascade runs to the root. Undo restores the bytes and therefore every slot at once.',
    ].join('\n'),
    parts: [
      { key: norm('canonical-layer'), platform: 'web', note: [
        'The web implementation, extracted out of HistoryService so it stands alone as a pure function.',
        '',
        'That extraction was a protocol requirement, not tidiness: the vector generator has to produce ground truth by running the real canonicalizer, and it cannot boot a shell to do it. HistoryService re-exports it; the logic must never be forked back in.',
        '',
        `source: ${E}/history/canonical-layer.ts`,
      ].join('\n') },
      { key: norm('layer'), platform: 'windows', note: `The native implementation. Slots live in an ordered map, so the alphabetical requirement is structural — it cannot be got wrong by forgetting to sort. Child order stays content and is never sorted.\n\nsource: ${R}/protocol/src/layer.rs` },
    ],
  },
  {
    key: norm('markers'),
    parity: 'ports',
    note: [
      'The entries inside a lineage sigbag — zero-padded eight-digit files, the maximum of which IS the head.',
      '',
      'Filenames carry no other meaning. There is no separate head pointer to keep in sync and therefore none to corrupt. A marker is meta: it names which layer a revision points at, while the layer itself is root content. Because the marker IS the revision, versioning, undo and shareability come for free.',
    ].join('\n'),
    parts: [
      { key: norm('history-service'), platform: 'web', note: `The web implementation — marker writing, extraction, and the union-resolve across root and legacy sources where the highest marker wins.\n\nsource: ${E}/history/history.service.ts` },
      { key: norm('marker'), platform: 'windows', note: `The native implementation, parsing both pointer records and legacy inline markers so old bags keep resolving.\n\nsource: ${R}/protocol/src/marker.rs` },
    ],
  },
  {
    key: norm('bee-payloads'),
    parity: 'ports',
    note: [
      'A DIFFERENT canonical rule from layers, and the easiest thing in the protocol to get wrong.',
      '',
      'A payload hashes in INSERTION order; keys are not sorted. An implementation that applies the layer rule here mints a wrong signature for every module in the ecosystem. The two rules never share a helper, deliberately.',
    ].join('\n'),
    parts: [
      { key: norm('visual-bee-registry'), platform: 'web', note: `The web side of payload canonicalization.\n\nsource: ${E}/commands/visual-bee-registry.ts` },
      { key: norm('payload'), platform: 'windows', note: `The native implementation, kept in its own module with its own type so it cannot be confused with the layer form.\n\nsource: ${R}/protocol/src/payload.rs` },
    ],
  },
  {
    key: norm('store'),
    parity: 'ports',
    note: [
      'Content-addressed storage: put bytes, get a signature, resolve a signature back to bytes.',
      '',
      'Writes are idempotent by construction — identical content signs identically, so a repeat write is a no-op and there is no conflict resolution anywhere in the system.',
      '',
      'This is the feature where the two implementations diverge most in HOW while agreeing exactly on WHAT. Both answer the same questions; only the machinery underneath differs.',
    ].join('\n'),
    parts: [
      { key: norm('store-web'), platform: 'web', note: `The OPFS implementation: sig-named files at the root, lineage sigbags, pools of meaning.\n\nsource: ${SH}/store.ts` },
      { key: norm('redb-store'), platform: 'windows', note: [
        'The native implementation: one memory-mapped B-tree, plus loose blob files above a size threshold, fanned out so no directory grows unbounded.',
        '',
        'Content addressing produces enormous numbers of tiny records — measured on the real tree, 603 bags and 8,006 markers of about 77 bytes. Each costs an open/close pair, a filesystem record, a directory entry, and on Windows a trip through the on-access antivirus filter, which is frequently dominant and invisible to an application profiler. The bytes are trivial; the file operations are not.',
        '',
        `source: ${R}/store/src/redb_store.rs`,
      ].join('\n') },
    ],
  },
  {
    key: norm('interchange'),
    parity: 'ports',
    note: [
      'The portable sig-named layout — import, export, backup, and the legacy drain, all one operation with a different source.',
      '',
      'Content inserts if absent, bags union their markers with the highest winning, pools union by member. Idempotent, so a second run imports nothing and overlapping hives merge instead of colliding.',
    ].join('\n'),
    parts: [
      { key: norm('folder-sync-service'), platform: 'web', note: `The web side: the folder backup, its closure walk, the seal, and the import.\n\nsource: ${E}/sharing/folder-sync.service.ts` },
      { key: norm('interchange-native'), platform: 'windows', note: `The native side. Because the internal form is a database, the canonical layout has to be the interchange format — which is what makes the internal representation legal, and a v1 feature rather than a convenience.\n\nsource: ${R}/store/src/interchange.rs` },
    ],
  },
  {
    key: norm('head-index'),
    parity: 'does-not-port',
    note: [
      'THE DEVIATION. This exists on the web and has no native counterpart, and that is correct.',
      '',
      'The head rule is "the maximum marker in the bag". On OPFS that means enumerating a directory — thousands of files, multiple seconds — so the head is cached in persisted storage to avoid paying it. The cache is a workaround for the enumeration, not a feature.',
      '',
      'The native store keys markers by bag plus a big-endian index, so the same question is one B-tree range scan. There is nothing to cache because the lookup was never expensive. The design says it in as many words: DO NOT PORT THE HEAD INDEX.',
      '',
      'An absence that means "the architecture removed the need" is worth more than either implementation beside it — it is the shape of the difference between the two designs, made readable. It is marked does-not-port so nobody ever files it as a gap.',
    ].join('\n'),
    parts: [
      { key: norm('head-index-web'), platform: 'web', note: `The cache, and the flush index that keeps it honest.\n\nsource: ${E}/history/head-index.ts` },
    ],
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

const written: { segments: string[]; note: string; marks: string[] }[] = []

async function ensure(segments: string[], children: string[], note: string, marks: string[]): Promise<void> {
  const path = segments.join('/')
  const have = (await childrenOf(segments)) ?? []
  const merged = [...have, ...children.filter(c => !have.includes(c))]
  process.stdout.write(`[struct] ${path}${merged.length ? ` ← ${merged.length} children` : ''} ... `)
  const res = await sendRetry({
    op: 'update',
    segments,
    layer: merged.length ? { name: segments[segments.length - 1], children: merged } : { name: segments[segments.length - 1] },
  })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) return
  const noted = await sendRetry({ op: 'note-list', segments })
  if (noted.ok && Array.isArray(noted.data) && noted.data.length > 0) console.log(`[struct] ${path} already noted — skip note+marks`)
  else written.push({ segments, note, marks })
}

async function main(): Promise<void> {
  const existing = await childrenOf([ROOT])
  if (existing === null) {
    console.error('[features] ABORT: cannot read "protocol" — is a renderer connected?')
    process.exit(1)
  }
  console.log(`[features] protocol holds: ${existing.join(', ')}`)

  // Phase 1 — feature cells at the shared coordinates, each holding both
  // implementations as parts.
  const featureKeys = FEATURES.map(f => f.key)
  const keep = existing.filter(c => c !== STALE_CHILD)
  const merged = [...keep, ...featureKeys.filter(k => !keep.includes(k))]
  process.stdout.write(`[struct] ${ROOT} ← ${merged.length} children (−${STALE_CHILD}) ... `)
  const up = await sendRetry({ op: 'update', segments: [ROOT], layer: { name: ROOT, children: merged } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const f of FEATURES) {
    await ensure([ROOT, f.key], f.parts.map(p => p.key), f.note, ['protocol', f.parity])
    for (const p of f.parts) await ensure([ROOT, f.key, p.key], [], p.note, ['part', p.platform])
  }

  // Phase 2 — notes.
  let okNotes = 0, failNotes = 0
  for (let i = 0; i < written.length; i++) {
    const w = written[i]
    process.stdout.write(`[note ${i + 1}/${written.length}] ${w.segments.join('/')} ... `)
    const res = await sendRetry(
      { op: 'note-add', segments: w.segments.slice(0, -1), cell: w.segments[w.segments.length - 1], text: w.note },
      async () => {
        const check = await send({ op: 'note-list', segments: w.segments })
        return check.ok && Array.isArray(check.data) && check.data.some((x: any) => (x?.text ?? x?.note) === w.note)
      },
    )
    if (res.ok) { okNotes++; console.log('ok') } else { failNotes++; console.log(`FAIL: ${res.error}`) }
  }

  // Phase 3 — marks. Platform on the parts, parity on the features.
  let okMarks = 0, failMarks = 0
  for (const w of written) {
    for (const mark of w.marks) {
      process.stdout.write(`[mark] ${w.segments.join('/')} ← ${mark} ... `)
      const res = await sendRetry(
        { op: 'decoration-add', segments: w.segments, kind: 'tag', appliesTo: [], payload: { name: mark } },
        async () => {
          const check = await send({ op: 'layer-at', segments: w.segments })
          const decs = (check.data?.decorations ?? []) as string[]
          return check.ok && decs.includes(decorationSig(mark))
        },
      )
      if (res.ok) { okMarks++; console.log('ok') } else { failMarks++; console.log(`FAIL: ${res.error}`) }
    }
  }

  // Phase 4 — declare the vocabulary.
  if (written.length) {
    for (const [word, color] of VOCAB) {
      process.stdout.write(`[features] vocabulary: ${word}(${color}) ... `)
      const reg = await send({ op: 'submit', text: `/keyword [${word}(${color})]` })
      console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
    }
    await send({ op: 'submit', text: '' })
  }

  console.log(`[features] DONE — ${written.length} cells, ${okNotes} notes, ${okMarks} marks; ${STALE_CHILD} dropped from ${ROOT}`)
  const failed = failNotes + failMarks
  if (failed > 0) console.warn(`[features] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
