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

    const i18n = get('@hypercomb.social/I18n') as any
    const t = (key: string, params?: Record<string, unknown>) => i18n?.t?.(key, params) ?? key

    const trimmed = args.trim().toLowerCase()
    const parts = trimmed.split(/\s+/).filter(Boolean)
    const subcommand = parts[0] ?? ''

    switch (subcommand) {
      case '': {
        const resolved = await service.resolve()
        const global = service.globalPath

        if (resolved) {
          this.#log(
            t('substrate.active', { path: resolved }),
            undefined,
            { label: t('substrate.go'), effect: 'substrate:navigate', payload: { segments: resolved.split('/') } },
          )
        } else {
          this.#log(t('substrate.none'))
        }
        if (global && global !== resolved) {
          this.#log(
            t('substrate.global', { path: global }),
            undefined,
            { label: t('substrate.go'), effect: 'substrate:navigate', payload: { segments: global.split('/') } },
          )
        }
        return
      }

      case 'set': {
        const path = await this.#currentPath()
        if (!path) {
          this.#log(t('substrate.navigate-first'))
          return
        }
        await service.setHive(path)
        this.#setIndicator(true, path)
        this.#log(t('substrate.set', { path }))
        return
      }

      case 'global': {
        const path = await this.#currentPath()
        if (!path) {
          this.#log(t('substrate.navigate-first'))
          return
        }
        await service.setGlobal(path)
        this.#setIndicator(true, path)
        this.#log(t('substrate.global-set', { path }))
        return
      }

      case 'clear': {
        if (parts[1] === 'global') {
          await service.clearGlobal()
        } else {
          await service.clearHive()
        }
        this.#setIndicator(false)
        this.#log(t('substrate.cleared'))
        return
      }

      case 'off': {
        await service.setInherit(false)
        this.#log(t('substrate.inherit-disabled'))
        return
      }

      case 'on': {
        await service.setInherit(true)
        this.#log(t('substrate.inherit-enabled'))
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
        // Invalidate renderer cache for refreshed tiles so new images show immediately
        for (const label of labels) {
          EffectBus.emit('tile:saved', { cell: label })
        }
        this.#log(t('substrate.refreshed', { count }))
        void new hypercomb().act()
        return
      }

      default: {
        this.#log(t('substrate.unknown-subcommand', { subcommand }))
        return
      }
    }
  }

  #log(message: string, icon?: string, action?: { label: string; effect: string; payload?: unknown }): void {
    EffectBus.emit('activity:log', { message, icon, action })
  }

  #setIndicator(active: boolean, path?: string): void {
    if (active) {
      const action = path
        ? { effect: 'substrate:navigate', payload: { segments: path.split('/') } }
        : undefined
      EffectBus.emit('indicator:set', { key: 'substrate', icon: '◈', label: 'Substrate active', action })
    } else {
      EffectBus.emit('indicator:clear', { key: 'substrate' })
    }
    // Persist indicator state
    const action = path
      ? { effect: 'substrate:navigate', payload: { segments: path.split('/') } }
      : undefined
    const saved = JSON.parse(localStorage.getItem('hc:indicators') ?? '[]') as { key: string; icon: string; label: string; action?: unknown }[]
    if (active) {
      const existing = saved.find(i => i.key === 'substrate')
      if (existing) {
        existing.action = action
      } else {
        saved.push({ key: 'substrate', icon: '◈', label: 'Substrate active', action })
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
