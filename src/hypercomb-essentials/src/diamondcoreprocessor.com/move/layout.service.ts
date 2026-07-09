// diamondcoreprocessor.com/core/layout/layout.service.ts
//
// LEGACY ordering sidecar. `__layout__` is a per-directory FILE (never a
// typed directory) holding the ordered cell list for a content-tree dir.
// Order lives in each tile's own `properties` slot (`index`) now; this
// sidecar survives only for still-undrained legacy content trees and is
// READ-ONLY — the writer was removed when /layout apply moved onto
// writeTilePropertiesAt.
const LAYOUT_FILE = '__layout__'

export class LayoutService {

  /**
   * Read the ordered cell list from the legacy `__layout__` sidecar in the
   * given directory. Returns null if no layout file exists (fall back to
   * alphabetical).
   */
  async read(dir: FileSystemDirectoryHandle): Promise<string[] | null> {
    try {
      const handle = await dir.getFileHandle(LAYOUT_FILE, { create: false })
      const file = await handle.getFile()
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) return null
      return parsed.filter((x: unknown) => typeof x === 'string' && x.length > 0)
    } catch {
      return null
    }
  }

  /**
   * Merge a saved layout order with current filesystem cells.
   * Keeps layout order, removes deleted cells, appends new cells alphabetically.
   */
  merge(layoutOrder: string[], fsCells: string[]): string[] {
    const fsSet = new Set(fsCells)
    const result: string[] = []
    const seen = new Set<string>()

    // keep layout order for cells that still exist
    for (const label of layoutOrder) {
      if (fsSet.has(label) && !seen.has(label)) {
        result.push(label)
        seen.add(label)
      }
    }

    // append new cells not in layout (alphabetically)
    const newCells = fsCells.filter(s => !seen.has(s))
    newCells.sort((a, b) => a.localeCompare(b))
    for (const s of newCells) result.push(s)

    return result
  }
}

window.ioc.register('@diamondcoreprocessor.com/LayoutService', new LayoutService())
