// core/molecule-address.ts
//
// THE ADDRESS SYNTAX, EXECUTABLE.
//
// `documentation/address-syntax.md` states the convention in prose. This module
// IS that convention, so the two cannot drift: where you store something is the
// promise you make about who can reach it, and the preimage is the whole of the
// mechanism.
//
//   sign(fold(canon(word)))          MOLECULE   a grammar. Anyone may type the word.
//   sign('<plural>:' + subjectSig)   FACET      a collection about one subject.
//   sign('<reserved>:<word>')        SYSTEM     e.g. format:hive, usage:dwell
//
// TWO PREIMAGE FUNCTIONS, NEVER ONE. A molecule is `sign(fold(canon(name)))`; a
// system pool is `sign(RAW meaning)` (`registerPoolMeaning`, pool-registry.ts).
// They are DIFFERENT functions on purpose, and `molecule-address.spec.ts`
// proves the separation holds absolutely: `canonicalizeLineageSegment` can only
// ever emit letters, digits and hyphens, in any script, so no tile name
// anywhere can reach a colon-scoped address. That is why the reservation is
// safe, and why it must not be spent on user content.
//
// MINTING IS FREE AND CANNOT FAIL. Deriving a word nobody has used starts a
// conversation rather than raising an error, so `validatePoolSpelling` REJECTS
// only what is structurally undecidable (a user word after a colon, a nested
// pool) and merely ADVISES on what is linguistic (English-shaped plurals).
// The registry grants permission; it never denies it.

import { SignatureService } from './signature.service.js'
import { canonicalizeLineageSegment } from './lineage-key.js'
import { reservedColonScopes } from './pool-registry.js'

/** A 64-hex signature — the only thing that may follow a colon besides a
 *  reserved system word. */
const SIGNATURE = /^[0-9a-f]{64}$/i

/** What `canonicalizeLineageSegment` is able to emit: Unicode letters, Unicode
 *  digits and the hyphen it folds every separator to. Exported because it is
 *  the machine-checkable statement of the colon rule — see the spec. */
export const CANON_ALPHABET = /^[\p{L}\p{N}-]*$/u

/**
 * Case fold for the ADDRESS.
 *
 * `String.prototype.toLowerCase` is locale-INDEPENDENT. `toLocaleLowerCase`
 * would map `I` to a dotless `ı` under a Turkish locale, so two machines
 * holding the same word would derive different addresses and the vocabulary
 * would stop being shared. Case folding IS the interop; the locale-sensitive
 * variant is the one thing that breaks it.
 */
export const fold = (value: string): string => String(value ?? '').toLowerCase()

/**
 * The MOLECULE PREIMAGE — `fold(canon(name) || trim(name))`.
 *
 * Note the parenthesisation: the fold wraps the WHOLE expression, including the
 * raw-trimmed fallback. `documentation/address-syntax.md` spelled it
 * `fold(canon(name)) || trim(name)`, which leaves the fallback branch unfolded
 * — and the fallback branch is reachable by names that still case-fold. `Ⓐ`
 * (U+24B6) is category So, so nothing survives canon's letter/digit filter and
 * the fallback fires; under the doc's ordering `Ⓐ` and `ⓐ` would be two
 * molecules of the same word. Folding the whole expression converges them.
 *
 * THE FALLBACK IS NOT OPTIONAL. `canon` returns `''` for a name that is
 * entirely symbols or emoji, and `sign('')` IS the empty-content ROOT address —
 * the same root-bag/empty-hash collision `lineageKey` guards against. A
 * symbol-only name stays distinct as its folded raw self.
 */
export const moleculeKey = (name: unknown): string =>
  fold(canonicalizeLineageSegment(name) || String(name ?? '').trim())

/** meaning → sig, and the inverse. A session mints each word once.
 *
 *  BOUNDED. One entry per DISTINCT word the session touched, in both
 *  directions — and an index pass derives an address for every name in the
 *  hive, so on a large one these would grow to the whole vocabulary and never
 *  shrink. `moleculeWordOf` needs the reverse map, so neither can simply be
 *  dropped; both are cleared wholesale past the cap. A cleared memo costs one
 *  re-hash, which is what it was avoiding in the first place. */
const MEMO_LIMIT = 4096
const addressByKey = new Map<string, string>()
const keyByAddress = new Map<string, string>()

const signText = async (preimage: string): Promise<string> => {
  const known = addressByKey.get(preimage)
  if (known) return known
  const sig = await SignatureService.sign(
    new TextEncoder().encode(preimage).buffer as ArrayBuffer,
  )
  if (addressByKey.size >= MEMO_LIMIT) { addressByKey.clear(); keyByAddress.clear() }
  addressByKey.set(preimage, sig)
  keyByAddress.set(sig, preimage)
  return sig
}

/**
 * `sign(fold(canon(name)))` — the address of the molecule a word names.
 *
 * Throws `RangeError` on an empty key rather than returning the root address.
 * Minting the root by accident is the one failure with no recovery: every
 * subsequent read and write lands on the empty-content sigbag shared by
 * everything. `rootMoleculeAddress()` is the deliberate door.
 */
export const moleculeAddress = async (name: unknown): Promise<string> => {
  const key = moleculeKey(name)
  if (!key) throw new RangeError('moleculeAddress: an empty name has no molecule — it is the ROOT')
  return await signText(key)
}

/** The ROOT address, `sign('')`, reachable only on purpose. */
export const rootMoleculeAddress = async (): Promise<string> => await signText('')

/** The word behind a molecule address THIS session derived, if any. A molecule
 *  minted elsewhere is still a molecule — absence here is not "not a molecule". */
export const moleculeWordOf = (address: string): string | undefined =>
  keyByAddress.get(address)

/** `'<plural>:' + subjectSig`. Plural because a facet genuinely holds a
 *  collection about that subject; position determines the form, so nobody has
 *  to choose. */
export const facetPreimage = (plural: string, subjectSig: string): string => {
  const word = moleculeKey(plural)
  if (!word) throw new RangeError('facetPreimage: the plural is empty')
  const subject = String(subjectSig ?? '')
  if (!SIGNATURE.test(subject)) {
    throw new RangeError('facetPreimage: the subject must be a 64-hex signature')
  }
  return `${word}:${subject.toLowerCase()}`
}

/** `sign('<plural>:' + subjectSig)` — a collection about one subject. */
export const facetAddress = async (plural: string, subjectSig: string): Promise<string> =>
  await signText(facetPreimage(plural, subjectSig))

// ---------------------------------------------------------------------------
// THE VALIDATOR
// ---------------------------------------------------------------------------

/** Which of the three forms a spelling is, or why it is none of them. Never a
 *  bare boolean — a refusal that cannot say what it refused is how the original
 *  pool-collision incident stayed invisible for months. */
export type SpellingVerdict =
  | { readonly ok: true; readonly form: 'molecule' | 'facet' | 'system'; readonly advice?: string }
  | { readonly ok: false; readonly reason: string; readonly suggestion?: string }

/** Words whose trailing `s` is not a plural. English-shaped, and deliberately
 *  incomplete — this list only ever suppresses ADVICE, never a rejection. */
const NOT_PLURAL = new Set([
  'address', 'analysis', 'as', 'basis', 'bias', 'bus', 'canvas', 'chaos', 'class',
  'focus', 'gas', 'genus', 'glass', 'is', 'iris', 'lens', 'mass', 'news', 'pass',
  'press', 'process', 'series', 'species', 'status', 'stress', 'success', 'this',
  'us', 'was', 'yes',
])

const looksPlural = (word: string): boolean => {
  if (word.length < 4 || NOT_PLURAL.has(word)) return false
  if (!word.endsWith('s')) return false
  if (/(?:ss|us|is|as|os)$/.test(word)) return false
  return true
}

/**
 * Is this a legal pool spelling, and which form is it?
 *
 * REJECTS what is decidable:
 *   - an empty spelling
 *   - a `/` (a path, not an address) or more than one colon (rule 6 — a pool
 *     never contains another pool; everything below the first level is a
 *     bucket)
 *   - `A:B` where `B` is not a 64-hex signature and `A` is not a reserved
 *     system scope (rule 3 — this is the whole of what keeps the two
 *     namespaces apart; rule 2 says the fix is a compound WORD)
 *
 * ADVISES on what is linguistic:
 *   - a bare word that looks plural (rule 1 — a bare word is singular, so it
 *     reads correctly at every level). Never a rejection: the heuristic is
 *     English-shaped, `address` and `news` are counterexamples, and minting
 *     must not be able to fail.
 *
 * `reserved` defaults to the colon scopes DERIVED from `SCOPED_POOL_MEANINGS`,
 * so reserving a new system scope extends the validator for free and there is
 * never a second list of meanings to drift.
 */
export const validatePoolSpelling = (
  meaning: string,
  reserved: ReadonlySet<string> = reservedColonScopes(),
): SpellingVerdict => {
  const raw = String(meaning ?? '').trim()
  if (!raw) return { ok: false, reason: 'an empty spelling addresses the ROOT, not a pool' }
  if (raw.includes('/')) {
    return {
      ok: false,
      reason: 'a pool address is one hash of one word — a slash is a path, and paths are routes, never addresses',
      suggestion: raw.split('/').filter(Boolean).join('-'),
    }
  }

  const parts = raw.split(':')
  if (parts.length > 2) {
    return {
      ok: false,
      reason: 'a pool never contains another pool — everything below the first level is a bucket, never a new meaning',
      suggestion: `${parts[0]}:${parts.slice(1).join('-')}`,
    }
  }

  if (parts.length === 2) {
    const [scope, tail] = parts
    if (!scope) return { ok: false, reason: 'a colon with nothing before it names no scope' }
    if (!tail) return { ok: false, reason: 'a colon with nothing after it names no subject' }
    if (SIGNATURE.test(tail)) {
      return looksPlural(fold(scope))
        ? { ok: true, form: 'facet' }
        : { ok: true, form: 'facet', advice: `'${scope}' precedes a signature, so it holds a collection — plural reads correctly there` }
    }
    if (reserved.has(scope)) return { ok: true, form: 'system' }
    return {
      ok: false,
      reason: `after a colon: a reserved system word or a 64-hex signature, never a user word — '${scope}' is not reserved and '${tail}' is not a signature`,
      suggestion: `${scope}-${tail}`,
    }
  }

  const word = fold(raw)
  return looksPlural(word)
    ? { ok: true, form: 'molecule', advice: `a bare word is singular — it names what each member IS, so it reads at every level. Did you mean '${word.replace(/e?s$/, '')}'?` }
    : { ok: true, form: 'molecule' }
}
