// molecule/vocabulary-publish.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// PUBLISHING IS AN ACT. THIS IS THE ONLY DOOR, AND IT HAS NO OTHER ENTRANCE.
// ═══════════════════════════════════════════════════════════════════════════
//
//   "Nothing enters your world because someone else decided it should. A host
//    MAY DECLARE what it holds. It may NEVER PLACE anything in your world."
//
// Deriving the index stays automatic and local (`molecule-index.drone.ts`, the
// optimize phase). Publishing the claim is explicit, scoped, and reached from
// one function that REFUSES unless it is told, in an argument with no default,
// that a participant asked for it.
//
// EVERY AUTOMATIC TRIGGER THAT WAS AVAILABLE, AND WHY NONE OF THEM IS USED:
//
//  1. `optimize()`. The processor calls it from `act()`'s `finally` on a 2s
//     idle TIMEOUT, serially, swallowing every throw — it fires during boot
//     whether idle or not. Anything there is unattributable. The index drone
//     keeps its `#pending.size === 0` early return and gains NOTHING.
//  2. `content:wrote`. Fires on every layer commit. A handler that published
//     would make publishing a side effect of a commit. (The index drone's own
//     handler is the model of what such a listener may do: nothing but
//     remember a sig.)
//  3. `publishBranch`. A branch publish and a vocabulary publish are two acts.
//     No chaining, in either direction. Note that `publishBranch` is NOT
//     scope-neutral — it sets the branch's public mark and enables the public
//     host — which is exactly why this routine only ever READS that mark.
//  4. `publish-status.drone`'s refresh (`history:head-changed`, `navigate`,
//     `share:receipt-revoked`). Every one of those is read-only and stays so.
//  5. `domain:learned` → `published-pools.probeDomain`, which fires for every
//     host the participant learns. Fine for READING; never a write trigger.
//  6. HostSyncService's auto-drain and the swarm walk's fire-and-forget
//     `markPublic`. Those move BYTES once a gate is on; the claim atom becomes
//     public only INSIDE this act, which is why nothing here mints before the
//     confirmation returns (see THE MINT ORDER below).
//  7. `claude-bridge.worker.ts`'s `hive-root-set` op, which advances the
//     signed index with no gesture at all and refuses only COLON-LESS keys.
//     `vocabulary:hive` carries a colon, so it would have been remotely
//     settable the moment the key existed. Closed as DATA:
//     `BRIDGE_FORBIDDEN_ROOT_KEYS` in sharing/hive-link.ts.
//
// THE MINT ORDER, AND WHY IT IS LOAD-BEARING. `HostSyncService` auto-enqueues
// every `content:wrote` sig once the participant has opted in, and drains at
// module load, at +20s, and on an interval. MINTING IS THEREFORE UPLOADING.
// So nothing may reach `putResource` or `markPublic` until the confirmation has
// returned true. The obvious optimisation — "precompute the claim so the
// confirmation can show its size" — is the one that breaks this, and
// `vocabulary-publish.spec.ts` fails if anyone takes it.
//
// AND THE LINE IS NOT "EVERY WRITE", IT IS "EVERY IRREVERSIBLE STEP". Two of
// the DEPS THAT LOOK LIKE READS are effects on the world, and both used to run
// before the participant was asked:
//
//   * `publicKey` → `readerPubkey()` → `resolveSecretKeyHex()`, which MINTS
//     AND PERSISTS a secp256k1 secret on a miss. A participant who opened the
//     dialog and said NO walked away holding a signing identity they declined
//     — the exact hazard `nostr-signer.ts` documents against itself, made
//     worse here because a claim key carries WRITE AUTHORITY.
//   * `readHeld` → `fetchHiveIndex` + a second `fetch`, i.e. the participant's
//     public key, IP and publishing intent handed to a standing public
//     endpoint. A decline cannot un-send that.
//
// Both were there only to render `seq` in the dialog. `seq` is `null` in the
// summary now and the anti-rollback plan is computed after consent, which
// costs nothing: it is needed to SIGN, not to ASK.
//
// ─── THE SCOPE MODEL: PER PUBLISHED SUBTREE ────────────────────────────────
//
// Not per-word, not all-or-nothing.
//
//   * all-or-nothing is the wide default the constraint forbids.
//   * per-word needs a new registry of up to 8000 toggles, a second thing to
//     keep in agreement with the tree, and a participant who has to FIND a
//     setting before their words are private.
//   * per-subtree ALREADY EXISTS as `hc:public-branches`, ALREADY defaults to
//     nothing-public, and is already how a participant says "this branch is
//     shareable". No new mechanism, and no new default to get wrong.
//
// THE INVARIANT THAT MAKES IT SAFE, and it is enforced by construction rather
// than by care: THE CLAIM MAY ONLY EVER NAME WORDS ALREADY REACHABLE IN
// PUBLISHED BYTES. The body is derived from published subtree heads, and the
// set of published subtrees is the public-branch marks INTERSECTED WITH THE
// PUBLISH LEDGER — a branch marked public but never actually served would
// otherwise mint a route to bytes no host holds. So the claim reveals no name
// a visitor could not already fetch. Holding a word privately is the DEFAULT,
// and a participant reaches it by doing nothing.
//
// The intersection under-reports rather than over-reports (the ledger is
// per-device, a floor and never a ceiling), which is the safe direction — and
// under-reporting is exactly what `complete: false` exists to say out loud.

import {
  MAX_CLAIM_WORDS,
  canonicalVocabularyBody,
  encodeVocabularyBody,
  moleculeAddress,
  planVocabularyClaim,
} from '@hypercomb/core'
import { VOCABULARY_ROOT_KEY } from '../sharing/hive-link.js'
import type { VocabularyPublishRecord } from './vocabulary-ledger.js'
import type { VocabularySignResult } from './vocabulary-signer.js'

const HEX64 = /^[0-9a-f]{64}$/

/** How long the claim's own bytes may take to become servable before the act
 *  declines to advance the pointer. The index must only ever name atoms a
 *  reader can actually fetch — `publishBranch`'s availability gate, narrowed
 *  to two small resources. */
export const VOCABULARY_AVAILABILITY_MS = 30_000
export const VOCABULARY_AVAILABILITY_POLL_MS = 1_000

/** What the participant is shown BEFORE anything is minted. */
export interface VocabularyPublishSummary {
  /** How many distinct words the claim would declare. */
  readonly words: number
  /** The published branch paths those words come from, verbatim. */
  readonly branches: readonly string[]
  /** False when any subtree's picture was incomplete. */
  readonly complete: boolean
  /** The door the index would be advanced on. */
  readonly host: string
  /** The counter this publish would sign, or NULL because it is not known yet.
   *  It is read back FROM A HOST, and a host read is two HTTPS requests
   *  carrying the participant's public key — which must not happen to render a
   *  line in a dialog the participant may be about to decline. */
  readonly seq: number | null
  /** True for `withdrawVocabulary` — the claim declares NOTHING. */
  readonly withdrawal: boolean
}

export type VocabularyPublishFailure =
  /** The caller did not pass `confirmed: true`. The API guard. */
  | 'not-confirmed'
  /** The participant declined. The human guard. */
  | 'declined'
  /** No published branch contributes a word, and this is not a withdrawal. */
  | 'nothing-published'
  | 'no-signer'
  | 'no-host'
  | 'sign-failed'
  | 'mint-failed'
  /** The claim's own bytes are not servable yet — refuse rather than advance
   *  the pointer to something no reader can fetch. */
  | 'not-available'
  | 'index-unsafe'

export type VocabularyPublishResult =
  | {
      ok: true
      claim: string
      body: string
      seq: number
      count: number
      complete: boolean
      host: string
      pubkey: string
    }
  | { ok: false; failure: VocabularyPublishFailure; detail?: string }

/** What the routine needs from the world. EVERY ONE INJECTABLE, so the spec
 *  never touches a socket, a pool or a key. */
export interface VocabularyPublishDeps {
  /** `sign('vocabulary:hive')`, derived. */
  readonly surface: () => Promise<string>
  /** The participant's key. Reached ONLY BELOW THE CONFIRMATION — it mints and
   *  persists an identity on a miss, which is correct once becoming an author
   *  is what the participant just agreed to, and nowhere else. */
  readonly publicKey: () => Promise<string | null>
  /** The door the index is advanced on. */
  readonly host: () => Promise<string>

  /** `hc:public-branches`, read and NEVER written. */
  readonly publicBranches: () => readonly string[]
  /** The lineage keys this participant has actually published, from the
   *  publish ledger. A branch marked public but never served contributes
   *  nothing — it would be a route to bytes no host holds. */
  readonly publishedKeys: () => Promise<ReadonlySet<string>>
  readonly lineageKeyOf: (segments: readonly string[]) => string
  /** The head layer sig of one branch, or null. */
  readonly headOf: (segments: readonly string[]) => Promise<string | null>
  /**
   * THE VOCABULARY OF ONE SUBTREE, record-ACCELERATED and never
   * record-DEPENDENT.
   *
   * `sign('molecule:index')` is declared `index` kind — recomputable,
   * wipe-safe, GC-able — so a collector may empty it at any moment and is
   * licensed to. This dep used to be the raw pool reader, which by its own
   * docstring "NEVER DERIVES": a wiped pool therefore changed the ANSWER (a
   * refusal instead of a claim), and `optimize-phase.md` rule 3 is explicit
   * that "cold paths must produce identical results without them". The live
   * wiring is `MoleculeIndexReader.subtreeVocabulary`, which answers from the
   * record when it is WHOLE and walks layers otherwise: identical, only
   * slower. A null here is a genuine failure to assemble, and it clears
   * `complete`.
   */
  readonly readRecord: (
    layerSig: string,
  ) => Promise<{ readonly words: readonly { readonly a: string }[]; readonly truncated?: boolean } | null>

  /** sha256 of a UTF-8 string, as 64 lowercase hex. Pure — NOT a write. */
  readonly hash: (text: string) => Promise<string>
  /** The published claim currently named by my own index, if it can be read. */
  readonly readHeld: (host: string, pubkey: string) => Promise<{ body: string; seq: number } | null>
  /** The strongest claim THIS DEVICE actually signed. */
  readonly readMinted: (pubkey: string) => Promise<{ body: string; seq: number } | null>

  /** THE GESTURE. Shown the summary, before a single byte is minted. */
  readonly confirm: (summary: VocabularyPublishSummary) => Promise<boolean>

  // ── everything below this line is a WRITE, and is unreachable until the
  //    confirmation above has returned true ─────────────────────────────────
  readonly sign: (
    surface: string, body: string, prev: string | null, seq: number, count: number, complete: boolean,
  ) => Promise<VocabularySignResult>
  /** Store one UTF-8 JSON document, content-addressed. Takes TEXT and not a
   *  Blob: the routine only ever stores canonical JSON, and the wrapper is a
   *  Store detail the routine has no business knowing. */
  readonly putResource: (text: string) => Promise<string>
  readonly markPublic: (sig: string, kind?: string, closure?: boolean) => Promise<void>
  readonly available: (sig: string) => Promise<boolean>
  readonly setRoot: (
    host: string, key: string, sig: string,
  ) => Promise<{ ok: boolean; reason?: string }>
  readonly writeRecord: (claimSig: string, record: VocabularyPublishRecord) => Promise<boolean>
  readonly now?: () => number
  readonly wait?: (ms: number) => Promise<void>
}

const segmentsOf = (path: string): string[] =>
  String(path ?? '').split('/').map((s) => s.trim()).filter(Boolean)

/**
 * WHICH WORDS THIS PARTICIPANT WOULD DECLARE — a pure read, and the whole of
 * the scope decision.
 *
 * ONE RULE GOVERNS EVERY BRANCH BELOW: A BRANCH THAT CONTRIBUTES FEWER THAN
 * ALL OF ITS REACHABLE WORDS CLEARS `complete`. A claim that silently drops
 * words makes a reader conclude "declared, absent" for a word the hive
 * genuinely serves, which is a WRONG NO — the one answer this whole design
 * exists to make unmintable, and a signed one, so no amount of reader-side
 * rigour can catch it. `declaredVocabularyPartial()` already defaults
 * pessimistically to true for the same reason.
 *
 * The rule has FOUR triggers, and the first two were the defects:
 *
 *   1. THE LEDGER INTERSECTION dropped a branch and said nothing.
 *      `publish-heads.ts` describes its own pool as "a floor, never a ceiling:
 *      it cannot know about branches published from another device", so a
 *      branch that really is published and really is served is dropped here —
 *      and the claim used to be signed `complete: true` over that narrower
 *      picture. It now says so out loud, which is precisely what the flag is
 *      for. The `published.size > 0` escape is gone too: an empty or
 *      unreadable ledger used to disable the intersection entirely, which is
 *      the fail-open direction on exactly the device (fresh, wiped) where it
 *      is most likely.
 *   2. THE BRANCH'S OWN NAME. A record is the fold over a layer's CHILDREN
 *      manifest, so publishing `/business` declared `invoices` and `clients`
 *      and never `business` — the single most likely search term for the
 *      branch, and one a visitor can plainly read off the route. Only the LAST
 *      segment is added: the ancestors on the path are not themselves public.
 *   3. a missing head, or a record the reader could not assemble.
 *   4. a `truncated` record.
 */
export const buildVocabularyBody = async (
  deps: Pick<VocabularyPublishDeps, 'publicBranches' | 'publishedKeys' | 'lineageKeyOf' | 'headOf' | 'readRecord'>,
): Promise<{ addresses: string[]; branches: string[]; complete: boolean }> => {
  const published = await deps.publishedKeys().catch(() => new Set<string>())
  const words = new Set<string>()
  const branches: string[] = []
  let complete = true

  for (const path of deps.publicBranches() ?? []) {
    const segments = segmentsOf(path)
    if (segments.length === 0) continue
    // THE INTERSECTION. A mark alone is an intention; the ledger is the
    // evidence that bytes actually went out — and a drop is a NARROWER
    // PICTURE, never a silent one.
    if (!published.has(deps.lineageKeyOf(segments))) { complete = false; continue }
    branches.push('/' + segments.join('/'))

    // THE BRANCH TILE ITSELF. `isCellPublic` marks this exact path, so its own
    // name is as reachable as any name below it.
    const own = await moleculeAddress(segments[segments.length - 1] as string).catch(() => null)
    if (own && HEX64.test(own)) words.add(own)
    else complete = false

    const head = await deps.headOf(segments).catch(() => null)
    if (!head || !HEX64.test(head)) { complete = false; continue }
    const record = await deps.readRecord(head).catch(() => null)
    if (!record) { complete = false; continue }
    if (record.truncated === true) complete = false
    for (const word of record.words ?? []) {
      if (HEX64.test(String(word?.a ?? ''))) words.add(word.a)
    }
  }

  // Past the cap the publisher signs the first N in ascending address order —
  // deterministic, and harmless because no absence is mintable from an
  // incomplete claim.
  const addresses = [...words].sort()
  if (addresses.length > MAX_CLAIM_WORDS) {
    return { addresses: addresses.slice(0, MAX_CLAIM_WORDS), branches, complete: false }
  }
  return { addresses, branches, complete }
}

const run = async (
  addresses: readonly string[],
  branches: readonly string[],
  complete: boolean,
  withdrawal: boolean,
  options: { readonly confirmed?: boolean },
  deps: VocabularyPublishDeps,
): Promise<VocabularyPublishResult> => {
  // ── THE API GUARD. A required argument with no default, so a caller cannot
  //    omit consent by forgetting a parameter. ─────────────────────────────
  if (options?.confirmed !== true) return { ok: false, failure: 'not-confirmed' }

  const host = String((await deps.host().catch(() => '')) ?? '').trim().toLowerCase()
  if (!host) return { ok: false, failure: 'no-host' }
  const surface = String((await deps.surface().catch(() => '')) ?? '').toLowerCase()
  if (!HEX64.test(surface)) return { ok: false, failure: 'no-host', detail: 'surface did not derive' }

  if (!withdrawal && addresses.length === 0) return { ok: false, failure: 'nothing-published' }

  // ── THE HUMAN GUARD, and the line every IRREVERSIBLE STEP is below. ────
  //
  // NOT MERELY EVERY WRITE. Two of the reads are irreversible effects of an
  // act the participant may be about to decline, and both used to run first:
  //
  //   * `deps.publicKey` is `readerPubkey()`, which falls through to
  //     `resolveSecretKeyHex()` and MINTS AND PERSISTS a fresh secret key on a
  //     miss. `nostr-signer.ts` names the hazard in its own words: "a user who
  //     explicitly clicked reject would walk away with a persistent signing
  //     identity in plaintext localStorage that they declined" — and a
  //     vocabulary claim makes that key load-bearing for WRITE AUTHORITY.
  //   * `deps.readHeld` is two HTTPS requests to a standing public endpoint
  //     carrying the participant's public key. Declining cannot un-send them.
  //
  // Both existed only to render `seq` in the dialog, so `seq` is `null` there
  // now and the anti-rollback plan is computed after consent at no cost.
  const summary: VocabularyPublishSummary = {
    words: new Set(addresses).size,
    branches: [...branches],
    complete,
    host,
    seq: null,
    withdrawal,
  }
  let agreed = false
  try { agreed = (await deps.confirm(summary)) === true } catch { agreed = false }
  if (!agreed) return { ok: false, failure: 'declined' }

  // ── EVERYTHING BELOW IS AN EFFECT ON THE WORLD ─────────────────────────
  const pubkey = String((await deps.publicKey().catch(() => null)) ?? '').toLowerCase()
  if (!HEX64.test(pubkey)) return { ok: false, failure: 'no-signer' }

  // Canonical bytes and their address — still pure, still nothing stored.
  const record = canonicalVocabularyBody(pubkey, addresses)
  if (!record) return { ok: false, failure: 'mint-failed', detail: 'body is not canonical' }
  let text: string
  try { text = encodeVocabularyBody(record) }
  catch { return { ok: false, failure: 'mint-failed', detail: 'body would not encode' } }
  const bodySig = String(await deps.hash(text).catch(() => '')).toLowerCase()
  if (!HEX64.test(bodySig)) return { ok: false, failure: 'mint-failed', detail: 'body did not hash' }

  const held = await deps.readHeld(host, pubkey).catch(() => null)
  const minted = await deps.readMinted(pubkey).catch(() => null)
  const plan = planVocabularyClaim(held, minted)

  // ── STORAGE WRITES START HERE ──────────────────────────────────────────
  let bodyStored: string
  try { bodyStored = String(await deps.putResource(text)).toLowerCase() }
  catch { return { ok: false, failure: 'mint-failed', detail: 'body resource write failed' } }
  if (bodyStored !== bodySig) {
    return { ok: false, failure: 'mint-failed', detail: 'stored body does not hash to the signed address' }
  }

  const signed = await deps.sign(surface, bodySig, plan.prev, plan.seq, record.words.length, complete)
  if (!signed.ok) return { ok: false, failure: 'sign-failed', detail: signed.reason }
  if (signed.pubkey !== pubkey) return { ok: false, failure: 'sign-failed', detail: 'signer key changed' }

  let claimSig: string
  try { claimSig = String(await deps.putResource(signed.json)).toLowerCase() }
  catch { return { ok: false, failure: 'mint-failed', detail: 'claim resource write failed' } }
  if (!HEX64.test(claimSig)) return { ok: false, failure: 'mint-failed', detail: 'claim did not hash' }

  try {
    await deps.markPublic(bodySig, 'resource', false)
    await deps.markPublic(claimSig, 'resource', false)
  } catch { /* the drain retries; availability below is the real gate */ }

  // THE AVAILABILITY GATE. The index must only ever name atoms a reader can
  // fetch, or the very first thing a stranger sees is a hole.
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => Date.now())
  const deadline = now() + VOCABULARY_AVAILABILITY_MS
  let servable = false
  for (;;) {
    servable = (await deps.available(claimSig).catch(() => false)) === true
      && (await deps.available(bodySig).catch(() => false)) === true
    if (servable || now() >= deadline) break
    await wait(VOCABULARY_AVAILABILITY_POLL_MS)
  }
  if (!servable) return { ok: false, failure: 'not-available', detail: claimSig }

  const set = await deps.setRoot(host, VOCABULARY_ROOT_KEY, claimSig).catch(() => ({ ok: false, reason: 'threw' }))
  if (!set.ok) return { ok: false, failure: 'index-unsafe', detail: set.reason }

  // THE LEDGER, WRITTEN BEFORE THE ACT IS REPORTED DONE. It is the `minted`
  // half of the anti-rollback rule; losing it would let a behind host talk
  // this device into re-signing a counter it already passed.
  await deps.writeRecord(claimSig, {
    v: 1,
    pubkey,
    surface,
    body: bodySig,
    prev: plan.prev,
    seq: plan.seq,
    count: record.words.length,
    complete,
    host,
    at: now(),
  }).catch(() => false)

  return {
    ok: true,
    claim: claimSig,
    body: bodySig,
    seq: plan.seq,
    count: record.words.length,
    complete,
    host,
    pubkey,
  }
}

/**
 * DECLARE THE WORDS I HOLD. The one door, and it opens only on an act.
 */
export const publishVocabulary = async (
  options: { readonly confirmed?: boolean },
  deps: VocabularyPublishDeps,
): Promise<VocabularyPublishResult> => {
  // The word set is a READ, and it runs before the API guard only so a
  // refusal can be honest about what it would have declared. It writes
  // nothing and touches no key.
  if (options?.confirmed !== true) return { ok: false, failure: 'not-confirmed' }
  const built = await buildVocabularyBody(deps)
  return await run(built.addresses, built.branches, built.complete, false, options, deps)
}

/**
 * SAY THAT I HOLD NOTHING — a SECOND, DISTINCT VERB.
 *
 * It exists because nothing may be inferred from absence: an unreachable claim
 * is UNKNOWN, so the only way to say "I hold nothing" is to SIGN it. And "I
 * publish" and "I retract" must never be reachable by the same accidental
 * call, which is why this is not a flag on the function above.
 */
export const withdrawVocabulary = async (
  options: { readonly confirmed?: boolean },
  deps: VocabularyPublishDeps,
): Promise<VocabularyPublishResult> =>
  await run([], [], true, true, options, deps)
