// diamondcoreprocessor.com/history/delta-record.ts
//
// The mechanical delta-record format. Every history entry is one of
// these records: a differential that names its subject and lists
// ops with their referenced sigs. Records are immutable, content-
// addressed, and carry zero metadata — no timestamps, no session tags,
// no parent pointers. Meaning emerges only by comparison to the
// predecessor in the chain; a record alone is structure without
// context.
//
// Wire format (what gets signed, what gets stored, what gets parsed):
//
//   <name>\n
//   <op> <sig> <sig> ... \n
//   <op> <sig> <sig> ... \n
//   ...
//
// - Bare tokens throughout. No JSON, no quotes, no brackets. Sigs are
//   raw 64-hex-char runs, recognised by their shape at parse time.
// - Line 0 is always the name.
// - Each subsequent line is an op name followed by zero or more sigs,
//   separated by single spaces.
// - Canonicalisation: op lines sorted lexicographically; sigs within
//   a line sorted lexicographically. Name is not sorted — it's the
//   identity anchor and stays on line 0. LF endings only. No
//   trailing whitespace, no trailing newline.
//
// Sig positions support two equivalent forms:
//
//   (a) inline sig list    — `add sig1 sig2 sig3`
//   (b) resource pointer   — `add ARRAY_SIG`  (a single sig whose
//                            resolved resource is `sig1 sig2 sig3`,
//                            same bare format)
//
// The reducer transparently resolves (b) to (a) at read time. The
// canonical form for a record is whichever the writer emits; the
// sig of a record depends on bytes, so two records with the same
// logical content written differently are different records. Dedup
// at the bytes level is the only dedup.

const NAME_MAX_LEN = 256
const SIG_RE = /^[a-f0-9]{64}$/

export interface DeltaRecord {
  readonly name: string
  // Each op key maps to either:
  //   - an inline array of sigs (the list of things this op carries)
  //   - a single sig string whose resolved resource is that list
  // The reducer handles both; writers pick whichever suits the payload.
  readonly [op: string]: string | readonly string[] | undefined
}

/**
 * Stable serialisation used for signing AND for disk storage. Two
 * records whose canonicalised bytes match produce the same sig under
 * SignatureService.sign.
 */
export function canonicalise(record: DeltaRecord): string {
  if (typeof record?.name !== 'string' || record.name.length === 0) {
    throw new Error('DeltaRecord: name is required')
  }
  if (record.name.length > NAME_MAX_LEN) {
    throw new Error(`DeltaRecord: name exceeds ${NAME_MAX_LEN} chars`)
  }

  const opKeys = Object.keys(record)
    .filter(k => k !== 'name')
    .sort()

  const lines: string[] = [record.name]
  for (const op of opKeys) {
    const value = record[op]
    const sigs = extractSigs(value)
    // An op with no sigs is still meaningful — e.g. `hide` on a cell
    // carries the op marker, not a list. Emit the op name alone.
    if (sigs.length === 0) {
      lines.push(op)
    } else {
      const sortedSigs = [...sigs].sort()
      lines.push(`${op} ${sortedSigs.join(' ')}`)
    }
  }
  return lines.join('\n')
}

export function parse(text: string): DeltaRecord | null {
  if (typeof text !== 'string' || text.length === 0) return null
  const lines = text.split('\n')
  const name = lines[0]?.trim()
  if (!name || name.length > NAME_MAX_LEN) return null

  const out: { name: string; [op: string]: string | readonly string[] | undefined } = { name }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw) continue
    const tokens = raw.split(' ').filter(t => t.length > 0)
    if (tokens.length === 0) continue
    const op = tokens[0]
    if (op === 'name') continue // never overwrite the identity anchor
    const sigs = tokens.slice(1).filter(t => SIG_RE.test(t))
    // Store inline array form. Consumers that want the resource-
    // pointer form re-canonicalise. Zero-sig ops become an empty
    // array — round-trip safe through canonicalise.
    ;(out as any)[op] = sigs
  }
  return out as DeltaRecord
}

/** UTF-8 encode the canonical string. This is what gets signed. */
export function canonicalBytes(record: DeltaRecord): Uint8Array {
  return new TextEncoder().encode(canonicalise(record))
}

function extractSigs(value: string | readonly string[] | undefined): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s))
  }
  if (typeof value === 'string') {
    // A single-string value can be either "one inline sig" or "a sig
    // pointing at a list resource". Both forms serialise identically
    // here — bare sig token. The reducer distinguishes at resolve
    // time. Validation is the same: must be a sig.
    return SIG_RE.test(value) ? [value] : []
  }
  return []
}

/** Public sig validator — useful for writers that want to check inputs. */
export function isSig(value: unknown): value is string {
  return typeof value === 'string' && SIG_RE.test(value)
}
