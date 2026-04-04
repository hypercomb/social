// diamondcoreprocessor.com/substrate/substrate.queen.ts
//
// /substrate — toggle the default background image collection for new cells.
//
// Syntax:
//   /substrate                        — toggle global substrate on/off
//   /substrate here                   — set current hive as per-hive substrate source

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class SubstrateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'substrate'
  override readonly aliases = []
  override description = 'Toggle default background images for new tiles'

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) return

    await service.ensureLoaded()

    const trimmed = args.trim().toLowerCase()

    if (trimmed === 'here') {
      // Set per-hive substrate for current page
      const path = await this.#currentPath()
      if (!path) {
        this.#toast('navigate into a hive first')
        return
      }
      await service.setHive(path)
      this.#setIndicator(true)
      await this.#refreshVisible(service)
      this.#toast(`substrate → ${path}`)
      return
    }

    // Default: toggle global substrate on/off
    const resolved = await service.resolve()
    if (resolved) {
      // Currently on → turn off
      await service.clearHive()
      await service.clearGlobal()
      this.#setIndicator(false)
      this.#toast('substrate off')
    } else {
      // Currently off → turn on using current hive
      const path = await this.#currentPath()
      if (!path) {
        this.#toast('navigate into a hive first')
        return
      }
      await service.setGlobal(path)
      this.#setIndicator(true)
      await this.#refreshVisible(service)
      this.#toast(`substrate on → ${path}`)
    }
  }

  #toast(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }

  #setIndicator(active: boolean): void {
    if (active) {
      EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate' })
    } else {
      EffectBus.emit('indicator:clear', { key: 'substrate' })
    }
    // Persist indicator state
    const saved = JSON.parse(localStorage.getItem('hc:indicators') ?? '[]') as { key: string; icon: string; label: string }[]
    if (active) {
      if (!saved.find(i => i.key === 'substrate')) {
        saved.push({ key: 'substrate', icon: '◈', label: 'Substrate' })
      }
    } else {
      const idx = saved.findIndex(i => i.key === 'substrate')
      if (idx !== -1) saved.splice(idx, 1)
    }
    localStorage.setItem('hc:indicators', JSON.stringify(saved))
  }

  async #refreshVisible(service: SubstrateService): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const dir = await lineage?.explorerDir()
    if (!dir) return

    const labels: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'directory') labels.push(name)
    }

    const count = await service.refresh(labels)
    if (count > 0) {
      this.#toast(`refreshed ${count} tile${count === 1 ? '' : 's'}`)
      void new hypercomb().act()
    }
  }

  async #currentPath(): Promise<string | null> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments: () => readonly string[] } | undefined
    if (!lineage) return null
    const segments = lineage.explorerSegments()
    return segments.length > 0 ? segments.join('/') : null
  }
}

const _substrate = new SubstrateQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SubstrateQueenBee', _substrate)
