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

  protected override listens = ['cell:added', 'cell:removed', 'substrate:changed', 'drop:pending', 'clipboard:paste-start', 'clipboard:paste-done', 'editor:mode', 'render:cell-count', 'indicator:dismiss', 'substrate:navigate']
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
      void service.warmUp().then(async () => {
        // Show indicator if substrate is active
        if (service.pickRandomImageSync()) {
          const resolved = await service.resolve()
          const action = resolved
            ? { effect: 'substrate:navigate', payload: { segments: resolved.split('/') } }
            : undefined
          EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate active', action })
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
        void svc.warmUp().then(async () => {
          if (svc.pickRandomImageSync()) {
            const resolved = await svc.resolve()
            const action = resolved
              ? { effect: 'substrate:navigate', payload: { segments: resolved.split('/') } }
              : undefined
            EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate active', action })
          } else {
            EffectBus.emit('indicator:clear', { key: 'substrate' })
          }
        })
      }
    })

    // Handle indicator click — navigate to the substrate source hive
    this.onEffect<{ segments: string[] }>('substrate:navigate', ({ segments }) => {
      if (!segments?.length) return
      const navigation = get('@hypercomb.social/Navigation') as
        { goRaw: (segments: readonly string[]) => void } | undefined
      navigation?.goRaw(segments)
    })

    // Handle indicator dismiss — clear only the resolved level
    this.onEffect<{ key: string }>('indicator:dismiss', ({ key }) => {
      if (key !== 'substrate') return
      const svc = this.#service()
      if (!svc) return

      void svc.resolve().then(resolved => {
        if (!resolved) return
        // If resolved differs from global, a hive override is active — clear it
        if (resolved !== svc.globalPath) {
          void svc.clearHive()
        } else {
          void svc.clearGlobal()
        }
      })
    })
  }

  #service(): SubstrateService | undefined {
    return get('@diamondcoreprocessor.com/SubstrateService')
  }
}

const _substrateDrone = new SubstrateDrone()
window.ioc.register('@diamondcoreprocessor.com/SubstrateDrone', _substrateDrone)
