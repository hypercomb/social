// hypercomb-essentials/.../presentation/tiles/sources/opfs-tile.source.ts
//
// The OPFS-walk contributor. Returns one TileEntry per child directory
// of the lineage's explorerDir, excluding system dirs (__dependencies__,
// __bees__, __layers__, etc.). This is the "owned tiles" stream — the
// cells the user actually has on disk at the current lineage.
//
// Behaviour matches show-cell's previous listCellFolders semantics
// exactly. Once Phase 2 (layout) lifts out, this source supplies the
// raw set and the layout service decides positions.

import type {
  LocationContext,
  TileEntry,
  TileSource,
} from '../tile-source.types.js'

const SYSTEM_DIR_NAMES = new Set([
  '__dependencies__',
  '__bees__',
  '__layers__',
  '__location__',
  '__history__',
  '__optimization__',
  '__resources__',
])

/** Returns true for any `__*__` directory we should never surface as
 *  a tile. The hard-coded names above are the well-known ones; the
 *  generic `__*__` shape covers any future system dir convention. */
function isSystemDirName(name: string): boolean {
  if (!name) return true
  if (SYSTEM_DIR_NAMES.has(name)) return true
  return name.startsWith('__') && name.endsWith('__')
}

/** The OPFS source: walks the lineage's directory and emits one tile
 *  per child cell. Empty when the location has no backing OPFS dir
 *  (e.g. navigation into an ephemeral subtree before adopt). */
export const opfsTileSource: TileSource = async (
  loc: LocationContext,
): Promise<readonly TileEntry[]> => {
  const dir = loc.dir
  if (!dir) return []
  const out: TileEntry[] = []
  try {
    for await (const [name, handle] of (dir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>
    }).entries()) {
      if (handle.kind !== 'directory') continue
      if (isSystemDirName(name)) continue
      out.push({
        name,
        kind: 'opfs',
        source: { dir: handle as FileSystemDirectoryHandle },
      })
    }
  } catch (err) {
    // Permission errors, handle invalidation by sweeps, etc. Surface
    // as empty rather than poisoning the registry.
    console.warn('[opfs-tile-source] enumeration failed', err)
    return []
  }
  // Stable name order — downstream layout services may re-sort by
  // pinned index, but a deterministic input keeps any positional
  // collision-resolution reproducible.
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}
