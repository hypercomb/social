// presentation/tiles/boot-sprite.drone.ts
//
// Mints the screen's sprite during the optimize phase — the only sanctioned
// place to write a derived cache. A view that had to paint without one
// emits `sprite:boot:wanted` with the source image signatures. The next
// open of that screen is one file.
//
// Asleep until that effect (wakesOn). The bus replays it, so a want that
// landed before this module loaded is not lost.

import { Drone } from '@hypercomb/core'
import { deriveThumbnail, readThumbnail, writeThumbnail, type ThumbnailStore } from './thumbnails.js'
import { composeBootSprite, readBootSprite, writeBootSprite } from './boot-sprite.js'

const SIG = /^[0-9a-f]{64}$/

type SpriteStore = ThumbnailStore & {
  getResource(sig: string): Promise<Blob | null>
}

export class BootSpriteDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'packs a screen of tile pictures into one small sprite during the optimize phase'

  /** The one effect that wakes this bee. Declared for the sleeper. */
  readonly wakesOn = ['sprite:boot:wanted']

  #pending = new Map<string, readonly string[]>()
  #attempted = new Set<string>()

  constructor() {
    super()
    this.onEffect<{ key?: string; sigs?: readonly string[] }>('sprite:boot:wanted', event => {
      const key = event?.key
      const sigs = event?.sigs
      if (typeof key !== 'string' || !SIG.test(key) || !Array.isArray(sigs) || sigs.length === 0) return
      if (this.#attempted.has(key)) return
      const clean = sigs.filter(sig => typeof sig === 'string' && SIG.test(sig))
      if (clean.length === 0) return
      this.#pending.set(key, clean)
    })
  }

  public override optimize = async (): Promise<void> => {
    if (this.#pending.size === 0) return
    const store = window.ioc?.get<SpriteStore>('@hypercomb.social/Store')
    if (!store?.getPool || !store.getResource) return

    const next = this.#pending.entries().next()
    if (next.done || !next.value) return
    const [key, sigs] = next.value
    this.#pending.delete(key)
    this.#attempted.add(key)
    try {
      if (await readBootSprite(store, key)) return
      const cells: (Blob | null)[] = []
      for (const sig of sigs) {
        let blob = await readThumbnail(store, sig)
        if (!blob) {
          const source = await store.getResource(sig)
          const bytes = source ? await deriveThumbnail(source) : null
          if (bytes) {
            await writeThumbnail(store, sig, bytes)
            blob = new Blob([bytes], { type: 'image/webp' })
          }
        }
        cells.push(blob)
      }
      if (!cells.some(cell => cell && cell.size > 0)) return
      const sheet = await composeBootSprite(cells)
      if (!sheet || sheet.size === 0) return
      await writeBootSprite(store, key, await sheet.arrayBuffer())
    } catch {
      // A missing sprite changes nothing a reader depends on.
    }
  }
}

const _bootSprite = new BootSpriteDrone()
window.ioc.register('@diamondcoreprocessor.com/BootSpriteDrone', _bootSprite)
