// diamondcoreprocessor.com/commands/keyword.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /keyword — add or remove keywords (tags) on selected tiles.
 *
 * Tags ride the decoration primitive: each is a decoration of kind `tag`
 * (payload `{ name }`) written via DecorationService, so a tag travels on the
 * cell's `decorations` slot like every other shareable decoration. Colour lives
 * in the global TagRegistry keyed by name. `tags:changed` is still emitted so
 * show-cell invalidates its tag cache and the controls bar refreshes.
 *
 * Syntax:
 *   /keyword tagName              — add tag (to selected tiles if any, else global registry only)
 *   /keyword tagName(#ff0000)     — add tag with color
 *   /keyword ~tagName             — remove tag from selected tiles
 *   /keyword [tag1, ~tag2, tag3]  — batch add/remove
 *   [a,b]/keyword tagName         — chained: select then tag
 */
type DecorationServiceLike = {
  addTag(segments: readonly string[], name: string): Promise<string>
  removeTag(segments: readonly string[], name: string): Promise<void>
}

export class KeywordQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'keyword'
  override readonly aliases = []
  override description = 'Add or remove keywords (tags) on selected tiles'

  protected async execute(args: string): Promise<void> {
    const parsed = parseKeywordArgs(args)
    if (parsed.length === 0) return

    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const registry = get('@hypercomb.social/TagRegistry') as
      { add: (n: string, c?: string) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined
    const decorations = get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined

    const selectedLabels = selection ? Array.from(selection.selected) : []

    if (selectedLabels.length > 0 && decorations) {
      const parentSegments = lineage?.explorerSegments?.() ?? []
      const updates: { cell: string; tag: string; color?: string }[] = []

      for (const label of selectedLabels) {
        const segments = [...parentSegments, label]
        for (const op of parsed) {
          try {
            if (op.remove) await decorations.removeTag(segments, op.tag)
            else await decorations.addTag(segments, op.tag)
            updates.push({ cell: label, tag: op.tag, color: op.color })
          } catch (err) { console.warn('[keyword] update failed for', label, err) }
        }
      }

      if (updates.length > 0) EffectBus.emit('tags:changed', { updates })
    }

    // Always update global registry for non-remove ops (colour + intellisense).
    if (registry) {
      await registry.ensureLoaded()
      for (const op of parsed) {
        if (!op.remove) await registry.add(op.tag, op.color)
      }
    }

    // Trigger processor to sync visual state
    void new hypercomb().act()
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseKeywordArgs(args: string): { tag: string; color?: string; remove: boolean }[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  // Bracket batch: [tag1, ~tag2, tag3(#color)]
  const bracketMatch = trimmed.match(/^\[(.+)\]$/)
  if (bracketMatch) {
    const ops: { tag: string; color?: string; remove: boolean }[] = []
    for (const raw of bracketMatch[1].split(',')) {
      const item = raw.trim()
      if (!item) continue
      if (item.startsWith('~')) {
        const tag = item.slice(1).trim()
        if (tag) ops.push({ tag, remove: true })
      } else {
        const m = item.match(/^([^(]+)(?:\(([^)]+)\))?$/)
        if (m) {
          const tag = m[1].trim()
          const color = m[2]?.trim()
          if (tag) ops.push({ tag, color, remove: false })
        }
      }
    }
    return ops
  }

  // Single: ~tagName or tagName or tagName(#color)
  if (trimmed.startsWith('~')) {
    const tag = trimmed.slice(1).trim()
    return tag ? [{ tag, remove: true }] : []
  }

  const m = trimmed.match(/^([^(]+)(?:\(([^)]+)\))?$/)
  if (m) {
    const tag = m[1].trim()
    const color = m[2]?.trim()
    return tag ? [{ tag, color, remove: false }] : []
  }

  return []
}

// ── registration ────────────────────────────────────────

const _keyword = new KeywordQueenBee()
window.ioc.register('@diamondcoreprocessor.com/KeywordQueenBee', _keyword)
