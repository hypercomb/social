// diamondcoreprocessor.com/substrate/substrate.queen.ts
//
// /substrate — manage the substrate image collection used as default
// backgrounds for blank cells.
//
// Syntax:
//   /substrate                  — open the substrate organizer
//   /substrate here             — use current hive as substrate source
//   /substrate link             — link a local folder (File System Access API)
//   /substrate off              — deactivate substrate
//   /substrate on               — reactivate (picks last active or defaults)
//   /substrate reset            — restore bundled defaults as active
//   /substrate list             — log all known sources to the activity log

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)
const BUILTIN_DEFAULTS_ID = 'builtin:defaults'

export class SubstrateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'substrate'
  override readonly aliases = []
  override description = 'Manage substrate background image sources'
  override descriptionKey = 'slash.substrate'

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    if (!q) return ['here']
    return ['here'].filter(s => s.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) return
    await service.ensureLoaded()

    const trimmed = args.trim().toLowerCase()

    switch (trimmed) {
      case '':
        EffectBus.emit('substrate-organizer:open', {})
        return

      case 'here': {
        const path = await this.#currentPath()
        if (!path) { this.#toast('navigate into a hive first'); return }
        const source = await service.addHiveSource(path)
        await service.setHive(path) // per-hive override on current dir
        await this.#refreshVisible(service)
        this.#toast(`substrate → ${source.label}`)
        return
      }

      case 'link': {
        const source = await service.linkLocalFolder()
        if (!source) { this.#toast('folder link cancelled or unsupported'); return }
        await this.#refreshVisible(service)
        this.#toast(`substrate → ${source.label}`)
        return
      }

      case 'off': {
        await service.setActive(null)
        await this.#refreshVisible(service)
        this.#toast('substrate off')
        return
      }

      case 'on': {
        // Reactivate: prefer current active, else first non-builtin, else defaults.
        const registry = service.registry
        const target = registry.sources.find(s => s.id === registry.activeId)
                    ?? registry.sources.find(s => !s.builtin)
                    ?? registry.sources.find(s => s.id === BUILTIN_DEFAULTS_ID)
        if (!target) { this.#toast('no substrate sources'); return }
        await service.setActive(target.id)
        await this.#refreshVisible(service)
        this.#toast(`substrate on → ${target.label}`)
        return
      }

      case 'reset':
      case 'defaults': {
        await service.clearHive()
        await service.setActive(BUILTIN_DEFAULTS_ID)
        await this.#refreshVisible(service)
        this.#toast('substrate reset to defaults')
        return
      }

      case 'list': {
        const sources = service.listSources()
        if (sources.length === 0) { this.#toast('no substrate sources'); return }
        for (const s of sources) {
          const active = s.id === service.registry.activeId ? '●' : '○'
          this.#toast(`${active} ${s.type}: ${s.label}`)
        }
        return
      }

      default:
        this.#toast(`unknown: /substrate ${trimmed}`)
    }
  }

  #toast(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }

  async #refreshVisible(service: SubstrateService): Promise<void> {
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerDir: () => Promise<FileSystemDirectoryHandle | null> } | undefined
    const dir = await lineage?.explorerDir()
    if (!dir) { await service.warmUp(); return }

    const labels: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'directory') labels.push(name)
    }
    const count = await service.refresh(labels, true)
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
