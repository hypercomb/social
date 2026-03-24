// hypercomb-shared/ui/command-line/hash-marker.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'

/**
 * `#` is the universal action/behavior operator.
 *
 * Examples:
 *   "seed#DroneName"   → bind drone marker to seed's properties
 *   "seed#"            → list available drones for this seed (future)
 *   "#command"         → system command (future)
 *
 * Markers are stored in the seed's 0000 properties file under
 * `markers: string[]` — an array of drone IoC keys or signatures.
 * The processor reads these at pulse time to decide which bees
 * are relevant for the seed.
 */
export class HashMarkerBehavior implements CommandLineBehavior {

  readonly name = 'hash-marker'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^!\[].+#.+/,
      description: 'Bind a drone marker to a seed',
      examples: [
        { input: 'cigars#CigarJournal', key: 'Enter', result: 'Marks "cigars" with CigarJournal drone' },
        { input: 'photos#Gallery', key: 'Enter', result: 'Marks "photos" with Gallery drone' },
      ]
    },
    {
      trigger: 'Enter',
      pattern: /^[^!\[].+#$/,
      description: 'List available drones for a seed',
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
    const seedRaw = input.slice(0, hashIndex).trim()
    const markerRaw = input.slice(hashIndex + 1).trim()

    const seedName = completions.normalize(seedRaw)
    if (!seedName) return

    // ensure seed exists
    const dir = await lineage.explorerDir()
    if (!dir) return

    const seedDir = await dir.getDirectoryHandle(seedName, { create: true })

    if (!markerRaw) {
      // seed# — list markers (emit effect for UI to pick up)
      const props = await readProps(seedDir)
      const existing = Array.isArray(props['markers']) ? props['markers'] : []
      EffectBus.emit('marker:list', { seed: seedName, markers: existing })
      return
    }

    // seed#DroneName — add marker
    const marker = completions.normalize(markerRaw)
    if (!marker) return

    const props = await readProps(seedDir)
    const existing: string[] = Array.isArray(props['markers']) ? props['markers'] : []

    if (!existing.includes(marker)) {
      existing.push(marker)
      await writeProps(seedDir, { markers: existing })
    }

    // ensure seed is tracked in history
    EffectBus.emit('seed:added', { seed: seedName })
    EffectBus.emit('marker:added', { seed: seedName, marker })
    await new hypercomb().act()
  }
}

// ── 0000 properties helpers (lightweight inline, avoids import from essentials) ──

const PROPS_FILE = '0000'

async function readProps(seedDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
  try {
    const fh = await seedDir.getFileHandle(PROPS_FILE)
    const file = await fh.getFile()
    return JSON.parse(await file.text())
  } catch {
    return {}
  }
}

async function writeProps(seedDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
  const existing = await readProps(seedDir)
  const merged = { ...existing, ...updates }
  const fh = await seedDir.getFileHandle(PROPS_FILE, { create: true })
  const writable = await fh.createWritable()
  await writable.write(JSON.stringify(merged))
  await writable.close()
}
