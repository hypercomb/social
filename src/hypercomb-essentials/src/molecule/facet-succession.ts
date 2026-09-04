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
  declarePoolKind,
  facetAddress,
  facetPreimage,
  moleculeKey,
  planHeadClaim,
  resolveBucketHead,
  SignatureService,
  type HeldHeadClaim,
} from '@hypercomb/core'
import { readHeadEntry, signHeadClaim, type HeadClaimSignResult } from '../sharing/head-claim-signer.js'

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

/** The claims this instance signed this session, per facet — the local half
 *  of `planHeadClaim`, so a host that is merely behind can never roll my own
 *  counter back. Session memory: durable minted records live beside the key
 *  (vocabulary-ledger does this for the vocabulary claim) and are a later step. */
const minted = new Map<string, HeldHeadClaim>()

/** Test seam. */
export const _resetMintedFacetClaims = (): void => { minted.clear() }

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
  const own = minted.get(`${facet}/${pubkey}`) ?? null
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
  minted.set(`${facet}/${pubkey}`, { head, prev: plan.prev, seq: plan.seq })
  return { ok: true, facet, head, seq: plan.seq, claim, changed: true }
}
