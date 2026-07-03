// diamondcoreprocessor.com/format/format.queen.ts
import { QueenBee, EffectBus } from '@hypercomb/core'
import { cellLocationSig, readTilePropsIndex, lookupTilePropsSig } from '../editor/tile-properties.js'

type Store = {
  getResource: (signature: string) => Promise<Blob | null>
}

type FormatPainterDrone = {
  state: { open: boolean }
}

export class FormatQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'editor'
  readonly command = 'format'
  override readonly aliases = []
  override description = 'Copy visual formatting from the active tile'
  override descriptionKey = 'slash.format'
  override examples = [
    { input: '/format', result: 'Opens the format painter; run again to close' },
  ]

  protected async execute(_args: string): Promise<void> {
    // toggle: if already open, close
    const drone = window.ioc.get<FormatPainterDrone>('@diamondcoreprocessor.com/FormatPainterDrone')
    if (drone?.state.open) {
      EffectBus.emit('format:close', {})
      return
    }

    // read active tile's properties if one is selected
    const selection = window.ioc.get<{ active: string | null }>('@diamondcoreprocessor.com/SelectionService')
    const active = selection?.active
    let properties: Record<string, unknown> = {}

    if (active) {
      const store = window.ioc.get<Store>('@hypercomb.social/Store')
      if (store) {
        try {
          const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
          const segments = lineage?.explorerSegments?.() ?? []
          const index = readTilePropsIndex()
          const propsSig = lookupTilePropsSig(index, await cellLocationSig(segments, active), active)
          if (!propsSig) throw new Error('no index entry')
          const propsBlob = await store.getResource(propsSig)
          if (!propsBlob) throw new Error('props blob missing')
          properties = JSON.parse(await propsBlob.text())
        } catch {
          // no properties — open with empty
        }
      }
    }

    // always open — shows empty state if no tile or no visual properties
    EffectBus.emit('format:open', { cell: active ?? '', properties })
  }
}

const _format = new FormatQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FormatQueenBee', _format)
