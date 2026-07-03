// diamondcoreprocessor.com/substrate/backgrounds.queen.ts
//
// /backgrounds — view and toggle which default substrate images are available.
//
// The substrate pool ships a set of default background images (sunset, lava,
// butterfly, …) that fill blank tiles. This queen lets you see the pool and
// flip individual images in or out of it.
//
//   /backgrounds            — list every default image with its on/off state
//   /backgrounds lava       — toggle the "lava" image on/off
//
// Toggles are SESSION-ONLY (not sticky): they live in memory on the
// SubstrateService and reset to all-on when the page reloads. Nothing is
// written to the registry, the layer, or localStorage — peers never see it.
// Toggling an image off immediately rerolls any visible tile that was using
// it; toggling it back on just returns it to the pool for future picks.

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class BackgroundsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'backgrounds'
  override readonly aliases = ['background', 'bg']
  override description = 'View or toggle which default background images are available'
  override descriptionKey = 'slash.backgrounds'
  override options = ['<image name>']
  override examples = [
    { input: '/backgrounds', result: 'Lists default images with on/off state' },
    { input: '/backgrounds lava', result: 'Toggles "lava"; rerolls tiles showing it' },
  ]

  override slashComplete(args: string): readonly string[] {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    const names = service?.listImages().map(i => i.name) ?? []
    const q = args.toLowerCase().trim()
    return q ? names.filter(n => n.startsWith(q)) : names
  }

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) return
    await service.ensureLoaded()

    // The pool is built lazily by warm-up; ensure it exists before listing.
    if (service.listImages().length === 0) await service.warmUp()

    const token = args.trim()

    // No argument → show the pool and each image's on/off state.
    if (!token) {
      const images = service.listImages()
      if (images.length === 0) { this.#log('no default backgrounds available'); return }
      const on = images.filter(i => i.enabled).length
      this.#log(`backgrounds — ${on}/${images.length} on`)
      for (const img of images) this.#log(img.name, img.enabled ? '●' : '○')
      return
    }

    // Argument → toggle that image.
    const result = service.toggleImage(token)
    if (!result) { this.#log(`no background named "${token}"`); return }

    if (!result.enabled) {
      // Toggled OFF — drop it from any visible tile that's still showing it.
      const labels = await this.#visibleLabels()
      const rerolled = await service.rerollDisabledOnVisible(labels)
      for (const cell of rerolled) EffectBus.emit('substrate:rerolled', { cell })
      if (rerolled.length > 0) void new hypercomb().act()
      this.#log(`${result.name} off${rerolled.length ? ` — rerolled ${rerolled.length}` : ''}`, '○')
    } else {
      this.#log(`${result.name} on`, '●')
    }
  }

  async #visibleLabels(): Promise<string[]> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const dir = await lineage?.explorerDir()
    if (!dir) return []
    const labels: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'directory') labels.push(name)
    }
    return labels
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _backgrounds = new BackgroundsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BackgroundsQueenBee', _backgrounds)
