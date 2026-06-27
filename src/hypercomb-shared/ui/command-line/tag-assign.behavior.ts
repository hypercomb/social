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
 * A tag rides the decoration primitive: it's a decoration of kind `tag`
 * (payload `{ name }`) written via the essentials DecorationService, resolved
 * at runtime through IoC (shared can't import essentials). Colour lives in the
 * global TagRegistry keyed by name. `tags:changed` refreshes show-cell's cache
 * and the controls-bar pills.
 */
type DecorationServiceLike = {
  addTag(segments: readonly string[], name: string): Promise<string>
}
type TagRegistryLike = {
  ensureLoaded(): Promise<void>
  add(name: string, color?: string): Promise<void>
}

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
    const segments = [...parentSegments, cellName]

    // Write the tag as a decoration on the cell's layer.
    const decorations = get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined
    if (decorations) await decorations.addTag(segments, tagName)

    // persist global tag name + colour in the registry (keeps hc:tag-colors in sync)
    const registry = get('@hypercomb.social/TagRegistry') as TagRegistryLike | undefined
    if (registry) {
      await registry.ensureLoaded()
      await registry.add(tagName, color)
    } else if (color) {
      const stored: Record<string, string> = JSON.parse(localStorage.getItem('hc:tag-colors') ?? '{}')
      stored[tagName] = color
      localStorage.setItem('hc:tag-colors', JSON.stringify(stored))
    }

    EffectBus.emit('tags:changed', { updates: [{ cell: cellName, tag: tagName, color }] })
    EffectBus.emit('cell:added', { cell: cellName, segments: parentSegments.slice(), viaUpdate: true })
    await new hypercomb().act()
  }
}
