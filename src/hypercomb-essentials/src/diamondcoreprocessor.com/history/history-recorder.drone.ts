// diamondcoreprocessor.com/core/history-recorder.drone.ts
import { EffectBus, SignatureService } from '@hypercomb/core'
import type { HistoryService, HistoryOpType } from './history.service.js'
import type { HistoryCursorService } from './history-cursor.service.js'

type TagUpdate = { cell: string; tag: string }

export class HistoryRecorder {

  #queue: Promise<void> = Promise.resolve()

  constructor() {
    // ── Cell lifecycle ────────────────────────────────────
    EffectBus.on<{ cell: string }>('cell:added', (payload) => {
      if (payload?.cell) this.#enqueue('add', payload.cell)
    })

    EffectBus.on<{ cell: string; groupId?: string }>('cell:removed', (payload) => {
      if (payload?.cell) this.#enqueue('remove', payload.cell, payload.groupId)
    })

    // ── Tag state ─────────────────────────────────────────
    EffectBus.on<{ updates: TagUpdate[] }>('tags:changed', (payload) => {
      if (payload?.updates?.length) this.#enqueueTagState(payload.updates)
    })

    // ── Reorder state ─────────────────────────────────────
    EffectBus.on<{ labels: string[] }>('cell:reorder', (payload) => {
      if (payload?.labels?.length) this.#enqueueReorderState(payload.labels)
    })

    // ── Content state ─────────────────────────────────────
    EffectBus.on<{ cell: string }>('tile:saved', (payload) => {
      if (payload?.cell) this.#enqueueContentState(payload.cell)
    })

    // ── Visibility markers ──────────────────────────────────
    EffectBus.on<{ cell: string }>('tile:hidden', (payload) => {
      if (payload?.cell) this.#enqueue('hide', payload.cell)
    })

    EffectBus.on<{ cell: string }>('tile:unhidden', (payload) => {
      if (payload?.cell) this.#enqueue('unhide', payload.cell)
    })

    // ── Drone lifecycle ─────────────────────────────────────
    EffectBus.on<{ iocKey: string }>('bee:disposed', (payload) => {
      if (payload?.iocKey) this.#enqueue('remove-drone', payload.iocKey)
    })

    // ── Layout state ──────────────────────────────────────
    EffectBus.on<{ mode: string }>('layout:mode', (payload) => {
      if (payload?.mode) this.#enqueueLayoutState('mode', payload.mode)
    })

    EffectBus.on<{ flat: boolean }>('render:set-orientation', (payload) => {
      if (payload != null) this.#enqueueLayoutState('orientation', payload.flat ? 'flat-top' : 'point-top')
    })

    EffectBus.on<{ pivot: boolean }>('render:set-pivot', (payload) => {
      if (payload != null) this.#enqueueLayoutState('pivot', String(payload.pivot))
    })

    EffectBus.on<{ index: number; name: string }>('overlay:neon-color', (payload) => {
      if (payload?.name) this.#enqueueLayoutState('accent', payload.name)
    })

    EffectBus.on<{ gapPx: number }>('render:set-gap', (payload) => {
      if (payload?.gapPx != null) this.#enqueueLayoutState('gap', String(payload.gapPx))
    })
  }

  #enqueue(op: HistoryOpType, cell: string, groupId?: string): void {
    this.#queue = this.#queue
      .then(() => this.#recordOp(op, cell, groupId))
      .catch(() => { })
  }

  async #recordOp(op: HistoryOpType, cell: string, groupId?: string): Promise<void> {
    const lineage = get<any>('@hypercomb.social/Lineage')
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, { op, cell, at: Date.now(), groupId })

    // Notify cursor service so slider stays in sync
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor) await cursor.onNewOp()
  }

  /**
   * Capture tag state as a signature-addressed resource.
   * Reads the FULL tag array from each affected cell's properties (post-change),
   * so reconstruction at any cursor position only needs the last tag-state per cell.
   */
  #enqueueTagState(updates: TagUpdate[]): void {
    this.#queue = this.#queue
      .then(async () => {
        const lineage = get<any>('@hypercomb.social/Lineage')
        const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
        const store = get<any>('@hypercomb.social/Store')
        if (!lineage || !historyService || !store) return

        const locationSig = await historyService.sign(lineage)

        // Read the full tag array for each affected cell (post-change state)
        const cellTags: Record<string, string[]> = {}
        for (const u of updates) {
          if (cellTags[u.cell]) continue   // already captured
          try {
            const explorerDir = lineage.explorerDir?.() as FileSystemDirectoryHandle | undefined
            if (explorerDir) {
              const cellDir = await explorerDir.getDirectoryHandle(u.cell, { create: false })
              const fileHandle = await cellDir.getFileHandle('0000')
              const file = await fileHandle.getFile()
              const props = JSON.parse(await file.text())
              cellTags[u.cell] = Array.isArray(props.tags) ? props.tags : []
            }
          } catch {
            cellTags[u.cell] = []
          }
        }

        // Capture: full tag snapshot per cell (enables point-in-time reconstruction)
        const snapshot = {
          version: 1 as const,
          cellTags,
          at: Date.now(),
        }
        const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0)
        const blob = new Blob([json], { type: 'application/json' })

        // Sign: store as resource
        const bytes = await blob.arrayBuffer()
        const resourceSig = await SignatureService.sign(bytes)
        await store.putResource(blob)

        // Reference: record op
        await historyService.record(locationSig, {
          op: 'tag-state',
          cell: resourceSig,
          at: snapshot.at,
        })

        const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
        if (cursor) await cursor.onNewOp()
      })
      .catch(() => { })
  }

  /**
   * Capture reorder state as a signature-addressed resource.
   * Records a `reorder` op whose `cell` field is the resource signature
   * pointing to the ordered cell list at reorder time.
   */
  #enqueueReorderState(labels: string[]): void {
    this.#queue = this.#queue
      .then(async () => {
        const lineage = get<any>('@hypercomb.social/Lineage')
        const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
        const store = get<any>('@hypercomb.social/Store')
        if (!lineage || !historyService || !store) return

        const locationSig = await historyService.sign(lineage)

        // Store ordered cell list as content-addressed resource
        const payload = JSON.stringify(labels)
        const blob = new Blob([payload], { type: 'application/json' })
        await store.putResource(blob)

        const bytes = await blob.arrayBuffer()
        const resourceSig = await SignatureService.sign(bytes)

        // Record reorder op — cell field holds the resource signature
        await historyService.record(locationSig, {
          op: 'reorder',
          cell: resourceSig,
          at: Date.now(),
        })

        const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
        if (cursor) await cursor.onNewOp()
      })
      .catch(() => { })
  }

  /**
   * Capture content state as a signature-addressed resource.
   * Records the properties signature from the tile-props-index so that
   * point-in-time reconstruction can load the exact content at save time.
   */
  #enqueueContentState(cellLabel: string): void {
    this.#queue = this.#queue
      .then(async () => {
        const lineage = get<any>('@hypercomb.social/Lineage')
        const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
        const store = get<any>('@hypercomb.social/Store')
        if (!lineage || !historyService || !store) return

        const locationSig = await historyService.sign(lineage)

        // Read the current properties signature from localStorage index
        // (tile-editor.drone.ts writes this right before emitting tile:saved)
        const indexKey = 'hc:tile-props-index'
        const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
        const propertiesSig = index[cellLabel] ?? ''

        // Capture: cell label + its properties signature at this moment
        const snapshot = {
          version: 1 as const,
          cellLabel,
          propertiesSig,
          at: Date.now(),
        }
        const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0)
        const blob = new Blob([json], { type: 'application/json' })

        // Sign: store as resource
        const bytes = await blob.arrayBuffer()
        const resourceSig = await SignatureService.sign(bytes)
        await store.putResource(blob)

        // Reference: record op
        await historyService.record(locationSig, {
          op: 'content-state',
          cell: resourceSig,
          at: snapshot.at,
        })

        const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
        if (cursor) await cursor.onNewOp()
      })
      .catch(() => { })
  }
  /**
   * Capture layout state as a signature-addressed resource.
   * Records layout property changes (mode, orientation, pivot, gap) as
   * snapshots for point-in-time reconstruction.
   */
  #enqueueLayoutState(property: string, value: string): void {
    this.#queue = this.#queue
      .then(async () => {
        const lineage = get<any>('@hypercomb.social/Lineage')
        const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
        const store = get<any>('@hypercomb.social/Store')
        if (!lineage || !historyService || !store) return

        const locationSig = await historyService.sign(lineage)

        const snapshot = {
          version: 1 as const,
          property,
          value,
          at: Date.now(),
        }
        const json = JSON.stringify(snapshot, Object.keys(snapshot).sort(), 0)
        const blob = new Blob([json], { type: 'application/json' })

        const bytes = await blob.arrayBuffer()
        const resourceSig = await SignatureService.sign(bytes)
        await store.putResource(blob)

        await historyService.record(locationSig, {
          op: 'layout-state',
          cell: resourceSig,
          at: snapshot.at,
        })

        const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
        if (cursor) await cursor.onNewOp()
      })
      .catch(() => { })
  }
}

const _historyRecorder = new HistoryRecorder()
window.ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
