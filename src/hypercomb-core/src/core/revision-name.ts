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

/** Labels that are BUILD MACHINERY, not names. build-module stamps the
 *  current git branch as the genesis label, so every deploy of the same
 *  repo carries the same word — a list of revisions all called
 *  "development" names nothing. These read as "the build calls itself
 *  nothing", and the word pair (or the date) stands in. */
const AUTO_LABELS = new Set(['development', 'main', 'master', 'genesis', 'head'])

/** The label, unless it is build machinery — then ''. The single gate every
 *  revision-name consumer shares, so "development" can never lead a name. */
export function meaningfulLabel(label: string | null | undefined): string {
  const trimmed = String(label ?? '').trim()
  return AUTO_LABELS.has(trimmed.toLowerCase()) ? '' : trimmed
}

/** Title-cased word pair from the signature — the deterministic half of
 *  every minted name. */
function taggedWords(packageSig: string | null | undefined, locale: string, at: Date): string {
  const sig = String(packageSig ?? '').trim().toLowerCase()
  const words = secretTag(sig || at.toISOString().slice(0, 10), locale)
  return words.replace(/(^|\s)(\p{L})/gu, (_m, lead: string, ch: string) =>
    lead + ch.toLocaleUpperCase(locale))
}

/** `"Amber Meadow"` — the word pair alone, for list rows that already show
 *  version number and time separately and only need the revision's NAME. */
export function revisionWords({
  packageSig,
  locale = 'en',
  at = new Date(),
}: Omit<RevisionNameParts, 'label'> = {}): string {
  return taggedWords(packageSig, locale, at)
}

/** `"Amber Meadow · 1 Aug 2026"` — two words from the signature, then whatever
 *  the build calls itself (or the date, when it calls itself nothing — a git
 *  branch label counts as nothing, see AUTO_LABELS). */
export function revisionName({
  packageSig,
  label,
  locale = 'en',
  at = new Date(),
}: RevisionNameParts = {}): string {
  const trailer = meaningfulLabel(label) || at.toLocaleDateString(locale)
  return `${taggedWords(packageSig, locale, at)} · ${trailer}`
}

/** `"alpha 0.9.4 · Aug 4, 2026, 6:03 PM"` — the name of an incoming BUILD.
 *  The AUTHOR'S build name leads (the word pair stands in when the build
 *  calls itself nothing — and a git branch label counts as nothing), and the
 *  date + time trail as the changing default: each new revision mints a later
 *  time, so every update the hive takes reads as its own line in the list.
 *  The participant types over any of it. */
export function buildRevisionName({
  packageSig,
  label,
  locale = 'en',
  at = new Date(),
}: RevisionNameParts = {}): string {
  const head = meaningfulLabel(label) || taggedWords(packageSig, locale, at)
  const trailer = at.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return `${head} · ${trailer}`
}
