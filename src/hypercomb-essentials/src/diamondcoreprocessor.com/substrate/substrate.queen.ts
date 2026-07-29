// diamondcoreprocessor.com/substrate/substrate.queen.ts
//
// /substrate — manage the substrate image collection used as default
// backgrounds for blank cells.
//
// Syntax:
//   /substrate                  — open the substrate organizer
//   /substrate sets             — list the built-in themed sets + active marker
//   /substrate set <name>       — switch the active themed set (steel, daylight, …)
//   /substrate here             — use current hive as substrate source
//   /substrate link             — link a local folder (File System Access API)
//   /substrate off              — deactivate substrate
//   /substrate on               — reactivate (picks last active or defaults)
//   /substrate reset            — restore the default set (Steel) as active
//   /substrate list             — log all known sources to the activity log

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)
// Tile-substrate default is the Photos collection. The themed sets (steel,
// daylight, …) are still selectable here via `set`, but they're primarily
// canvas/screen backgrounds now (see /canvas), not the tile default.
const PHOTOS_SET_ID = 'builtin:defaults'

export class SubstrateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'substrate'
  override readonly aliases = []
  override description = 'Manage substrate background image sources'
  override descriptionKey = 'slash.substrate'
  override options = ['sets', 'set <name>', 'here', 'link', 'on', 'off', 'reset', 'list']
  override examples = [
    { input: '/substrate', result: 'Opens the substrate organizer' },
    { input: '/substrate set steel', result: 'Switches backgrounds to the Steel set' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    const verbs = ['set', 'sets', 'here', 'link', 'on', 'off', 'reset', 'list']
    // "set <partial>" → suggest the built-in set names.
    if (q === 'set' || q.startsWith('set ')) {
      const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
      const names = (service?.listSources() ?? [])
        .filter(s => s.builtin)
        .map(s => (s.label || s.id).toLowerCase())
      const partial = q.replace(/^set\s*/, '')
      const matches = partial ? names.filter(n => n.startsWith(partial)) : names
      return matches.map(n => `set ${n}`)
    }
    return q ? verbs.filter(v => v.startsWith(q)) : verbs
  }

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) return
    await service.ensureLoaded()

    const trimmed = args.trim().toLowerCase()
    const [verb, ...rest] = trimmed.split(/\s+/)
    const setArg = rest.join(' ').trim()

    // ── themed-set switching ───────────────────────────────────────────
    if (verb === 'sets') {
      const builtins = service.listSources().filter(s => s.builtin)
      if (builtins.length === 0) { this.#toast('no built-in sets'); return }
      for (const s of builtins) {
        const active = s.id === service.registry.activeId ? '●' : '○'
        this.#toast(`${active} ${s.label}`)
      }
      return
    }

    if (verb === 'set') {
      if (!setArg) { this.#toast('usage: /substrate set <name>'); return }
      const sources = service.listSources()
      const match = sources.find(s => (s.label || '').toLowerCase() === setArg)
        ?? sources.find(s => s.id.toLowerCase() === setArg || s.id.toLowerCase() === `builtin:${setArg}`)
        ?? sources.find(s => (s.label || '').toLowerCase().startsWith(setArg))
      if (!match) { this.#toast(`no set "${setArg}"`); return }
      await service.setActive(match.id)
      await this.#refreshVisible(service)
      this.#toast(`backgrounds → ${match.label}`)
      return
    }

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
                    ?? registry.sources.find(s => s.id === PHOTOS_SET_ID)
        if (!target) { this.#toast('no substrate sources'); return }
        await service.setActive(target.id)
        await this.#refreshVisible(service)
        this.#toast(`substrate on → ${target.label}`)
        return
      }

      case 'reset':
      case 'defaults': {
        await service.clearHive()
        await service.setActive(PHOTOS_SET_ID)
        await this.#refreshVisible(service)
        this.#toast('substrate reset to Photos')
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
