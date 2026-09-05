// molecule/facet-succession.ts
//
// THE FIRST FACET WRITER — a collection about one subject, as the molecule
// model says it is stored (hypergraph-molecule-lineage.md, address-syntax.md):
//
//   <root>/<sign('<plural>:' + subjectSig)>/        the FACET (a pool)
//       <pubkey>/<sha256(claimJson)>                 this author's signed head
//   <root>/<envelopeSig>     {meta:1, resource:<memberSig>, root:'<plural>',
//                             relation:'<plural>', slot:<i>}
//   <root>/<headSig>         {succession:1, signer, prev, members:[envelopeSig…], at}
//
// Three primitives, all already in core, composed for the first time:
//   * `facetAddress` — the pool's address is derived, never registered.
//   * `mintMetaEnvelope` (via `Store.putArtifactMeta`) — one typed incidence
//     per member; ORDER RIDES THE ENVELOPE as `slot`, never the member.
//   * `headClaimPreimage` / `signHeadClaim` / `planHeadClaim` /
//     `resolveBucketHead` — one signed head per author bucket, monotone `seq`,
//     `prev` chaining the succession. The reader walks the bucket it asked for
//     and verifies against the bucket's key; nothing here declares a location.
//
// FORWARD COMMIT, NEVER A HEAL. Nothing this writes replaces anything. The
// members (a note's bytes) keep the signature they always had; the envelopes,
// the succession atom and the claim are NEW atoms beside them. Older clients
// that read the layer slot keep working; a client that learns to read the
// facet finds the same members there.
//
// NO IDENTITY IS MINTED HERE. `readerPubkey()` mints and persists a secret on
// a miss; this module takes the CACHED key and, without one, writes nothing
// and says so. Becoming an author is a gesture elsewhere.
//
// OLD CLAIMS STAY. "New-before-old publishing" means the new claim is written
// and the reader ranks by `seq`; this never sweeps a bucket's siblings. A
// bucket is history; history never heals.

import {
  acceptHeadClaim,
  declarePoolKind,
  facetAddress,
  facetPreimage,
  metaPayloadOf,
  moleculeKey,
  planHeadClaim,
  resolveBucketHead,
  SignatureService,
  type HeadClaimVerifier,
  type HeldHeadClaim,
} from '@hypercomb/core'
import { readHeadEntry, signHeadClaim, verifierFor, type HeadClaimSignResult } from '../sharing/head-claim-signer.js'

const SIG_RE = /^[0-9a-f]{64}$/

/** The succession atom. `members` are envelope sigs (EDGES — their bytes must
 *  travel); `prev` is a REFERENT (never carried in a closure); `signer` binds
 *  the atom to the bucket that claims it (`headClaimAuthors`). */
export interface SuccessionAtom {
  succession: 1
  signer: string
  prev: string | null
  members: string[]
  at: number
}

export interface FacetStore {
  getPool: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  putResource: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null | undefined>
  /** The document-pool contract, for the per-device minted record. */
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putArtifactMeta?: (
    kind: 'layer' | 'resource' | 'dependency' | 'bee',
    artifactSig: string,
    incidence?: Record<string, unknown>,
    options?: { emit?: boolean },
  ) => Promise<string>
}

export type FacetWriteResult =
  | { ok: true; facet: string; head: string; seq: number; claim: string; changed: boolean }
  | { ok: false; reason: 'no identity' | 'no store' | 'no pool' | 'no envelope minter' | 'bad subject' | 'bad member' | 'sign failed'; detail?: string }

export interface FacetWriteInput {
  /** The plural word — `notes`. Position makes it a facet; the word is folded. */
  plural: string
  /** The subject: a 64-hex signature (the molecule address of the thing). */
  subjectSig: string
  /** Member atom signatures, IN ORDER. Order becomes each envelope's `slot`. */
  members: readonly string[]
  /** What kind of atom a member is. Notes are resources. */
  kind?: 'resource' | 'layer'
  store: FacetStore
  /** The CACHED author key. Null writes nothing. */
  pubkey: string | null
  /** The signer — injectable so a spec never touches a key. */
  sign?: (molecule: string, head: string, prev: string | null, seq: number) => Promise<HeadClaimSignResult>
  now?: () => number
}

/**
 * THE MINTED RECORD — the local half of `planHeadClaim`'s anti-rollback rule.
 *
 * A host that is merely BEHIND hands back a bucket with my genesis and none of
 * my later claims; planning from that alone would sign seq 1 over genesis
 * again, and every peer holding my real chain would refuse it as a fork. So
 * the last claim THIS DEVICE signed for each facet is kept where the KEY is
 * kept: per-device, never replicated, one current document per (facet,
 * pubkey) in the `facet:minted` pool (head-claim.ts, "WHAT MY NEXT CLAIM MUST
 * CARRY"). Memory is only a cache in front of it.
 */
export const FACET_MINTED_MEANING = 'facet:minted'
const minted = new Map<string, HeldHeadClaim>()

/** Test seam — clears the CACHE only; the document stays, as it would across a reload. */
export const _resetMintedFacetClaims = (): void => { minted.clear() }

const mintedKey = (facet: string, pubkey: string): string => `${facet}:${pubkey}`

const readMinted = async (store: FacetStore, facet: string, pubkey: string): Promise<HeldHeadClaim | null> => {
  const cached = minted.get(mintedKey(facet, pubkey))
  if (cached) return cached
  if (!store.getPoolDoc) return null
  try {
    const pool = await store.getPool(FACET_MINTED_MEANING)
    const bytes = await store.getPoolDoc(pool ?? undefined, mintedKey(facet, pubkey))
    if (!bytes || bytes.byteLength === 0) return null
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as Partial<HeldHeadClaim> & { facet?: string; pubkey?: string }
    if (doc.facet !== facet || doc.pubkey !== pubkey || !SIG_RE.test(String(doc.head ?? ''))) return null
    const record: HeldHeadClaim = { head: String(doc.head), prev: doc.prev ?? null, seq: Number(doc.seq) }
    minted.set(mintedKey(facet, pubkey), record)
    return record
  } catch { return null }
}

const writeMinted = async (store: FacetStore, facet: string, pubkey: string, record: HeldHeadClaim): Promise<void> => {
  minted.set(mintedKey(facet, pubkey), record)
  if (!store.putPoolDoc) return
  try {
    const pool = await store.getPool(FACET_MINTED_MEANING)
    if (!pool) return
    const bytes = new TextEncoder().encode(JSON.stringify({ facet, pubkey, ...record, at: Date.now() })).buffer as ArrayBuffer
    await store.putPoolDoc(pool, bytes, mintedKey(facet, pubkey))
  } catch { /* the cache still holds it for this session */ }
}

const canonicalAtom = (atom: SuccessionAtom): string =>
  JSON.stringify({ succession: 1, signer: atom.signer, prev: atom.prev, members: atom.members, at: atom.at })

/** The bucket's current head as this replica holds it: every parseable claim
 *  signed for THIS facet and THIS key, ranked by seq. */
const heldHead = async (
  bucket: FileSystemDirectoryHandle,
  facet: string,
  pubkey: string,
): Promise<HeldHeadClaim | null> => {
  const claims: HeldHeadClaim[] = []
  try {
    for await (const [name, handle] of (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (handle.kind !== 'file' || !SIG_RE.test(name)) continue
      try {
        const read = readHeadEntry(await (await (handle as FileSystemFileHandle).getFile()).text())
        if (!read || read.signedFor.molecule !== facet || read.signedFor.pubkey !== pubkey) continue
        claims.push(read.offered)
      } catch { /* an unreadable claim ranks nobody */ }
    }
  } catch { return null }
  return resolveBucketHead(claims)
}

/** The members the head atom names, so an unchanged list writes nothing. */
const membersOfHead = async (store: FacetStore, head: string | null): Promise<string[] | null> => {
  if (!head) return null
  try {
    const blob = await store.getResource(head)
    if (!blob) return null
    const atom = JSON.parse(await blob.text()) as Partial<SuccessionAtom>
    return atom?.succession === 1 && Array.isArray(atom.members) ? atom.members.map(String) : null
  } catch { return null }
}

/**
 * Write the facet's head for THIS author: envelopes for the members, one
 * succession atom, one signed claim into the author's bucket. Idempotent — the
 * same members in the same order mint the same envelopes, and a head whose
 * members are unchanged is not re-claimed. Never throws.
 */
export const writeFacetHead = async (input: FacetWriteInput): Promise<FacetWriteResult> => {
  const pubkey = String(input.pubkey ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, reason: 'no identity' }
  const store = input.store
  if (!store?.getPool || !store.putResource || !store.getResource) return { ok: false, reason: 'no store' }
  if (!store.putArtifactMeta) return { ok: false, reason: 'no envelope minter' }
  const subject = String(input.subjectSig ?? '').toLowerCase()
  if (!SIG_RE.test(subject)) return { ok: false, reason: 'bad subject' }
  const members = input.members.map(m => String(m ?? '').toLowerCase())
  if (members.some(m => !SIG_RE.test(m))) return { ok: false, reason: 'bad member' }
  const kind = input.kind ?? 'resource'
  const word = moleculeKey(input.plural)
  const sign = input.sign ?? signHeadClaim
  const now = input.now ?? Date.now

  let meaning: string
  let facet: string
  try {
    meaning = facetPreimage(input.plural, subject)
    facet = await facetAddress(input.plural, subject)
  } catch (err) { return { ok: false, reason: 'bad subject', detail: String(err) } }
  // A facet is per-author buckets of signed claims: the SUCCESSION kind. Said
  // at the write, in the same breath as the address is derived.
  declarePoolKind(meaning, 'succession')
  const pool = await store.getPool(meaning).catch(() => null)
  if (!pool) return { ok: false, reason: 'no pool' }
  let bucket: FileSystemDirectoryHandle
  try { bucket = await pool.getDirectoryHandle(pubkey, { create: true }) } catch (err) { return { ok: false, reason: 'no pool', detail: String(err) } }

  // 1. The envelopes — one typed incidence per member, order in `slot`.
  const envelopes: string[] = []
  for (let i = 0; i < members.length; i++) {
    const sig = await store.putArtifactMeta(kind, members[i]!, { relation: word, root: word, slot: i })
    envelopes.push(String(sig).toLowerCase())
  }

  // 2. Where this author's chain stands, from the bucket and from memory.
  const held = await heldHead(bucket, facet, pubkey)
  const own = await readMinted(store, facet, pubkey)
  const plan = planHeadClaim(held, own)
  const current = plan.prev
  const currentMembers = await membersOfHead(store, current)
  if (currentMembers && currentMembers.length === envelopes.length && currentMembers.every((m, i) => m === envelopes[i])) {
    const base = own && held ? (own.seq >= held.seq ? own : held) : (own ?? held)!
    return { ok: true, facet, head: base.head, seq: base.seq, claim: '', changed: false }
  }

  // 3. The succession atom — signer bound, prev chained.
  const atom: SuccessionAtom = { succession: 1, signer: pubkey, prev: current, members: envelopes, at: now() }
  const head = String(await store.putResource(new Blob([canonicalAtom(atom)], { type: 'application/json' }))).toLowerCase()

  // 4. The signed claim into MY bucket. The molecule line is the FACET address
  //    — the directory a reader routes to — never the subject.
  const signed = await sign(facet, head, plan.prev, plan.seq)
  if (!signed.ok) return { ok: false, reason: 'sign failed', detail: signed.reason }
  const bytes = new TextEncoder().encode(signed.json)
  const claim = (await SignatureService.sign(bytes.buffer as ArrayBuffer)).toLowerCase()
  try {
    const handle = await bucket.getFileHandle(claim, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  } catch (err) { return { ok: false, reason: 'no pool', detail: String(err) } }
  await writeMinted(store, facet, pubkey, { head, prev: plan.prev, seq: plan.seq })
  return { ok: true, facet, head, seq: plan.seq, claim, changed: true }
}

// ---------------------------------------------------------------------------
// THE READ HALF
// ---------------------------------------------------------------------------
//
// OPENS, NEVER MINTS. A read uses `openPool` — absent pool, null, nothing
// created — because merely LOOKING at a word's notes must not grow a directory
// that claims the participant uses the feature. Every claim in every author
// bucket is verified against the BUCKET'S key by `acceptHeadClaim`, the same
// gate a peer's bytes face; the reader never trusts a location a claim
// declares, only the one it walked to. The members are the union across
// authors, this reader's own bucket first, each author's list in its slot
// order — and an unreadable bucket ranks nobody.

export interface FacetReadStore {
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  getResource: (sig: string) => Promise<Blob | null | undefined>
}

export interface FacetReadInput {
  plural: string
  subjectSig: string
  store: FacetReadStore
  /** This reader's own key, so its list leads. Null is fine: a reader with
   *  no identity still reads every bucket. */
  ownPubkey?: string | null
  /** The verifier factory — injectable so a spec never needs a real curve. */
  verify?: (event: Record<string, unknown>) => HeadClaimVerifier
}

export interface FacetReadResult {
  facet: string
  /** Member atom sigs, deduped, own author first, each in slot order. */
  members: string[]
  /** How many author buckets contributed a verified head. */
  authors: number
}

/** A verified head's member sigs, in slot order, or null when the atom or an
 *  envelope will not read. */
const membersOfAtom = async (store: FacetReadStore, head: string): Promise<string[] | null> => {
  let atom: Partial<SuccessionAtom>
  try {
    const blob = await store.getResource(head)
    if (!blob) return null
    atom = JSON.parse(await blob.text()) as Partial<SuccessionAtom>
  } catch { return null }
  if (atom?.succession !== 1 || !Array.isArray(atom.members)) return null
  const rows: Array<{ sig: string; slot: number }> = []
  for (const envelopeSig of atom.members) {
    try {
      const blob = await store.getResource(String(envelopeSig))
      if (!blob) return null
      const envelope = JSON.parse(await blob.text()) as Record<string, unknown>
      const payload = metaPayloadOf(envelope)
      if (!payload) return null
      const slot = typeof envelope['slot'] === 'number' ? envelope['slot'] : rows.length
      rows.push({ sig: payload.sig, slot })
    } catch { return null }
  }
  return rows.sort((a, b) => a.slot - b.slot).map(r => r.sig)
}

/**
 * Read a facet's members across every author bucket. Never throws; an absent
 * facet is `null` (indistinguishable from "nobody has said anything yet", as
 * address-syntax.md rule 7 says it should be).
 */
export const readFacetMembers = async (input: FacetReadInput): Promise<FacetReadResult | null> => {
  const subject = String(input.subjectSig ?? '').toLowerCase()
  if (!SIG_RE.test(subject) || !input.store?.openPool || !input.store.getResource) return null
  let facet: string
  let pool: FileSystemDirectoryHandle | null | undefined
  try {
    facet = await facetAddress(input.plural, subject)
    pool = await input.store.openPool(facetPreimage(input.plural, subject))
  } catch { return null }
  if (!pool) return null
  const verify = input.verify ?? verifierFor
  const own = String(input.ownPubkey ?? '').toLowerCase()

  const byAuthor = new Map<string, string[]>()
  try {
    for await (const [bucketName, bucket] of (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (bucket.kind !== 'directory' || !SIG_RE.test(bucketName)) continue
      const address = { molecule: facet, pubkey: bucketName.toLowerCase() }
      let held: HeldHeadClaim | null = null
      try {
        for await (const [name, handle] of (bucket as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (handle.kind !== 'file' || !SIG_RE.test(name)) continue
          let read: ReturnType<typeof readHeadEntry>
          try { read = readHeadEntry(await (await (handle as FileSystemFileHandle).getFile()).text()) } catch { continue }
          if (!read) continue
          const verdict = await acceptHeadClaim(address, read.offered, verify(read.event), { held })
          if (verdict.ok) held = verdict.claim
        }
      } catch { continue }   // an unreadable bucket ranks nobody
      if (!held) continue
      const members = await membersOfAtom(input.store, held.head)
      if (members) byAuthor.set(address.pubkey, members)
    }
  } catch { return { facet, members: [], authors: 0 } }

  const ordered = [...byAuthor.keys()].sort((a, b) => (a === own ? -1 : b === own ? 1 : a.localeCompare(b)))
  const seen = new Set<string>()
  const members: string[] = []
  for (const author of ordered) {
    for (const sig of byAuthor.get(author)!) {
      if (seen.has(sig)) continue
      seen.add(sig)
      members.push(sig)
    }
  }
  return { facet, members, authors: byAuthor.size }
}
