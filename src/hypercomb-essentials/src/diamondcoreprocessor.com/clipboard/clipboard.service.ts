// diamondcoreprocessor.com/core/clipboard/clipboard.service.ts
import { EffectBus } from '@hypercomb/core'

/** Capture-time verb: did the gesture also remove the source (cut) or leave
 *  it in place (copy)? It is a property of the GESTURE, not of the clipboard —
 *  what the clipboard holds is identical either way: sig references. */
export type ClipboardOp = 'copy' | 'cut'

export interface ClipboardEntry {
  label: string
  sourceSegments: readonly string[]
  /** The source cell's LAYER SIG, captured at cut/copy intent. History is
   *  append-only, so this stays resolvable forever — a cut child is gone
   *  from its parent's head, but its layer bytes remain sig-addressed.
   *  Paste resolves by sig FIRST; path resolution is the fallback. */
  sig?: string
}

export class ClipboardService extends EventTarget {
  #items: ClipboardEntry[] = []

  get items(): readonly ClipboardEntry[] { return this.#items }
  get count(): number { return this.#items.length }
  get isEmpty(): boolean { return this.#items.length === 0 }

  /** Capture entries with per-item sourceSegments — used when selection
   *  spans multiple parent dirs (path syntax like `[a, b/c]/cut`). */
  captureEntries(entries: readonly ClipboardEntry[]): void {
    if (entries.length === 0) return
    this.#items = entries.map(e => ({ label: e.label, sourceSegments: [...e.sourceSegments], sig: e.sig }))
    this.#notify()
  }

  /** ADD entries without dropping what is already held — the click-take path
   *  (a tile clicked on the hive while the clipboard window is open swaps
   *  INTO it, one at a time). Keyed by label + source path, so the eager
   *  pre-commit call and the enriching post-seal call for the same tile
   *  upsert one row instead of minting two; an absent `sig` on the second
   *  pass never erases the one the first pass captured. */
  appendEntries(entries: readonly ClipboardEntry[]): void {
    if (entries.length === 0) return
    const keyOf = (e: ClipboardEntry): string => e.label + '\u0000' + e.sourceSegments.join('/')
    const byKey = new Map(this.#items.map(i => [keyOf(i), i]))
    for (const e of entries) {
      const key = keyOf(e)
      byKey.set(key, {
        label: e.label,
        sourceSegments: [...e.sourceSegments],
        sig: e.sig ?? byKey.get(key)?.sig,
      })
    }
    this.#items = [...byKey.values()]
    this.#notify()
  }

  removeItems(labels: ReadonlySet<string>): void {
    this.#items = this.#items.filter(i => !labels.has(i.label))
    this.#notify()
  }

  clear(): void {
    if (this.#items.length === 0) return
    this.#items = []
    this.#notify()
  }

  #notify(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('clipboard:changed', {
      items: this.#items,
      count: this.#items.length,
    })
  }
}

const _clipboardService = new ClipboardService()
window.ioc.register('@diamondcoreprocessor.com/ClipboardService', _clipboardService)

// Announce clipboard availability so shared UI can gate clipboard controls
EffectBus.emit('clipboard:available', { available: true })
