// hypercomb-shim/src/bootstrap/device-binding.ts
//
// WHICH ANCHOR THIS BROWSER PUBLISHES FOR, on a front door. The same document the
// hive keeps (essentials sharing/anchor-binding.ts): `keys:binding`, one record
// `{ kind: 'anchor-binding@1', anchor, sources }`, never replicated. On an origin
// where the hive also runs, both read and write the one document.
//
// Not a secret — the anchor is a public key and `sources` are hosts that hold its
// list — so it lives in a pool, read and written through the store, never a
// browser key. Only the Allow tap writes it (device-invite.ts).

// Structural, never imported — a second Store module would be a second instance over the same OPFS.
type PoolStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}

const ANCHOR_BINDING_MEANING = 'keys:binding'
const HEX64 = /^[0-9a-f]{64}$/
const SOURCES_MAX = 8

export type DeviceBinding = { readonly anchor: string; readonly sources: readonly string[] }

const store = (): PoolStore | undefined => window.ioc?.get?.<PoolStore>('@hypercomb.social/Store')

const pool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const found = store()
  if (!found?.getPool) return null
  try { return await found.getPool(ANCHOR_BINDING_MEANING) } catch { return null }
}

/** The binding a document names, or null when it binds nothing. */
export const parseDeviceBinding = (raw: unknown): DeviceBinding | null => {
  const record = raw as Record<string, unknown> | null
  if (!record || typeof record !== 'object' || record['kind'] !== 'anchor-binding@1') return null
  const anchor = typeof record['anchor'] === 'string' && HEX64.test(record['anchor']) ? record['anchor'] : ''
  if (!anchor) return null
  const sources = Array.isArray(record['sources'])
    ? [...new Set(record['sources'].filter((s): s is string => typeof s === 'string' && !!s.trim()).map(s => s.trim().toLowerCase()))].slice(0, SOURCES_MAX)
    : []
  return { anchor, sources }
}

export const readDeviceBinding = async (): Promise<DeviceBinding | null> => {
  const dir = await pool()
  if (!dir) return null
  try {
    const bytes = await store()!.getPoolDoc(dir)
    return bytes ? parseDeviceBinding(JSON.parse(new TextDecoder().decode(bytes))) : null
  } catch { return null }
}

/** Take an anchor. True when it was written. */
export const bindDevice = async (anchor: string, sources: readonly string[]): Promise<boolean> => {
  const clean = String(anchor ?? '').toLowerCase()
  if (!HEX64.test(clean)) return false
  const dir = await pool()
  if (!dir) return false
  const record = { kind: 'anchor-binding@1', anchor: clean,
    sources: [...new Set(sources.map(s => s.trim().toLowerCase()).filter(Boolean))].slice(0, SOURCES_MAX) }
  try { return !!(await store()!.putPoolDoc(dir, new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer)) } catch { return false }
}
