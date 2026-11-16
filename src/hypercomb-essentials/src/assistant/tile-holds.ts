// assistant/tile-holds.ts
//
// WHAT A TILE HOLDS, FOR THE EYE (documentation/inspect.md). The inspect panel
// walked from a tile to the code that runs it. A tile also holds things that
// are not code the hive runs: its files (a page in parts keeps its script and
// stylesheet as files on tiles), the resources its records name (a page, a
// card's details, a picture), and the tiles inside it. jwize, 2026-11-16:
// "we should be able to drill down to the files and resources … and see the
// code for the behaviour on that tile as well."
//
// Pure text and bytes. Nothing here reads a store: the panel does, and hands
// what it read to these.

const SIG = /^[0-9a-f]{64}$/
const SIG_RUN = /[0-9a-f]{64}/g

/** A resource a record names, and the word it names it by. */
export type NamedResource = { readonly label: string; readonly sig: string }

/** Records that name an identity, not bytes, and the one the Files list shows. */
const NOT_LISTED = new Set(['group', 'creation', 'files:attachment'])
const NAMED_MAX = 24

/**
 * The resources one decoration record names: each payload field called
 * `…Sig` or `…Sigs`, by its own name, then whatever else its `refs` declare.
 * Null for a record that is not one, or names an identity.
 */
export const recordResources = (record: unknown): { readonly kind: string; readonly named: readonly NamedResource[] } | null => {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  const kind = (record as Record<string, unknown>)['kind']
  if (typeof kind !== 'string' || !kind || NOT_LISTED.has(kind)) return null
  const named: NamedResource[] = []
  const seen = new Set<string>()
  const take = (label: string, value: unknown): void => {
    const sig = String(value ?? '').toLowerCase()
    if (!SIG.test(sig) || seen.has(sig) || named.length >= NAMED_MAX) return
    seen.add(sig)
    named.push({ label, sig })
  }
  const payload = (record as Record<string, unknown>)['payload']
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [field, value] of Object.entries(payload as Record<string, unknown>)) {
      if (field.endsWith('Sigs') && Array.isArray(value)) value.forEach(item => take(field, item))
      else if (field.endsWith('Sig') || field === 'sig') take(field, value)
    }
  }
  const refs = (record as Record<string, unknown>)['refs']
  if (Array.isArray(refs)) refs.forEach(ref => take('ref', ref))
  return { kind, named }
}

/** What some bytes are, as far as showing them goes. */
export type ShownAs =
  | { readonly as: 'picture'; readonly mime: string }
  | { readonly as: 'text'; readonly text: string }
  | { readonly as: 'bytes' }

const starts = (bytes: Uint8Array, ...head: number[]): boolean => head.every((byte, index) => bytes[index] === byte)

/** A picture by its first bytes, never by a name or a claimed type. */
export const pictureMime = (bytes: Uint8Array): string | null => {
  if (starts(bytes, 0x89, 0x50, 0x4e, 0x47)) return 'image/png'
  if (starts(bytes, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (starts(bytes, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'
  if (starts(bytes, 0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

/** A picture, readable text, or bytes that are neither. Text is whole UTF-8
 *  with no NUL in it; anything else is only its size. */
export const shownAs = (bytes: Uint8Array): ShownAs => {
  const mime = pictureMime(bytes)
  if (mime) return { as: 'picture', mime }
  if (bytes.includes(0)) return { as: 'bytes' }
  try { return { as: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } } catch { return { as: 'bytes' } }
}

/** JSON written on one line is unreadable: the same JSON, indented. The text
 *  as it is when it is not JSON, or is too large to be worth it. */
export const readable = (text: string, max = 400_000): string => {
  if (text.length > max) return text
  const first = text.trimStart()[0]
  if (first !== '{' && first !== '[') return text
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}

/** Every signature a text names, each once, in the order met. */
export const signaturesIn = (text: string, max = 40): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of text.toLowerCase().matchAll(SIG_RUN)) {
    if (seen.has(match[0])) continue
    seen.add(match[0])
    out.push(match[0])
    if (out.length >= max) break
  }
  return out
}

/** A size a person reads: 512 B, 19 KB, 1.3 MB. */
export const sizeWords = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}
