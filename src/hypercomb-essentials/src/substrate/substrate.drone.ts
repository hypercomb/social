// substrate/substrate.drone.ts
//
// SubstrateDrone — orchestrates the substrate system:
//   • Warms up the active source on startup and after changes
//   • Applies substrate to blank tiles as they render
//   • Clears cell assignments when cells are removed
//   • Prompts for folder re-grant when a linked folder needs permission —
//     a command-line pill whose click IS the re-grant gesture
//   • Re-scans linked folders on tab focus so new images appear live

import { Drone, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

/** The reconnect pill's key on the command line. */
const RECONNECT_KEY = 'substrate-reconnect'

export class SubstrateDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Auto-assign substrate background images to new cells'

  protected override listens = [
    'cell:added', 'cell:removed',
    'substrate:changed', 'substrate:folder-permission',
    'clipboard:paste-start', 'clipboard:paste-done',
    'editor:mode', 'render:cell-count',
    'cell:attach-pending',
    'indicator:query', 'indicator:activate',
  ]
  protected override emits = ['substrate:applied', 'substrate:ready', 'indicator:set', 'indicator:clear', 'activity:log']

  #initialized = false
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

    // Apply substrate to new cells. Index entries are keyed by the cell's
    // full-lineage sig — pass the event's segments through when present so
    // the assignment lands on the exact hive location, not the bare name.
    this.onEffect<{ cell: string; segments?: readonly string[] }>('cell:added', ({ cell, segments }) => {
      if (!cell) return
      if (this.#pastePending || this.#editorActive) return
      if (this.#attachPending.has(cell)) return
      const svc = this.#service()
      if (!svc) return
      void svc.applyToCell(cell, segments).then(applied => {
        if (applied) EffectBus.emit('substrate:applied', { cell })
      })
    })

    this.onEffect<{ cell: string; segments?: readonly string[] }>('cell:removed', ({ cell, segments }) => {
      if (!cell) return
      void this.#service()?.clearCell(cell, segments)
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
      void svc.applyToAllBlanks(filtered).then(applied => {
        for (const cell of applied) EffectBus.emit('substrate:applied', { cell })
      })
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

    // Folder source needs a user-gesture re-grant. Show the reconnect pill;
    // clicking it triggers requestPermission inside the gesture.
    this.onEffect<{ handleId: string; permission: string }>('substrate:folder-permission', ({ handleId, permission }) => {
      if (permission === 'granted') return
      this.#pendingPermissionHandleId = handleId
      this.#publishReconnect()
    })

    // The command line asks producers to replay when it mounts after them —
    // after it has restored what it persisted. This pill used to be persisted
    // (it did not say `dismissable: false`), so a stale copy can come back
    // from storage with no re-grant pending; publishing clears it unless one is.
    this.onEffect('indicator:query', () => this.#publishReconnect())

    // The pill's click is the re-grant. The command line activates on
    // mousedown — a user gesture — and the bus is synchronous, so
    // requestFolderAccess starts inside the press. It used to listen for
    // `indicator:click`, which nothing emits: the pill wore an × that hid it
    // and the folder never reconnected.
    this.onEffect<{ key: string }>('indicator:activate', async ({ key }) => {
      if (key !== RECONNECT_KEY || !this.#pendingPermissionHandleId) return
      const svc = this.#service()
      if (!svc) return
      const result = await svc.requestFolderAccess(this.#pendingPermissionHandleId)
      const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
      if (result === 'granted') {
        this.#pendingPermissionHandleId = null
        this.#publishReconnect()
        await svc.warmUp()
        this.#syncIndicator()
        EffectBus.emit('activity:log', { message: i18n?.t('substrate.folder-reconnected') ?? 'substrate folder reconnected', icon: '◈' })
      } else {
        EffectBus.emit('activity:log', { message: i18n?.t('substrate.folder-access-denied') ?? 'substrate folder access denied', icon: '◈' })
      }
    })
    this.#publishReconnect()

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

  /** The reconnect pill, stated from the one fact behind it: a linked folder
   *  waiting on a re-grant. Producer-owned, so never persisted — a restored
   *  copy would outlive its grant — and actionable: a click re-grants. */
  #publishReconnect(): void {
    if (!this.#pendingPermissionHandleId) {
      EffectBus.emit('indicator:clear', { key: RECONNECT_KEY })
      return
    }
    EffectBus.emit('indicator:set', {
      key: RECONNECT_KEY,
      icon: 'link_off',
      label: 'Substrate folder — click to reconnect',
      dismissable: false,
      actionable: true,
    })
  }

  #service(): SubstrateService | undefined {
    return get('@diamondcoreprocessor.com/SubstrateService')
  }
}

const _substrateDrone = new SubstrateDrone()
window.ioc.register('@diamondcoreprocessor.com/SubstrateDrone', _substrateDrone)
