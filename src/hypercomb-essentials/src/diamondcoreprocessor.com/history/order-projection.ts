// diamondcoreprocessor.com/core/order-projection.ts
import { EffectBus } from '@hypercomb/core'
import type { HistoryService, HistoryOp } from './history.service.js'

export class OrderProjection {

  #cache = new Map<string, string[]>()
  #currentSig: string | null = null

  constructor() {
    EffectBus.on<{ cell: string }>('cell:added', (payload) => {
      if (!payload?.cell || !this.#currentSig) return
      const order = this.#cache.get(this.#currentSig)
      if (order && !order.includes(payload.cell)) {
        order.push(payload.cell)
      }
    })

    EffectBus.on<{ cell: string }>('cell:removed', (payload) => {
      if (!payload?.cell || !this.#currentSig) return
      const order = this.#cache.get(this.#currentSig)
      if (order) {
        const idx = order.indexOf(payload.cell)
        if (idx !== -1) order.splice(idx, 1)
      }
    })

    EffectBus.on<{ labels: string[] }>('cell:reorder', (payload) => {
      if (!payload?.labels?.length || !this.#currentSig) return
      this.#cache.set(this.#currentSig, [...payload.labels])
    })
  }

  /**
   * Resolve the canonical cell order for a location.
   *
   * Preferred path: read the head layer and use its `children` array —
   * constant-time and always reflects whatever the LayerCommitter most
   * recently snapshotted. NOTE: `children` now contains child layer
   * sigs (not display names). Display-name resolution is the consumer's
   * responsibility — callers that need names must load each child sig
   * via HistoryService.getLayerContent and read its `name` field.
   *
   * Legacy fallback: for locations whose history predates the layer
   * format (no `layers/` subdirectory), replay the sequential op files.
   * This keeps existing user bags readable without a one-shot migration.
   */
  async hydrate(locationSig: string): Promise<string[]> {
    this.#currentSig = locationSig

    const cached = this.#cache.get(locationSig)
    if (cached) return cached

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!historyService) return []

    const fromLayer = await this.#orderFromHeadLayer(historyService, locationSig)
    if (fromLayer) {
      this.#cache.set(locationSig, fromLayer)
      return fromLayer
    }

    const ops = await historyService.replay(locationSig)
    const order = await this.#buildOrder(ops)

    this.#cache.set(locationSig, order)
    return order
  }

  async #orderFromHeadLayer(
    history: HistoryService,
    locationSig: string,
  ): Promise<string[] | null> {
    const head = await history.headLayer(locationSig)
    if (!head) return null

    // Marker file IS the layer JSON — read directly from the bag.
    // `children` carries child layer sigs (not display names); the
    // consumer must resolve those sigs to names if it needs them.
    const content = await history.getLayerContent(locationSig, head.layerSig)
    if (!content) return null
    return Array.isArray(content.children) ? [...content.children] : null
  }

  /**
   * Cache the current display order at this location.
   *
   * Position is NOT layer state. Each cell carries its slot index
   * permanently in its own `0000` properties (see show-cell's
   * `#orderByIndexPinned`). Reordering the parent's `children` sig
   * array would have no semantic effect on placement, so we deliberately
   * do NOT call `committer.update` here — that would mint layer
   * markers for non-changes and pollute the merkle backbone.
   *
   * The legacy `historyService.record('reorder', ...)` path that lived
   * here was a dead write (see history-recorder.drone.ts) and is gone.
   * The authoritative save for a move is `writeCellProperties(cell,
   * { index })` in MoveDrone — that's already happening alongside this
   * cache update.
   */
  async reorder(cells: string[]): Promise<string[]> {
    if (!this.#currentSig) return cells
    const copy = [...cells]
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
   * - add → append cell (if not present)
   * - remove → remove cell from list
   * - reorder → resolve payload from resources, replace list
   */
  async #buildOrder(ops: HistoryOp[]): Promise<string[]> {
    const store = get<any>('@hypercomb.social/Store')
    let order: string[] = []

    for (const op of ops) {
      switch (op.op) {
        case 'add':
          if (!order.includes(op.cell)) order.push(op.cell)
          break
        case 'remove':
          order = order.filter(s => s !== op.cell)
          break
        case 'reorder':
          if (store) {
            const blob: Blob | null = await store.getResource(op.cell)
            if (blob) {
              try {
                const parsed = JSON.parse(await blob.text())
                if (Array.isArray(parsed)) order = parsed
              } catch { /* skip corrupted payload */ }
            }
          }
          break
        // other op types (add-drone, remove-drone, tag-state, content-state, layout-state, instruction-state) don't affect order
      }
    }

    return order
  }
}

const _orderProjection = new OrderProjection()
;(window as any).ioc.register('@diamondcoreprocessor.com/OrderProjection', _orderProjection)
