// diamondcoreprocessor.com/commands/remove.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import { confirmRemoval } from './remove-confirm.js'
import { resolveCurrentLayer } from '../history/layer-placement.js'
import type { PlacementHistory } from '../history/layer-placement.js'

type LineageLike = {
  domain?: () => string
  explorerSegments?: () => readonly string[]
}
type HistoryServiceLike = {
  sign(l: LineageLike): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ children?: readonly string[]; [k: string]: unknown } | null>
  getLayerBySig(sig: string): Promise<{ name?: string } | null>
}
type LayerCommitterLike = {
  update(
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ): Promise<string>
}

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
  override readonly aliases = []
  override description = 'Remove tiles from the current directory'

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
    const history = get('@diamondcoreprocessor.com/HistoryService') as HistoryServiceLike | undefined
    const committer = get('@diamondcoreprocessor.com/LayerCommitter') as LayerCommitterLike | undefined
    if (!lineage || !history || !committer) return

    const segments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    // Resolve the parent layer ROBUSTLY. The bare currentLayerAt(sign(segments))
    // reads the location's OWN history bag, which is COLD/empty for any location
    // never committed into (its content lives as a child sig in its parent,
    // pool-addressed) or simply not yet warmed after a reload — so it returns
    // null even when the layer plainly renders, and the old `if (!parent) return`
    // made delete a silent no-op ("tile never disappears"). resolveCurrentLayer
    // walks the parent chain, then falls back to the cursor (the source the
    // renderer warms for the current location). Mirrors the clipboard worker's
    // #resolveParentLayer and the move drone's #resolveCurrentParent.
    const cursor = get('@diamondcoreprocessor.com/HistoryCursorService') as { currentLayerSig?: string } | undefined
    const parent = await resolveCurrentLayer(
      history as unknown as PlacementHistory,
      lineage.domain,
      segments,
      cursor?.currentLayerSig,
    )
    if (!parent) return

    // Deleting a tile takes its whole branch with it. Count what's nested and
    // confirm (the dialog is skipped when nothing is nested — see helper).
    if (!(await confirmRemoval(history, parent, targets))) return
    selectionToClear?.clear()

    // Names are the truth. Resolve each child sig to its layer's `name`,
    // drop the targets, and pass the surviving names back. The committer
    // re-resolves each name to its current head sig at commit time, so
    // concurrent edits to a sibling cell are picked up automatically.
    const childSigs = Array.isArray(parent.children) ? parent.children : []
    const targetSet = new Set(targets)
    const survivorNames: string[] = []
    for (const sig of childSigs) {
      const child = await history.getLayerBySig(sig)
      if (!child || typeof child.name !== 'string') continue
      if (!targetSet.has(child.name)) survivorNames.push(child.name)
    }

    const nextLayer = { ...parent, children: survivorNames }

    // Notify downstream UI subscribers (activity log, substrate, slot
    // machine, tile-overlay) BEFORE awaiting the commit so the visual
    // unmount runs immediately. LayerCommitter.update is O(siblings)
    // per ancestor depth and can take seconds with large layers; gating
    // the visual on it makes deletes feel broken.
    //
    // `viaUpdate: true` tells LayerCommitter's per-event commit listener
    // to skip queueing — the upcoming committer.update() call IS the
    // atomic commit for this whole operation. Without the flag, N tiles
    // produce N history markers (one per event); with it, the whole
    // multi-delete collapses into a single marker.
    for (const name of targets) {
      EffectBus.emit('cell:removed', { cell: name, segments, viaUpdate: true })
    }

    await committer.update(segments, nextLayer)
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
