// sequence/pattern.queen.ts
//
// /pattern [name] — draw a shape.
//
//   /pattern               — list the patterns you have
//   /pattern grid          — draw (or redraw) the one called "grid"
//   /pattern honeycomb     — open a built-in and make it yours
//
// A pattern is bound to NOTHING. Drawing one saves a shape; `/frame <name>` is
// the verb that applies it to a branch, and the same pattern can be applied in
// as many places as you like. That separation is the point: shapes are
// authored once and shared, places merely point at one.

import { EffectBus, QueenBee } from '@hypercomb/core'
import type { FrameService } from './frame.service.js'

type EditorLike = { openPatternEditor(name: string): Promise<void> }

export class PatternQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'pattern'
  override readonly aliases = []

  override description = 'Draw a tile shape a frame can be read through'
  override descriptionKey = 'slash.pattern'
  override options = ['<pattern name>']
  override examples = [
    { input: '/pattern', result: 'Lists the patterns you have' },
    { input: '/pattern grid', result: 'Opens the hex editor to draw "grid"' },
  ]

  override slashComplete(args: string): readonly string[] {
    const names = this.#frames()?.list() ?? []
    const q = args.toLowerCase().trim()
    return q ? names.filter(n => n.toLowerCase().startsWith(q)) : names
  }

  protected async execute(args: string): Promise<void> {
    const frames = this.#frames()
    const name = args.trim()

    if (!name) {
      const names = frames?.list() ?? []
      this.#log(names.length
        ? `Patterns: ${names.map(n => this.#describe(frames, n)).join(', ')}`
        : 'No patterns yet — /pattern <name> draws one')
      return
    }

    const editor = window.ioc.get<EditorLike>('@diamondcoreprocessor.com/SequenceEditorBee')
    if (!editor?.openPatternEditor) {
      console.warn('[/pattern] editor unavailable')
      return
    }
    await editor.openPatternEditor(name)
  }

  /** "honeycomb (13)" — the name and what it holds, which is the thing you
   *  are choosing between when picking one to frame with. */
  #describe(frames: FrameService | undefined, name: string): string {
    const count = frames?.get(name)?.pattern.coords.length ?? 0
    return count ? `${name} (${count})` : name
  }

  #frames(): FrameService | undefined {
    return window.ioc.get<FrameService>('@FrameService')
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: 'grid_view' })
  }
}

const _patternQueen = new PatternQueenBee()
window.ioc.register('@PatternQueenBee', _patternQueen)
