// hypercomb-shared/ui/command-line/hash-marker.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'

/**
 * `#` is the universal action/behavior operator.
 *
 * Examples:
 *   "cell#DroneName"   → bind drone marker to cell's properties
 *   "cell#"            → list available drones for this cell (future)
 *   "#command"         → system command (future)
 *
 * Markers are stored in the cell's 0000 properties file under
 * `markers: string[]` — an array of drone IoC keys or signatures.
 * The processor reads these at pulse time to decide which bees
 * are relevant for the cell.
 */
export class HashMarkerBehavior implements CommandLineBehavior {

  readonly name = 'hash-marker'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^~\[].+#.+/,
      description: 'Bind a drone marker to a cell',
      examples: [
        { input: 'cigars#CigarJournal', key: 'Enter', result: 'Marks "cigars" with CigarJournal drone' },
        { input: 'photos#Gallery', key: 'Enter', result: 'Marks "photos" with Gallery drone' },
      ]
    },
    {
      trigger: 'Enter',
      pattern: /^[^~\[].+#$/,
      description: 'List available drones for a cell',
      examples: [
        { input: 'cigars#', key: 'Enter', result: 'Lists drones applicable to "cigars"' },
      ]
    },
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    const hashIndex = input.indexOf('#')
    // must have content before # (not a bare #command or standalone #)
    return hashIndex > 0
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const hashIndex = input.indexOf('#')
    const cellRaw = input.slice(0, hashIndex).trim()
    const markerRaw = input.slice(hashIndex + 1).trim()

    const cellName = completions.normalize(cellRaw)
    if (!cellName) return

    // ensure cell exists
    const dir = await lineage.explorerDir()
    if (!dir) return

    const cellDir = await dir.getDirectoryHandle(cellName, { create: true })

    if (!markerRaw) {
      // cell# — list markers (emit effect for UI to pick up)
      const props = await readProps(cellDir)
      const existing = Array.isArray(props['markers']) ? props['markers'] : []
      EffectBus.emit('marker:list', { cell: cellName, markers: existing })
      return
    }

    // cell#DroneName — add marker
    const marker = completions.normalize(markerRaw)
    if (!marker) return

    const props = await readProps(cellDir)
    const existing: string[] = Array.isArray(props['markers']) ? props['markers'] : []

    if (!existing.includes(marker)) {
      existing.push(marker)
      await writeProps(cellDir, { markers: existing })
    }

    // ensure cell is tracked in history
    EffectBus.emit('cell:added', { cell: cellName })
    EffectBus.emit('marker:added', { cell: cellName, marker })
    await new hypercomb().act()
  }
}

// ── 0000 properties helpers (lightweight inline, avoids import from essentials) ──

const PROPS_FILE = '0000'

async function readProps(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  try {
    const fh = await cellDir.getFileHandle(PROPS_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

async function writeProps(cellDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
  const existing = await readProps(cellDir)
  const merged = { ...existing, ...updates }
  const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}
