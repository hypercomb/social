// hypercomb-shared/core/mark-set.ts
//
// ONE CANONICAL FORM FOR A SET OF MARKS — the bytes a bouquet and an interest
// both hash, in one place so they cannot disagree.
//
// A bouquet is the set you PUT ON things; an interest is the set you WATCH for
// (see `bouquet-registry.ts` for the distinction). They are the same kind of
// thing pointed in opposite directions, and both take their identity from the
// SET: sorted, de-duplicated, blank-free, so the signature is a property of
// what the marks ARE rather than of the order somebody happened to pick them.
// That is what lets two participants who assemble the same set independently
// hold ONE resource, and what lets a set assembled as one be adopted as the
// other without conversion.
//
// THEY DRIFTED, WHICH IS WHY THIS FILE EXISTS. Each registry carried its own
// private `#canonical` and `#bytes`, and when the interest registry moved to
// code-unit order the bouquet registry did not follow. The two then produced
// DIFFERENT bytes for the same marks whenever case or non-ASCII was involved,
// so one set landed on two resources and the interchangeability the comments
// claimed quietly stopped being true. Two copies of a rule is one copy too
// many; this is the rule.
//
// CODE-UNIT ORDER, NEVER `localeCompare`. Collation is a property of the
// RUNTIME — locale, ICU build, browser — so the same marks sorted on two
// machines can hash to two addresses, which is exactly the failure the
// canonical form exists to prevent. Default `sort()` is byte-stable
// everywhere.
//
// Ordering marks for a HUMAN is a different job and still uses
// `localeCompare` at the call sites that display them. Identity is not
// presentation.

import { SignatureService } from '@hypercomb/core'

/** Sorted, de-duplicated, blank-free. Idempotent — canonicalising a canonical
 *  set returns it unchanged, so callers may pass either. */
export const canonicalMarks = (marks: readonly string[]): string[] =>
  [...new Set(marks.map(m => String(m ?? '').trim()).filter(Boolean))].sort()

/** The bytes a mark set hashes to. ONE definition, used by both the derived
 *  signature and the stored resource — if those two ever disagreed, a named
 *  bouquet or interest would resolve to nothing. */
export const markSetBytes = (marks: readonly string[]): string =>
  JSON.stringify({ marks: canonicalMarks(marks) })

/** The signature a set of marks HAS. Derived, never written — storing is the
 *  caller's separate act, and deliberately so: gathering passes through every
 *  intermediate set on the way to the one you meant, and committing each would
 *  leave a resource at the content root for every combination nobody asked for.
 *
 *  `null` for an empty set, which has no identity worth minting. */
export const markSetSignature = async (marks: readonly string[]): Promise<string | null> => {
  const clean = canonicalMarks(marks)
  if (clean.length === 0) return null
  const bytes = new TextEncoder().encode(markSetBytes(clean)).buffer as ArrayBuffer
  return await SignatureService.sign(bytes)
}
