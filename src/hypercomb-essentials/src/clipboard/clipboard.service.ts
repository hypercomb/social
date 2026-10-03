// core/clipboard/clipboard.service.ts
import { EffectBus } from '@hypercomb/core'

/** Capture-time verb: did the gesture also remove the source (cut) or leave
 *  it in place (copy)? It is a property of the GESTURE — what the clipboard
 *  holds is the same sig reference either way. The one fact a held entry keeps
 *  from it is `cut`: whether its source page still lists it, which decides
 *  whether replacing the entry loses the only easy handle on the tile. */
export type ClipboardOp = 'copy' | 'cut'

export interface ClipboardEntry {
  label: string
  sourceSegments: readonly string[]
  /** The COLLECTION sig, captured at cut/copy intent: a merkle fold of the
   *  cell's live subtree (sealSubtree), falling back to the parent's stored
   *  child sig. One sig carries the whole subtree — paste appends it to the
   *  destination's children and nothing else. History is append-only, so it
   *  stays resolvable forever: a cut child is gone from its parent's head,
   *  but its bytes remain sig-addressed. Paste resolves by sig FIRST; path
   *  resolution is the fallback. (The worker kept its own copy of this type
   *  until the `cut` mark drifted between the two; this is the one.) */
  sig?: string
  /** Set when a CUT put this entry here. Its source page no longer lists it,
   *  so until it is placed the clipboard is the only easy handle on it — a
   *  fresh capture that replaced it would leave it reachable by undo alone. */
  cut?: boolean
  /** Set when the tile was someone else's words when it was taken — inside a
   *  branch folded in from a peer (sharing/adopted-roots.ts `isPeerContentAt`).
   *  Decided at the take, because cutting an adopted root unsubscribes it;
   *  placing the entry marks where it lands, so the words stay theirs there. */
  fromPeer?: boolean
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
    this.#items = entries.map(e => ({
      label: e.label, sourceSegments: [...e.sourceSegments], sig: e.sig, ...(e.cut ? { cut: true } : {}),
      ...(e.fromPeer ? { fromPeer: true } : {}),
    }))
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
      const held = byKey.get(key)
      byKey.set(key, {
        label: e.label,
        sourceSegments: [...e.sourceSegments],
        sig: e.sig ?? held?.sig,
        ...(e.cut || held?.cut ? { cut: true } : {}),
        ...(e.fromPeer || held?.fromPeer ? { fromPeer: true } : {}),
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

// clipboard/clipboard.worker.ts registers this (atomic-modules-plan.md): a dependency registers nothing.
