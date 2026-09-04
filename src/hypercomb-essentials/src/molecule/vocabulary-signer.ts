// molecule/vocabulary-signer.ts
//
// THE ESSENTIALS BINDING for `hypercomb-core/src/core/vocabulary-claim.ts`:
// it turns the participant's existing nostr identity into the
// `VocabularyClaimVerifier` core's acceptor takes as an argument, and mints
// signed claims with the same key. Core defines the preimage and the
// acceptance rule and imports nothing; this file owns the envelope and the
// curve.
//
// It is `sharing/head-claim-signer.ts` line for line, and deliberately so —
// every reason that file gives for its shape applies here unchanged:
//
//   * `NostrSigner.signEvent` signs only a nostr event whose `content` is a
//     STRING. There is no raw-bytes door and a NIP-07 extension has none, so
//     the preimage rides VERBATIM as `content`.
//   * the verifier asserts kind, then that the event's DECLARED pubkey is the
//     key the reader ASKED FOR, then that the signed string IS the preimage
//     the reader REBUILT — and only then runs the curve. It is the pubkey and
//     content comparison, not the schnorr check, that closes the hole.
//   * `created_at` is used for NOTHING; the extension may rewrite it. Recency
//     lives in the signed `seq` inside `content`.
//   * the writer runs the READER'S shape gate before a NIP-07 prompt is ever
//     spent, so it can never sign bytes the reader refuses.
//   * sign-then-self-verify runs against the JSON ROUND-TRIPPED bytes, because
//     `nostr-tools` memoises `verifiedSymbol` on the object it just signed.

import {
  parseVocabularyClaimPreimage,
  vocabularyClaimPreimage,
  type OfferedVocabularyClaim,
  type VocabularyClaimVerifier,
} from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools'
import { readerPubkey } from '../sharing/head-claim-signer.js'
import { nostrSigner, type NostrSignerLike } from './vocabulary-signer.deps.js'

// A parameterized-replaceable kind with no `d` tag makes every event a key
// publishes REPLACE all of their previous ones — so the SURFACE is the `d`
// tag and nothing else can be. (A vocabulary claim is one per surface per
// publisher by construction, which is exactly what a `d` tag scopes.)
const D_TAG = 'd'

/** Kind for a signed vocabulary claim. 30564 is the hive index and 30565 is a
 *  molecule head claim (sharing/head-claim-signer.ts); this sits beside them
 *  and is checked explicitly, so a NIP-98 header (27235), a hive index or a
 *  head claim can never be replayed as a vocabulary claim even before the
 *  domain tag on line one is read. */
export const VOCABULARY_CLAIM_KIND = 30566

const HEX64 = /^[0-9a-f]{64}$/

export type VocabularySignFailure =
  | 'no signer'
  | 'malformed'
  | 'signing refused'
  | 'signer key changed'
  | 'self-verify failed'

export type VocabularySignResult =
  | { ok: true; pubkey: string; claim: OfferedVocabularyClaim; event: Record<string, unknown>; json: string }
  | { ok: false; reason: VocabularySignFailure }

/**
 * THE INJECTED VERIFIER, built per entry as a closure over the parsed event.
 * No map, no cache, no lifetime. Cheapest first; the elliptic-curve maths runs
 * LAST on purpose.
 */
export const verifierFor = (evt: Record<string, unknown>): VocabularyClaimVerifier =>
  (pubkey, preimage, sig) => {
    if (Number(evt?.['kind']) !== VOCABULARY_CLAIM_KIND) return false
    if (String(evt?.['pubkey'] ?? '').toLowerCase() !== pubkey) return false
    if (String(evt?.['sig'] ?? '').toLowerCase() !== sig) return false
    if (String(evt?.['content'] ?? '') !== preimage) return false
    try { return verifyEvent(evt as never) } catch { return false }
  }

/**
 * Read one claim ENTRY (the signed event, as stored bytes or a JSON string)
 * into the `{offered, event}` pair the accept path takes.
 *
 * `parsed.pubkey` and `parsed.surface` are DELIBERATELY DISCARDED into
 * `signedFor`, available only for a diagnostic line. Nothing on the accept
 * path reads placement out of the bytes; the caller supplies the address it
 * walked to.
 *
 * A VERIFIER IS NEVER A FIELD ON UNTRUSTED INPUT — the caller names
 * `verifierFor` itself. Handing one back invites exactly one refactor
 * (`read?.verify ?? (() => true)`) after which the whole design collapses with
 * no test failing.
 */
export const readVocabularyEntry = (
  entry: string | Uint8Array,
): {
  offered: OfferedVocabularyClaim
  event: Record<string, unknown>
  signedFor: { pubkey: string; surface: string }
} | null => {
  let text: string
  try {
    text = typeof entry === 'string' ? entry : new TextDecoder().decode(entry)
  } catch { return null }
  let evt: Record<string, unknown>
  try { evt = JSON.parse(text) as Record<string, unknown> } catch { return null }
  if (!evt || typeof evt !== 'object') return null
  const parsed = parseVocabularyClaimPreimage(String(evt['content'] ?? ''))
  if (!parsed) return null
  return {
    offered: {
      body: parsed.body,
      prev: parsed.prev,
      seq: parsed.seq,
      count: parsed.count,
      complete: parsed.complete,
      sig: String(evt['sig'] ?? '').toLowerCase(),
    },
    event: evt,
    signedFor: { pubkey: parsed.pubkey, surface: parsed.surface },
  }
}

/**
 * Mint a signed vocabulary claim for MY key at `surface`.
 *
 * A refusal is a normal return value, never a throw — a NIP-07 call can raise
 * a permission prompt and be denied, and a reader with no signer at all must
 * still be able to READ every publisher's claim (verification is against the
 * CLAIMANT's key, never the reader's).
 *
 * `readerPubkey()` is reached here and ONLY here in this feature: it falls
 * through to `resolveSecretKeyHex()`, which mints and persists a fresh secret
 * on a miss. That is correct on a path where becoming an author is the point,
 * and would silently give a read-only visitor an identity anywhere else.
 */
export const signVocabularyClaim = async (
  surface: string,
  body: string,
  prev: string | null,
  seq: number,
  count: number,
  complete: boolean,
  deps: { signer?: () => NostrSignerLike | undefined; publicKey?: () => Promise<string | null> } = {},
): Promise<VocabularySignResult> => {
  const s = (deps.signer ?? nostrSigner)()
  if (!s?.signEvent) return { ok: false, reason: 'no signer' }
  const pubkey = String((await (deps.publicKey ?? readerPubkey)().catch(() => null)) ?? '').toLowerCase()
  if (!HEX64.test(pubkey)) return { ok: false, reason: 'no signer' }

  const content = vocabularyClaimPreimage(pubkey, surface, body, prev, seq, count, complete)
  // THE SHAPE GATE, BEFORE THE KEY IS EVER ASKED. The writer is never a weaker
  // gate than the reader, and refusing here also means a denied NIP-07 prompt
  // is never spent on bytes that were dead anyway.
  const parsed = parseVocabularyClaimPreimage(content)
  if (!parsed || parsed.pubkey !== pubkey || parsed.surface !== surface) {
    return { ok: false, reason: 'malformed' }
  }

  let signed: Record<string, unknown>
  try {
    signed = await s.signEvent({
      kind: VOCABULARY_CLAIM_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [[D_TAG, surface]],
      content,
    })
  } catch { return { ok: false, reason: 'signing refused' } }

  if (String(signed?.['pubkey'] ?? '').toLowerCase() !== pubkey) {
    return { ok: false, reason: 'signer key changed' }
  }

  const claim: OfferedVocabularyClaim = {
    body, prev, seq, count, complete, sig: String(signed['sig'] ?? '').toLowerCase(),
  }

  const json = JSON.stringify(signed)
  let published: Record<string, unknown>
  try { published = JSON.parse(json) as Record<string, unknown> }
  catch { return { ok: false, reason: 'self-verify failed' } }
  if (!verifierFor(published)(pubkey, content, claim.sig)) {
    return { ok: false, reason: 'self-verify failed' }
  }

  return { ok: true, pubkey, claim, event: signed, json }
}
