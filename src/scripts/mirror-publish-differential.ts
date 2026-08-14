// Mirror pass for the PUBLISH DIFFERENTIAL — `/publish`, the state half of
// sharing, next to `/host`, the gesture half.
//
// Extends the existing `behaviors` mirror (mirror-behaviors.ts built the
// collections; mirror-behavior-parts.ts spread implementation files as `part`
// cells) — it never re-runs them. This pass adds ONE behaviour tile under the
// `swarm` collection, one child cell per source resource the creation actually
// lives in, and a note on the SIBLING `/host` tile recording that the publish
// sequence moved out of that queen:
//
//   behaviors/swarm/publish                the behaviour (1:1 with publish.queen.ts)
//     ├── publish-verdict                  the pure verdict ladder
//     ├── publish-verdict-spec             fourteen ways the panel could lie
//     ├── publish-heads                    the ledger + the `publish:heads` pool
//     ├── publish-branch                   the routine, the wipe guard, unpublish
//     ├── publish-branch-spec              eight tests pinning the wipe guard
//     ├── publish-status-drone             the read model
//     ├── publish-panel                    the docked window (shared UI)
//     ├── hive-pointer                     MODIFIED — the read reports WHY
//     └── host-sync-service                MODIFIED — served/gaps/any-receipt
//
// VOCABULARY — declared, never minted on the fly. Everything here already
// exists: `behavior` + `swarm` on the behaviour tile (the collection's
// keywords ARE its parameters — painting them is what makes a member), `part`
// on every implementation cell, and `window` additionally on `publish-panel`,
// which is how the `tool-windows` collection gathers a window that already
// lives somewhere else (mirror-window-chrome.ts). No `/keyword` registration
// is sent: no new word, no new colour, nothing to register.
//
// NOT MARKED, deliberately: the `publish:heads` pool of meaning. There is no
// declared keyword for a pool, and minting one here would be exactly the
// on-the-fly vocabulary the paradigm forbids — so the pool is described in
// the `publish-heads` note instead, where it can say what it holds and why it
// is truth rather than a derived cache.
//
// SAFE TO INSPECT: `--dry-run` prints the entire plan — every cell, every note
// verbatim, every mark — and never opens a socket.
//
// IDEMPOTENT: children union into what is there; a note is written only when
// `note-list` does not already carry that exact text; a mark only when
// `layer-at` does not already carry that decoration's signature. A second run
// writes nothing, so this pass is safe for the unattended idle drain.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
// Afterwards mint the deck card: `node scripts/behaviors-theme/sweep.cjs`
// (the `publish` glyph is declared in scripts/behaviors-theme/gen-behavior-tiles.mjs).

import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
// A commit can legitimately take minutes in a background renderer mid-optimize.
const TIMEOUT = 180_000

const DRY_RUN = process.argv.includes('--dry-run')

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mirror-${Date.now()}-${++counter}` }
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
  if (DRY_RUN) throw new Error('dry run must never reach the bridge')
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

/** Retry a lost response. Non-idempotent ops pass `landed` so a swallowed reply
 *  is never mistaken for a failed write and re-applied as a duplicate. */
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

// ── vocabulary (all pre-existing) ───────────────────────────────────
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'swarm'
const PART_KEYWORD = 'part'
const WINDOW_KEYWORD = 'window'

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('swarm')
const BEHAVIOR = norm('publish')
/** The sibling gesture — it gets a note, never a rewrite. */
const SIBLING = norm('host')

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const S = 'hypercomb-shared'

// ── the creation ────────────────────────────────────────────────────

const BEHAVIOR_NOTES: string[] = [
  [
    '/publish — what the world is serving right now, next to what has changed here since. One row per publishable branch, in the grammar of the enablement roster: a name, a state light, a reason, one action.',
    '',
    'A row is a comparison of THREE signatures, and it takes three rather than two because two cannot tell "behind" from "cannot see". LIVE: the head named by the publisher-signed hive index, schnorr-verified against our own pubkey — what a visitor would resolve this second. HERE: what sealing the branch would produce now — what publishing would advance to. MINE: the ledger record of our last index advance — which head we put there, when, and under which index stamp.',
    '',
    '/host is the GESTURE (publish the branch I am standing in, hand me a link); /publish is the STATE. Keeping them separate keeps each honest: a gesture that also reported status would have to guess, and a status surface that also published would hide which branch it acted on. Both now drive the SAME routine, so the two surfaces cannot drift into publishing differently.',
    '',
    `source: ${E}/sharing/publish.queen.ts`,
  ].join('\n'),
  [
    'THE DISCIPLINE, which is most of the value: this surface never claims more than it can prove.',
    '',
    '• Only a 404 asserts absence. Offline, CORS, 5xx and the local breaker all resolve to `unknown`, which renders as the last observation with its age — never as a red light.',
    '• `sealSubtree` returning null means a child is cold. That is CANNOT-COMPARE, never "different". Collapsing the two would invent drift out of an unvisited tile.',
    '• A schnorr check proves an index is OURS; it never proves it is the LATEST. An index stamped older than one we ourselves signed is `stale-edge` — authentic and wrong, the one case a cached 200 can still lie about.',
    '• A signature that does NOT verify is not an outage. It is a host serving something that is not ours, and it is stated loudly, once, at panel level — never as nine red rows.',
    '• Matching heads with an unprovable service verdict is not green. `unknown` service is not proof of service, so it does not earn the light.',
  ].join('\n'),
  [
    'TWO SAFETIES ship with it.',
    '',
    'THE WIPE GUARD. The hive index is the one mutable object in static hosting and it is REPLACEABLE, not mergeable: every PUT carries the complete lineageKey → head map, so advancing one branch rewrites all of them. The old path read the live index and fell back to an empty map on failure — and the fetch helper collapsed every failure to null — so one flaky GET published an index containing only the branch in hand, silently unpublishing every other branch ever shared. A rewrite now requires either a VERIFIED read or an explicit 404 (nothing published yet); anything else refuses and leaves the index untouched. Refusing costs a retry. Guessing costs every link already handed out.',
    '',
    'THE CONFIRMATION. A PUT that returns 200 proves the host accepted an index, not that the world can see it. The routine re-reads the index with no-store until it names our head, then probes that the head bytes are actually served. Only then is it `confirmed`: a caller may render "published" on `unconfirmed`, but never "live".',
    '',
    'And unpublishing states its honest limit every single time. Removing the index entry stops a branch being ADVERTISED and stops it tracking future changes. It is not deletion: content-addressed bytes stay hosted, and a link already shared carries a cold head hint, so it keeps resolving. It does not un-share what was shared.',
  ].join('\n'),
]

interface Part {
  /** Cell name — pre-normalized, 1:1 with one source resource. */
  key: string
  note: string
  /** Marks beyond `part`. */
  extraMarks?: string[]
}

const PARTS: Part[] = [
  {
    key: norm('publish-verdict'),
    note: [
      'publish-verdict.ts — the verdict ladder: three signatures and a probe in, one row state out.',
      '',
      'Pure, and separate from the drone on purpose. This is the honesty of the whole publish surface compressed into one function, and it is the thing most worth pinning with tests. Every rung ABOVE `drift` is a reason the comparison ITSELF cannot be trusted, and each must win over it — a panel that reports "changed here" when it actually means "I could not look" is worse than one that says nothing at all.',
      '',
      'The order is the argument: an index that could not be believed → nothing published (only for a branch we could actually publish) → authentic but superseded (stale-edge) → the host ASSERTED 404 (gone) → we published a head the index still does not name, recently (pending) → no local path to seal → a cold child, so we could not see our own side (cannot-compare) → the heads differ (drift) → and `live` only when the heads match AND the bytes are proven served.',
      '',
      `source: ${E}/sharing/publish-verdict.ts`,
    ].join('\n'),
  },
  {
    key: norm('publish-verdict-spec'),
    note: [
      'publish-verdict.spec.ts — fourteen cases, each one a way the panel could LIE, pinned so it cannot start lying again.',
      '',
      'The ladder exists to keep apart three things that all look like "not live": the world is behind (drift), the world asserted nothing (unknown), and we could not look at our own side (cannot-compare). The tests inject `now`, so the recent-publish window is exercised rather than waited on.',
      '',
      `source: ${E}/sharing/publish-verdict.spec.ts`,
    ].join('\n'),
  },
  {
    key: norm('publish-heads'),
    note: [
      'publish-heads.ts — the publish ledger: what this participant has put into the world, and what they last saw of it. Owner of the `publish:heads` pool of meaning.',
      '',
      'The publisher\'s own memory is load-bearing in two separate ways. SAFETY: to advance one branch you must rewrite the whole index map, so the ledger is the independent record that lets a write refuse when the read-back fails — a floor, never a ceiling (it cannot know about a branch published from another device, which is exactly why a failed read-back must REFUSE rather than fall back to it). HONESTY: a schnorr signature proves an index IS the publisher\'s, never that it is the LATEST, so the only way to catch an edge serving a superseded index is to compare its stamp against one we ourselves signed — which means writing that stamp down at publish time.',
      '',
      'TRUTH, NOT A DERIVED CACHE. "I advanced the index to head X at time T" is the record of a remote act; no cold client could rebuild it by walking layers, so by the optimize-phase litmus it is state, it gets its own pool, and it is never minted from optimize() nor written from the commit path. The meaning carries a colon — `publish:heads` — as every new pool meaning must: a bare word shares the flat root namespace with lineage sigbags and would collide with any location whose slug matched it.',
      '',
      'Two member shapes share the pool: `{sealedSig}` is a publish record (truth, immutable — a later publish mints a new head and therefore a new member), and `{sealedSig}.{hostHash}.seen` is an observation (never load-bearing; the sidecar deliberately fails the record pattern so listing records never surfaces one, and deleting every sidecar loses nothing but the "as of" line an offline panel shows). It also names the collisions honestly: distinct paths that fold to the same index key can only have one of them served, so the panel says so rather than showing two green rows.',
      '',
      `source: ${E}/sharing/publish-heads.ts`,
    ].join('\n'),
  },
  {
    key: norm('publish-branch'),
    note: [
      'publish-branch.ts — the publish routine: one branch, from local head to a link anyone can open.',
      '',
      'Extracted from the /host queen so the queen and the panel drive the SAME sequence. There is exactly one implementation of "put a branch into the world", and it is this: mark public → seal from live heads (heal once, retry, then fail loud — never publish a lossy seal) → stage and drain → THE AVAILABILITY GATE, so the index only ever names a head that is actually served → the wipe guard → the index PUT → the link bundle → the ledger record → the confirmation round trip.',
      '',
      'The ledger record is written BEFORE confirming, on purpose: the PUT has already happened, so if the tab closes during confirmation the act still has to be on record — otherwise the next publish loses its freshness baseline and the wipe guard loses its evidence. Anything our ledger knows about that the live index does not carry is REPORTED, never silently re-asserted: resurrecting a branch the participant deliberately took down would be its own kind of lie.',
      '',
      'It also owns unpublishBranch — the counterpart that `setBranchPublic(false)` never was. Un-marking a branch locally left its index entry standing, so the world kept being handed a head the participant thought they had withdrawn. The same guard applies to the removal: a rewrite we cannot base on a verified read is a rewrite that drops everything we cannot see.',
      '',
      `source: ${E}/sharing/publish-branch.ts`,
    ].join('\n'),
  },
  {
    key: norm('publish-branch-spec'),
    note: [
      'publish-branch.spec.ts — eight tests over THE INDEX WIPE GUARD.',
      '',
      'They pin the rule that replaced the bug: a rewrite requires either a verified read of the existing index or an explicit 404, and a refusal must leave the index untouched — no PUT at all. The fake host behaves (once something has been PUT, reads return it), which is what lets the confirmation round trip terminate and means the success cases exercise the real confirm path instead of mocking it away.',
      '',
      `source: ${E}/sharing/publish-branch.spec.ts`,
    ].join('\n'),
  },
  {
    key: norm('publish-status-drone'),
    note: [
      'publish-status.drone.ts — the read model behind the panel: candidates, one index read, a verdict per row, and the actions.',
      '',
      'Rows are gathered from three places and folded into one key space: everything we published (the ledger), everything marked public here (paths, folded through lineageKey), and everything the live index names. An index entry with no record and no local mark was published from another device — the key cannot be inverted into a path, so the row can be compared but not re-sealed, and the action says exactly that rather than failing oddly.',
      '',
      'ONE index read answers every row (the branches share a publisher). Rows paint immediately as `comparing` and fill in progressively, because sealing is the only expensive step and it must not hold the panel shut; the sweep is serial with a yield between rows, since sealSubtree re-walks live heads after a commit and running N of those at once is how a status panel becomes a stall. A commit burst is coalesced by a debounce rather than restarting the sweep per commit. Gap enumeration reads local bytes across a closure, so it is opt-in per expanded row and capped: "at least this many holes" is enough to refuse a green light.',
      '',
      'Shell parity: the panel is a shared Angular component and must not import essentials, so everything crosses as `publish:render` payloads and comes back as intents (publish:run, publish:unpublish, publish:expand, publish:copy-link, publish:refresh, publish:close).',
      '',
      `source: ${E}/sharing/publish-status.drone.ts`,
    ].join('\n'),
  },
  {
    key: norm('publish-panel'),
    extraMarks: [WINDOW_KEYWORD],
    note: [
      'publish-panel.component.ts — the face: a right-docked, read-only tool window. Registry-fed, mounted by <hc-shell-surfaces> and never by an app.html tag, at order 145 — between Observe and the clipboard panel, both read-only status windows.',
      '',
      'It inherits the drone\'s discipline and must not undo it in the rendering. `unknown` and `cannot-compare` are QUIET: dim light, grey text, an "as of" age — never a red light, never the word error, because nothing was asserted. `gone` is the only 404-backed absence. `forged` — a host serving an index that is not ours — is the one loud banner in the panel. And `comparing` rows sit in a LEADING, unlabelled block rather than under "Live" or "Changed here": filing a verdict that has not landed yet would invent a difference (or a confirmation) out of a computation still running.',
      '',
      'One action per row, never a bulk selection bar — bulk selection is pointer-only and dies on a phone, where this panel becomes a bottom sheet. Unpublish lives inside the row\'s expansion, under its honest limit stated in full.',
      '',
      'Marked `window` as well as `part`: the tool-windows collection gathers windows by MARK wherever they live, rather than duplicating them as tiles of its own.',
      '',
      `source: ${S}/ui/publish-panel/publish-panel.component.ts`,
    ].join('\n'),
  },
  {
    key: norm('hive-pointer'),
    note: [
      'hive-pointer.ts — CHANGED FOR THIS WORK. The index read now reports WHY, and the index write now returns its stamp.',
      '',
      'fetchHiveIndex distinguishes unreachable / http+status / malformed / forged, where fetchHiveManifest collapsed all of them to null. That collapse was the other half of the wipe bug: a caller could not tell "nothing published yet" (404 — an empty map is the TRUTH there, and the only sanctioned path to one) from "I could not see" (never a basis for a rewrite). A status surface needs the same distinction in the other direction: render `forged` loudly, render `unreachable` as silence.',
      '',
      'putHiveManifest returns the signed event\'s created_at, read back off the SIGNED event rather than our own clock — a NIP-07 extension signs an event it composed, and the freshness compare is only meaningful against the value the host will actually serve. That number is the baseline the stale-edge rung compares against; discarding it was why an authentic-but-superseded index could not be detected.',
      '',
      'Shared with the rest of sharing/, listed here because this pass is the change it grew for.',
      '',
      `source: ${E}/sharing/hive-pointer.ts`,
    ].join('\n'),
  },
  {
    key: norm('host-sync-service'),
    note: [
      'host-sync.service.ts — CHANGED FOR THIS WORK. Three reads that let a status surface be honest about hosting.',
      '',
      'probeServed(host, sig) is tri-state and the distinction is the whole point: `served` (200 — honest even from a cache, because the URL IS the content hash, so an intermediary can only hold that object under that name because the origin served it), `absent` (404, the only condition that ASSERTS absence), `unknown` (offline, CORS, 5xx, timeout, or the local breaker — nothing asserted, so callers must render silence). It never writes receipt state and a 404 never revokes one: an edge miss is far likelier than a deletion, and coupling a read-only surface to receipt destruction would let one bad response re-push an entire branch.',
      '',
      'closureGaps COLLECTS the holes instead of short-circuiting on the first, which is what turns "this branch is not fully served" into "these three objects are missing" — the only form a participant can act on. Bounded, because the caller is a status line and not an audit.',
      '',
      'hasAnyReceipt answers "is this hosted?" rather than "is it on MY domain?". hasReceipt tests only the bare self-domain filename, so for the CDN-only publisher /host produces by default — it flips the public gate and never requires a self-domain — it answered false for content the host demonstrably serves.',
      '',
      'Shared with the rest of sharing/, listed here because this pass is the change it grew for.',
      '',
      `source: ${E}/sharing/host-sync.service.ts`,
    ].join('\n'),
  },
]

/** An additive note on the EXISTING `/host` tile. The queen is /host's
 *  resource, not this behaviour's internals (mirror-paradigm rule 6), so it
 *  gets a note where it lives instead of a part cell over here. */
const SIBLING_NOTE = [
  '/host and /publish now share ONE routine. The sequence that used to live in this queen — mark public, seal, stage and drain, wait for availability, advance the signed index, mint the link — moved to sharing/publish-branch.ts. The queen keeps only the GESTURE: consent, progress notes, the outcome toast, and link delivery.',
  '',
  'It inherited the index wipe guard and the confirmation round trip in the move, and it can no longer drift from what the publish panel does — there is exactly one implementation of "put a branch into the world". The state half of the same subject is behaviors/swarm/publish.',
  '',
  `source: ${E}/sharing/host.queen.ts`,
].join('\n')

// ── plan rendering (dry run) ────────────────────────────────────────

const collectionSeg = [ROOT_KEY, COLLECTION]
const behaviorSeg = [...collectionSeg, BEHAVIOR]
const siblingSeg = [...collectionSeg, SIBLING]

function indent(text: string, pad = '      '): string {
  return text.split('\n').map(line => pad + line).join('\n')
}

function printPlan(): void {
  console.log('[publish] DRY RUN — nothing is written, no socket is opened.\n')
  console.log('CELLS (union into whatever is already there)')
  console.log(`  ${collectionSeg.join('/')}                (existing collection — gains one child)`)
  console.log(`  ${behaviorSeg.join('/')}`)
  for (const p of PARTS) console.log(`    ${behaviorSeg.join('/')}/${p.key}`)
  console.log('')

  console.log('PHEROMONES (declared vocabulary only — nothing new is minted)')
  console.log(`  ${behaviorSeg.join('/')} ← ${BEHAVIOR_KEYWORD}, ${COLLECTION_KEYWORD}`)
  for (const p of PARTS) {
    console.log(`  ${behaviorSeg.join('/')}/${p.key} ← ${[PART_KEYWORD, ...(p.extraMarks ?? [])].join(', ')}`)
  }
  console.log(`  NOT marked: the \`publish:heads\` pool — no declared keyword exists for a pool,`)
  console.log('              and minting one on the fly is forbidden. It is described in the')
  console.log('              publish-heads note instead.')
  console.log('')

  console.log(`NOTES (${BEHAVIOR_NOTES.length + PARTS.length + 1} in total; each written only if that exact text is not already on the cell)`)
  for (const [i, text] of BEHAVIOR_NOTES.entries()) {
    console.log(`\n  ── ${behaviorSeg.join('/')}  [note ${i + 1}/${BEHAVIOR_NOTES.length}]`)
    console.log(indent(text))
  }
  for (const p of PARTS) {
    console.log(`\n  ── ${behaviorSeg.join('/')}/${p.key}`)
    console.log(indent(p.note))
  }
  console.log(`\n  ── ${siblingSeg.join('/')}   (existing tile — additive note only, never a rewrite)`)
  console.log(indent(SIBLING_NOTE))

  console.log('\nAFTERWARDS')
  console.log('  node scripts/behaviors-theme/sweep.cjs   — mint the deck cards for the new cells')
  console.log("  (the `publish` glyph is declared in scripts/behaviors-theme/gen-behavior-tiles.mjs)")
  console.log('\n[publish] DRY RUN complete — the hive was not touched.')
}

// ── bridge helpers ──────────────────────────────────────────────────

async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'inflate', segments })
  if (!res.ok) return []
  const kids = (res.data as { children?: unknown } | undefined)?.children
  if (Array.isArray(kids)) {
    return kids.map(k => String(typeof k === 'string' ? k : (k as { name?: string })?.name ?? '')).filter(Boolean)
  }
  if (kids && typeof kids === 'object') return Object.keys(kids as Record<string, unknown>)
  return []
}

/** Exact-text presence — the gate that makes this pass re-runnable. `note-add`
 *  is additive, so re-sending a note without this check stacks a duplicate. */
async function hasNote(segments: string[], text: string): Promise<boolean> {
  const res = await send({ op: 'note-list', segments })
  return res.ok && Array.isArray(res.data) && res.data.some((n: any) => String(n?.text ?? '') === text)
}

async function note(segments: string[], text: string): Promise<'written' | 'present' | 'failed'> {
  if (await hasNote(segments, text).catch(() => false)) return 'present'
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    () => hasNote(segments, text),
  )
  return res.ok ? 'written' : 'failed'
}

async function hasMark(segments: string[], name: string): Promise<boolean> {
  const res = await send({ op: 'layer-at', segments })
  const decorations = (res.data?.decorations ?? []) as string[]
  return res.ok && Array.isArray(decorations) && decorations.includes(decorationSig(name))
}

async function mark(segments: string[], name: string): Promise<'written' | 'present' | 'failed'> {
  if (await hasMark(segments, name).catch(() => false)) return 'present'
  // NO replaceKind — tags stack; replaceKind would drop the sibling tag.
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } },
    () => hasMark(segments, name),
  )
  return res.ok ? 'written' : 'failed'
}

// ── the pass ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (DRY_RUN) { printPlan(); return }

  // Preflight. A pass that cannot reach a renderer must say so and fail — a
  // mirror that silently did nothing is how the hive falls behind.
  const pre = await sendOnce({ op: 'inflate', segments: collectionSeg }).catch((e: Error) => ({
    ok: false as const, error: e.message, id: '', data: undefined,
  }))
  if (!pre.ok) {
    console.error(`[publish] ABORT: cannot read "${collectionSeg.join('/')}" (${pre.error}).`)
    console.error('[publish] Open the hive on localhost with ?claudeBridge=1 (broker on 127.0.0.1:2401)')
    console.error('[publish] and make sure the behaviors mirror is built, then re-run.')
    console.error('[publish] Nothing was written.')
    process.exit(1)
  }

  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[publish] ABORT: "${collectionSeg.join('/')}" has no children — is the behaviors mirror built?`)
    process.exit(1)
  }
  console.log(`[publish] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

  let failed = 0
  const tally = { cells: 0, notes: 0, marks: 0, skipped: 0 }
  const record = (r: 'written' | 'present' | 'failed', kind: 'notes' | 'marks'): string => {
    if (r === 'written') { tally[kind]++; return 'ok' }
    if (r === 'present') { tally.skipped++; return 'already there' }
    failed++
    return 'FAIL'
  }

  // Phase 1 — structure. Union only; membership is never replaced.
  if (!members.includes(BEHAVIOR)) {
    process.stdout.write(`[struct] ${collectionSeg.join('/')} ← +${BEHAVIOR} ... `)
    const res = await sendRetry({
      op: 'update', segments: collectionSeg,
      layer: { name: COLLECTION, children: [...members, BEHAVIOR] },
    })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exit(1)
    tally.cells++
  } else {
    console.log(`[struct] ${BEHAVIOR} already present — merging parts only`)
  }

  const havePart = await childrenOf(behaviorSeg)
  const newParts = PARTS.map(p => p.key).filter(k => !havePart.includes(k))
  process.stdout.write(`[struct] ${behaviorSeg.join('/')} ← ${havePart.length + newParts.length} children ... `)
  const up = await sendRetry({
    op: 'update', segments: behaviorSeg,
    layer: { name: BEHAVIOR, children: [...havePart, ...newParts] },
  })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const key of newParts) {
    process.stdout.write(`[struct] ${behaviorSeg.join('/')}/${key} ... `)
    const res = await sendRetry({ op: 'update', segments: [...behaviorSeg, key], layer: { name: key } })
    if (res.ok) { tally.cells++; console.log('ok') } else { failed++; console.log(`FAIL: ${res.error}`) }
  }

  // Phase 2 — notes. Gated on exact text, so a re-run writes nothing.
  for (const [i, text] of BEHAVIOR_NOTES.entries()) {
    process.stdout.write(`[note ${i + 1}/${BEHAVIOR_NOTES.length}] ${behaviorSeg.join('/')} ... `)
    console.log(record(await note(behaviorSeg, text), 'notes'))
  }
  for (const p of PARTS) {
    process.stdout.write(`[note] ${behaviorSeg.join('/')}/${p.key} ... `)
    console.log(record(await note([...behaviorSeg, p.key], p.note), 'notes'))
  }
  if (members.includes(SIBLING)) {
    process.stdout.write(`[note] ${siblingSeg.join('/')} (sibling gesture) ... `)
    console.log(record(await note(siblingSeg, SIBLING_NOTE), 'notes'))
  } else {
    console.warn(`[note] SKIPPED ${siblingSeg.join('/')} — no /host tile here to note.`)
  }

  // Phase 3 — pheromones. Declared vocabulary only.
  const marks: { segments: string[]; name: string }[] = [
    { segments: behaviorSeg, name: BEHAVIOR_KEYWORD },
    { segments: behaviorSeg, name: COLLECTION_KEYWORD },
    ...PARTS.flatMap(p => [PART_KEYWORD, ...(p.extraMarks ?? [])].map(name => ({
      segments: [...behaviorSeg, p.key], name,
    }))),
  ]
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.name} ... `)
    console.log(record(await mark(m.segments, m.name), 'marks'))
  }

  console.log(`[publish] DONE — ${tally.cells} cells, ${tally.notes} notes, ${tally.marks} marks written; ${tally.skipped} already present`)
  console.log('[publish] NEXT: node scripts/behaviors-theme/sweep.cjs — mint the deck card for /publish and its parts')
  if (failed > 0) {
    console.error(`[publish] ${failed} operation(s) failed — review the log above and re-run (the pass is idempotent).`)
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
