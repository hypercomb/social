// commands/keyword.queen.ts

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
 *   /keyword cell = tagName       — tag a NAMED tile, whatever is selected
 *   [a,b]/keyword tagName         — chained: select then tag
 *
 * THE NAMED FORM EXISTS FOR SPEAKERS. Every other form acts on the current
 * selection, which is exactly right for a hand on a mouse and unusable for
 * anyone who cannot see it: a model saying `/keyword urgent` with nothing
 * picked writes only the global registry and still earns a clean receipt. The
 * `cell = tag` form is the same shape `/title` already uses, so the language
 * gained no new punctuation, and it is the ONLY form offered to a machine.
 */
type DecorationServiceLike = {
  addTag(segments: readonly string[], name: string): Promise<string>
  removeTag(segments: readonly string[], name: string): Promise<void>
}

export class KeywordQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'keyword'
  override description = 'Add or remove keywords (tags) on selected tiles'
  override options = ['<tag>', '<tag>(#<color>)', '~<tag>', '[<tag>, ~<tag>, ...]', '<cell> = <tag>']
  override examples = [
    { input: '/keyword urgent', result: 'Tags selected tiles with "urgent"' },
    { input: '/keyword ~urgent', result: 'Removes "urgent" from selected tiles' },
    { input: '/keyword roadmap = urgent', result: 'Tags the tile "roadmap", whatever is selected' },
  ]

  protected async execute(args: string): Promise<void> {
    const named = readNamedTarget(args)
    if (named && 'refuse' in named) { this.#log(`Keyword — ${named.refuse}`); return }

    const parsed = parseKeywordArgs(named ? named.tags : args)
    if (parsed.length === 0) return

    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const registry = get('@hypercomb.social/TagRegistry') as
      { add: (n: string, c?: string) => Promise<void>; ensureLoaded: () => Promise<void> } | undefined
    const decorations = get('@diamondcoreprocessor.com/DecorationService') as DecorationServiceLike | undefined

    // A NAMED target wins over the selection outright — it was stated, and a
    // stated target is never ambiguous the way a picked one is.
    const selectedLabels = named ? [named.cell] : selection ? Array.from(selection.selected) : []

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

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '#' })
  }
}

/** `<cell> = <tags>` — the named form, or undefined when the line uses none.
 *  One reader for the parser and for the machine gate, so the two can never
 *  disagree about what a line means. */
export const readNamedTarget = (
  args: string,
): { cell: string; tags: string } | { refuse: string } | undefined => {
  const equals = args.indexOf('=')
  if (equals === -1) return undefined
  const cell = args.slice(0, equals).trim()
  const tags = args.slice(equals + 1).trim()
  if (!cell || cell.includes('/') || cell.includes(String.fromCharCode(92))) {
    return { refuse: 'the named form is /keyword <cell> = <tag>, one tile on this page' }
  }
  if (!tags) return { refuse: '/keyword needs at least one tag after =' }
  return { cell, tags }
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
