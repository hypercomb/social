// A meaningful, deterministic name for a build the hive is about to take.
//
// The header's upgrade indicator used to STOP and ask for a restore-point name
// before it would move: a naming step wedged into the middle of a one-click
// action, and one a phone could not even show (`.restore-name` is
// `display: none` under 600px). But the name is not a decision — it only has to
// be meaningful and overwritable. So the same word-pair service the breadcrumb
// uses for its secret words mints it from the PACKAGE SIGNATURE: the same build
// carries the same two words on every device, the different times a hive was
// updated read as names instead of timestamps, and the participant can type
// over it before adopting.

import { secretTag } from './secret-words/index.js'

export interface RevisionNameParts {
  /** The package signature being adopted — what makes the name deterministic. */
  packageSig?: string | null
  /** The bundle's own label, if the manifest carried one. */
  label?: string | null
  locale?: string
  at?: Date
}

/** Title-cased word pair from the signature — the deterministic half of
 *  every minted name. */
function taggedWords(packageSig: string | null | undefined, locale: string, at: Date): string {
  const sig = String(packageSig ?? '').trim().toLowerCase()
  const words = secretTag(sig || at.toISOString().slice(0, 10), locale)
  return words.replace(/(^|\s)(\p{L})/gu, (_m, lead: string, ch: string) =>
    lead + ch.toLocaleUpperCase(locale))
}

/** `"Amber Meadow · 1 Aug 2026"` — two words from the signature, then whatever
 *  the build calls itself (or the date, when it calls itself nothing). */
export function revisionName({
  packageSig,
  label,
  locale = 'en',
  at = new Date(),
}: RevisionNameParts = {}): string {
  const trailer = String(label ?? '').trim() || at.toLocaleDateString(locale)
  return `${taggedWords(packageSig, locale, at)} · ${trailer}`
}

/** `"alpha 0.9.4 · Aug 4, 2026, 6:03 PM"` — the name of an incoming BUILD.
 *  The AUTHOR'S build name leads (the word pair stands in when the build
 *  calls itself nothing), and the date + time trail as the changing default:
 *  each new revision mints a later time, so every update the hive takes
 *  reads as its own line in the list. The participant types over any of it. */
export function buildRevisionName({
  packageSig,
  label,
  locale = 'en',
  at = new Date(),
}: RevisionNameParts = {}): string {
  const head = String(label ?? '').trim() || taggedWords(packageSig, locale, at)
  const trailer = at.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return `${head} · ${trailer}`
}
