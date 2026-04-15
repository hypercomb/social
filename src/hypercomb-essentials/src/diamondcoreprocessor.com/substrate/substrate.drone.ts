// diamondcoreprocessor.com/substrate/substrate.drone.ts
//
// SubstrateDrone — orchestrates the substrate system:
//   • Warms up the active source on startup and after changes
//   • Applies substrate to blank tiles as they render
//   • Clears cell assignments when cells are removed
//   • Opens the organizer on indicator click
//   • Prompts for folder re-grant when a linked folder needs permission
//   • Re-scans linked folders on tab focus so new images appear live

import { Drone, EffectBus, hypercomb } from '@hypercomb/core'
import type { OverlayActionDescriptor } from '../presentation/tiles/tile-overlay.drone.js'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

const REROLL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14"/></svg>'

const REROLL_ICON: OverlayActionDescriptor = {
  name: 'reroll',
  owner: '@diamondcoreprocessor.com/SubstrateDrone',
  svgMarkup: REROLL_SVG,
  x: 0, y: 10,
  hoverTint: 0xd8c8ff,
  profile: 'private',
  visibleWhen: (ctx) => ctx.hasSubstrate,
  labelKey: 'action.reroll',
  descriptionKey: 'action.reroll.description',
}

type TileActionPayload = { action: string; label: string; q: number; r: number; index: number }

export class SubstrateDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Auto-assign substrate background images to new cells'

  protected override listens = [
    'render:host-ready', 'tile:action', 'controls:action',
    'cell:added', 'cell:removed',
    'substrate:changed', 'substrate:folder-permission',
    'drop:pending', 'clipboard:paste-start', 'clipboard:paste-done',
    'editor:mode', 'render:cell-count',
    'cell:attach-pending',
    'indicator:click',
  ]
  protected override emits = ['overlay:register-action', 'substrate:applied', 'substrate:rerolled', 'substrate:ready', 'indicator:set', 'indicator:clear', 'substrate-organizer:open', 'activity:log']

  #initialized = false
  #iconRegistered = false
  #substrateLabels = new Set<string>()
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

    // Self-register reroll overlay icon
    this.onEffect('render:host-ready', () => {
      if (this.#iconRegistered) return
      this.#iconRegistered = true
      this.emitEffect('overlay:register-action', REROLL_ICON)
    })

    // Handle single-tile reroll from overlay click
    this.onEffect<TileActionPayload>('tile:action', (payload) => {
      if (payload.action !== 'reroll') return
      this.#rerollSingle(payload.label)
    })

    // Handle bulk reroll from selection context menu
    this.onEffect<{ action: string }>('controls:action', (payload) => {
      if (payload?.action === 'reroll') this.#bulkRerollSelected()
    })

    // Track which tiles have substrate so bulk reroll can filter correctly
    this.onEffect<{ substrateLabels?: string[] }>('render:cell-count', (payload) => {
      this.#substrateLabels = new Set(payload.substrateLabels ?? [])
    })
    this.onEffect<{ cell: string }>('substrate:applied', ({ cell }) => {
      if (cell) this.#substrateLabels.add(cell)
    })
    this.onEffect<{ cell: string }>('cell:removed', ({ cell }) => {
      if (cell) this.#substrateLabels.delete(cell)
    })

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

  #rerollSingle(label: string): void {
    const svc = this.#service()
    if (svc?.rerollCell(label)) {
      EffectBus.emit('substrate:rerolled', { cell: label })
      void new hypercomb().act()
    }
  }

  #bulkRerollSelected(): void {
    const selection = window.ioc.get<{ selected: ReadonlySet<string>; count: number }>('@diamondcoreprocessor.com/SelectionService')
    if (!selection || selection.count === 0) return

    const svc = this.#service()
    if (!svc) return

    const labels = [...selection.selected].filter(l => this.#substrateLabels.has(l))
    if (labels.length === 0) return
    const rerolled = svc.rerollCells(labels)
    if (rerolled.length === 0) return

    for (const cell of rerolled) {
      EffectBus.emit('substrate:rerolled', { cell })
    }
    void new hypercomb().act()
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
