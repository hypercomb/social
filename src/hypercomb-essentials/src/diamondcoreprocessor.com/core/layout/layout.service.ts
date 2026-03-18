// hypercomb-essentials/src/diamondcoreprocessor.com/core/layout/layout.service.ts
// Thin OPFS read/write for __layout__ file — persists tile display order.

const LAYOUT_FILE = '__layout__'

export class LayoutService {

  /**
   * Read the ordered seed list from __layout__ in the given directory.
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
   * Write the ordered seed list to __layout__.
   */
  async write(dir: FileSystemDirectoryHandle, order: string[]): Promise<void> {
    const handle = await dir.getFileHandle(LAYOUT_FILE, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(order))
    await writable.close()
  }

  /**
   * Merge a saved layout order with current filesystem seeds.
   * Keeps layout order, removes deleted seeds, appends new seeds alphabetically.
   */
  merge(layoutOrder: string[], fsSeeds: string[]): string[] {
    const fsSet = new Set(fsSeeds)
    const result: string[] = []
    const seen = new Set<string>()

    // keep layout order for seeds that still exist
    for (const label of layoutOrder) {
      if (fsSet.has(label) && !seen.has(label)) {
        result.push(label)
        seen.add(label)
      }
    }

    // append new seeds not in layout (alphabetically)
    const newSeeds = fsSeeds.filter(s => !seen.has(s))
    newSeeds.sort((a, b) => a.localeCompare(b))
    for (const s of newSeeds) result.push(s)

    return result
  }
}

window.ioc.register('@diamondcoreprocessor.com/LayoutService', new LayoutService())
