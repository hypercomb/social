// diamondcoreprocessor.com/commands/view-current.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /view-current — show the current layer's JSON content.
 *
 * Reads the head layer at the user's current explorer location and
 * dumps the parsed JSON to the console (and emits an effect for any
 * future overlay subscriber). Snapshot only — no history walk, no
 * change diff. The actual layer-as-stored.
 */
export class ViewCurrentQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'view-current'
  override readonly aliases = ['view-layer', 'current']

  override description = 'Show the current layer JSON at this location'

  protected async execute(_args: string): Promise<void> {
    const lineage = get<{
      domain?: () => string
      explorerSegments?: () => string[]
    }>('@hypercomb.social/Lineage')
    const history = get<{
      sign: (lineage: unknown) => Promise<string>
      currentLayerAt: (locSig: string) => Promise<unknown>
    }>('@diamondcoreprocessor.com/HistoryService')

    if (!lineage || !history) {
      console.warn('[view-current] lineage or history service not available')
      return
    }

    const segments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const locSig = await history.sign({
      domain: lineage.domain,
      explorerSegments: () => segments,
    })

    const layer = await history.currentLayerAt(locSig)
    const path = segments.length === 0 ? '(root)' : segments.join('/')

    if (!layer) {
      console.log(`%c[view-current] no layer at ${path}`, 'color: #888; font-style: italic')
      EffectBus.emit('queen:view-current', { path, layer: null })
      return
    }

    console.log(`%c[view-current] ${path}`, 'color: #4af; font-weight: bold')
    console.log(layer)
    EffectBus.emit('queen:view-current', { path, layer })
  }
}

const _viewCurrent = new ViewCurrentQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ViewCurrentQueenBee', _viewCurrent)
