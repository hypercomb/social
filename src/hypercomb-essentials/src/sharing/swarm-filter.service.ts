// sharing/swarm-filter.service.ts
//
// SwarmFilterService — the participant filter for the swarm canvas.
//
// Model: at a busy location N peers publish tiles. By default the render
// composites everyone. Clicking participant badges selects a SUBSET of
// pubkeys; while the selection is non-empty, only the selected
// participants' peer tiles render (your own tiles are never touched).
// Empty selection = no filter = everyone shows.
//
// The selection is MULTI-select (unlike spotlight's single peer) and
// deliberately in-memory, session-only: a filter surviving a reload
// while the peers who justified it are gone is a trap — the same
// posture SpotlightService and the session hide store take. No
// localStorage, no pool, no lineage writes.
//
// Consumers:
//   - swarm.drone #registerTileSource — the AUTHORITATIVE filter point,
//     applied before the tile-source registry's kind:name dedup so a
//     same-name tile resolves to a SELECTED publisher's entry
//   - show-cell — belt-and-braces union delete + full render
//     invalidation on `swarm:filter`
//   - presence-banner — the badge toggles + selected styling
//
// Fired on every change: `swarm:filter { participants }` (EffectBus,
// last-value replay seeds late subscribers).

import { EffectBus } from '@hypercomb/core'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'

/** Fired on every selection change (toggle / clear / reconcile). */
export const SWARM_FILTER_CHANGED = 'swarm:filter'

interface SwarmDroneLike {
  participantsAtCurrentSig?: () => readonly string[]
}

export class SwarmFilterService extends EventTarget {

  /** Selected participant pubkeys. Empty = no filter, everyone shows. */
  #selected = new Set<string>()

  get selected(): ReadonlySet<string> { return this.#selected }

  isSelected(pubkey: string): boolean { return this.#selected.has(pubkey) }

  /** Flip one participant in or out of the selection. Selecting a
   *  pubkey that isn't in the live participant set is refused
   *  (defensive — a stale badge click after the peer expired). */
  toggle(pubkey: string): void {
    const key = String(pubkey ?? '').trim()
    if (!key) return
    if (this.#selected.has(key)) {
      this.#selected.delete(key)
      this.#emit()
      return
    }
    if (!this.#participants().includes(key)) return
    this.#selected.add(key)
    this.#emit()
  }

  /** Back to "everyone shows". */
  clear(): void {
    if (this.#selected.size === 0) return
    this.#selected.clear()
    this.#emit()
  }

  /** Called when the swarm's peer set changes — departed participants
   *  drop out of the selection (a selection of ghosts would filter the
   *  canvas down to nothing with no visible reason). */
  reconcile(): void {
    if (this.#selected.size === 0) return
    const live = new Set(this.#participants())
    let changed = false
    for (const pk of this.#selected) {
      if (!live.has(pk)) { this.#selected.delete(pk); changed = true }
    }
    if (changed) this.#emit()
  }

  #participants(): readonly string[] {
    const swarm = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(
      SWARM_DRONE_KEY,
    ) as SwarmDroneLike | undefined
    return swarm?.participantsAtCurrentSig?.() ?? []
  }

  #emit(): void {
    const payload = { participants: [...this.#selected] as readonly string[] }
    this.dispatchEvent(new CustomEvent(SWARM_FILTER_CHANGED, { detail: payload }))
    EffectBus.emit(SWARM_FILTER_CHANGED, payload)
  }
}

const _swarmFilter = new SwarmFilterService()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/SwarmFilterService',
  _swarmFilter,
)

/** The live selection, for the swarm drone's source-side filter — a
 *  direct module read keeps the hot path free of IoC lookups. */
export const swarmFilterSelection = (): ReadonlySet<string> => _swarmFilter.selected

// Reconcile when the swarm's peer set changes — covers peers going
// stale, leaving, or the location changing under the selection.
EffectBus.on('swarm:peers-changed', () => _swarmFilter.reconcile())
