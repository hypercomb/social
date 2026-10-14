// notes/lines.queen.ts
//
// `lines` — see the room as note lines instead of hexagons (jwize
// 2026-10-13: "a swarm with a note interface instead of hexagons").
//
//   lines        toggle between the lines and the hexagons
//   lines on     the lines
//   lines off    back to the hexagons
//
// Same page, same swarm, same acts — only the surface changes. The lines
// view (note-lines-view.drone.ts) is the renderer; this is the word.

import { EffectBus, QueenBee, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { LINES_VIEW } from './note-lines.js'

type ViewModeShape = { mode: string; setMode(next: string): void }

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

const t = (key: string, fallback: string): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t(key)
  return value && value !== key ? value : fallback
}

export class LinesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lines'
  override description = 'See this page as note lines instead of hexagons — everyone in the swarm writes, takes and keeps notes here'
  override descriptionKey = 'slash.lines'
  override options = ['on', 'off']
  override examples = [
    { input: '/lines', result: 'Turns this page into note lines, or back into hexagons' },
    { input: '/lines off', result: 'Back to the hexagons' },
  ]

  protected async execute(args: string): Promise<void> {
    const word = String(args ?? '').trim().toLowerCase()
    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) return
    if (word && word !== 'on' && word !== 'off') {
      EffectBus.emit('toast:show', { type: 'error', message: t('lines.usage', 'lines: say "lines", "lines on" or "lines off"') })
      return
    }
    const want = word === 'on' ? true : word === 'off' ? false : vm.mode !== LINES_VIEW
    vm.setMode(want ? LINES_VIEW : 'hexagons')
  }
}

window.ioc.register('@diamondcoreprocessor.com/LinesQueenBee', new LinesQueenBee())
