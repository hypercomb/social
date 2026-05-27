// hypercomb-shared/ui/command-line/tag-assign.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import { EffectBus, hypercomb } from '@hypercomb/core'

/**
 * `label:tagName` or `label:tagName(#color)` assigns a tag to a cell.
 *
 * Examples:
 *   "navtest:education"            → tag "navtest" with "education"
 *   "navtest:education(#ff4444)"   → tag with color
 *
 * Tags are stored in the cell's 0000 properties file under
 * `tags: string[]`. Colors are stored globally in localStorage
 * under `hc:tag-colors`.
 */
export class TagAssignBehavior implements CommandLineBehavior {

  readonly name = 'tag-assign'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^[^\/!#\[].+:[^(]+(\([^)]+\))?$/,
      description: 'Assign a tag to a cell',
      examples: [
        { input: 'navtest:education', key: 'Enter', result: 'Tags "navtest" with "education"' },
        { input: 'navtest:work(#4caf50)', key: 'Enter', result: 'Tags "navtest" with "work" in green' },
      ]
    },
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    // must have content before : and after :, and not be a slash behaviour, hash marker, or bracket syntax
    if (input.startsWith('/') || input.startsWith('!') || input.includes('[')) return false
    const colonIdx = input.indexOf(':')
    if (colonIdx <= 0 || colonIdx >= input.length - 1) return false
    // reject hash marker syntax: cell#Drone (# outside parentheses)
    const beforeParen = input.indexOf('(')
    const hashIdx = input.indexOf('#')
    if (hashIdx >= 0 && (beforeParen < 0 || hashIdx < beforeParen)) return false
    return true
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const colonIdx = input.indexOf(':')
    const cellRaw = input.slice(0, colonIdx).trim()
    const tagRaw = input.slice(colonIdx + 1).trim()

    const cellName = completions.normalize(cellRaw)
    if (!cellName || !tagRaw) return

    // parse optional color: tagName(#color)
    const colorMatch = tagRaw.match(/^([^(]+)(?:\(([^)]+)\))?$/)
    if (!colorMatch) return
    const tagName = colorMatch[1].trim()
    const color = colorMatch[2]?.trim()
    if (!tagName) return

    const parentSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    // Read existing tags via layer-slot properties (no folder mint).
    const props = await readPropsAt(parentSegments, cellName)
    const tags: string[] = Array.isArray(props['tags']) ? props['tags'] : []
    if (!tags.includes(tagName)) {
      tags.push(tagName)
      await writePropsAt(parentSegments, cellName, { tags })
    }

    // persist global tag color
    if (color) {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      stored[tagName] = color
      localStorage.setItem('hc:tag-colors', JSON.stringify(stored))
    }

    EffectBus.emit('tags:changed', { updates: [{ cell: cellName, tag: tagName, color }] })
    EffectBus.emit('cell:added', { cell: cellName, segments: parentSegments.slice() })
    await new hypercomb().act()
  }
}

// ── Layer-slot tile properties (IoC-resolved at runtime) ─────────────
//
// Shared can't import from essentials at compile time; pull the same
// layer-slot primitives from IoC at runtime. Matches the canonical
// `writeTilePropertiesAt` / `readTilePropertiesAt` in essentials.

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
