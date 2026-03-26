// diamondcoreprocessor.com/format/format.queen.ts
import { QueenBee, EffectBus } from '@hypercomb/core'

type Store = {
  current: FileSystemDirectoryHandle
  getResource: (signature: string) => Promise<Blob | null>
}

type FormatPainterDrone = {
  state: { open: boolean }
}

export class FormatQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'format'
  override readonly aliases = ['fmt', 'fp']
  override description = 'Copy visual formatting from the active tile'

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
          const indexKey = 'hc:tile-props-index'
          const index: Record<string, string> = JSON.parse(localStorage.getItem(indexKey) ?? '{}')
          const propsSig = index[active]
          if (!propsSig) throw new Error('no index entry')
          const propsBlob = await store.getResource(propsSig)
          if (!propsBlob) throw new Error('props blob missing')
          properties = JSON.parse(await propsBlob.text())
        } catch {
          try {
            const seedDir = await store.current.getDirectoryHandle(active)
            const fh = await seedDir.getFileHandle('0000')
            const file = await fh.getFile()
            properties = JSON.parse(await file.text())
          } catch {
            // no properties — open with empty
          }
        }
      }
    }

    // always open — shows empty state if no tile or no visual properties
    EffectBus.emit('format:open', { seed: active ?? '', properties })
  }
}

const _format = new FormatQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FormatQueenBee', _format)
