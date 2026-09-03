// head-map.mjs — a faithful, runnable mirror of
// `hypercomb-core/src/core/head-map.ts`, the way head-claim.mjs mirrors
// hypercomb-core/src/core/head-claim.ts.
//
// Same canonical bytes, same refuse-or-parse rule, same per-row verification
// order. The ONE difference is that verification here is SYNCHRONOUS, because
// node's ed25519 verify is; nothing about the shape depends on that.
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
// The map has none of those handles, because it never descends into a value:
//
//   mintHeadMap  = { molecule -> the head CLAIM in MY bucket }, canonicalized.
//
// It terminates because enumeration is set MEMBERSHIP; it is entry-point
// independent because the bytes are the canonical representative of a SET; a
// stranger cannot move it because only my own bucket is read; and it verifies
// from atoms fetched BY SIGNATURE because every row's claim is self-
// authenticating against the row's own key.

import { canonName } from './canon.mjs'
import { sha256, signText, SIG_RE } from './sig.mjs'
import { acceptHeadClaim } from './head-claim.mjs'
import { ROOT_MOLECULE } from './molecule.mjs'

const HEX64 = /^[0-9a-f]{64}$/

export const HEAD_MAP_KIND = 'hypercomb.head-map'
export const HEAD_MAP_V1 = 1

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

/**
 * THE EXACT BYTES. Five fields in a fixed literal order, composed from arrays
 * only — nothing depends on a serializer's property-order rule. Every value is
 * fixed-width lowercase hex or a fixed literal, so no escaping rule is needed.
 *
 * `rows` is deliberately NOT called `heads`: `heads` is an EDGE FIELD in
 * sig.mjs (and in hypercomb-core's edge-registry), so a closure walker would
 * descend the pairs and try to fetch every MOLECULE ADDRESS as an atom — a
 * directory with no bytes behind it, i.e. the permanent-404 bug class. `refs`
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
  const rowBytes = rebuilt.rows.map(([m, c]) => `["${m}","${c}"]`).join(',')
  const refBytes = rebuilt.refs.map((r) => `"${r}"`).join(',')
  return `{"kind":"${HEAD_MAP_KIND}","v":${HEAD_MAP_V1},"pubkey":"${rebuilt.pubkey}",` +
    `"rows":[${rowBytes}],"refs":[${refBytes}]}`
}

/** REFUSE-OR-PARSE: a second spelling of one set cannot exist. */
export const parseHeadMap = (text) => {
  if (typeof text !== 'string') return null
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.kind !== HEAD_MAP_KIND || raw.v !== HEAD_MAP_V1) return null
  if (!Array.isArray(raw.rows) || !Array.isArray(raw.refs)) return null
  const pairs = []
  for (const row of raw.rows) {
    if (!Array.isArray(row) || row.length !== 2) return null
    if (!isHex64(row[0]) || !isHex64(row[1])) return null
    pairs.push({ molecule: row[0], claim: row[1] })
  }
  const rebuilt = canonicalHeadMap(raw.pubkey, pairs)
  if (!rebuilt) return null
  let encoded
  try {
    encoded = encodeHeadMap(rebuilt)
  } catch {
    return null
  }
  return encoded === text ? rebuilt : null
}

export const headMapClaimFor = (record, molecule) => {
  if (!record || !Array.isArray(record.rows) || !isHex64(molecule)) return null
  for (const row of record.rows) if (row[0] === molecule) return row[1]
  return null
}

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
 * A REPLAYED OLDER MAP IS CAUGHT PER ROW, on the author's own signed counter.
 * The map carries no clock and no counter by design — a signature proves
 * authorship and NEVER recency, so a map-level counter would be a number the
 * publisher asserts rather than a fact anyone can check. `seq` is line six of a
 * signed claim preimage and cannot be raised without the secret.
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
 * VERIFY WITH NO DIRECTORY LISTING. `expected` is argument two and has no
 * default: a caller cannot ask "is this map good?" without saying whose it is
 * supposed to be. `readClaim(claimSig)` is `GET /<64hex>` plus a hash check.
 *
 * A row is verified on `authentic`, never on `ok`: `ok` answers a question
 * about a TRANSITION and is meaningless when re-reading what is already
 * published.
 */
export const verifyHeadMap = (record, expected, readClaim, accept = acceptHeadClaim) => {
  const fail = (reason) => ({ ok: false, reason, verified: [], holes: [] })
  if (!record || record.kind !== HEAD_MAP_KIND || record.v !== HEAD_MAP_V1) return fail('malformed')
  if (!Array.isArray(record.rows) || !isHex64(record.pubkey)) return fail('malformed')
  try {
    encodeHeadMap(record)
  } catch {
    return fail('malformed')
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
    if (read.sig !== undefined && read.sig !== claim) {
      holes.push({ molecule, claim, reason: 'mismatched' })
      continue
    }
    const verdict = accept({ molecule, pubkey: expected }, read.offered, read.verify)
    if (!verdict || verdict.authentic !== true) {
      holes.push({ molecule, claim, reason: verdict?.reason ?? 'unsigned' })
      continue
    }
    verified.push({
      molecule,
      claim,
      head: read.offered.head,
      prev: read.offered.prev ?? null,
      seq: read.offered.seq,
    })
  }
  return { ok: holes.length === 0, reason: holes.length === 0 ? null : 'incomplete', verified, holes }
}

// ── the minter: what THIS publisher publishes ──────────────────────────────

/**
 * THE MOLECULES REACHABLE FROM `route`, OVER MY OWN HEADS, with a GLOBAL
 * VISITED SET.
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
 * IT READS HEADS, NEVER `viewOf`. `viewOf` folds every other author's bucket
 * (which is how a stranger moved the seal) AND the local undo cursor (which is
 * how pressing undo moved it). Neither can reach this.
 */
export const molecularScope = (store, route = []) => {
  const start = route.length ? store.moleculeFor(route) : ROOT_MOLECULE
  const seen = new Set()
  const queue = [start]
  const pairs = []
  while (queue.length) {
    const mol = queue.shift()
    if (!isHex64(mol) || seen.has(mol)) continue
    seen.add(mol)
    const claim = store.heldClaim(mol)
    if (!claim) continue // I head nothing here; the molecule may still be someone else's
    pairs.push({ molecule: mol, claim: claim.entry })
    const succ = store.getAtom(claim.head)
    for (const envSig of succ?.members ?? []) {
      const env = store.getAtom(envSig)
      if (!env || typeof env.root !== 'string') continue
      queue.push(signText(canonName(env.root)))
    }
  }
  return pairs
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
 */
export const mintedScope = (store) => {
  const pairs = []
  for (const molecule of store.minted.keys()) {
    const claim = store.heldClaim(molecule)
    if (claim) pairs.push({ molecule, claim: claim.entry })
  }
  return pairs
}

/**
 * MINT THE DEPLOY. Returns `{ sig, record, bytes, pairs }` where `sig` is the
 * content signature of the canonical map bytes — the single summarizing
 * signature "history is the deploy" always wanted.
 *
 * DUAL CARRIER, nothing removed: the claim bytes stay where they are (inside
 * the bucket, which is what the cold directory path reads) AND are written at
 * the root by their own signature, so a content-only host can serve them for
 * listing-free verification. In OPFS that is one extra root file per claim.
 *
 * In the shipped app this map atom is carried by a DEPLOY LAYER minted with the
 * existing non-recursive `history.materializeLayer`, whose `heads: [mapSig]`
 * array slot makes the index value stay an adoptable LAYER sig — see
 * `documentation/hypergraph-molecule-lineage.md`.
 */
export const mintHeadMap = (store, { route = null, scope = null } = {}) => {
  const pairs = scope ?? (route === null ? mintedScope(store) : molecularScope(store, route))
  const record = canonicalHeadMap(store.pubkey, pairs)
  if (!record) return null
  for (const claimSig of record.refs) {
    const bytes = claimBytesOf(store, claimSig)
    if (bytes && !store.root.has(claimSig)) store.root.write(claimSig, bytes)
  }
  const bytes = Buffer.from(encodeHeadMap(record), 'utf8')
  const sig = sha256(bytes)
  store.root.write(sig, bytes)
  return { sig, record, bytes, pairs }
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
 * THE READER A THIRD PARTY USES: `GET /<claimSig>`, assert the hash, parse.
 * There is no listing verb anywhere in this function, which is the whole
 * argument against skeptic-4 H.
 */
export const claimReaderOf = (host, verify) => (claimSig) => {
  if (!SIG_RE.test(String(claimSig ?? ''))) return null
  const bytes = host.content(claimSig)
  if (!bytes || !bytes.length) return null
  if (sha256(bytes) !== claimSig) return null
  try {
    const c = JSON.parse(bytes.toString('utf8'))
    return {
      offered: { head: c.head, prev: c.prev ?? null, seq: c.seq, sig: c.sig },
      verify,
      sig: claimSig,
    }
  } catch {
    return null
  }
}
