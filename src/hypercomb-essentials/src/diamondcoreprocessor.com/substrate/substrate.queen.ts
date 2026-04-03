// diamondcoreprocessor.com/substrate/substrate.queen.ts
//
// /substrate — manage the default background image collection for new cells.
//
// Syntax:
//   /substrate                        — show current substrate info
//   /substrate set                    — set current hive as substrate source
//   /substrate global                 — set current hive as the global substrate
//   /substrate clear                  — clear per-hive substrate
//   /substrate clear global           — clear global substrate
//   /substrate off                    — suppress child overrides (global only under this hive)
//   /substrate on                     — re-enable inheritance for children
//   /substrate refresh                — re-roll all substrate images on visible tiles

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class SubstrateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'substrate'
  override readonly aliases = ['sub']
  override description = 'Manage the default background image collection for new tiles'

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) return

    await service.ensureLoaded()

    const trimmed = args.trim().toLowerCase()
    const parts = trimmed.split(/\s+/).filter(Boolean)
    const subcommand = parts[0] ?? ''

    switch (subcommand) {
      case '': {
        const resolved = await service.resolve()
        const global = service.globalSignature
        const i18n = get('@hypercomb.social/I18n') as any
        const t = (key: string, params?: Record<string, unknown>) => i18n?.t?.(key, params) ?? key

        if (resolved) {
          this.#log(t('substrate.active', { path: resolved }))
        } else {
          this.#log(t('substrate.none'))
        }
        if (global && global !== resolved) {
          this.#log(t('substrate.global', { path: global }))
        }
        return
      }

      case 'set': {
        const path = await this.#currentPath()
        if (!path) {
          this.#log('navigate into a hive first')
          return
        }
        await service.setHive(path)
        this.#setIndicator(true)
        this.#log(`substrate set → ${path}`)
        return
      }

      case 'global': {
        const path = await this.#currentPath()
        if (!path) {
          this.#log('navigate into a hive first')
          return
        }
        await service.setGlobal(path)
        this.#setIndicator(true)
        this.#log(`global substrate → ${path}`)
        return
      }

      case 'clear': {
        if (parts[1] === 'global') {
          await service.clearGlobal()
        } else {
          await service.clearHive()
        }
        this.#setIndicator(false)
        this.#log('substrate cleared')
        return
      }

      case 'off': {
        await service.setInherit(false)
        this.#log('substrate inheritance disabled')
        return
      }

      case 'on': {
        await service.setInherit(true)
        this.#log('substrate inheritance enabled')
        return
      }

      case 'refresh':
      case 'replay':
      case 'reroll': {
        const lineage = get('@hypercomb.social/Lineage') as
          { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
        const dir = await lineage?.explorerDir()
        if (!dir) return

        const labels: string[] = []
        for await (const [name, handle] of (dir as any).entries()) {
          if (handle.kind === 'directory') labels.push(name)
        }

        const count = await service.refresh(labels)
        this.#log(`substrate refreshed ${count} tile${count === 1 ? '' : 's'}`)
        void new hypercomb().act()
        return
      }

      default: {
        this.#log(`unknown subcommand: ${subcommand}`)
        return
      }
    }
  }

  #log(message: string, icon?: string): void {
    EffectBus.emit('activity:log', { message, icon })
  }

  #setIndicator(active: boolean): void {
    if (active) {
      EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate active' })
    } else {
      EffectBus.emit('indicator:clear', { key: 'substrate' })
    }
    // Persist indicator state
    const saved = JSON.parse(localStorage.getItem('hc:indicators') ?? '[]') as { key: string; icon: string; label: string }[]
    if (active) {
      if (!saved.find(i => i.key === 'substrate')) {
        saved.push({ key: 'substrate', icon: '◈', label: 'Substrate active' })
      }
    } else {
      const idx = saved.findIndex(i => i.key === 'substrate')
      if (idx !== -1) saved.splice(idx, 1)
    }
    localStorage.setItem('hc:indicators', JSON.stringify(saved))
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
