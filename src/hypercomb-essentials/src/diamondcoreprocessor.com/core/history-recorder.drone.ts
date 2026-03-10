// hypercomb-essentials/src/diamondcoreprocessor.com/core/history-recorder.drone.ts
// Listens on EffectBus for layer mutation effects and delegates to HistoryService.
// Callers emit 'layer:add-child' or 'layer:remove-child' effects;
// the recorder resolves the current lineage and records the mutation.

import { EffectBus } from '@hypercomb/core'
import type { HistoryService } from './history.service.js'

type AddChildPayload = { name: string }
type RemoveChildPayload = { name: string }

export class HistoryRecorder {

  constructor() {
    EffectBus.on<AddChildPayload>('layer:add-child', this.#onAddChild)
    EffectBus.on<RemoveChildPayload>('layer:remove-child', this.#onRemoveChild)
  }

  #onAddChild = (payload: AddChildPayload): void => {
    void this.#recordAdd(payload.name)
  }

  #onRemoveChild = (payload: RemoveChildPayload): void => {
    void this.#recordRemove(payload.name)
  }

  #recordAdd = async (childName: string): Promise<void> => {
    const lineage = (window as any).ioc.get('@hypercomb.social/Lineage')
    const historyService = (window as any).ioc.get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    if (!lineage || !historyService) return

    const segments = this.#getSegments(lineage)
    await historyService.addChild(segments, childName)
  }

  #recordRemove = async (childName: string): Promise<void> => {
    const lineage = (window as any).ioc.get('@hypercomb.social/Lineage')
    const historyService = (window as any).ioc.get('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    if (!lineage || !historyService) return

    const segments = this.#getSegments(lineage)
    await historyService.removeChild(segments, childName)
  }

  #getSegments = (lineage: any): string[] => {
    try {
      const segs = lineage.explorerSegments?.()
      if (Array.isArray(segs)) return segs.map((s: unknown) => String(s ?? '').trim()).filter(Boolean)
    } catch {
      // ignore
    }
    return []
  }
}

const _historyRecorder = new HistoryRecorder()
;(window as any).ioc.register('@diamondcoreprocessor.com/HistoryRecorder', _historyRecorder)
