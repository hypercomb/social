// sharing/head-claim-signer.ts
//
// THE ESSENTIALS BINDING for `hypercomb-core/src/core/head-claim.ts`: it turns
// the participant's existing nostr identity into the `HeadClaimVerifier` core's
// acceptor takes as an argument, and mints signed head entries with the same
// key. Core defines the preimage and the acceptance rules and imports nothing;
// this file owns the envelope and the curve.
//
// WHY THE ENVELOPE EXISTS AT ALL. The step-3 brief specified an injected
// `verify(pubkeyHex, messageBytes, sigHex)` over the molecule preimage. That is
// NOT IMPLEMENTABLE with the identity this project has, and the design was
// adjusted rather than the capability invented:
//
//   - `NostrSigner.signEvent` (sharing/nostr-signer.ts) signs only a nostr
//     event `{kind, created_at, tags, content}` where `content` is a STRING.
//     There is no raw-bytes door, and a NIP-07 extension has none either.
//   - the schnorr signature covers the NIP-01 EVENT ID (a hash of the
//     serialized event), never an application-chosen byte string.
//   - `nostr-tools` exposes `verifyEvent(evt)` — whole event in, boolean out.
//   - reaching for raw `schnorr` from @noble/curves would be a PHANTOM
//     dependency: it is present only transitively and is not declared in
//     hypercomb-essentials/package.json.
//
// So the preimage rides VERBATIM as the event `content`, and the injected
// verifier asserts four things together before the curve maths ever runs. This
// is the shape `sharing/hive-pointer.ts` already ships for the hive index, and
// its comment states the reason: it is the pubkey comparison — not the schnorr
// check — that stops substitution. `verifyEvent` alone proves only that an
// event is internally consistent under the key the EVENT DECLARES.

import { get, headClaimPreimage, parseHeadClaimPreimage } from '@hypercomb/core'
import type { HeadClaimVerifier, OfferedHeadClaim } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools'

// A head claim is a nostr event, and 30000-39999 is NIP-01's
// PARAMETERIZED-REPLACEABLE range: a relay keeps exactly ONE event per
// (kind, pubkey, d-tag), and a MISSING `d` tag is the empty string. So a kind
// in this range without a `d` tag means every head claim a participant
// publishes REPLACES all of their previous ones ACROSS EVERY MOLECULE — a
// legitimate head for molecule B silently deleting the head for molecule A.
// This repo's own convention is explicit about it (`content-broker.drone.ts`:
// "Parameterized-replaceable: ['d', sig] makes the relay store", and
// `client-presence.drone.ts` does the same), so the molecule address is the
// `d` tag and nothing else can be.
const D_TAG = 'd'

/** Kind for a molecule head claim. 30564 is HIVE_INDEX_EVENT_KIND
 *  (sharing/hive-link.ts) and 30200-30217 are the mesh kinds; this sits beside
 *  them and is checked explicitly, so a NIP-98 header (27235) or a hive index
 *  can never be replayed as a head claim even before the domain tag is read. */
export const HEAD_CLAIM_KIND = 30565

/** The IoC key the ONE identity registers under (sharing/nostr-signer.ts). */
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

const HEX64 = /^[0-9a-f]{64}$/

interface SignerLike {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
  getPublicKeyHex?: () => Promise<string | null>
}

export type HeadClaimSignFailure =
  /** No identity is available, or the extension declined to name one. */
  | 'no signer'
  /** The arguments could not make a claim any reader — including this one — can parse. */
  | 'malformed'
  | 'signing refused'
  | 'signer key changed'
  | 'self-verify failed'

export type HeadClaimSignResult =
  | { ok: true; pubkey: string; claim: OfferedHeadClaim; event: Record<string, unknown>; json: string }
  | { ok: false; reason: HeadClaimSignFailure }

const signer = (): SignerLike | undefined => {
  try { return get(NOSTR_SIGNER_KEY) as SignerLike | undefined } catch { return undefined }
}

// A lazily-cached pubkey for the HOT path, mirroring the cache
// `sharing/host-sync.service.ts` already keeps and for the same stated reason:
// `getPublicKeyHex()` is async and may dial out to a NIP-07 extension.
let cachedReaderPubkey: string | null = null

/**
 * MY bucket address, or null.
 *
 * NEVER CALL THIS ON A READ PATH. `getPublicKeyHex()` falls through to
 * `resolveSecretKeyHex()`, which MINTS AND PERSISTS a fresh 32-byte secret on
 * a miss (nostr-signer.ts). So merely asking "which of these buckets is mine?"
 * would give a read-only visitor an identity it never asked for. Reads must
 * treat a null cache as "I own no bucket" — every row foreign, nothing minted —
 * and only the COMMIT path, where becoming an author is the point, may call it.
 */
export const readerPubkey = async (): Promise<string | null> => {
  if (cachedReaderPubkey) return cachedReaderPubkey
  const s = signer()
  if (!s?.getPublicKeyHex) return null
  let pk: string | null = null
  try { pk = await s.getPublicKeyHex() } catch { return null }
  const key = String(pk ?? '').toLowerCase()
  if (!HEX64.test(key)) return null
  cachedReaderPubkey = key
  return key
}

/** The cached pubkey WITHOUT resolving one — safe on a read path. */
export const cachedPubkey = (): string | null => cachedReaderPubkey

/** Drop the cache. `#cachedPubkey` on the signer itself is never invalidated
 *  within a session, so a key change mid-session can still leave a stale bucket
 *  address in flight elsewhere; this at least lets a teardown reset ours. */
export const resetReaderPubkey = (): void => { cachedReaderPubkey = null }

/**
 * THE INJECTED VERIFIER, built per entry as a closure over the parsed event.
 * No map, no cache, no lifetime.
 *
 * Order is cheapest-first and the elliptic-curve maths runs LAST on purpose:
 *
 *   1. kind          — this is a head claim, not a harvested NIP-98 header
 *   2. pubkey        — the key the event declares IS the bucket the reader
 *                      ASKED FOR (hive-pointer.ts does exactly this, and calls
 *                      a mismatch 'forged')
 *   3. content       — the signed string IS the preimage the reader REBUILT
 *                      from that address; this is what makes a claim minted
 *                      for another molecule inert here
 *   4. verifyEvent   — and only now, is the event actually signed
 */
export const verifierFor = (evt: Record<string, unknown>): HeadClaimVerifier =>
  (pubkey, preimage, sig) => {
    if (Number(evt?.['kind']) !== HEAD_CLAIM_KIND) return false
    if (String(evt?.['pubkey'] ?? '').toLowerCase() !== pubkey) return false
    if (String(evt?.['sig'] ?? '').toLowerCase() !== sig) return false
    if (String(evt?.['content'] ?? '') !== preimage) return false
    try { return verifyEvent(evt as never) } catch { return false }
  }

/**
 * Read one head ENTRY (the signed event, as stored bytes or a JSON string) into
 * the `{offered, verify}` pair `acceptHeadClaim` takes.
 *
 * `parsed.molecule` and `parsed.pubkey` are DELIBERATELY DISCARDED — they are
 * available only for a diagnostic line ("signed for X/Y, offered at A/B").
 * Nothing on the accept path reads placement out of the bytes; the caller
 * supplies the address it walked to.
 */
export const readHeadEntry = (
  entry: string | Uint8Array,
): { offered: OfferedHeadClaim; event: Record<string, unknown>; signedFor: { molecule: string; pubkey: string } } | null => {
  let text: string
  try {
    text = typeof entry === 'string' ? entry : new TextDecoder().decode(entry)
  } catch { return null }
  let evt: Record<string, unknown>
  try { evt = JSON.parse(text) as Record<string, unknown> } catch { return null }
  if (!evt || typeof evt !== 'object') return null
  const parsed = parseHeadClaimPreimage(String(evt['content'] ?? ''))
  if (!parsed) return null
  return {
    offered: {
      head: parsed.head,
      prev: parsed.prev,
      seq: parsed.seq,
      sig: String(evt['sig'] ?? '').toLowerCase(),
    },
    // THE PARSED EVENT, NOT A VERIFIER. This used to hand back
    // `verify: verifierFor(evt)` — a security primitive supplied by the very
    // bytes it is meant to judge. It was correct (the closure captures only
    // data, and `verifierFor` compares the address before running the curve),
    // and it invited exactly one refactor to undo it: `read?.verify ?? (() =>
    // true)`, or a `readHeadEntry(entry, {verify})` option, and the whole
    // design collapses with no test failing. The caller now names `verifierFor`
    // itself, so the injected verifier is never a field on untrusted input.
    event: evt,
    signedFor: { molecule: parsed.molecule, pubkey: parsed.pubkey },
  }
}

/**
 * Mint a signed head entry for MY bucket at `molecule`.
 *
 * THREE DETAILS THAT MATTER:
 *
 *  (a) the event is composed INLINE from four literal fields, so
 *      `signEvent`'s silent pass-through — `if (evt?.id && evt?.pubkey &&
 *      evt?.sig) return evt`, which hands an attacker-supplied object BACK
 *      UNSIGNED — can never fire. That trap is defused structurally, not by
 *      remembering.
 *  (b) `pubkey` is read BACK off the SIGNED event and compared, because a
 *      NIP-07 extension signs an event it composed and owns the result.
 *  (c) `created_at` is used for NOTHING. The extension may rewrite it.
 *      Recency lives in the signed `seq` inside `content`.
 *
 *  (d) THE WRITER IS NEVER A WEAKER GATE THAN THE READER. `acceptHeadClaim`
 *      has a shape gate ("seq 0 and genesis must agree", hex head, non-negative
 *      safe-integer seq) and this used to run none of it, so a caller could
 *      sign — and be told `ok: true` for — bytes that `readHeadEntry` returns
 *      null for on the very next line. Under new-before-old publishing (write
 *      the entry, then sweep the bucket's siblings) that is not cosmetic: it
 *      prunes the live head in favour of an unreadable one and destroys the
 *      author's published head for every peer while the local store believes it
 *      committed. `parseHeadClaimPreimage` is the same gate the reader uses, so
 *      the two can never drift.
 *
 * A refusal is a normal return value, never a throw — a NIP-07 call can raise a
 * user permission prompt and be denied, and a reader with no signer at all must
 * still be able to READ every molecule (verification is against the BUCKET's
 * key, never the reader's).
 */
export const signHeadClaim = async (
  molecule: string,
  head: string,
  prev: string | null,
  seq: number,
): Promise<HeadClaimSignResult> => {
  const s = signer()
  if (!s?.signEvent) return { ok: false, reason: 'no signer' }
  const pubkey = await readerPubkey()
  if (!pubkey) return { ok: false, reason: 'no signer' }

  const content = headClaimPreimage(molecule, pubkey, head, prev, seq)
  // THE SHAPE GATE, BEFORE THE KEY IS EVER ASKED. Refusing here also means a
  // denied NIP-07 prompt is never spent on bytes that were dead anyway.
  const parsed = parseHeadClaimPreimage(content)
  if (!parsed || parsed.molecule !== molecule || parsed.pubkey !== pubkey) {
    return { ok: false, reason: 'malformed' }
  }

  let signed: Record<string, unknown>
  try {
    signed = await s.signEvent({
      kind: HEAD_CLAIM_KIND,
      created_at: Math.floor(Date.now() / 1000),
      // `d` is the molecule, and it is STRUCTURAL rather than a hint: see D_TAG
      // above — a parameterized-replaceable kind with no `d` tag makes every
      // head claim replace every other one the same key ever published. `h` is
      // an indexable hint and is NEVER authoritative: the acceptor reads the
      // molecule and the head out of the signed CONTENT, and the address out of
      // its own walk.
      tags: [[D_TAG, molecule], ['h', head]],
      content,
    })
  } catch { return { ok: false, reason: 'signing refused' } }

  if (String(signed?.['pubkey'] ?? '').toLowerCase() !== pubkey) {
    return { ok: false, reason: 'signer key changed' }
  }

  const claim: OfferedHeadClaim = { head, prev, seq, sig: String(signed['sig'] ?? '').toLowerCase() }

  // SIGN THEN SELF-VERIFY, BEFORE PUBLISHING — AGAINST THE BYTES, NOT THE
  // OBJECT. `nostr-tools`' `finalizeEvent` stamps `event[verifiedSymbol] = true`
  // and `verifyEvent` returns that memo before touching the curve, so verifying
  // the object the signer just handed back is three string comparisons wearing
  // a signature check's clothes. A JSON round trip drops the symbol, and the
  // round-tripped bytes are also exactly what a peer will receive — so this
  // checks the thing that is actually published.
  const json = JSON.stringify(signed)
  let published: Record<string, unknown>
  try { published = JSON.parse(json) as Record<string, unknown> } catch { return { ok: false, reason: 'self-verify failed' } }
  if (!verifierFor(published)(pubkey, content, claim.sig)) {
    return { ok: false, reason: 'self-verify failed' }
  }

  return { ok: true, pubkey, claim, event: signed, json }
}
