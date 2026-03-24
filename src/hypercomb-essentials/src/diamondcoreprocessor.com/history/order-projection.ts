// diamondcoreprocessor.com/core/order-projection.ts
import { EffectBus } from '@hypercomb/core'
import type { HistoryService, HistoryOp } from './history.service.js'

export class OrderProjection {

  #cache = new Map<string, string[]>()
  #currentSig: string | null = null

  constructor() {
    EffectBus.on<{ seed: string }>('seed:added', (payload) => {
      if (!payload?.seed || !this.#currentSig) return
      const order = this.#cache.get(this.#currentSig)
      if (order && !order.includes(payload.seed)) {
        order.push(payload.seed)
      }
    })

    EffectBus.on<{ seed: string }>('seed:removed', (payload) => {
      if (!payload?.seed || !this.#currentSig) return
      const order = this.#cache.get(this.#currentSig)
      if (order) {
        const idx = order.indexOf(payload.seed)
        if (idx !== -1) order.splice(idx, 1)
      }
    })
  }

  /**
   * Replay history for a location, build order, cache and return it.
   * Sets this location as the "current" for effect-driven updates.
   */
  async hydrate(locationSig: string): Promise<string[]> {
    this.#currentSig = locationSig

    const cached = this.#cache.get(locationSig)
    if (cached) return cached

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return []

    const ops = await historyService.replay(locationSig)
    const order = await this.#buildOrder(ops)

    this.#cache.set(locationSig, order)
    return order
  }

  /**
   * Write a reorder op to history and update the in-memory cache.
   * Stores the ordered seed list as a content-addressed resource.
   */
  async reorder(seeds: string[]): Promise<string[]> {
    if (!this.#currentSig) return seeds

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const store = get<any>('@hypercomb.social/Store')
    if (!historyService || !store) return seeds

    // Store ordered list as content-addressed resource
    const payload = JSON.stringify(seeds)
    const payloadSig: string = await store.putResource(new Blob([payload]))

    // Record reorder op — seed field holds the resource signature
    await historyService.record(this.#currentSig, {
      op: 'reorder',
      seed: payloadSig,
      at: Date.now(),
    })

    // Update in-memory cache
    const copy = [...seeds]
    this.#cache.set(this.#currentSig, copy)
    return copy
  }

  /** Read cached order (null if not hydrated). */
  peek(locationSig: string): string[] | null {
    return this.#cache.get(locationSig) ?? null
  }

  /** Invalidate cache for a location. */
  evict(locationSig: string): void {
    this.#cache.delete(locationSig)
  }

  /**
   * Walk history ops to derive display order:
   * - add → append seed (if not present)
   * - remove → remove seed from list
   * - reorder → resolve payload from resources, replace list
   */
  async #buildOrder(ops: HistoryOp[]): Promise<string[]> {
    const store = get<any>('@hypercomb.social/Store')
    let order: string[] = []

    for (const op of ops) {
      switch (op.op) {
        case 'add':
          if (!order.includes(op.seed)) order.push(op.seed)
          break
        case 'remove':
          order = order.filter(s => s !== op.seed)
          break
        case 'reorder':
          if (store) {
            const blob: Blob | null = await store.getResource(op.seed)
            if (blob) {
              try {
                const parsed = JSON.parse(await blob.text())
                if (Array.isArray(parsed)) order = parsed
              } catch { /* skip corrupted payload */ }
            }
          }
          break
        // other op types (rename, add-drone, remove-drone) don't affect order
      }
    }

    return order
  }
}

const _orderProjection = new OrderProjection()
;(window as any).ioc.register('@diamondcoreprocessor.com/OrderProjection', _orderProjection)
