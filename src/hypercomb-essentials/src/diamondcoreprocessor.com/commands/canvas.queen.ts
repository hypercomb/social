// diamondcoreprocessor.com/commands/canvas.queen.ts
//
// /canvas — choose the screen backdrop the hive sits on.
//
// Syntax:
//   /canvas                 — show the current backdrop + available options
//   /canvas dots            — hex dots (the default)
//   /canvas honeycomb       — and depth / sheen / mesh / contour
//   /canvas indigo          — pin a palette (steel, daylight, indigo, teal, ember)
//   /canvas indigo dots     — palette + archetype together
//   /canvas auto            — let the palette follow the colour theme
//   /canvas off             — no backdrop (bare surface)
//
// The choice is participant-local (localStorage) and independent of the colour
// theme — though by default the palette tracks it (dark → steel, light →
// daylight). See CanvasBackgroundService.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { CanvasBackgroundService } from '../presentation/background/canvas-background.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)
const SVC = '@diamondcoreprocessor.com/CanvasBackground'

export class CanvasQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'canvas'
  override readonly aliases = ['backdrop']
  override description = 'Choose the screen backdrop (hex dots, honeycomb, depth, …)'
  override descriptionKey = 'slash.canvas'
  override options = ['dots', 'honeycomb', 'grid', 'depth', 'sheen', 'mesh', 'contour', 'steel', 'daylight', 'indigo', 'teal', 'ember', 'auto', 'off']
  override examples = [
    { input: '/canvas indigo dots', result: 'Hex-dot backdrop with the indigo palette' },
    { input: '/canvas off', result: 'No backdrop — bare surface' },
  ]

  override slashComplete(args: string): readonly string[] {
    const svc = get(SVC) as CanvasBackgroundService | undefined
    const opts = [...(svc?.archetypes ?? []), ...(svc?.palettes ?? []), 'auto', 'off']
    // trimStart only — keep a trailing space so "indigo " can complete the
    // SECOND token (e.g. "indigo dots") instead of collapsing to one.
    const q = args.toLowerCase().replace(/^\s+/, '')
    // Complete the LAST token so "indigo do<tab>" → "indigo dots".
    const parts = q.split(/\s+/)
    const last = parts[parts.length - 1]
    const head = parts.slice(0, -1).join(' ')
    const matches = last ? opts.filter(o => o.startsWith(last)) : opts
    return matches.map(o => (head ? `${head} ${o}` : o))
  }

  protected execute(args: string): void {
    const svc = get(SVC) as CanvasBackgroundService | undefined
    if (!svc) { this.#log('canvas background not ready'); return }

    const token = args.trim()
    if (!token) {
      this.#log(svc.status())
      this.#log(`backdrops: ${svc.archetypes.join(', ')}`)
      this.#log(`palettes: ${svc.palettes.join(', ')} (or auto)`)
      return
    }

    const result = svc.set(token)
    this.#log(result ?? `no backdrop matching "${token}"`)
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }
}

const _canvas = new CanvasQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CanvasQueenBee', _canvas)
