// diamondcoreprocessor.com/commands/background.queen.ts
//
// /background — choose how the app is dressed.
//
//   /background                      — the current theme and the whole list
//   /background ember                — dress the app in Ember
//   /background ember.items          — show Ember's group of pictures
//   /background ember.dots           — pin ONE picture onto every tile
//   /background ember.force          — also re-dress this layer's tiles
//   /background ember.force-global   — also re-dress every tile in the hive
//   /background off                  — bare surface
//
// A theme dresses the screen behind the hive, the pictures that fill blank
// tiles, or both — the theme says which, and the autocomplete draws each one so
// the choice is made by eye.
//
// DOT SYNTAX: a theme is an object and its pictures are its members, so you
// walk into it with dots and the dropdown completes the segment after the last
// one, the way member completion works everywhere else. A flat row of
// space-separated words could not say whether "dots" was a theme, a picture or
// a flag; the position after a dot says it. Spaces still parse, so nothing that
// used to work stops working.
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
  override options = ['<theme>', '<theme>.<picture>', '<theme>.force', '<theme>.force-global', '<theme>.items', 'off']
  override examples = [
    { input: '/background ember', result: 'Ember screen; tiles vary across the Ember group' },
    { input: '/background ember.dots.force', result: 'One picture on every tile of this layer' },
  ]

  override slashComplete(args: string): readonly string[] {
    const svc = get(SVC) as BackgroundThemeService | undefined
    if (!svc) return []
    // DOT SYNTAX — a theme is an object, its pictures are its members, and this
    // completes the segment after the last dot exactly the way member
    // completion does. `ember.` offers Ember's pictures; `ember.do` finishes to
    // `ember.dots`. The words are unambiguous because their POSITION says what
    // they are, which is what a flat row of space-separated words could not do.
    const q = args.toLowerCase().replace(/^\s+/, '').replace(/\s+/g, '.')
    const parts = q.split('.')
    const last = parts[parts.length - 1]
    const head = parts.slice(0, -1)

    // First segment: the themes. After that: this theme's own pictures (only
    // listable once its group is warm), the group viewer, and the reaches.
    let options: string[]
    if (head.length === 0) {
      options = [...svc.names]
    } else {
      const pictures = svc.items(head[0])
      const typed = new Set(head.slice(1))
      const pinned = head.slice(1).some(w => pictures.includes(w))
      options = [...(pinned ? [] : pictures), 'items', 'force', 'force-global']
        .filter(o => !typed.has(o))
      // One picture across a whole hive is refused, so never offer the pair.
      if (pinned) options = options.filter(o => o !== 'force-global')
    }
    const matches = last ? options.filter(o => o.startsWith(last)) : options
    return matches.map(o => (head.length ? `${head.join('.')}.${o}` : o))
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

    // "<theme> items" — show the group. The pictures are the group's members,
    // so this lists them and opens the organizer, where they are laid out as
    // thumbnails and can be curated.
    const words = token.toLowerCase().split(/[.\s]+/).filter(Boolean)
    if (words.length > 1 && words[words.length - 1] === 'items') {
      const themeId = words[0]
      const theme = svc.theme(themeId)
      if (!theme) { this.#log(`no theme named "${themeId}"`); return }
      // A pool is only warmed while it is the active one, so make it active
      // first — showing a group means looking at it.
      await svc.set(themeId)
      const items = svc.items(themeId)
      this.#log(`${theme.label} — ${items.length} picture${items.length === 1 ? '' : 's'}`)
      for (const name of items) this.#log(name, '▫')
      EffectBus.emit('substrate-organizer:open', {})
      return
    }

    const result = await svc.set(token)
    this.#log(result ?? `no theme named "${words[0]}"`)
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _background = new BackgroundQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/BackgroundQueenBee', _background)
