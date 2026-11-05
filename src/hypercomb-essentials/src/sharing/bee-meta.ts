// sharing/bee-meta.ts
//
// THE META LAYER OF A CODE FILE — what a bee says about itself, and the words a
// participant gives it instead. (jwize, 2026-11-04: "include that in the meta
// layers so we can describe them and they can be overridden.")
//
// The primitive is a word, its signature, a layer of children and a META layer:
// "the small layer that describes a tile rather than holding its content … versioned
// like everything else, so it can be changed or replaced without touching the value
// or anything related to it" (living-presentation.md; uniform-decoration.md). A file
// is a signature. Who it is — its logical name, what it is for — is its meta layer,
// and it has two voices, the participant's winning:
//
//   PUBLISHED — the build writes what a bee is (className, kind, description, what it
//     listens to and emits, its command and aliases) into the layer that declares it,
//     `docs.bees[<sig>]` (build-module.ts). It sits inside the signed layer, so no
//     host can alter it and reading it costs no fetch beyond the layer. It is the
//     file's OWN version — it stays as the default, it is never rewritten.
//   YOURS — one document per file signature in the pool `meta:bees` (the sub-key is
//     the signature): `{ v:1, name?, description? }`. It overrides the published words
//     FIELD BY FIELD — a name of your own with the published description, or the other
//     way round. It is written by a human save, so every earlier version is kept
//     (`putPoolDoc` with no `keep`), and `{ v:1 }` hands the words back. It lives in
//     this hive and changes nothing else: not the bytes, not the layer that declares
//     them, not one signature.
//
// Not built: the AUTHORED version of the same words — an envelope that travels with
// the tile and is offered to hosts you follow (uniform-decoration.md, "Meta resources").
// This is the personal annotation, which is the pool carrier's job: no graph churn.
//
// A dependency (atomic-modules-plan.md): it registers nothing.

export const BEE_META_MEANING = 'meta:bees'

const SIG_RE = /^[0-9a-f]{64}$/
const VERSION = 1
const NAME_MAX = 80
const DESCRIPTION_MAX = 600

/** A module is named `<sig>.js` in a layer's `bees` and `<sig>` in its `docs`. */
export const bareBeeSig = (sig: string): string => String(sig ?? '').trim().toLowerCase().replace(/\.(?:js|json)$/, '')

/** What the build said a bee is — the layer's own record of it. */
export interface BeeDoc {
  className: string
  kind: string
  description: string
  listens: string[]
  emits: string[]
  command: string
  aliases: string[]
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
const words = (value: unknown, max = 40): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : []

/**
 * THE BEES A LAYER DESCRIBES, by bare signature, read from its JSON. Tolerant: a
 * layer with no `docs`, an entry that is not an object, or a key that is no signature
 * is skipped, never an error — an older package has none of it. Nothing here is
 * fetched: the text is the layer the window already holds.
 */
export function beeDocsOf(layerText: string): Map<string, BeeDoc> {
  const out = new Map<string, BeeDoc>()
  let layer: unknown
  try { layer = JSON.parse(layerText) } catch { return out }
  const bees = (layer as { docs?: { bees?: unknown } } | null)?.docs?.bees
  if (!bees || typeof bees !== 'object' || Array.isArray(bees)) return out
  for (const [key, entry] of Object.entries(bees as Record<string, unknown>)) {
    const sig = bareBeeSig(key)
    if (!SIG_RE.test(sig) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const doc = entry as Record<string, unknown>
    out.set(sig, {
      className: text(doc['className'], 120),
      kind: text(doc['kind'], 40),
      description: text(doc['description'], DESCRIPTION_MAX),
      listens: words(doc['listens']),
      emits: words(doc['emits']),
      command: text(doc['command'], 80),
      aliases: words(doc['aliases']),
    })
  }
  return out
}

/** The words a participant gave one file: either, both, or neither. */
export interface BeeMeta {
  name?: string
  description?: string
}

/** A name is one line; both are trimmed and bounded; an empty field is not a field. */
export function normalizeMeta(raw: unknown): BeeMeta {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const name = text(record['name'], NAME_MAX)
  const description = text(record['description'], DESCRIPTION_MAX)
  return { ...(name ? { name } : {}), ...(description ? { description } : {}) }
}

const leaf = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? ''

/** What the file is called with nobody's words but its own: the class the build
 *  recorded, else the last part of the path its first line gives, else its signature. */
export const publishedName = (input: { sig: string; doc?: BeeDoc; fileName?: string }): string =>
  input.doc?.className || leaf(input.fileName ?? '') || input.sig.slice(0, 12)

export interface BeeWords {
  name: string
  description: string
  /** drone · queen · … as the build recorded it; '' when it did not. */
  kind: string
  /** Which of the two the participant's words are standing in for. */
  yoursName: boolean
  yoursDescription: boolean
}

/** THE TWO VOICES, MERGED: the participant's name and description win, each on its
 *  own; what they did not say is what the file says of itself. */
export function beeWords(input: { sig: string; meta?: BeeMeta; doc?: BeeDoc; fileName?: string }): BeeWords {
  const own = normalizeMeta(input.meta)
  return {
    name: own.name || publishedName(input),
    description: own.description || input.doc?.description || '',
    kind: input.doc?.kind ?? '',
    yoursName: !!own.name,
    yoursDescription: !!own.description,
  }
}

// ── the pool ─────────────────────────────────────────────────────────────────

export type MetaStore = {
  /** The read-only open: a READ must not mint the pool. */
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (
    pool: FileSystemDirectoryHandle,
    bytes: ArrayBuffer,
    subKey?: string,
    options?: { keep?: 'versions' | 'current' },
  ) => Promise<string | null>
}

const hiveStore = (): MetaStore | undefined =>
  (window as { ioc?: { get?: <T>(key: string) => T | undefined } }).ioc?.get?.<MetaStore>('@hypercomb.social/Store')

/** The words a participant gave one file — `{}` when none, when the pool is not
 *  there, and for a record this code does not know how to read. */
export async function readBeeMeta(sig: string, store: MetaStore | undefined = hiveStore()): Promise<BeeMeta> {
  const key = bareBeeSig(sig)
  if (!SIG_RE.test(key) || !store?.getPoolDoc) return {}
  try {
    const pool = await store.openPool?.(BEE_META_MEANING)
    if (!pool) return {}
    const bytes = await store.getPoolDoc(pool, key)
    if (!bytes) return {}
    const record = JSON.parse(new TextDecoder().decode(bytes)) as { v?: unknown }
    return record?.v === VERSION ? normalizeMeta(record) : {}
  } catch { return {} }
}

/**
 * Save the participant's words for one file. A human save: every earlier version is
 * kept, so describing again never loses what was said before. An empty `meta` is
 * written as the current version too — it is how the published words are handed
 * back, and the earlier words stay in the history. True once the document is held.
 */
export async function writeBeeMeta(sig: string, meta: BeeMeta, store: MetaStore | undefined = hiveStore()): Promise<boolean> {
  const key = bareBeeSig(sig)
  if (!SIG_RE.test(key) || !store?.getPool || !store.putPoolDoc) return false
  try {
    const pool = await store.getPool(BEE_META_MEANING)
    if (!pool) return false
    // Fixed key order: the same words are the same bytes, and the same bytes are one document.
    const own = normalizeMeta(meta)
    const record = { v: VERSION, ...(own.name ? { name: own.name } : {}), ...(own.description ? { description: own.description } : {}) }
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    return !!(await store.putPoolDoc(pool, bytes, key))
  } catch { return false }
}
