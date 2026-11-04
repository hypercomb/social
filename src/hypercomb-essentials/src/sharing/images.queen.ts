// sharing/images.queen.ts
//
// /images — open the wall of pictures a tile holds, and those other hosts publish for it.
//
//   /images            — the selected tile; with several selected, each in turn
//   /images <tile>     — that tile
//
// Several tiles selected opens the wall for EACH of them, in the order they
// were selected (`images:open` carries `labels`; image-choice.drone runs the
// queue): choose a picture or skip, and it moves on to the next tile.
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
    { input: '/images', result: 'The pictures held for the selected tile, and those other hosts publish for it; with several selected, each in turn' },
    { input: '/images garden', result: 'The pictures held and offered for "garden"' },
  ]

  override slashComplete(args: string): readonly string[] {
    const cells = (get('@hypercomb.social/CellSuggestionProvider') as { suggestions(): string[] } | undefined)
      ?.suggestions() ?? []
    const q = args.trim().toLowerCase()
    return q ? cells.filter(n => n.startsWith(q)) : cells
  }

  protected async execute(args: string): Promise<void> {
    const named = args.trim().toLowerCase()
    const selected = named ? [] : this.#selected()
    const label = named || selected[0] || ''
    if (!label) { this.#log('name a tile, or select one first'); return }

    const segments = (get('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined)
      ?.explorerSegments?.() ?? []
    // A named tile, or one selected, is the wall as it always was. Two or more
    // selected is the queue: the first opens now, the rest follow it.
    EffectBus.emit('images:open', selected.length > 1
      ? { label, labels: selected, segments: [...segments] }
      : { label, segments: [...segments] })
  }

  /** The selected tiles, in the order they were selected. */
  #selected(): string[] {
    const selection = get('@diamondcoreprocessor.com/SelectionService') as { selected?: ReadonlySet<string> } | undefined
    return [...(selection?.selected ?? [])].filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }
}

const _images = new ImagesQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/ImagesQueenBee', _images)
