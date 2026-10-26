// sharing/images.queen.ts
//
// /images — open the wall of pictures a tile holds, and those other hosts publish for it.
//
//   /images            — the selected tile
//   /images <tile>     — that tile
//
// The same wall the tile's images icon opens. The icon appears only once a tile
// holds more than one picture; the word always works, and it is the door to the
// pictures other hosts publish under the tile's name, which never gate the icon.
// The wall says plainly when there is nothing to choose from.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class ImagesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'images'
  override description = 'Open the pictures a tile holds, and what other hosts publish for it, and choose one'
  override descriptionKey = 'slash.images'
  override options = ['<cell name>']
  override examples = [
    { input: '/images', result: 'The pictures held for the selected tile, and those other hosts publish for it' },
    { input: '/images garden', result: 'The pictures held and offered for "garden"' },
  ]

  override slashComplete(args: string): readonly string[] {
    const cells = (get('@hypercomb.social/CellSuggestionProvider') as { suggestions(): string[] } | undefined)
      ?.suggestions() ?? []
    const q = args.trim().toLowerCase()
    return q ? cells.filter(n => n.startsWith(q)) : cells
  }

  protected async execute(args: string): Promise<void> {
    const label = args.trim().toLowerCase() || this.#selected()
    if (!label) { this.#log('name a tile, or select one first'); return }

    const segments = (get('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined)
      ?.explorerSegments?.() ?? []
    EffectBus.emit('images:open', { label, segments: [...segments] })
  }

  #selected(): string {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as { selected: ReadonlySet<string> } | undefined
    const first = selection?.selected.values().next().value
    return typeof first === 'string' ? first : ''
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }
}

const _images = new ImagesQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/ImagesQueenBee', _images)
