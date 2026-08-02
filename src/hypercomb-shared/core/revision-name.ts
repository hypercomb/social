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

import { secretTag } from '../ui/controls-bar/secret-words'

export interface RevisionNameParts {
  /** The package signature being adopted — what makes the name deterministic. */
  packageSig?: string | null
  /** The bundle's own label, if the manifest carried one. */
  label?: string | null
  locale?: string
  at?: Date
}

/** `"Amber Meadow · 1 Aug 2026"` — two words from the signature, then whatever
 *  the build calls itself (or the date, when it calls itself nothing). */
export function revisionName({
  packageSig,
  label,
  locale = 'en',
  at = new Date(),
}: RevisionNameParts = {}): string {
  const sig = String(packageSig ?? '').trim().toLowerCase()
  const words = secretTag(sig || at.toISOString().slice(0, 10), locale)
  const titled = words.replace(/(^|\s)(\p{L})/gu, (_m, lead: string, ch: string) =>
    lead + ch.toLocaleUpperCase(locale))
  const trailer = String(label ?? '').trim() || at.toLocaleDateString(locale)
  return `${titled} · ${trailer}`
}
