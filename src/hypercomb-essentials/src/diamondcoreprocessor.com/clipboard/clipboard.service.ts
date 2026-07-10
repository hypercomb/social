// diamondcoreprocessor.com/core/clipboard/clipboard.service.ts
import { EffectBus } from '@hypercomb/core'

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
  #op: ClipboardOp = 'copy'

  get items(): readonly ClipboardEntry[] { return this.#items }
  get operation(): ClipboardOp { return this.#op }
  get count(): number { return this.#items.length }
  get isEmpty(): boolean { return this.#items.length === 0 }

  capture(labels: readonly string[], sourceSegments: readonly string[], op: ClipboardOp): void {
    if (labels.length === 0) return
    this.#items = labels.map(label => ({ label, sourceSegments }))
    this.#op = op
    this.#notify()
  }

  /** Capture entries with per-item sourceSegments — used when selection
   *  spans multiple parent dirs (path syntax like `[a, b/c]/cut`). */
  captureEntries(entries: readonly ClipboardEntry[], op: ClipboardOp): void {
    if (entries.length === 0) return
    this.#items = entries.map(e => ({ label: e.label, sourceSegments: [...e.sourceSegments], sig: e.sig }))
    this.#op = op
    this.#notify()
  }

  consume(): { items: readonly ClipboardEntry[]; op: ClipboardOp } {
    const result = { items: this.#items, op: this.#op }
    if (this.#op === 'cut') {
      this.#items = []
      this.#notify()
    }
    return result
  }

  removeItems(labels: ReadonlySet<string>): void {
    this.#items = this.#items.filter(i => !labels.has(i.label))
    this.#notify()
  }

  clear(): void {
    if (this.#items.length === 0) return
    this.#items = []
    this.#op = 'copy'
    this.#notify()
  }

  #notify(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('clipboard:changed', {
      items: this.#items,
      op: this.#op,
      count: this.#items.length,
    })
  }
}

const _clipboardService = new ClipboardService()
window.ioc.register('@diamondcoreprocessor.com/ClipboardService', _clipboardService)

// Announce clipboard availability so shared UI can gate clipboard controls
EffectBus.emit('clipboard:available', { available: true })
