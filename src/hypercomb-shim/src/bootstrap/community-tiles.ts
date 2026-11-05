// hypercomb-shim/src/bootstrap/community-tiles.ts
//
// THE TILES YOU BROUGHT INTO YOUR COMMUNITY (jwize 2026-11-04: "the community is not a domain just a target for
// promoting locally domain hosted creations"; "when in manage mode we touch them and they go back to their domain even
// the current domain"). While managing, a tap on a tile in any domain's row — this one's too — brings it into this
// browser's community, a row of its own; a tap on it there sends it back to its domain.
//
// Kept in this browser, as the domains you follow are: ONE document in the `community:tiles` pool, read and
// written through the store — never a key, never signed. Going live is the signed act (the showcase record);
// this list is only what you chose to look at.

// Structural, never imported — a second Store module would be a second instance over the same OPFS.
type PoolStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getPoolDoc(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}

const COMMUNITY_TILES_POOL = 'community:tiles'
const KIND = 'community:tiles'

/** One tile in your community: the domain row it was picked from, and the tile's name key there. */
export type CommunityPick = { readonly zone: string; readonly key: string }

const store = (): PoolStore | undefined => window.ioc?.get?.<PoolStore>('@hypercomb.social/Store')

const pool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const found = store()
  if (!found?.getPool) return null
  try { return await found.getPool(COMMUNITY_TILES_POOL) } catch { return null }
}

/** The picks a document names, believed only as far as each survives its check. */
export const parseCommunityTiles = (raw: unknown): CommunityPick[] => {
  const record = raw as { kind?: unknown; picks?: unknown } | null
  if (!record || record.kind !== KIND || !Array.isArray(record.picks)) return []
  const seen = new Set<string>()
  const out: CommunityPick[] = []
  for (const row of record.picks.slice(0, 2000)) {
    const pick = row as Record<string, unknown> | null
    const zone = typeof pick?.['zone'] === 'string' ? pick['zone'].slice(0, 253) : ''
    const key = typeof pick?.['key'] === 'string' ? pick['key'].slice(0, 400) : ''
    if (!zone || !key || seen.has(key)) continue
    seen.add(key)
    out.push({ zone, key })
  }
  return out
}

/** Canonical: sorted, no wall clock, so the same set is always the same bytes. */
export const encodeCommunityTiles = (picks: readonly CommunityPick[]): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify({
    kind: KIND,
    picks: [...picks].sort((a, b) => a.key.localeCompare(b.key)).map(pick => ({ key: pick.key, zone: pick.zone })),
  })).buffer as ArrayBuffer

export const readCommunityTiles = async (): Promise<CommunityPick[]> => {
  const dir = await pool()
  if (!dir) return []
  try {
    const bytes = await store()!.getPoolDoc(dir)
    return bytes ? parseCommunityTiles(JSON.parse(new TextDecoder().decode(bytes))) : []
  } catch { return [] }
}

/** Keep the whole set. True when it was written. */
export const keepCommunityTiles = async (picks: readonly CommunityPick[]): Promise<boolean> => {
  const dir = await pool()
  if (!dir) return false
  try { return !!(await store()!.putPoolDoc(dir, encodeCommunityTiles(picks), undefined, { keep: 'current' })) } catch { return false }
}
