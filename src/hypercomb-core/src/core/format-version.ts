// core/format-version.ts
//
// THE HIVE FORMAT MARKER — how a client says "I cannot read all of this".
//
// The molecule direction moves new writes to new addresses and leaves old
// data where it lies. DATA NEVER HEALS: there is no dual-pointer migration,
// no backfill, no repair pass. The consequence is that an OLDER CLIENT WILL
// STOP SEEING NEW CONTENT — silently, with no error and nothing missing that
// it knows to look for. This module is what turns that silent divergence into
// a legible sentence.
//
// TWO CONSTRAINTS SHAPE EVERYTHING HERE.
//
//   1. IT MUST SHIP BEFORE THE CHANGE IT PROTECTS AGAINST. A client that
//      predates the check cannot report anything, so this lands while the
//      format is still the old one and `SUPPORTED_FORMAT_VERSION` is still 1.
//      Do NOT bump it here: it moves in the same change that first writes the
//      new addresses, not before.
//
//   2. IT MUST BE READABLE BY A CLIENT THAT DOES NOT UNDERSTAND THE NEW
//      FORMAT. So the declaration is plain JSON in the OLD format, in a place
//      old clients already read. Putting it inside a molecule would be
//      circular.
//
// POWER ASYMMETRY — WHY THIS NEVER GATES. `hardDeleteVetoFor` fails CLOSED
// because its power is to DESTROY: a guard that cannot see what it is about
// to remove must refuse. This marker's only power is to WARN, so nothing here
// may ever lock a participant out — a future reader tempted to harden this
// into a gate would be building a lockout that any corrupt byte can trigger.
//
// But "fails open" is NOT "says nothing". An ABSENT declaration is silence;
// a declaration that is PRESENT and unreadable is a sentence, because the only
// thing that writes one is a client newer than this one. Collapsing the two
// was how a future schema change — nesting the numbers, or making a field
// optional that this reader requires — would have produced total silence on
// exactly the clients this module exists to warn. `marker-unreadable` is that
// distinction, and the caller supplies it: `parseHiveFormat` cannot tell
// "nothing there" from "something I cannot read".
//
// ZERO DEPENDENCIES, like `directory-safety.ts`. Two integers and `<`. No
// semver library, no I/O, no globals. The wall clock is read in exactly one
// place, for exactly one decision — whether the record's date is in the future
// and therefore not a date this sentence may state as fact — and `now` is an
// overridable parameter so every sentence stays deterministic under test. No
// VERDICT depends on it: the clock can only remove a date clause, never change
// what the client can read.

/**
 * The hive format THIS client writes and fully understands.
 *
 * Bumped in the same change that first writes the new format — NEVER ahead of
 * it. Bumping it early makes every existing hive report `ahead-of-hive` and
 * trains the participant to ignore the marker before it has ever said
 * anything true.
 */
export const SUPPORTED_FORMAT_VERSION = 1

/** The declaration a hive publishes about its own format. */
export interface HiveFormatDeclaration {
  kind: 'hypercomb.hive-format'
  /** Schema version of THIS record. Unknown extras are tolerated. */
  v: number
  /** The format the hive's NEWEST writes use. */
  format: number
  /** The lowest client `SUPPORTED_FORMAT_VERSION` that reads it FULLY. */
  minReader: number
  /** When the format last moved (epoch ms). 0 when unknown. */
  changedAt: number
  /** A short human phrase naming the format, optional. */
  note?: string
}

export const HIVE_FORMAT_KIND = 'hypercomb.hive-format'

const positiveInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (!Number.isSafeInteger(value) || value < 1) return null
  return value
}

/** The largest instant `Date` can represent. A stamp past it is a safe
 *  integer and passes every arithmetic check, but `new Date(ms)` is Invalid —
 *  and `toLocaleDateString` on an Invalid Date RETURNS the string "Invalid
 *  Date" rather than throwing, so a try/catch never catches it. The range
 *  check is the only guard that works. */
const MAX_DATE_MS = 8.64e15

/** An epoch-millisecond stamp, or 0 when the value cannot be one. */
const epochMillis = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const ms = Math.floor(value)
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_DATE_MS) return 0
  return ms
}

/**
 * Parse and validate a declaration.
 *
 * Anything malformed is `null` — an unreadable declaration is treated as NO
 * declaration, never as a broken boot and never as an alarm. Unknown extra
 * fields are IGNORED on purpose: an older reader must survive a newer record,
 * which is the entire contract.
 */
export const parseHiveFormat = (
  text: string | null | undefined,
): HiveFormatDeclaration | null => {
  if (typeof text !== 'string' || text.trim().length === 0) return null
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record['kind'] !== HIVE_FORMAT_KIND) return null

  const format = positiveInteger(record['format'])
  if (format === null) return null
  // A MISSING minReader defaults to `format`, it does not reject the record.
  // The obvious reading of this schema by a future writer is that minReader
  // is optional and equal to the format — and rejecting such a record would
  // produce TOTAL SILENCE on exactly the older clients this marker exists to
  // warn. A minReader that is PRESENT but not a positive integer is still a
  // record this reader cannot understand, and is rejected.
  // ABSENT, not null: `JSON.stringify` DROPS an undefined key but writes an
  // out-of-range number (Infinity, NaN) as `null`, so a present-but-null
  // minReader is a value this reader cannot understand and must reject.
  const hasMin = record['minReader'] !== undefined
  const minReader = hasMin ? positiveInteger(record['minReader']) : format
  if (minReader === null) return null

  // A hive cannot require a reader NEWER than its own format. An incoherent
  // foreign record must not be able to lock this client out of a hive it can
  // demonstrably read, so clamp rather than reject.
  const clamped = Math.min(minReader, format)

  const v = positiveInteger(record['v']) ?? 1
  const changedAt = epochMillis(record['changedAt'])
  const noteRaw = record['note']
  const note = typeof noteRaw === 'string' && noteRaw.trim().length > 0 ? noteRaw.trim() : undefined

  return note === undefined
    ? { kind: HIVE_FORMAT_KIND, v, format, minReader: clamped, changedAt }
    : { kind: HIVE_FORMAT_KIND, v, format, minReader: clamped, changedAt, note }
}

/**
 * Would `proposed` move the hive FORWARD from `current`? Returns the
 * declaration to write, or `null` when it must not be written.
 *
 * The monotonicity lives here, in a pure function, so "never overwrite a
 * NEWER declaration with an older one" cannot be forgotten by a second
 * writer: a downgrade is not merely discouraged, it is uncomposable. This
 * matters because the underlying pool write is unconditional last-write-wins,
 * so an older device could otherwise silently downgrade the hive's declared
 * format and turn the warning OFF on every client.
 */
export const advanceFormat = (
  current: HiveFormatDeclaration | null | undefined,
  proposed: HiveFormatDeclaration,
): HiveFormatDeclaration | null => {
  if (!current) return proposed
  if (proposed.format < current.format) return null
  if (proposed.minReader < current.minReader) return null
  if (proposed.format === current.format && proposed.minReader === current.minReader) return null
  return proposed
}

export type FormatVerdict =
  | 'undeclared'
  /** A declaration EXISTS and this reader cannot understand it. Distinct from
   *  `undeclared` on purpose: collapsing the two made the sentence assert a
   *  cause it could not know ("made before format tracking"), and it asserted
   *  it in the reassuring direction. A future writer that re-shapes the record
   *  — nesting the numbers, or making a field optional this reader requires —
   *  would otherwise produce TOTAL SILENCE on every older client, which is the
   *  exact failure this whole module exists to prevent. */
  | 'marker-unreadable'
  | 'readable'
  | 'ahead-of-hive'
  | 'unreadable'

export interface FormatComparison {
  verdict: FormatVerdict
  /** One plain sentence a human can act on. */
  sentence: string
  hiveFormat: number | null
  minReader: number | null
  clientSupports: number
  /** True for the two verdicts that interrupt: `unreadable` (the hive says it
   *  needs a newer reader) and `marker-unreadable` (the hive carries a marker
   *  in a shape this reader does not know, which can only mean a newer
   *  writer). Everything else is silent. */
  announce: boolean
}

/**
 * Render `changedAt` as a date clause, or '' when the record does not give a
 * date this sentence may state as fact.
 *
 * THREE WAYS A STAMP IS NOT A DATE, and none of them may reach the sentence:
 *
 *   * OUT OF RANGE. Past `MAX_DATE_MS` the stamp is still a safe integer, but
 *     `new Date(ms)` is Invalid and `toLocaleDateString` RETURNS the literal
 *     string "Invalid Date" instead of throwing — so the try/catch below never
 *     fires and the nonsense lands in the one sentence the participant reads.
 *   * NOT A DATE AT ALL. Belt and braces: an Invalid Date is checked directly.
 *   * IN THE FUTURE. "anything added since December 30, 2099 is not shown
 *     here" is not a true statement about anything. `now` is a PARAMETER, not
 *     a `Date.now()` call, so the module stays pure and every sentence stays
 *     unit-testable; a day of clock skew is allowed before the clause drops.
 *
 * Dropping the clause is always safe: the sentence degrades to "anything added
 * since is not shown here", which is still true.
 */
const SKEW_ALLOWANCE_MS = 24 * 60 * 60 * 1000

const whenClause = (changedAt: number, now: number): string => {
  if (!Number.isSafeInteger(changedAt) || changedAt <= 0 || changedAt > MAX_DATE_MS) return ''
  if (Number.isSafeInteger(now) && now > 0 && changedAt > now + SKEW_ALLOWANCE_MS) return ''
  const when = new Date(changedAt)
  if (Number.isNaN(when.getTime())) return ''
  let rendered: string
  try {
    rendered = when.toLocaleDateString(undefined, {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return '' }
  return rendered === 'Invalid Date' ? '' : rendered
}

/**
 * Compare what this client supports against what a hive declares.
 *
 * Pure. The four verdicts and their sentences are the whole public surface:
 * only `unreadable` announces, and it names both numbers, names the date the
 * format moved, and states the consequence as MISSING CONTENT — never as
 * damage, and never offering to fix anything, because the remedy is a newer
 * client or the other device.
 */
export const compareFormat = (
  declaration: HiveFormatDeclaration | null | undefined,
  clientSupports: number = SUPPORTED_FORMAT_VERSION,
  options?: {
    /** True when a declaration was FOUND but could not be parsed. The caller
     *  is the only one who can know this — `parseHiveFormat` returns the same
     *  null for "absent" and "unreadable" — and the two need different
     *  sentences. */
    markerUnreadable?: boolean
    /** Epoch ms used for ONE decision: is the record's date in the future,
     *  and therefore not a date this sentence may state as fact? Pass it to
     *  make a test deterministic; it defaults to the wall clock, which is the
     *  only clock read anywhere in this module and never touches a verdict. */
    now?: number
  },
): FormatComparison => {
  const supports = positiveInteger(clientSupports) ?? SUPPORTED_FORMAT_VERSION
  const now = epochMillis(options?.now ?? Date.now())

  if (!declaration) {
    if (options?.markerUnreadable === true) {
      return {
        verdict: 'marker-unreadable',
        sentence:
          'This hive carries a format marker this copy of Hypercomb cannot read, ' +
          'which means it has been written by a newer client. Some of what it holds may not be shown here. ' +
          'Update this client, or open the hive on the device that wrote it.',
        hiveFormat: null,
        minReader: null,
        clientSupports: supports,
        announce: true,
      }
    }
    return {
      verdict: 'undeclared',
      // It states what is KNOWN and stops. The old sentence went on to assert
      // a CAUSE — "it was made before format tracking" — which is exactly what
      // an absent record cannot establish, and it asserted it reassuringly.
      sentence:
        'This hive does not say what format it was written in, so it is read as format 1.',
      hiveFormat: null,
      minReader: null,
      clientSupports: supports,
      announce: false,
    }
  }

  const { format, minReader, changedAt } = declaration

  if (minReader > supports) {
    const when = whenClause(changedAt, now)
    const since = when ? ` anything added since ${when}` : ' anything added since'
    return {
      verdict: 'unreadable',
      sentence:
        `This hive has been written in format ${format} by a newer client. ` +
        `This copy of Hypercomb reads up to format ${supports}, so${since} is not shown here. ` +
        'Update this client, or open the hive on the device that wrote it.',
      hiveFormat: format,
      minReader,
      clientSupports: supports,
      announce: true,
    }
  }

  if (format < supports) {
    return {
      verdict: 'ahead-of-hive',
      sentence:
        `This hive is still written in format ${format}; this client can write format ${supports}. ` +
        'Nothing is hidden. New content you add here stays readable by older clients until this hive is moved forward.',
      hiveFormat: format,
      minReader,
      clientSupports: supports,
      announce: false,
    }
  }

  // format > supports with minReader <= supports is the ADDITIVE case: the
  // hive moved forward in a way that kept older readers whole. Still
  // `readable`, but the sentence must not claim this client reads format N.
  return {
    verdict: 'readable',
    sentence: format > supports
      ? `This hive is written in format ${format}. This client reads format ${supports}, ` +
        'and that format change kept older clients whole — you are seeing everything in it.'
      : `This hive is written in format ${format}, and this client reads format ${supports}. ` +
        'You are seeing everything in it.',
    hiveFormat: format,
    minReader,
    clientSupports: supports,
    announce: false,
  }
}
