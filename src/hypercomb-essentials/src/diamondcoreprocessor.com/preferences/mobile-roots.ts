// diamondcoreprocessor.com/preferences/mobile-roots.ts
//
// The "mobile signature pool" — a participant-local registry of designated
// mobile hive roots, stored as one content-addressed JSON doc in the
// `sign('mobile:roots')` pool of meaning. See mobile-pheromones.ts
// (MOBILE_ROOTS_POOL) for the doctrine + division of labour.
//
// Pure helper (no side-effect registration): resolves Store via IoC and
// read-modify-writes the single pool doc. The per-tile `mobile:friendly` tag
// stays the authoritative "what shows in mobile" mechanism; this pool is an
// index/curation layer over it.

import { MOBILE_ROOTS_POOL } from './mobile-pheromones.js'

type StoreLike = {
  getPool: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
}

const store = (): StoreLike | undefined => {
  try {
    return (window as unknown as { ioc?: { get?: (k: string) => unknown } })
      .ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined
  } catch {
    return undefined
  }
}

/** The current set of designated mobile hive root signatures. */
export const readMobileRoots = async (): Promise<string[]> => {
  const s = store()
  if (!s) return []
  const pool = await s.getPool(MOBILE_ROOTS_POOL)
  if (!pool) return []
  const buf = await s.getPoolDoc(pool)
  if (!buf) return []
  try {
    const j = JSON.parse(new TextDecoder().decode(buf)) as { roots?: unknown }
    return Array.isArray(j?.roots) ? j.roots.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const writeMobileRoots = async (roots: readonly string[]): Promise<void> => {
  const s = store()
  if (!s) return
  const pool = await s.getPool(MOBILE_ROOTS_POOL)
  if (!pool) return
  const uniq = [...new Set(roots)]
  const bytes = new TextEncoder().encode(JSON.stringify({ roots: uniq })).buffer
  await s.putPoolDoc(pool, bytes)
}

/** Register a hive root signature as a mobile hive. Idempotent. */
export const addMobileRoot = async (sig: string): Promise<void> => {
  const roots = await readMobileRoots()
  if (!roots.includes(sig)) await writeMobileRoots([...roots, sig])
}

/** Remove a hive root signature from the registry. No-op if absent. */
export const removeMobileRoot = async (sig: string): Promise<void> => {
  const roots = await readMobileRoots()
  if (roots.includes(sig)) await writeMobileRoots(roots.filter(s => s !== sig))
}

/** Whether a hive root signature is registered as mobile. */
export const isMobileRoot = async (sig: string): Promise<boolean> => {
  return (await readMobileRoots()).includes(sig)
}
