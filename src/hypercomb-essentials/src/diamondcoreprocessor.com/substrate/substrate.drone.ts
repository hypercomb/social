// diamondcoreprocessor.com/substrate/substrate.drone.ts
//
// SubstrateDrone — orchestrates the substrate system:
//   • Warms up the active source on startup and after changes
//   • Applies substrate to blank tiles as they render
//   • Clears cell assignments when cells are removed
//   • Opens the organizer on indicator click
//   • Prompts for folder re-grant when a linked folder needs permission
//   • Re-scans linked folders on tab focus so new images appear live

import { Drone, EffectBus } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class SubstrateDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Auto-assign substrate background images to new cells'

  protected override listens = [
    'cell:added', 'cell:removed',
    'substrate:changed', 'substrate:folder-permission',
    'drop:pending', 'clipboard:paste-start', 'clipboard:paste-done',
    'editor:mode', 'render:cell-count',
    'cell:attach-pending',
    'indicator:click',
  ]
  protected override emits = ['substrate:applied', 'substrate:ready', 'indicator:set', 'indicator:clear', 'substrate-organizer:open', 'activity:log']

  #initialized = false
  #dropPending = false
  #pastePending = false
  #editorActive = false
  #visibilityBound = false
  #pendingPermissionHandleId: string | null = null
  /** Cells with a user-provided resource being attached — substrate must not touch these. */
  #attachPending = new Set<string>()

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    const service = this.#service()
    if (service) {
      void service.warmUp().then(() => {
        this.#syncIndicator()
        // Tell show-cell.drone that the props pool is ready so it triggers
        // a fresh render. The render emits render:cell-count → this drone
        // catches it and applies substrate to any still-blank cells. Without
        // this kick, cells created before warmUp finishes never get filled
        // until the user manually navigates or refreshes.
        EffectBus.emit('substrate:ready', {})
      })
    }

    this.onEffect<{ active: boolean }>('drop:pending', (p) => { this.#dropPending = p?.active ?? false })
    this.onEffect('clipboard:paste-start', () => { this.#pastePending = true })
    this.onEffect('clipboard:paste-done',  () => { this.#pastePending = false })
    this.onEffect<{ active: boolean }>('editor:mode', (p) => { this.#editorActive = p?.active ?? false })

    // A user-provided resource is being attached to this cell — lock substrate
    // out so it can't race and overwrite the image or stamp a substrate flag.
    this.onEffect<{ cell: string; pending: boolean }>('cell:attach-pending', ({ cell, pending }) => {
      if (!cell) return
      if (pending) this.#attachPending.add(cell)
      else this.#attachPending.delete(cell)
    })

    // Apply substrate to new cells synchronously.
    this.onEffect<{ cell: string }>('cell:added', ({ cell }) => {
      if (!cell) return
      if (this.#dropPending || this.#pastePending || this.#editorActive) return
      if (this.#attachPending.has(cell)) return
      const svc = this.#service()
      if (svc?.applyToCell(cell)) EffectBus.emit('substrate:applied', { cell })
    })

    this.onEffect<{ cell: string }>('cell:removed', ({ cell }) => {
      if (!cell) return
      this.#service()?.clearCell(cell)
    })

    // Fill tiles the renderer reports as blank — skip any cell currently
    // mid-attach (user-provided resource still being written to OPFS).
    this.onEffect<{ noImageLabels?: string[] }>('render:cell-count', (payload) => {
      const labels = payload?.noImageLabels
      if (!labels?.length) return
      const svc = this.#service()
      if (!svc) return
      const filtered = this.#attachPending.size
        ? labels.filter(l => !this.#attachPending.has(l))
        : labels
      if (filtered.length === 0) return
      const applied = svc.applyToAllBlanks(filtered)
      for (const cell of applied) EffectBus.emit('substrate:applied', { cell })
    })

    // Registry / active-source / per-hive changes → re-warm and re-sync indicator.
    this.onEffect('substrate:changed', () => {
      const svc = this.#service()
      if (!svc) return
      void svc.warmUp().then(() => {
        this.#syncIndicator()
        EffectBus.emit('substrate:ready', {})
      })
    })

    // Folder source needs a user-gesture re-grant. Show an indicator; clicking
    // it triggers requestPermission inside the gesture.
    this.onEffect<{ handleId: string; permission: string }>('substrate:folder-permission', ({ handleId, permission }) => {
      if (permission === 'granted') return
      this.#pendingPermissionHandleId = handleId
      EffectBus.emit('indicator:set', {
        key: 'substrate-reconnect',
        icon: '◈',
        label: 'Substrate folder — click to reconnect',
      })
    })

    // Indicator clicks → either reconnect a folder or open the organizer.
    this.onEffect<{ key: string }>('indicator:click', async ({ key }) => {
      const svc = this.#service()
      if (!svc) return
      if (key === 'substrate-reconnect' && this.#pendingPermissionHandleId) {
        const result = await svc.requestFolderAccess(this.#pendingPermissionHandleId)
        if (result === 'granted') {
          EffectBus.emit('indicator:clear', { key: 'substrate-reconnect' })
          this.#pendingPermissionHandleId = null
          await svc.warmUp()
          this.#syncIndicator()
          EffectBus.emit('activity:log', { message: 'substrate folder reconnected', icon: '◈' })
        } else {
          EffectBus.emit('activity:log', { message: 'substrate folder access denied', icon: '◈' })
        }
        return
      }
      if (key === 'substrate') {
        EffectBus.emit('substrate-organizer:open', {})
      }
    })

    // Re-scan linked folders when the tab regains focus — new images dropped
    // into the folder appear without a manual refresh.
    if (!this.#visibilityBound && typeof document !== 'undefined') {
      this.#visibilityBound = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        const s = this.#service()
        if (!s) return
        const active = s.resolvedSource
        if (active?.type !== 'folder') return
        void s.warmUp()
      })
    }
  }

  #syncIndicator(): void {
    EffectBus.emit('indicator:clear', { key: 'substrate' })
  }

  #service(): SubstrateService | undefined {
    return get('@diamondcoreprocessor.com/SubstrateService')
  }
}

const _substrateDrone = new SubstrateDrone()
window.ioc.register('@diamondcoreprocessor.com/SubstrateDrone', _substrateDrone)
