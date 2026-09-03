// head-map.mjs — a faithful, runnable mirror of
// `hypercomb-core/src/core/head-map.ts`, the way head-claim.mjs mirrors
// hypercomb-core/src/core/head-claim.ts.
//
// Same canonical bytes, same refuse-or-parse rule, THE SAME SIZE GATE IN BOTH
// DIRECTIONS, same attestation preimage, same per-row verification order. The
// ONE difference is that verification here is SYNCHRONOUS, because node's
// ed25519 verify is; nothing about the shape depends on that.
//
// (The size gate is called out because the first cut of this file did NOT have
// it: `parseHeadMap` opened with a type check and never looked at the length,
// so the twin parsed bytes core refused, and the one guard capable of rejecting
// a real deploy could not be exercised here at all. A mirror that diverges
// exactly where the original is fragile is not a mirror.)
//
// THE POINT OF THE FILE: THE DEPLOY SIGNATURE IS AN ENUMERATION, NOT A FOLD.
//
// The recursive seal the skeptics attacked lives only in the test files — it
// was never production code here — and it was written faithfully to the
// design's own words: "seal(M) = a derived succession whose envelopes add
// succession:<seal(child molecule head)> recursively". Four attacks land on
// that shape and every one of them is a property of FOLDING:
//
//   A   the recursion step is `signText(row.name)`, which does not GROW: it is
//       a step in a general directed graph over the global name set, so one
//       ordinary tile named after an ancestor makes it non-terminating.
//   A2  cutting the cycle on the recursion PATH makes what a node folds depend
//       on which ancestors are on the stack — one molecule, one merkle
//       identity per entry point.
//   B   the fold reads `viewOf`, which absorbs EVERY author's bucket in the
//       molecule, so a stranger's commit at a globally-named address re-mints
//       my deploy signature. (`viewOf` also reads my UNDO CURSOR, so pressing
//       undo re-minted it too, with nothing committed and nothing on disk
//       changed. That one is not even in the skeptics' list.)
//   H   sealing needs directory LISTINGS, so the merkle proof terminates in a
//       mutable, unsigned readdir that a static host does not have.
//
// The map has none of those handles, because it never descends into a value.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT THE STEP-4 REVIEW CHANGED IN THIS FILE (2026-09-03)
// ─────────────────────────────────────────────────────────────────────────
//
// THE ENUMERATION WAS NOT FLAT, AND IT AMPUTATED. `molecularScope` was a
// reachability walk over MY OWN heads whose stop condition was "I hold no claim
// here" — so one tile made by somebody else in the middle of a route
// TERMINATED that branch and every page of mine underneath it vanished from the
// deploy, silently, with no hole and no failure rung. In the design's own
// headline case (one name, one page, MANY AUTHORS) that is the ordinary shape,
// not the corner: a contributor who never made a top-level tile minted a
// well-formed, correctly-signed deploy of ZERO ROWS. Two fixes, both here:
//
//   * THE WHOLE-HIVE SCOPE IS THE LEDGER, FULL STOP. `route: []` no longer
//     walks anything. A walk from the root can never be more correct than the
//     list of molecules I have actually committed to, and was demonstrably less.
//   * A BRANCH SCOPE FILTERS ON THE UNION, ASSERTS ONLY MINE. Reachability now
//     descends every author's head (`store.heads`), so a stranger's page is
//     walked THROUGH instead of stopped AT; what gets NAMED is still only a
//     molecule I hold a claim in. A stranger can therefore widen or narrow
//     WHICH of my molecules a branch publish covers, and can still never touch
//     a row — a strictly weaker exposure than losing them outright. It reads
//     `heads`, never `viewOf`, so the local undo cursor cannot reach it.
//
// And the root scope is now provably a SUPERSET of any branch scope inside it,
// which it was not before.
//
// NOTHING IS DROPPED SILENTLY ANY MORE. Both scopes report what they could not
// resolve (`unresolved`), a branch scope reports what fell outside it
// (`outOfScope`), and the walk reports molecules whose succession bytes are
// missing so it could not descend (`opaque`). The old code swallowed all three
// with `?? []` and returned `{sig, record, bytes, pairs}` — no field named what
// was lost, so no caller could surface it. `#commit` fails CLOSED on exactly
// this store state ("out of sync … replicate from a current host"); the publish
// path must not fail open.
//
// AND THE SET IS SIGNED. Every row was independently signed and the COMPOSITION
// was signed by nobody, so any stranger holding the published bytes could
// compose a truncation, an empty deploy, or a cherry-picked mixture of
// generations out of the publisher's own rows — each verifying ok:true,
// holes:[], reason:null. `mintHeadMap` now returns an `attestation` and
// `verifyDeploy` requires it. It adds no clock and claims no recency.

import { canonName } from './canon.mjs'
import { sha256, signText, SIG_RE } from './sig.mjs'
import { acceptHeadClaim } from './head-claim.mjs'
import { ROOT_MOLECULE } from './molecule.mjs'

const HEX64 = /^[0-9a-f]{64}$/

export const HEAD_MAP_KIND = 'hypercomb.head-map'
export const HEAD_MAP_V1 = 1

/** The ONE size gate, applied by the encoder AND the parser. See core. */
export const HEAD_MAP_MAX_BYTES = 1 << 22

const isHex64 = (v) => typeof v === 'string' && HEX64.test(v)
const isSeq = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/**
 * THE CANONICAL REPRESENTATIVE OF A SET. A repeated molecule with a DIFFERENT
 * claim refuses the whole map — a publisher has one head per molecule, so two
 * answers means the enumeration is wrong and a map that quietly picked one
 * would publish a head the publisher never chose.
 */
export const canonicalHeadMap = (pubkey, pairs) => {
  if (!isHex64(pubkey)) return null
  const byMolecule = new Map()
  for (const pair of pairs ?? []) {
    if (!pair || !isHex64(pair.molecule) || !isHex64(pair.claim)) return null
    const held = byMolecule.get(pair.molecule)
    if (held !== undefined && held !== pair.claim) return null
    byMolecule.set(pair.molecule, pair.claim)
  }
  const rows = [...byMolecule.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([molecule, claim]) => [molecule, claim])
  const refs = [...new Set(rows.map((r) => r[1]))].sort()
  return { kind: HEAD_MAP_KIND, v: HEAD_MAP_V1, pubkey, rows, refs }
}

/** The exact encoded length, without building the string. */
const encodedLength = (rowCount, refCount) => {
  // 9 `{"kind":"` + kind + 6 `","v":` + 1 `1` + 11 `,"pubkey":"` + 64 + 10
  // `","rows":[` + rows + 10 `],"refs":[` + refs + 2 `]}` = 131 for the frame;
  // a row `["<64>","<64>"]` is 135 and a ref `"<64>"` is 66, plus the commas.
  const frame = 9 + HEAD_MAP_KIND.length + 6 + 1 + 11 + 64 + 10 + 10 + 2
  const rowBytes = rowCount === 0 ? 0 : rowCount * 135 + (rowCount - 1)
  const refBytes = refCount === 0 ? 0 : refCount * 66 + (refCount - 1)
  return frame + rowBytes + refBytes
}

/**
 * THE EXACT BYTES. Five fields in a fixed literal order, composed from arrays
 * only — nothing depends on a serializer's property-order rule. Every value is
 * fixed-width lowercase hex or a fixed literal, so no escaping rule is needed.
 *
 * THROWS past HEAD_MAP_MAX_BYTES, which is the parser's ceiling too. An encoder
 * with a weaker gate than the reader mints a deploy nobody can verify.
 *
 * `rows` is deliberately NOT called `heads`: `heads` IS an edge field in this
 * prototype's sig.mjs, so a closure walker would descend the pairs and try to
 * fetch every MOLECULE ADDRESS as an atom — a directory with no bytes behind
 * it, the permanent-404 bug class. (In hypercomb-core `heads` is not an edge
 * field at all, which is a different bug in the other direction: a walker there
 * would ignore it, so the deploy LAYER files the map sig under `refs`.) `refs`
 * is the record's self-declared flat closure and is the only edge.
 */
export const encodeHeadMap = (record) => {
  const rebuilt = record && record.kind === HEAD_MAP_KIND && record.v === HEAD_MAP_V1
    ? canonicalHeadMap(record.pubkey, (record.rows ?? []).map(([molecule, claim]) => ({ molecule, claim })))
    : null
  if (!rebuilt) throw new TypeError('head map: not a canonical hypercomb.head-map v1 record')
  if (rebuilt.rows.length !== (record.rows ?? []).length) {
    throw new TypeError('head map: rows carry a duplicate molecule')
  }
  for (let i = 0; i < rebuilt.rows.length; i++) {
    if (rebuilt.rows[i][0] !== record.rows[i][0] || rebuilt.rows[i][1] !== record.rows[i][1]) {
      throw new TypeError('head map: rows are not sorted by molecule')
    }
  }
  const refs = record.refs ?? []
  if (refs.length !== rebuilt.refs.length || rebuilt.refs.some((r, i) => r !== refs[i])) {
    throw new TypeError('head map: refs are not the distinct claims, sorted')
  }
  if (encodedLength(rebuilt.rows.length, rebuilt.refs.length) > HEAD_MAP_MAX_BYTES) {
    throw new RangeError(
      `head map: ${rebuilt.rows.length} rows exceed HEAD_MAP_MAX_BYTES (${HEAD_MAP_MAX_BYTES}) — shard with splitHeadMap`,
    )
  }
  const rowBytes = rebuilt.rows.map(([m, c]) => `["${m}","${c}"]`).join(',')
  const refBytes = rebuilt.refs.map((r) => `"${r}"`).join(',')
  return `{"kind":"${HEAD_MAP_KIND}","v":${HEAD_MAP_V1},"pubkey":"${rebuilt.pubkey}",` +
    `"rows":[${rowBytes}],"refs":[${refBytes}]}`
}

/** A set that is too big for one atom splits; a cap without this is a cliff. */
export const splitHeadMap = (record, maxBytes = HEAD_MAP_MAX_BYTES) => {
  if (!record || !isHex64(record.pubkey) || !Array.isArray(record.rows)) return []
  const limit = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : HEAD_MAP_MAX_BYTES
  const out = []
  let batch = []
  let refs = new Set()
  const flush = () => {
    if (!batch.length) return
    const shard = canonicalHeadMap(record.pubkey, batch)
    if (shard) out.push(shard)
    batch = []
    refs = new Set()
  }
  for (const row of record.rows) {
    if (!Array.isArray(row) || !isHex64(row[0]) || !isHex64(row[1])) return []
    const nextRefs = refs.has(row[1]) ? refs.size : refs.size + 1
    if (batch.length && encodedLength(batch.length + 1, nextRefs) > limit) flush()
    batch.push({ molecule: row[0], claim: row[1] })
    refs.add(row[1])
  }
  flush()
  return out
}

const readHeadMap = (text) => {
  if (typeof text !== 'string') return { record: null, refusal: 'unparseable' }
  if (text.length > HEAD_MAP_MAX_BYTES) return { record: null, refusal: 'oversize' }
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { record: null, refusal: 'unparseable' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { record: null, refusal: 'unparseable' }
  if (raw.kind !== HEAD_MAP_KIND || raw.v !== HEAD_MAP_V1) return { record: null, refusal: 'non-canonical' }
  if (!Array.isArray(raw.rows) || !Array.isArray(raw.refs)) return { record: null, refusal: 'non-canonical' }
  const pairs = []
  for (const row of raw.rows) {
    if (!Array.isArray(row) || row.length !== 2) return { record: null, refusal: 'non-canonical' }
    if (!isHex64(row[0]) || !isHex64(row[1])) return { record: null, refusal: 'non-canonical' }
    pairs.push({ molecule: row[0], claim: row[1] })
  }
  const rebuilt = canonicalHeadMap(raw.pubkey, pairs)
  if (!rebuilt) return { record: null, refusal: 'non-canonical' }
  let encoded
  try {
    encoded = encodeHeadMap(rebuilt)
  } catch {
    return { record: null, refusal: 'non-canonical' }
  }
  return encoded === text ? { record: rebuilt, refusal: null } : { record: null, refusal: 'non-canonical' }
}

/** REFUSE-OR-PARSE: a second spelling of one set cannot exist. */
export const parseHeadMap = (text) => readHeadMap(text).record

/** WHY it said no: 'oversize' calls for sharding, 'non-canonical' for distrust. */
export const headMapRefusal = (text) => readHeadMap(text).refusal

export const headMapClaimFor = (record, molecule) => {
  if (!record || !Array.isArray(record.rows) || !isHex64(molecule)) return null
  for (const row of record.rows) if (row[0] === molecule) return row[1]
  return null
}

// ── the attestation: who assembled this SET ────────────────────────────────

export const HEAD_MAP_ATTEST_V1 = 'hc:head-map:v1'

/**
 * Three lines, `\n`-joined, no trailing newline — `headClaimPreimage` one level
 * up. It proves this key assembled THIS SET, which is what makes a truncation,
 * an empty deploy, or a cherry-picked mixture refusable. It proves NOTHING
 * about recency, and a replayed older attested map still verifies.
 */
export const headMapAttestationPreimage = (pubkey, mapSig) =>
  [HEAD_MAP_ATTEST_V1, pubkey, mapSig].join('\n')

/** What changed, per molecule. Pure. */
export const headMapDiff = (a, b) => {
  const left = new Map((a?.rows ?? []).map((r) => [r[0], r[1]]))
  const right = new Map((b?.rows ?? []).map((r) => [r[0], r[1]]))
  const added = []; const removed = []; const moved = []; const unchanged = []
  for (const [molecule, claim] of right) {
    const before = left.get(molecule)
    if (before === undefined) added.push(molecule)
    else if (before === claim) unchanged.push(molecule)
    else moved.push(molecule)
  }
  for (const molecule of left.keys()) if (!right.has(molecule)) removed.push(molecule)
  return { added: added.sort(), removed: removed.sort(), moved: moved.sort(), unchanged: unchanged.sort() }
}

/**
 * COMPOSE TWO ENUMERATIONS, and RETURN WHAT IT DID. Last-write-wins over a
 * held newer row is a silent downgrade, so a caller that can rank (verified
 * rows carry `seq`) passes `held` and a backwards move REFUSES.
 */
export const mergeHeadMap = (prior, updates, options = {}) => {
  const empty = { record: null, replaced: [], regressed: [] }
  const pubkey = options.pubkey ?? prior?.pubkey
  if (!isHex64(pubkey)) return empty
  if (prior && prior.pubkey !== pubkey) return empty
  const drop = new Set()
  for (const molecule of options.remove ?? []) {
    if (!isHex64(molecule)) return empty
    drop.add(molecule)
  }
  const merged = new Map()
  for (const row of prior?.rows ?? []) merged.set(row[0], row[1])

  const heldSeq = new Map()
  for (const row of options.held ?? []) {
    if (!isHex64(row?.molecule) || !isSeq(row?.seq)) continue
    const seen = heldSeq.get(row.molecule)
    if (seen === undefined || row.seq > seen) heldSeq.set(row.molecule, row.seq)
  }

  const replaced = []
  const regressed = []
  for (const pair of updates ?? []) {
    if (!pair || !isHex64(pair.molecule) || !isHex64(pair.claim)) return empty
    const before = merged.get(pair.molecule)
    if (isSeq(pair.seq)) {
      const known = heldSeq.get(pair.molecule)
      if (known !== undefined && pair.seq < known) {
        regressed.push({ molecule: pair.molecule, heldSeq: known, offeredSeq: pair.seq })
      }
    }
    if (before !== undefined && before !== pair.claim) {
      replaced.push({ molecule: pair.molecule, from: before, to: pair.claim })
    }
    merged.set(pair.molecule, pair.claim)
  }
  for (const molecule of drop) merged.delete(molecule)
  regressed.sort((a, b) => (a.molecule < b.molecule ? -1 : a.molecule > b.molecule ? 1 : 0))
  if (regressed.length && options.allowRegression !== true) return { record: null, replaced, regressed }
  return {
    record: canonicalHeadMap(pubkey, [...merged.entries()].map(([molecule, claim]) => ({ molecule, claim }))),
    replaced,
    regressed,
  }
}

/**
 * A REPLAYED OLDER MAP IS CAUGHT PER ROW, on the author's own signed counter.
 * The map carries no clock and no counter by design — a signature proves
 * authorship and NEVER recency, so a map-level counter would be a number the
 * publisher asserts rather than a fact anyone can check. `seq` is line six of a
 * signed claim preimage and cannot be raised without the secret.
 *
 * THE HONEST LIMIT: this needs rows the reader has ALREADY PROVEN, and a cold
 * reader holds none. A replayed older ATTESTED deploy is invisible to a
 * first-time visitor, and no signature closes that.
 */
export const headMapRegressions = (held, offered) => {
  const best = new Map()
  for (const row of held ?? []) {
    if (!isHex64(row?.molecule) || !isSeq(row?.seq)) continue
    const seen = best.get(row.molecule)
    if (seen === undefined || row.seq > seen) best.set(row.molecule, row.seq)
  }
  const out = []
  for (const row of offered ?? []) {
    if (!isHex64(row?.molecule) || !isSeq(row?.seq)) continue
    const heldSeq = best.get(row.molecule)
    if (heldSeq !== undefined && row.seq < heldSeq) {
      out.push({ molecule: row.molecule, heldSeq, offeredSeq: row.seq })
    }
  }
  return out.sort((a, b) => (a.molecule < b.molecule ? -1 : a.molecule > b.molecule ? 1 : 0))
}

/**
 * THE INNER HALF: is every row PRESENT genuinely this key's? It cannot answer
 * whether this is the SET the publisher deployed, and there is no `ok` field
 * here so nobody can read that into it. Use `verifyDeploy` for a deploy.
 *
 * `readHead` is optional: without it, `rowsAuthentic:true` cannot tell a whole
 * site from no site, because the deploy's declared closure is its CLAIMS.
 */
export const verifyHeadMapRows = (record, expected, readClaim, accept = acceptHeadClaim, readHead = null) => {
  const fail = (reason) => ({ rowsAuthentic: false, reason, verified: [], holes: [] })
  if (!record || record.kind !== HEAD_MAP_KIND || record.v !== HEAD_MAP_V1) return fail('malformed')
  if (!Array.isArray(record.rows) || !isHex64(record.pubkey)) return fail('malformed')
  try {
    encodeHeadMap(record)
  } catch (error) {
    return fail(error instanceof RangeError ? 'oversize' : 'malformed')
  }
  if (!isHex64(expected) || record.pubkey !== expected) return fail('forged')

  const verified = []
  const holes = []
  for (const [molecule, claim] of record.rows) {
    let read = null
    try {
      read = readClaim(claim)
    } catch {
      read = null
    }
    if (!read || !read.offered) {
      holes.push({ molecule, claim, reason: 'absent' })
      continue
    }
    // THE READER MUST SAY WHAT IT FETCHED. Silence is not consent.
    if (!isHex64(read.sig)) {
      holes.push({ molecule, claim, reason: 'unchecked' })
      continue
    }
    if (read.sig !== claim) {
      holes.push({ molecule, claim, reason: 'mismatched' })
      continue
    }
    const verdict = accept({ molecule, pubkey: expected }, read.offered, read.verify)
    if (!verdict || verdict.authentic !== true) {
      holes.push({ molecule, claim, reason: verdict?.reason ?? 'unsigned' })
      continue
    }
    if (readHead) {
      let present = false
      try {
        present = readHead(read.offered.head) === true
      } catch {
        present = false
      }
      if (!present) {
        holes.push({ molecule, claim, reason: 'head-absent' })
        continue
      }
    }
    verified.push({
      molecule,
      claim,
      head: read.offered.head,
      prev: read.offered.prev ?? null,
      seq: read.offered.seq,
    })
  }
  return { rowsAuthentic: holes.length === 0, reason: holes.length === 0 ? null : 'incomplete', verified, holes }
}

/**
 * THE WHOLE PROCEDURE, IN ONE DOOR — and the only function that takes a deploy
 * SIGNATURE, which is what makes skipping step 1 impossible rather than easy.
 *
 *   0. offer.sig is 64-hex                 -> malformed
 *   1. sha256(offer.bytes) === offer.sig   -> forged
 *   2. refuse-or-parse                     -> oversize / malformed
 *   3. record.pubkey === expected          -> forged
 *   4. the publisher signed THIS SET       -> unattested
 *   5. every row, by signature             -> incomplete
 *
 * Steps 3 and 4 refuse BEFORE ANY FETCH.
 */
export const verifyDeploy = (offer, expected, deps = {}) => {
  const { verify, readClaim, accept = acceptHeadClaim, readHead = null } = deps
  const sig = typeof offer?.sig === 'string' ? offer.sig : ''
  const fail = (reason, record = null, attested = false) =>
    ({ ok: false, attested, reason, sig, record, rowsAuthentic: false, verified: [], holes: [] })

  if (!offer || !isHex64(sig) || typeof offer.bytes !== 'string') return fail('malformed')
  if (!isHex64(expected)) return fail('forged')
  if (sha256(Buffer.from(offer.bytes, 'utf8')) !== sig) return fail('forged')

  const { record, refusal } = readHeadMap(offer.bytes)
  if (!record) return fail(refusal === 'oversize' ? 'oversize' : 'malformed')
  if (record.pubkey !== expected) return fail('forged', record)

  let attested = false
  if (typeof offer.attestation === 'string' && offer.attestation.length) {
    try {
      attested = verify(expected, headMapAttestationPreimage(expected, sig), offer.attestation) === true
    } catch {
      attested = false
    }
  }
  if (!attested) return fail('unattested', record)

  const rows = verifyHeadMapRows(record, expected, readClaim, accept, readHead)
  return { ok: rows.rowsAuthentic, attested: true, sig, record, ...rows }
}

// ── the minter: what THIS publisher publishes ──────────────────────────────

/** Every molecule reachable from `mol` over the UNION of authors' heads. */
const reachableMolecules = (store, start) => {
  const seen = new Set()
  const opaque = []
  const queue = [start]
  while (queue.length) {
    const mol = queue.shift()
    if (!isHex64(mol) || seen.has(mol)) continue
    seen.add(mol)
    // EVERY AUTHOR'S HEAD, not only mine. Stopping at a molecule I do not head
    // is what amputated a publisher's whole subtree from their own deploy: one
    // tile somebody else made in the middle of a route, and every page of mine
    // below it was unreachable and named by nobody.
    //
    // `heads` and never `viewOf`: `viewOf` reads the local undo cursor, which
    // would put session state back into the deploy scope.
    for (const head of store.heads(mol)) {
      const succ = store.getAtom(head.sig)
      if (!succ) {
        // A missing succession is NOT a childless one, and swallowing the
        // difference with `?? []` is how an evicted atom silently shrank a
        // deploy. Say so; the caller decides.
        opaque.push({ molecule: mol, head: head.sig, author: head.authorSig })
        continue
      }
      for (const envSig of succ.members ?? []) {
        const env = store.getAtom(envSig)
        if (!env || typeof env.root !== 'string') continue
        queue.push(signText(canonName(env.root)))
      }
    }
  }
  return { seen, opaque }
}

/**
 * EVERY MOLECULE THIS PUBLISHER HEADS — the whole-hive scope, and a FLAT
 * enumeration with no graph in it at all.
 *
 * The source is the local MINT LEDGER, which `head-claim.ts` already specifies
 * must live beside the KEY rather than in the replicated content tree. That is
 * exactly the property a snapshot wants: `sealSubtree([])` over a global name
 * graph is the walk skeptic-4 A proves has no fixpoint, while "the molecules I
 * have committed to" is a list.
 *
 * A LEDGER MOLECULE WHOSE BUCKET DOES NOT RESOLVE IS REPORTED, NEVER DROPPED.
 * The ledger's own comment names the ordinary accident — OPFS evicted,
 * localStorage survived — and its documented recovery is "replicate from a
 * current host". Reach a host that is behind and the old code minted a
 * ZERO-ROW deploy and called it success: "I publish nothing", signed, from a
 * ledger that says otherwise.
 */
export const mintedScope = (store) => {
  const pairs = []
  const unresolved = []
  for (const molecule of store.minted.keys()) {
    const claim = store.heldClaim(molecule)
    if (claim) pairs.push({ molecule, claim: claim.entry })
    else unresolved.push(molecule)
  }
  return { pairs, unresolved, outOfScope: [], opaque: [] }
}

/**
 * A BRANCH SCOPE: the molecules I head that are reachable from `route`.
 *
 * REACHABILITY IS THE FILTER, MY OWN BUCKET IS THE CONTENT. The walk descends
 * every author's members so a stranger's page cannot amputate mine; what is
 * NAMED is only ever a molecule I hold a claim in. A stranger can therefore
 * widen or narrow which of MY molecules a branch publish covers — and can still
 * never touch a row, which is a strictly weaker exposure than losing them.
 *
 * Why a global visited set is sound HERE and was reverted for `sealSubtree`:
 * the seal computes a VALUE at each node, and de-duplicating a legitimately
 * repeated sibling changes the answer. This computes MEMBERSHIP, and membership
 * is idempotent and commutative — visiting a node twice can only re-add what is
 * already in the set. The reachable set is the least fixed point of a relation
 * over a FINITE name space, and a visited set computes it exactly. So a cycle
 * is a non-event rather than a refusal, and there is no recursion stack for the
 * answer to depend on.
 *
 * `route: []` does NOT come here — see `mintHeadMap`. A walk from the root can
 * never be more correct than the ledger, and was demonstrably less, so the root
 * scope IS the ledger and is therefore a superset of every branch scope in it.
 */
export const molecularScope = (store, route = []) => {
  const start = route.length ? store.moleculeFor(route) : ROOT_MOLECULE
  const { seen, opaque } = reachableMolecules(store, start)
  const pairs = []
  const unresolved = []
  const outOfScope = []
  for (const molecule of store.minted.keys()) {
    if (!seen.has(molecule)) {
      outOfScope.push(molecule)
      continue
    }
    const claim = store.heldClaim(molecule)
    if (claim) pairs.push({ molecule, claim: claim.entry })
    else unresolved.push(molecule)
  }
  // A molecule I hold a claim in but never minted from THIS instance (a
  // restored ledger, a second device) is still mine to assert if it is in
  // scope. The ledger is the fast path; reachability is the fallback.
  for (const molecule of seen) {
    if (store.minted.has(molecule)) continue
    const claim = store.heldClaim(molecule)
    if (claim) pairs.push({ molecule, claim: claim.entry })
  }
  return { pairs, unresolved, outOfScope, opaque }
}

/**
 * MINT THE DEPLOY. Returns
 * `{ sig, record, bytes, pairs, attestation, unresolved, outOfScope, opaque }`
 * where `sig` is the content signature of the canonical map bytes — the single
 * summarizing signature "history is the deploy" always wanted — and
 * `attestation` is this key's signature over `(pubkey, sig)`, which is what
 * makes the SET, and not merely each row, the publisher's.
 *
 * THE THREE REPORTS ARE NOT DECORATION. `unresolved` names ledger molecules
 * whose bucket did not resolve (a truncated deploy the publisher would
 * otherwise sign without knowing); `outOfScope` names molecules a BRANCH
 * publish leaves behind; `opaque` names molecules whose succession bytes are
 * missing so the walk could not descend. A publish UI must surface all three
 * rather than mint silently over them.
 *
 * DUAL CARRIER, nothing removed: the claim bytes stay where they are (inside
 * the bucket, which is what the cold directory path reads) AND are written at
 * the root by their own signature, so a content-only host can serve them for
 * listing-free verification. In OPFS that is one extra root file per claim.
 *
 * AND IT IS ALSO PERMANENT ROLLBACK AMMUNITION, which is worth saying out loud:
 * `#setHead` sweeps the losing entries out of my bucket, but nothing ever
 * removes these root copies, so every head claim I have ever minted stays
 * fetchable forever. That is correct under DATA NEVER HEALS, and it is why a
 * cherry-picked mixture of generations was composable at all — which is what
 * the attestation now refuses.
 *
 * In the shipped app this map atom is carried by a DEPLOY LAYER minted with the
 * existing non-recursive `history.materializeLayer`, whose `refs: [mapSig]`
 * slot makes the index value stay an adoptable LAYER sig while keeping the map
 * inside the layer's declared closure — see
 * `documentation/hypergraph-molecule-lineage.md`.
 */
export const mintHeadMap = (store, { route = null, scope = null } = {}) => {
  const survey = scope
    ? { pairs: [...scope], unresolved: [], outOfScope: [], opaque: [] }
    : (route === null || route.length === 0 ? mintedScope(store) : molecularScope(store, route))
  const record = canonicalHeadMap(store.pubkey, survey.pairs)
  if (!record) return null
  for (const claimSig of record.refs) {
    const bytes = claimBytesOf(store, claimSig)
    if (bytes && !store.root.has(claimSig)) store.root.write(claimSig, bytes)
  }
  const bytes = Buffer.from(encodeHeadMap(record), 'utf8')
  const sig = sha256(bytes)
  store.root.write(sig, bytes)
  const attestation = store.keys.sign(headMapAttestationPreimage(store.pubkey, sig))
  return {
    sig,
    record,
    bytes,
    pairs: survey.pairs,
    attestation,
    unresolved: survey.unresolved,
    outOfScope: survey.outOfScope,
    opaque: survey.opaque,
  }
}

/** The bytes of one of my claim entries, found by its own content signature. */
const claimBytesOf = (store, claimSig) => {
  if (store.root.has(claimSig)) return store.root.read(claimSig)
  for (const path of store.root.paths()) {
    if (path.endsWith(`/${claimSig}`) && path.includes(`/${store.pubkey}/`)) return store.root.read(path)
  }
  return null
}

/**
 * THE READER A THIRD PARTY USES: `GET /<claimSig>`, hash what came back, and
 * REPORT WHAT IT ACTUALLY GOT. There is no listing verb anywhere in this
 * function, which is the whole argument against skeptic-4 H.
 *
 * It reports `sig` as the hash of the bytes rather than refusing on a
 * mismatch: refusing collapses "this host answered with something else" into
 * "this byte was cold", and those are opposite facts about a host. The verifier
 * compares and says `mismatched`.
 */
export const claimReaderOf = (host, verify) => (claimSig) => {
  if (!SIG_RE.test(String(claimSig ?? ''))) return null
  const bytes = host.content(claimSig)
  if (!bytes || !bytes.length) return null
  try {
    const c = JSON.parse(bytes.toString('utf8'))
    return {
      offered: { head: c.head, prev: c.prev ?? null, seq: c.seq, sig: c.sig },
      verify,
      sig: sha256(bytes),
    }
  } catch {
    return null
  }
}

/** `GET /<headSig>` + hash check: does this row point at bytes that exist? */
export const headReaderOf = (host) => (headSig) => {
  if (!SIG_RE.test(String(headSig ?? ''))) return false
  const bytes = host.content(headSig)
  if (!bytes || !bytes.length) return false
  return sha256(bytes) === headSig
}
