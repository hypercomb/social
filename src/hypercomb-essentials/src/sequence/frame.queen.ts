// sequence/frame.queen.ts
//
// /frame [pattern] — read this branch through a fixed pattern.
//
//   /frame                 — say what frames this branch, and list the patterns
//   /frame honeycomb       — frame it: 4/5/4, three rows, fit to the window
//   /frame off             — release the frame declared here
//
// The binding cascades: every tile below inherits it until a descendant
// declares its own. Framing does not cap how many tiles the branch may hold —
// tiles past the frame simply wait off-screen, and space-drag walks them
// through it.

import { EffectBus, QueenBee } from '@hypercomb/core'
import type { FrameService } from './frame.service.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const OFF = new Set(['off', 'none', 'clear', 'release'])

export class FrameQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'frame'
  override description = 'Read this branch through a fixed pattern'
  override descriptionKey = 'slash.frame'
  override options = ['<pattern name>', 'off']
  override examples = [
    { input: '/frame honeycomb', result: 'This branch reads as 4/5/4, three rows, fit to the window' },
    { input: '/frame off', result: 'Releases the frame declared here' },
  ]

  override slashComplete(args: string): readonly string[] {
    const names = this.#service()?.list() ?? []
    const q = args.toLowerCase().trim()
    const all = [...names, 'off']
    return q ? all.filter(n => n.toLowerCase().startsWith(q)) : all
  }

  protected async execute(args: string): Promise<void> {
    const service = this.#service()
    if (!service) {
      console.warn('[/frame] FrameService unavailable')
      return
    }
    const segments = this.#segments()
    const name = args.trim().toLowerCase()

    if (!name) {
      const active = service.activeFrameFor(segments)
      this.#log(active
        ? `Framed by "${active.name}" — ${active.capacity} tiles, ${active.rows} rows. Patterns: ${service.list().join(', ')}`
        : `No frame here. Patterns: ${service.list().join(', ')}`)
      return
    }

    if (OFF.has(name)) {
      const released = await service.clearAt(segments)
      this.#log(released ? 'Frame released' : 'No frame declared here to release')
      return
    }

    if (!service.get(name)) {
      this.#log(`No pattern named "${name}". Patterns: ${service.list().join(', ')}`)
      return
    }

    const applied = await service.applyTo(segments, name)
    if (!applied) {
      this.#log(`Could not frame with "${name}"`)
      return
    }
    const active = service.activeFrameFor(segments)
    this.#log(`Framed by "${name}" — ${active?.capacity ?? 0} tiles, ${active?.rows ?? 0} rows`)
  }

  #service(): FrameService | undefined {
    return window.ioc.get<FrameService>('@FrameService')
  }

  #segments(): string[] {
    const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: 'grid_view' })
  }
}

const _frameQueen = new FrameQueenBee()
window.ioc.register('@FrameQueenBee', _frameQueen)
