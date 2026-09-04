// hypercomb-shared/core/registry-document.ts
//
// ONE WRITER FOR A PARTICIPANT REGISTRY'S MASTER RECORD.
//
// The name, tag, bouquet and interest registries each keep one master record:
// a JSON map that is this participant's own, replaced whole on every edit.
// They used to store it twice — the record as a content-root resource, and a
// POINTER to it as a member named `names-master` (a caller-chosen human
// string) inside the bare-word `registry` pool, rewritten in place. That
// shape failed the root primitive three ways at once: a member whose name is
// not a signature and not a derivation; a permanent foreign entry inside an
// address a tile named `registry` also owns; and a file two writers rewrite
// in place, so two readers can disagree about what it says. The identical
// six lines existed four times, which was the evidence.
//
// THE RECORD IS THE DOCUMENT. There is no pointer any more. The master JSON
// is written with `putPoolDoc` into a DOCUMENT pool of its own — colon-scoped
// (`registry:names`), so no tile can name it — as a member addressed by the
// signature of its own bytes. A document pool holds exactly one current
// member by design (address-syntax.md: "replaces siblings BY DESIGN"), which
// is precisely the semantics a per-participant master record wants, and the
// sweep proves the space is its own before it removes anything.
//
// READS WALK BACK, WRITES NEVER DO. Data never heals: an existing hive has
// its record behind the old pointer, so a read tries the document pool, then
// the legacy `registry/<key>` pointer, then the pre-pool root `0000` props
// file. The first write after that lands in the document pool and the old
// pointer is simply never advanced again. Nothing is deleted.

export interface RegistryStoreLike {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => Promise<string | null>
  getResource: (sig: string) => Promise<Blob | null | undefined>
  opfsRoot?: FileSystemDirectoryHandle
}

/** The bare-word pool the pointers used to live in. READ-FALLBACK ONLY. */
const LEGACY_REGISTRY_MEANING = 'registry'
/** Before the pool: one props file at the OPFS root. READ-FALLBACK ONLY. */
const LEGACY_PROPS_FILE = '0000'

const decode = (bytes: ArrayBuffer): string => new TextDecoder().decode(bytes)

const parse = <T>(text: string): T | null => {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value as T : null
  } catch { return null }
}

/** The legacy pointer's target, from the old pool member or the root props. */
const legacyPointer = async (store: RegistryStoreLike, legacyKey: string): Promise<string | null> => {
  try {
    const pool = await store.getPool?.(LEGACY_REGISTRY_MEANING)
    if (pool) {
      const fh = await pool.getFileHandle(legacyKey)
      const sig = (await (await fh.getFile()).text()).trim()
      if (sig) return sig
    }
  } catch { /* no legacy pool member — fall further back */ }
  try {
    const root = store.opfsRoot
    if (!root) return null
    const fh = await root.getFileHandle(LEGACY_PROPS_FILE)
    const props = JSON.parse(await (await fh.getFile()).text())
    const sig = props?.[legacyKey]
    return typeof sig === 'string' && sig ? sig : null
  } catch { return null }
}

/**
 * Read a registry's master record: the document pool first, then the two
 * legacy shapes. `null` means no record anywhere — a fresh hive, not a
 * failure, so callers start empty.
 */
export const readRegistryDocument = async <T extends object>(
  store: RegistryStoreLike,
  meaning: string,
  legacyKey: string,
): Promise<T | null> => {
  try {
    const pool = await store.getPool?.(meaning)
    const bytes = await store.getPoolDoc?.(pool)
    if (bytes && bytes.byteLength > 0) {
      const current = parse<T>(decode(bytes))
      if (current) return current
    }
  } catch { /* no document yet — the legacy shapes may still hold one */ }
  const sig = await legacyPointer(store, legacyKey)
  if (!sig) return null
  try {
    const blob = await store.getResource(sig)
    return blob ? parse<T>(await blob.text()) : null
  } catch { return null }
}

/**
 * Write a registry's master record as the current member of its document
 * pool. Returns the record's signature. Throws when the store cannot take a
 * document, so a caller's catch keeps its in-memory state and says nothing
 * false to disk.
 */
export const writeRegistryDocument = async (
  store: RegistryStoreLike,
  meaning: string,
  value: object,
): Promise<string> => {
  const pool = await store.getPool?.(meaning)
  if (!pool || !store.putPoolDoc) throw new Error(`registry document pool ${meaning} unavailable`)
  const bytes = new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer
  const sig = await store.putPoolDoc(pool, bytes)
  if (!sig) throw new Error(`registry document ${meaning} was not written`)
  return sig
}
