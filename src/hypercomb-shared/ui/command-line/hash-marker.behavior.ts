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

    const parentSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    if (!markerRaw) {
      // cell# — list markers via the layer-slot properties path
      const props = await readPropsAt(parentSegments, cellName)
      const existing = Array.isArray(props['markers']) ? props['markers'] : []
      EffectBus.emit('marker:list', { cell: cellName, markers: existing })
      return
    }

    // cell#DroneName — add marker (layer-slot write; no folder mint)
    const marker = completions.normalize(markerRaw)
    if (!marker) return

    const props = await readPropsAt(parentSegments, cellName)
    const existing: string[] = Array.isArray(props['markers']) ? props['markers'] : []

    if (!existing.includes(marker)) {
      existing.push(marker)
      await writePropsAt(parentSegments, cellName, { markers: existing })
    }

    EffectBus.emit('cell:added', { cell: cellName, segments: parentSegments.slice() })
    EffectBus.emit('marker:added', { cell: cellName, marker })
    await new hypercomb().act()
  }
}

// ── Layer-slot tile properties (IoC-resolved at runtime) ─────────────
//
// Shared can't import from essentials at compile time, but it can pull
// the same primitives from IoC at runtime. The keys + methods used here
// match `writeTilePropertiesAt` / `readTilePropertiesAt` in
// essentials/editor/tile-properties.ts.

const HISTORY_KEY   = '@diamondcoreprocessor.com/HistoryService'
const STORE_KEY     = '@hypercomb.social/Store'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const TILE_PROPERTIES_SLOT = 'properties'

type HistoryServiceLike = {
  sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
  currentLayerAt?: (sig: string) => Promise<unknown>
}
type StoreLike = {
  getResource?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
}
type LayerCommitterLike = {
  commitSlotSet?: (segments: readonly string[], slot: string, sigs: readonly string[]) => Promise<void>
}

async function readPropsAt(parentSegments: readonly string[], cellName: string): Promise<Record<string, unknown>> {
  const history = get(HISTORY_KEY) as HistoryServiceLike | undefined
  const store   = get(STORE_KEY) as StoreLike | undefined
  if (!history?.sign || !history?.currentLayerAt || !store?.getResource) return {}
  const cellSig = await history.sign({ explorerSegments: () => [...parentSegments, cellName] })
  if (!cellSig) return {}
  const layer = await history.currentLayerAt(cellSig) as { properties?: readonly unknown[] } | null
  const slot = Array.isArray(layer?.properties) ? layer!.properties : []
  const propSig = slot.length > 0 ? slot[0] : undefined
  if (typeof propSig !== 'string' || !propSig) return {}
  try {
    const blob = await store.getResource(propSig)
    if (!blob) return {}
    const parsed = JSON.parse(await blob.text())
    return (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

async function writePropsAt(parentSegments: readonly string[], cellName: string, updates: Record<string, unknown>): Promise<void> {
  const history   = get(HISTORY_KEY) as HistoryServiceLike | undefined
  const store     = get(STORE_KEY) as StoreLike | undefined
  const committer = get(COMMITTER_KEY) as LayerCommitterLike | undefined
  if (!history?.sign || !store?.putResource || !committer?.commitSlotSet) return
  const existing = await readPropsAt(parentSegments, cellName)
  const merged: Record<string, unknown> = { ...existing, ...updates }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k]
  const sortedKeys = Object.keys(merged).sort()
  const canonical: Record<string, unknown> = {}
  for (const k of sortedKeys) canonical[k] = merged[k]
  const blob = new Blob([JSON.stringify(canonical)], { type: 'application/json' })
  const propSig = await store.putResource(blob)
  await committer.commitSlotSet([...parentSegments, cellName], TILE_PROPERTIES_SLOT, [propSig])
}
