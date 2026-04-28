// diamondcoreprocessor.com/substrate/reroll.queen.ts
//
// /reroll — re-pick substrate background images for tiles.
//
// Targeting follows the standard slash-command convention:
//   /reroll                    — reroll current selection; if empty, reroll
//                                every substrate-assigned tile in the hive
//   /reroll tileName           — reroll a single tile
//   /reroll [tile1,tile2,...]  — reroll a bracketed batch
//
// Only tiles whose current props point into the substrate pool are touched,
// so a user-authored image can never be clobbered. The balanced picker in
// SubstrateService guarantees the new assignments spread evenly across the
// pool rather than stacking up on the same image.

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class RerollQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'reroll'
  override readonly aliases = []
  override description = 'Reroll substrate background images on tiles'
  override descriptionKey = 'slash.reroll'

  override slashComplete(args: string): readonly string[] {
    const cellProvider = get('@hypercomb.social/CellSuggestionProvider') as { suggestions(): string[] } | undefined
    const cells = cellProvider?.suggestions() ?? []

    const bracketStart = args.indexOf('[')
    if (bracketStart >= 0) {
      const inner = args.slice(bracketStart + 1)
      const lastComma = inner.lastIndexOf(',')
      const fragment = (lastComma >= 0 ? inner.slice(lastComma + 1) : inner).trimStart().toLowerCase()
      const already = new Set<string>()
      for (const item of inner.split(',')) {
        const n = item.trim().toLowerCase()
        if (n && n !== fragment) already.add(n)
      }
      let filtered = cells.filter(n => !already.has(n))
      if (fragment) filtered = filtered.filter(n => n.startsWith(fragment))
      return filtered
    }

    const q = args.toLowerCase().trim()
    if (!q) return cells
    return cells.filter(n => n.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) return
    await service.ensureLoaded()

    const targets = await this.#resolveTargets(args)
    if (targets.length === 0) {
      this.#toast('nothing to reroll')
      return
    }

    const rerolled = service.rerollCells(targets)
    if (rerolled.length === 0) {
      this.#toast('no substrate tiles in target')
      return
    }

    // Per-cell emit: show-cell's substrate:rerolled handler invalidates the
    // caches for each affected tile, and requestRender is microtask-coalesced
    // so the burst collapses to a single render pass.
    for (const cell of rerolled) {
      EffectBus.emit('substrate:rerolled', { cell })
    }

    this.#toast(`rerolled ${rerolled.length} tile${rerolled.length === 1 ? '' : 's'}`)
    void new hypercomb().act()
  }

  /**
   * Resolution order:
   *   1. explicit bracket batch    → those names
   *   2. explicit single name arg  → [that name]
   *   3. current selection         → selection contents
   *   4. no target information     → every tile in the current hive
   */
  async #resolveTargets(args: string): Promise<string[]> {
    const explicit = parseTargets(args)
    if (explicit.length > 0) return explicit

    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    if (selection && selection.selected.size > 0) {
      return Array.from(selection.selected)
    }

    return this.#visibleHiveLabels()
  }

  async #visibleHiveLabels(): Promise<string[]> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const dir = await lineage?.explorerDir()
    if (!dir) return []
    const labels: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'directory') labels.push(name)
    }
    return labels
  }

  #toast(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }
}

// ── arg parsing ──────────────────────────────────────────

/**
 * Parse the arg string into a list of tile names. Mirrors the
 * /remove parser so the bracket syntax is identical across commands:
 *   "" / whitespace          → []
 *   "tileName"                → ["tilename"]
 *   "[tile1, tile2, tile3]"   → ["tile1","tile2","tile3"]
 *   "[tile1, tile2"           → ["tile1","tile2"]  (autocomplete-in-progress)
 */
function parseTargets(args: string): string[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  const bracketStart = trimmed.indexOf('[')
  if (bracketStart >= 0) {
    const bracketEnd = trimmed.lastIndexOf(']')
    const inner = bracketEnd > bracketStart
      ? trimmed.slice(bracketStart + 1, bracketEnd)
      : trimmed.slice(bracketStart + 1)
    return inner
      .split(',')
      .map(s => normalizeName(s.trim()))
      .filter(Boolean)
  }

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

const _reroll = new RerollQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RerollQueenBee', _reroll)
