// diamondcoreprocessor.com/substrate/substrate.drone.ts
//
// SubstrateDrone — ensures every blank tile gets a substrate background image.
// Images and props resources are preloaded into a pool on startup.
// Assignment is a synchronous localStorage write — no render delay.

import { Drone, EffectBus } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class SubstrateDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Auto-assign substrate background images to new cells'

  protected override listens = ['cell:added', 'cell:removed', 'substrate:changed', 'drop:pending', 'clipboard:paste-start', 'editor:mode', 'render:cell-count']
  protected override emits = ['substrate:applied']

  #initialized = false
  #dropPending = false
  #pastePending = false
  #editorActive = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // Warm up: resolve path, collect image sigs, preload atlas + props pool
    const service = this.#service()
    if (service) {
      void service.warmUp().then(() => {
        // Show indicator if substrate is active
        if (service.pickRandomImageSync()) {
          EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate active' })
        }
      })
    }

    this.onEffect<{ active: boolean }>('drop:pending', (payload) => {
      this.#dropPending = payload?.active ?? false
    })

    this.onEffect('clipboard:paste-start', () => {
      this.#pastePending = true
    })
    this.onEffect('clipboard:paste-done', () => {
      this.#pastePending = false
    })

    this.onEffect<{ active: boolean }>('editor:mode', (payload) => {
      this.#editorActive = payload?.active ?? false
    })

    // Apply substrate to new cells synchronously
    this.onEffect<{ cell: string }>('cell:added', ({ cell }) => {
      if (!cell) return
      if (this.#dropPending || this.#pastePending || this.#editorActive) return

      const svc = this.#service()
      if (svc?.applyToCell(cell)) {
        EffectBus.emit('substrate:applied', { cell })
      }
    })

    // Clear props index when cell is removed so recreated cells get fresh substrate
    this.onEffect<{ cell: string }>('cell:removed', ({ cell }) => {
      if (!cell) return
      const svc = this.#service()
      svc?.clearCell(cell)
    })

    // When the renderer reports tiles with no image, fill them in
    this.onEffect<{ noImageLabels?: string[] }>('render:cell-count', (payload) => {
      if (!payload?.noImageLabels?.length) return
      const svc = this.#service()
      if (!svc) return

      const applied = svc.applyToAllBlanks(payload.noImageLabels)
      if (applied.length > 0) {
        for (const cell of applied) {
          EffectBus.emit('substrate:applied', { cell })
        }
      }
    })

    // When substrate config changes, re-warm the pool and sync indicator
    this.onEffect('substrate:changed', () => {
      const svc = this.#service()
      if (svc) {
        svc.invalidateCache()
        void svc.warmUp().then(() => {
          if (svc.pickRandomImageSync()) {
            EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate active' })
          } else {
            EffectBus.emit('indicator:clear', { key: 'substrate' })
          }
        })
      }
    })

    // Handle indicator dismiss — user clicked × on substrate indicator
    this.onEffect<{ key: string }>('indicator:dismiss', ({ key }) => {
      if (key !== 'substrate') return
      const svc = this.#service()
      if (svc) {
        void svc.clearHive()
        void svc.clearGlobal()
      }
    })
  }

  #service(): SubstrateService | undefined {
    return get('@diamondcoreprocessor.com/SubstrateService')
  }
}

const _substrateDrone = new SubstrateDrone()
window.ioc.register('@diamondcoreprocessor.com/SubstrateDrone', _substrateDrone)
