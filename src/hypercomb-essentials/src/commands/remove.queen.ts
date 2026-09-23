// commands/remove.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import { confirmRemoval } from './remove-confirm.js'
import { resolveCurrentLayer } from '../history/layer-placement.js'
import type { PlacementHistory } from '../history/layer-placement.js'
import { removeTilesAt, type HistoryServiceLike, type LayerCommitterLike, type LineageLike } from './remove-tiles.js'

/**
 * /remove — remove tiles from the current directory.
 *
 * Layer-as-primitive: removes the cells from the parent layer's
 * `children` slot via `LayerCommitter.update`. The cells' OPFS data
 * (history bags, body resources, sub-trees) is left intact — undoing
 * the deletion (deleting the head history row) restores the parent's
 * children list and the cells reappear.
 *
 * Syntax:
 *   /remove                         — remove currently selected tiles
 *   /remove tileName                — remove a single tile
 *   /remove [tile1, tile2, tile3]   — remove multiple tiles
 *   [a,b]/remove                    — chained: select then remove
 */
export class RemoveQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'remove'
  override description = 'Remove tiles from the current directory'
  override options = ['<tile name>', '[<tile>, <tile>, ...]']
  override examples = [
    { input: '/remove', result: 'Removes the currently selected tiles' },
    { input: '/remove drafts', result: 'Removes the tile "drafts"' },
  ]

  protected async execute(args: string): Promise<void> {
    const targets = parseRemoveArgs(args)

    // No args → operate on current selection. Hold the clear until AFTER the
    // confirm passes so cancelling keeps the selection intact.
    let selectionToClear: { clear: () => void } | null = null
    if (targets.length === 0) {
      const selection = get('@diamondcoreprocessor.com/SelectionService') as
        { selected: ReadonlySet<string>; clear: () => void } | undefined
      if (selection && selection.selected.size > 0) {
        targets.push(...Array.from(selection.selected))
        selectionToClear = selection
      }
    }

    if (targets.length === 0) return

    const lineage = get('@hypercomb.social/Lineage') as LineageLike | undefined
    const segments = (lineage?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)

    const landed = await removeTilesAt(segments, targets, {
      // Removing a tile takes its whole branch with it. Count what's nested and
      // confirm (the dialog is skipped when nothing is nested — see helper).
      confirm: async (history, parent) => {
        if (!(await confirmRemoval(history, parent, targets))) return false
        selectionToClear?.clear()
        return true
      },
    })

    // A DECLINED OR IMPOSSIBLE REMOVAL MUST NOT RESOLVE CLEAN. `removeTilesAt`
    // answers false when the participant cancels the dialog, when the services
    // are not up, or when the parent layer will not resolve — and this used to
    // return normally, so a model's receipt read "Ran 1 grammar" over work that
    // never happened. That is the exact failure `refuse` exists to prevent, one
    // step further down the path where only the outcome can see it. Throwing
    // makes the plan stop and report the honest partial receipt; for a typed
    // participant it surfaces as the same warned-and-skipped line as any other
    // behaviour that could not act.
    if (!landed) {
      throw new Error(`/remove did not run — ${targets.length === 1 ? `"${targets[0]}"` : 'the tiles'} were not taken off this page`)
    }
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseRemoveArgs(args: string): string[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  // Bracket batch: [tile1, tile2, tile3]
  const bracketMatch = trimmed.match(/^\[(.+)\]$/)
  if (bracketMatch) {
    return bracketMatch[1]
      .split(',')
      .map(s => normalizeName(s.trim()))
      .filter(Boolean)
  }

  // Single name
  const name = normalizeName(trimmed)
  return name ? [name] : []
}

/** Minimal normalization — lowercase, collapse whitespace to hyphens, strip non-alphanumeric. */
function normalizeName(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

// ── registration ────────────────────────────────────────

const _remove = new RemoveQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RemoveQueenBee', _remove)

// Listen for controls-bar / context-menu "remove" action
EffectBus.on<{ action: string }>('controls:action', (payload) => {
  if (payload?.action === 'remove') void _remove.invoke('')
})

// Listen for keyboard shortcut (Delete / Backspace)
EffectBus.on<{ cmd: string }>('keymap:invoke', (payload) => {
  if (payload?.cmd === 'selection.remove') void _remove.invoke('')
})
