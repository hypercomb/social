// diamondcoreprocessor.com/core/layout/layout.service.ts
const LAYOUT_FILE = '__layout__'

export class LayoutService {

  /**
   * Read the ordered cell list from __layout__ in the given directory.
   * Returns null if no layout file exists (fall back to alphabetical).
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
   * Write the ordered cell list to __layout__.
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
