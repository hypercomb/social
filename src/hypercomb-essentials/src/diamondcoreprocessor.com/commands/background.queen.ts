// diamondcoreprocessor.com/commands/background.queen.ts
//
// /background — choose how the app is dressed.
//
//   /background            — show the current theme and the whole list
//   /background ember      — dress the app in Ember
//   /background nature     — put the Nature pictures on blank tiles
//   /background off        — bare surface
//
// One word, one look. A theme dresses the screen behind the hive, the pictures
// that fill blank tiles, or both — the theme says which, and the autocomplete
// draws each one so the choice is made by eye.
//
// This replaces /canvas (which asked for an ARCHETYPE and a PALETTE as two
// separate axes) and /backgrounds (which toggled individual pictures one at a
// time). Curating which pictures are in a set is a different job and still
// lives in the substrate organizer — /substrate.
//
// There are no aliases. Every word means exactly itself; a second word for the
// same thing is confusion nobody asked for, and naming is the participant's.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { BackgroundThemeService } from '../presentation/background/background-theme.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)
const SVC = '@diamondcoreprocessor.com/BackgroundThemes'

export class BackgroundQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'background'
  override readonly aliases = []
  override description = 'Choose the background theme (screen, tiles, or both)'
  override descriptionKey = 'slash.background'
  override options = ['<theme>', 'off']
  override examples = [
    { input: '/background ember', result: 'Dresses the screen and tiles in Ember' },
    { input: '/background nature', result: 'Nature pictures on blank tiles' },
  ]

  override slashComplete(args: string): readonly string[] {
    const svc = get(SVC) as BackgroundThemeService | undefined
    const names = svc?.names ?? []
    const q = args.toLowerCase().replace(/^\s+/, '')
    return q ? names.filter(n => n.startsWith(q)) : names
  }

  protected async execute(args: string): Promise<void> {
    const svc = get(SVC) as BackgroundThemeService | undefined
    if (!svc) { this.#log('background themes not ready'); return }

    const token = args.trim()
    if (!token) {
      this.#log(svc.status())
      for (const theme of svc.themes) {
        const halves = [theme.screen ? 'screen' : null, theme.tiles ? 'tiles' : null].filter(Boolean).join(' + ')
        this.#log(`${theme.label} — ${halves}`, theme.id === svc.active ? '●' : '○')
      }
      return
    }

    const result = await svc.set(token)
    this.#log(result ?? `no theme named "${token}"`)
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _background = new BackgroundQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/BackgroundQueenBee', _background)
