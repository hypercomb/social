// diamondcoreprocessor.com/commands/tag-removal.drone.ts
//
// STAGED pheromone removal — the "which tiles?" step that the panel's × used
// to skip. Removing a keyword from a tile was previously only possible by
// typing `/keyword ~name` at a selection: the Pheromones panel's × dropped the
// tag from the master registry and left every decoration in place, so a
// mis-tagged hive had no way back out through the UI.
//
// The flow this drone owns:
//   1. `tags:removal-begin { tag }`  — the panel's × arms removal. The panel
//      simultaneously filters the hive to that tag, so every tile carrying it
//      (within the chosen reach) is what you're looking at.
//   2. `tags:removal-toggle { label }` — clicking a tile stages/unstages it.
//      Staged tiles render struck-through (show-cell marks them as a future
//      remove) and the panel's list grows, so the pending change is visible in
//      two places at once before anything is written.
//   3. `tags:removal-commit` — the removals are applied, one decoration
//      splice per staged tile, and the processor pulses.
//      `tags:removal-cancel` throws the staging away; nothing was written.
//
// Nothing here mutates a layer until the commit. Staging state is pure
// in-memory intent, broadcast on `tags:removal-pending` (sticky) so the panel
// and the renderer always agree on what is about to happen.
//
// The path per staged label comes from the flatten scan's `flatPaths` (a match
// can live anywhere in the hive, so its name alone doesn't locate it) with the
// current location as the fallback for an unflattened page.

import { Drone, EffectBus, hypercomb, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'

type DecorationServiceLike = {
  removeTag(segments: readonly string[], name: string): Promise<void>
}
type LineageLike = { explorerSegments?: () => readonly string[] }

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

export class TagRemovalDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'commands'

  public override description =
    'Staged pheromone removal: arm a keyword, click the tiles to drop it from, review the list, then commit.'

  protected override listens = [
    'tags:removal-begin', 'tags:removal-toggle', 'tags:removal-select-all',
    'tags:removal-commit', 'tags:removal-cancel', 'render:cell-count', 'tags:filter',
  ]
  protected override emits = ['tags:removal-pending', 'tags:changed', 'toast:show']

  #wired = false
  /** The keyword being removed. null = not staging. */
  #tag: string | null = null
  /** Labels staged for removal — the growing list the panel renders. */
  #pending = new Set<string>()
  /** Labels currently on screen (render:cell-count), for "stage all shown". */
  #shown: string[] = []
  /** Absolute path per flattened label — a match can live anywhere. */
  #paths = new Map<string, string[]>()
  /** The live tag filter, mirrored so the post-commit re-scan keeps the
   *  participant's chosen reach instead of resetting it to page-only. */
  #filter: { active: string[]; scope?: string } | null = null
  #committing = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<{ tag?: string }>('tags:removal-begin', (p) => {
      const tag = String(p?.tag ?? '').trim()
      if (!tag) return
      this.#tag = tag
      this.#pending.clear()
      this.#broadcast()
    })

    this.onEffect<{ label?: string }>('tags:removal-toggle', (p) => {
      const label = String(p?.label ?? '').trim()
      if (!this.#tag || !label) return
      if (this.#pending.has(label)) this.#pending.delete(label)
      else this.#pending.add(label)
      this.#broadcast()
    })

    this.onEffect('tags:removal-select-all', () => {
      if (!this.#tag) return
      for (const label of this.#shown) this.#pending.add(label)
      this.#broadcast()
    })

    this.onEffect('tags:removal-cancel', () => {
      if (!this.#tag) return
      this.#tag = null
      this.#pending.clear()
      this.#broadcast()
    })

    this.onEffect('tags:removal-commit', () => { void this.#commit() })

    // The rendered set is the source for "stage every tile shown", and its
    // flatPaths locate each match. Under a filter these describe the flatten;
    // on an ordinary page flatPaths is empty and the location fallback applies.
    this.onEffect<{ labels?: string[]; flatPaths?: Record<string, string[]> }>('render:cell-count', (p) => {
      this.#shown = Array.isArray(p?.labels) ? p.labels.filter(Boolean) : []
      const paths = p?.flatPaths ?? {}
      for (const [label, path] of Object.entries(paths)) {
        if (Array.isArray(path) && path.length > 0) this.#paths.set(label, [...path])
      }
    })

    this.onEffect<{ active?: string[]; scope?: string }>('tags:filter', (p) => {
      const active = Array.isArray(p?.active) ? p.active.filter(Boolean) : []
      this.#filter = active.length > 0 ? { active, scope: p?.scope } : null
    })
  }

  /** Broadcast the staging state. Sticky, so a panel opened mid-staging (or a
   *  renderer that just rebuilt) hydrates the pending marks immediately. */
  #broadcast(): void {
    this.emitEffect('tags:removal-pending', {
      tag: this.#tag,
      cells: [...this.#pending],
      active: this.#tag !== null,
    })
  }

  async #commit(): Promise<void> {
    const tag = this.#tag
    const cells = [...this.#pending]
    if (!tag || this.#committing) return
    if (cells.length === 0) {
      // Nothing staged — a commit means "never mind", not "remove everything".
      this.#tag = null
      this.#broadcast()
      return
    }
    this.#committing = true

    const decorations = ioc<DecorationServiceLike>('@diamondcoreprocessor.com/DecorationService')
    const here = ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []

    const removed: string[] = []
    for (const label of cells) {
      const segments = this.#paths.get(label) ?? [...here, label]
      try {
        await decorations?.removeTag(segments, tag)
        removed.push(label)
      } catch (err) {
        console.warn('[tag-removal] failed to remove', tag, 'from', label, err)
      }
    }

    this.#tag = null
    this.#pending.clear()
    this.#committing = false
    this.#broadcast()

    if (removed.length > 0) {
      this.emitEffect('tags:changed', { updates: removed.map(cell => ({ cell, tag })) })
    }

    await new hypercomb().act()

    const i18n = ioc<I18nProvider>(I18N_IOC_KEY)
    this.emitEffect('toast:show', {
      type: removed.length === cells.length ? 'success' : 'info',
      title: i18n?.t('tags.removal.done.title', { tag }) ?? `Removed "${tag}"`,
      message: i18n?.t('tags.removal.done.message', { count: removed.length, tag })
        ?? `"${tag}" removed from ${removed.length} tile${removed.length === 1 ? '' : 's'}.`,
    })

    // Re-run the flatten scan against the committed layers so the tiles that
    // just lost the keyword drop out of view — the confirmation IS the render.
    if (this.#filter) EffectBus.emit('tags:filter', { ...this.#filter })
  }
}

// ── registration ────────────────────────────────────────
const _tagRemoval = new TagRemovalDrone()
window.ioc.register('@diamondcoreprocessor.com/TagRemovalDrone', _tagRemoval)
