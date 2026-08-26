// diamondcoreprocessor.com/sharing/images.queen.ts
//
// /images — open the canonical name pool's wall of pictures.
//
//   /images            — the selected tile
//   /images <tile>     — that tile
//
// The same wall the tile's images icon opens. Both doors resolve the fixed name
// at the hive root, so their result is independent of the current lineage.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { canonicalPeerImageCandidates } from './peer-images.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class ImagesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'images'
  override readonly aliases = []
  override description = 'Open the room\'s pictures for a tile and choose one'
  override descriptionKey = 'slash.images'
  override options = ['<cell name>']
  override examples = [
    { input: '/images', result: 'The pictures the room is carrying for the selected tile' },
    { input: '/images garden', result: 'The pictures offered for "garden"' },
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

    const offered = await canonicalPeerImageCandidates(label)
    if (offered.length === 0) {
      this.#log(`nobody in the room is offering a picture for "${label}"`)
      return
    }

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
