// Mirror pass for THE PROTOCOL and its second implementation.
//
// The work being mirrored: the conformance specification, the vector generator
// that produces machine-checkable ground truth by EXECUTING the live TypeScript
// implementation, the extraction of the canonical layer form into a pure module
// so that generator can import it without booting a shell, and the Rust client
// crates (`protocol`, `store`) that are the first independent implementation.
//
// It is mirrored at the ROOT, not under `behaviors`, because it is not a
// behaviour: nothing here is a slash command or a surface. It is the contract
// two implementations meet at, plus one of the implementations.
//
// Structure — 1:1 with the source resources:
//
//   protocol/
//     conformance            documentation/protocol/conformance.md
//     client-design          documentation/protocol/client-design.md
//     vector-generator       hypercomb-net/conformance/generate-vectors.ts
//     vectors                hypercomb-net/conformance/vectors.json
//     canonical-layer        …/history/canonical-layer.ts
//     native-client/
//       protocol-crate/      sig, lineage, pool, layer, marker, payload, conformance-test
//       store-crate/         redb-store, interchange, store-test, scale-test
//
// Merge mode + idempotent: children are unioned, and a cell that already
// carries a note is left alone (note-add and decoration-add are not
// idempotent, so a re-run must not stack duplicates).

import { createHash } from 'node:crypto'
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

// A timeout does NOT mean the op failed — the response may simply be lost
// behind an optimize pass. Idempotent ops retry; the rest verify first.
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

const DOC = 'documentation/protocol'
const NET = 'hypercomb-net/conformance'
const CLIENT = 'hypercomb-client'
const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'

const PART_KEYWORD = 'part'
const PART_COLOR = '#7d8471'
const PROTOCOL_KEYWORD = 'protocol'
const PROTOCOL_COLOR = '#4f7d8b'

interface Cell {
  key: string
  note: string
  marks: string[]
  children?: Cell[]
}

const ROOT: Cell = {
  key: norm('protocol'),
  marks: [PROTOCOL_KEYWORD],
  note: [
    'The contract two implementations meet at — and the first one that is not the web shell.',
    '',
    'The TypeScript shell used to be the only participant, so "the protocol" was whatever the code happened to do. It is not the only participant any more, and an unwritten contract between two implementations is a merkle fork waiting to happen: mint one signature differently and the two trees stop being the same tree, silently, with no error anywhere.',
    '',
    'Two implementations meet at exactly THREE places — signatures, storage layout, and mesh events. Everything else (EffectBus, IoC keys, Angular signals, Pixi, OPFS handles) is shell-local by design and deliberately NOT shared. If a second implementation ever needs to know what `window.ioc` is, the boundary has leaked.',
    '',
    'The contract is not asserted in prose alone. Every rule has machine-checkable vectors, and those vectors are GENERATED BY EXECUTING THE LIVE TYPESCRIPT — never transcribed. That inverts who catches the drift: change the TS canonicalizer and regenerating the vectors makes the other implementation fail loudly, instead of the two forking quietly for months.',
    '',
    `source: ${DOC}/conformance.md, ${DOC}/client-design.md, ${NET}/, ${CLIENT}/`,
  ].join('\n'),
  children: [
    {
      key: norm('conformance'),
      marks: [PART_KEYWORD],
      note: [
        'The specification. What a conforming implementation MUST reproduce, byte for byte.',
        '',
        'Signatures are SHA-256 of the content bytes, lowercase hex, 64 characters — no salt, no prefix, no length framing, no domain separation. Text is UTF-8. Unicode normalization is NOT applied when signing: `sign()` hashes exactly the bytes it is handed, and NFC happens upstream in lineage-key canonicalization and nowhere else. So a composed and a decomposed cafe are DIFFERENT signatures but the SAME lineage bag, and the vectors assert both halves — getting it backwards forks either content identity or a participant\'s history.',
        '',
        'The root signs as empty, and that collision is load-bearing: the empty hash is both the signature of zero bytes and the root bag address, because the root\'s lineage key is the empty string. Code that walks the root must never read it as "nothing".',
        '',
        'It also writes down the two rules that are easiest to get wrong: `children` is just a slot with no positional special-casing, and bee payloads canonicalize in INSERTION order while layers canonicalize in SORTED order. Two different rules that must never share a helper.',
        '',
        `source: ${DOC}/conformance.md`,
      ].join('\n'),
    },
    {
      key: norm('client-design'),
      marks: [PART_KEYWORD],
      note: [
        'The design for a native window on your own hive, and the reasoning behind the two crates that exist so far.',
        '',
        'Scope of the pass: only what carries no product risk and is provable against the vectors — the pure protocol and the store. Mesh, platform, app shell, games, websites, AI are all deferred, each layering on later without revisiting anything here.',
        '',
        'The design also fixes a bug class rather than an instance. The TypeScript tree addresses everything as a bare 64-hex string, so a pool address and a bag address are indistinguishable — which is how `/flatten` once hard-deleted a whole pool. Typed newtypes that do not convert into one another turn that from a discipline problem into a compile error.',
        '',
        `source: ${DOC}/client-design.md`,
      ].join('\n'),
    },
    {
      key: norm('vector-generator'),
      marks: [PART_KEYWORD],
      note: [
        'Ground truth, produced by running the real implementation.',
        '',
        'It imports the live lineage-key canonicalizer, the live canonical layer form and the live pool registry, and writes what they actually return. Nothing here is a transcription of the spec — a transcription would agree with the prose and disagree with the code, which is precisely the failure it exists to prevent.',
        '',
        'Its output is committed, and regenerating it IS a protocol change: a diff in this file means the two implementations no longer agree, and it must be reviewed as one.',
        '',
        `source: ${NET}/generate-vectors.ts`,
      ].join('\n'),
    },
    {
      key: norm('vectors'),
      marks: [PART_KEYWORD],
      note: [
        'The vectors themselves: 71 cases across six groups — 11 signatures, 21 lineage keys, 27 pool addresses, 10 layers, 1 marker, 1 bee payload.',
        '',
        'The pool group is the largest for a reason. A pool address is sign(meaning) and a bag address is sign(lineageKey(segments)), and for a bare word those two preimages are byte-identical — the same directory. Every bare-word meaning still in use is pinned here, so nothing can quietly acquire a new one.',
        '',
        'Two copies of this file currently exist, one under hypercomb-net and one under hypercomb-client, byte-identical. The documents name the hypercomb-net path as authoritative.',
        '',
        `source: ${NET}/vectors.json`,
      ].join('\n'),
    },
    {
      key: norm('canonical-layer'),
      marks: [PART_KEYWORD],
      note: [
        'The exact bytes that get hashed into a layer\'s signature — lifted out of the history service so it stands alone.',
        '',
        'It was a static method on HistoryService, which meant reaching it required booting a shell: IoC, EffectBus, a browser. That was fine while there was one implementation. It stops being fine the moment a vector generator has to import the canonical form to produce ground truth from it, so the pure function moved into its own module and the service now RE-EXPORTS it. Every existing call site is unchanged, and the logic must never be forked back in.',
        '',
        'The form itself: `name` first — the layer\'s only intrinsic — then every other field as a slot, sorted alphabetically so byte output does not depend on registration or mutation order. `children` is one slot among many, with no special position. Empty arrays, empty objects, undefined and null are dropped, which is what keeps layers sparse.',
        '',
        `source: ${E}/history/canonical-layer.ts, ${E}/history/history.service.ts`,
      ].join('\n'),
    },
    {
      key: norm('native-client'),
      marks: [PROTOCOL_KEYWORD],
      note: [
        'The first implementation that is not the web shell: a native client in Rust, built inward.',
        '',
        'One dependency rule, the same shape as modules-depend-only-on-core: `protocol` depends on nothing, everything depends inward, and the operating system is named in exactly one place that neither `protocol` nor `store` may import. Windows is the first target, not the only one.',
        '',
        'Only the two crates that are provable against the vectors exist so far. Mesh, platform and the app shell are deferred on purpose — they carry product risk, and nothing above the store can be proven by a vector.',
        '',
        `source: ${CLIENT}/`,
      ].join('\n'),
      children: [
        {
          key: norm('protocol-crate'),
          marks: [PROTOCOL_KEYWORD],
          note: [
            'Bytes in, signatures out. Pure: no filesystem, no network, no clock, no globals.',
            '',
            'The purity is not tidiness — it is what makes the crate testable against the vectors and compilable to wasm32, so the web shell can eventually adopt this implementation instead of maintaining a parallel one.',
            '',
            'Its signatures are TYPED. A bag address and a pool address are indistinguishable on disk, so here they are distinct types that do not convert implicitly: a function that prunes bags cannot be handed a pool address. Signatures are also 32 raw bytes rather than hex strings — half the memory, no parsing per comparison, and hex only at the display edges.',
            '',
            `source: ${CLIENT}/crates/protocol/`,
          ].join('\n'),
          children: [
            {
              key: norm('sig'),
              marks: [PART_KEYWORD],
              note: [
                'The signature primitive, and the four types built on it.',
                '',
                'A plain content signature, a signature known to address a layer, a bag address and a pool address. They are separate types precisely because they are the same 32 bytes on disk — the disk cannot tell them apart, so the compiler must.',
                '',
                `source: ${CLIENT}/crates/protocol/src/sig.rs`,
              ].join('\n'),
            },
            {
              key: norm('lineage'),
              marks: [PART_KEYWORD],
              note: [
                'The address of a place: bag = sha256(lineage key of the segments).',
                '',
                'Two paths a person reads as the same place must hash identically or their history and their mesh slot silently fork. Names arrive typed, pasted, shared, AI-written, or from the back button, carrying invisible variation — en-dash for hyphen, non-breaking space, smart quotes, doubled spaces, trailing punctuation. All of it is folded away BEFORE hashing.',
                '',
                'The symbol-only guard is not optional: a segment that canonicalizes to nothing falls back to its trimmed raw form. Omit it and the first tile named with an emoji writes its history into the ROOT\'s bag.',
                '',
                `source: ${CLIENT}/crates/protocol/src/lineage.rs`,
              ].join('\n'),
            },
            {
              key: norm('pool'),
              marks: [PART_KEYWORD],
              note: [
                'Telling a pool of meaning apart from a lineage bag, which the storage root cannot do on its own.',
                '',
                'The root is an untagged union of the two, and for a bare-word meaning the preimages are byte-identical — the pool and a tile of that name ARE the same directory. That is not theory: flattening a colliding address once hard-deleted a pool.',
                '',
                'A colon in the meaning fixes it by construction, because the lineage key folds every non-letter and non-digit to a dash and so can never produce one. The registry is seeded with the full census and self-extending; deriving an address registers it. The bare-word list is frozen and may only shrink.',
                '',
                `source: ${CLIENT}/crates/protocol/src/pool.rs`,
              ].join('\n'),
            },
            {
              key: norm('layer'),
              marks: [PART_KEYWORD],
              note: [
                'The unit of mutation and its canonical byte form.',
                '',
                'Change any field and the bytes change, the signature changes, and the cascade propagates to the root. Undo restores the layer\'s bytes, and therefore restores every slot at once.',
                '',
                'Slots are held in an ordered map, so the required alphabetical ordering is structural — the canonical form cannot be got wrong by forgetting to sort. Child order, by contrast, is CONTENT and is never sorted.',
                '',
                `source: ${CLIENT}/crates/protocol/src/layer.rs`,
              ].join('\n'),
            },
            {
              key: norm('marker'),
              marks: [PART_KEYWORD],
              note: [
                'The entries inside a lineage sigbag — zero-padded eight-digit files, the maximum of which IS the head.',
                '',
                'Filenames carry no other meaning. There is no separate head pointer to keep in sync, and therefore none to corrupt. A marker is meta: it names which layer a revision points at, while the layer itself is root content. Because the marker IS the revision, versioning, undo and shareability come for free.',
                '',
                'Legacy inline markers are still parsed, so old bags keep resolving.',
                '',
                `source: ${CLIENT}/crates/protocol/src/marker.rs`,
              ].join('\n'),
            },
            {
              key: norm('payload'),
              marks: [PART_KEYWORD],
              note: [
                'Bee payloads — a DIFFERENT canonical rule, kept in a separate module so it cannot be confused with the layer rule.',
                '',
                'A payload hashes in INSERTION order; keys are not sorted. An implementation that applies the layer rule here mints a wrong signature for every module in the ecosystem. The two rules never share a helper, on purpose.',
                '',
                `source: ${CLIENT}/crates/protocol/src/payload.rs`,
              ].join('\n'),
            },
            {
              key: norm('conformance-test'),
              marks: [PART_KEYWORD],
              note: [
                'The crate\'s definition of done: one integration test that reads the vectors and asserts every entry.',
                '',
                'It is not a test suite someone writes to feel covered — it is the boundary itself, executable. All vectors green is the gate the store was not allowed to begin before.',
                '',
                `source: ${CLIENT}/crates/protocol/tests/conformance.rs`,
              ].join('\n'),
            },
          ],
        },
        {
          key: norm('store-crate'),
          marks: [PROTOCOL_KEYWORD],
          note: [
            'Content-addressed storage that stops paying per-record file costs.',
            '',
            'Content addressing produces enormous numbers of tiny records — measured on the real tree, 603 bags and 8,006 markers of about 77 bytes each. Every one of them costs an open/close pair, a filesystem record, a directory entry, and on Windows a trip through the on-access antivirus filter, which is frequently the dominant cost and is invisible to an application profiler. That is much of why a cold scan takes 13.6 seconds. The bytes are trivial; the FILE OPERATIONS are not.',
            '',
            'Meanwhile the whole navigable structure of a hive is a few megabytes, so it should simply be resident — and a memory-mapped file already IS memory, with the kernel\'s page cache doing the work. Images are the only genuinely large content, and they are exactly what should not be resident, so they stay loose files above a threshold.',
            '',
            'One trait, two implementations later: the native backend now, and an OPFS backend if the web shell adopts the wasm core — a swap at a seam that already exists, because the shell\'s store is already an interface behind IoC.',
            '',
            `source: ${CLIENT}/crates/store/`,
          ].join('\n'),
          children: [
            {
              key: norm('redb-store'),
              marks: [PART_KEYWORD],
              note: [
                'The native backend: one memory-mapped B-tree file, plus loose blob files fanned out so no directory grows unbounded.',
                '',
                'Markers are keyed by bag plus a big-endian index, which turns "the maximum marker is the head" into a single range scan — and that DELETES a workaround rather than optimizing one. The shell\'s persisted head-index cache exists purely to avoid a multi-second bag enumeration; here there is nothing to cache, because the lookup was never expensive. Boot performs no scan at all.',
                '',
                'Writes are idempotent by construction: identical content signs identically, so a repeat write is a no-op and there is no conflict resolution anywhere.',
                '',
                `source: ${CLIENT}/crates/store/src/redb_store.rs`,
              ].join('\n'),
            },
            {
              key: norm('interchange'),
              marks: [PART_KEYWORD],
              note: [
                'Restore and export — the portable, sig-named layout that makes an internal representation legal.',
                '',
                'Because the on-disk form here is a database rather than the canonical layout, the canonical layout has to be the import/export format, which makes it a v1 feature rather than a convenience. It is also the backup format, and it is exactly what the web shell writes: a hive exported here is readable there and the other way round.',
                '',
                'Restore is the legacy drain GENERALIZED to an arbitrary source directory. Content inserts if absent, bags union their markers with the highest winning, pools union by member. Idempotent, so a second run imports nothing and overlapping hives merge instead of colliding — one code path for restore, legacy drain and backup ingest.',
                '',
                `source: ${CLIENT}/crates/store/src/interchange.rs`,
              ].join('\n'),
            },
            {
              key: norm('store-test'),
              marks: [PART_KEYWORD],
              note: [
                'Behavioural tests for the store: put and get, head lookup, marker append, pool membership, and the interchange round trip.',
                '',
                `source: ${CLIENT}/crates/store/tests/store.rs`,
              ].join('\n'),
            },
            {
              key: norm('scale-test'),
              marks: [PART_KEYWORD],
              note: [
                'The claim, measured. The point of the whole storage design is a cold open that does no scan, so the number that matters is asserted rather than asserted-about.',
                '',
                `source: ${CLIENT}/crates/store/tests/scale.rs`,
              ].join('\n'),
            },
          ],
        },
      ],
    },
  ],
}

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

const created: { segments: string[]; cell: Cell }[] = []

async function ensure(cell: Cell, parent: string[]): Promise<void> {
  const segments = [...parent, cell.key]
  const path = segments.join('/')
  const wanted = (cell.children ?? []).map(c => c.key)
  const have = (await childrenOf(segments)) ?? []
  const merged = [...have, ...wanted.filter(w => !have.includes(w))]

  process.stdout.write(`[struct] ${path}${merged.length ? ` ← ${merged.length} children` : ''} ... `)
  const res = await sendRetry({
    op: 'update',
    segments,
    layer: merged.length ? { name: cell.key, children: merged } : { name: cell.key },
  })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) return

  // A cell that already carries a note was written by a prior run. note-add
  // and decoration-add are not idempotent, so skip both rather than stack.
  const noted = await sendRetry({ op: 'note-list', segments })
  if (noted.ok && Array.isArray(noted.data) && noted.data.length > 0) console.log(`[struct] ${path} already noted — skip note+marks`)
  else created.push({ segments, cell })

  for (const child of cell.children ?? []) await ensure(child, segments)
}

async function main(): Promise<void> {
  // Preflight against a cell known to exist. `protocol` itself may legitimately
  // be absent on a first run, so its own read says nothing about the bridge.
  const live = await childrenOf([norm('behaviors')])
  if (live === null || live.length === 0) {
    console.error('[protocol] ABORT: the bridge has no renderer. Open the hive with the bridge worker connected.')
    process.exit(1)
  }
  const probe = await childrenOf([ROOT.key])
  console.log(`[protocol] existing "${ROOT.key}" holds: ${probe?.length ? probe.join(', ') : '(nothing — new mirror)'}`)

  await ensure(ROOT, [])

  let okNotes = 0, failNotes = 0
  for (let i = 0; i < created.length; i++) {
    const { segments, cell } = created[i]
    process.stdout.write(`[note ${i + 1}/${created.length}] ${segments.join('/')} ... `)
    const res = await sendRetry(
      { op: 'note-add', segments: segments.slice(0, -1), cell: cell.key, text: cell.note },
      async () => {
        const check = await send({ op: 'note-list', segments })
        return check.ok && Array.isArray(check.data) && check.data.some((x: any) => (x?.text ?? x?.note) === cell.note)
      },
    )
    if (res.ok) { okNotes++; console.log('ok') } else { failNotes++; console.log(`FAIL: ${res.error}`) }
  }

  let okMarks = 0, failMarks = 0
  for (const { segments, cell } of created) {
    for (const mark of cell.marks) {
      process.stdout.write(`[mark] ${segments.join('/')} ← ${mark} ... `)
      const res = await sendRetry(
        { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name: mark } },
        async () => {
          const check = await send({ op: 'layer-at', segments })
          const decs = (check.data?.decorations ?? []) as string[]
          return check.ok && decs.includes(decorationSig(mark))
        },
      )
      if (res.ok) { okMarks++; console.log('ok') } else { failMarks++; console.log(`FAIL: ${res.error}`) }
    }
  }

  // Declare the vocabulary in the registry — never mint a keyword on the fly.
  if (created.length) {
    for (const [word, color] of [[PART_KEYWORD, PART_COLOR], [PROTOCOL_KEYWORD, PROTOCOL_COLOR]]) {
      process.stdout.write(`[protocol] registering vocabulary: ${word}(${color}) ... `)
      const reg = await send({ op: 'submit', text: `/keyword [${word}(${color})]` })
      console.log(reg.ok ? 'ok' : `FAIL: ${reg.error}`)
    }
    await send({ op: 'submit', text: '' })
  }

  console.log(`[protocol] DONE — ${created.length} cells written, ${okNotes} notes, ${okMarks} marks`)
  const failed = failNotes + failMarks
  if (failed > 0) console.warn(`[protocol] ${failed} operations failed — review the log above.`)
}

main().catch(err => { console.error(err); process.exit(1) })
