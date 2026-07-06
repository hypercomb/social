// diamondcoreprocessor.com/core/layout/layout.service.ts
//
// LEGACY ordering sidecar. `__layout__` is a per-directory FILE (never a
// typed directory) holding the ordered cell list for a content-tree dir.
// Tile order is layer state now; this sidecar survives only for the
// still-undrained legacy content trees and is a read-fallback. Nothing new
// should write it — the ordering rewire onto the optimization substrate is
// tracked in layout.queen's #save stub.
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
   * Write the ordered cell list to the legacy `__layout__` sidecar FILE.
   * Reachable only from /layout apply against a legacy content-tree dir;
   * pending the ordering rewire onto the optimization substrate.
   */
  async write(dir: FileSystemDirectoryHandle, order: string[]): Promise<void> {
    const handle = await dir.getFileHandle(LAYOUT_FILE, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(order))
    await writable.close()
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
