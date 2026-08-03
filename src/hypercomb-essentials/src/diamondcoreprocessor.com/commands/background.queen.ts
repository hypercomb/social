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

import {
  QueenBee, EffectBus,
  registerCommandRoot, completeCommandPath,
  type CommandObject, type CommandMember,
} from '@hypercomb/core'
import type { BackgroundThemeService } from '../presentation/background/background-theme.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)
const SVC = '@diamondcoreprocessor.com/BackgroundThemes'

/**
 * `/background` as an OBJECT — the first citizen of the command-object
 * protocol. It no longer parses its own arguments: it says what its members
 * are at each depth and the command line does the walking.
 *
 * Depth 0 — the themes (a code registry: they ship with their assets), each
 *           carrying the swatch that draws it in the dropdown.
 * Depth 1+ — this theme's own pictures, its group viewer, and the reaches.
 *
 * The refusal lives here rather than in a validator: once a picture is pinned,
 * `force-global` simply STOPS BEING A MEMBER. An impossible combination that
 * cannot be typed needs no error message.
 */
const backgroundObject: CommandObject = {
  members(path: readonly string[]): readonly CommandMember[] {
    const svc = get(SVC) as BackgroundThemeService | undefined
    if (!svc) return []

    if (path.length === 0) {
      return svc.names.map(name => {
        const theme = svc.theme(name)
        return {
          name,
          description: theme
            ? [theme.screen ? 'screen' : null, theme.tiles ? 'tiles' : null].filter(Boolean).join(' + ')
            : 'bare surface',
          swatch: svc.swatch(name) || undefined,
          leaf: !theme,
        }
      })
    }

    const pictures = svc.items(path[0])
    const walked = new Set(path.slice(1))
    const pinned = path.slice(1).some(w => pictures.includes(w))
    const out: CommandMember[] = []
    // A picture is only offered while none is pinned — two pictures on one tile
    // is not a thing, so it is not a member.
    if (!pinned) {
      for (const picture of pictures) {
        if (!walked.has(picture)) out.push({ name: picture, description: 'one picture on every tile' })
      }
    }
    if (!walked.has('items')) out.push({ name: 'items', description: 'show this group', leaf: true })
    // `force` is an OBJECT, not a leaf: its reach is a member. Walking into it
    // offers `global`, which is the shape the dot syntax invites and which
    // used to parse as a picture name and fail the whole command.
    if (!walked.has('force')) out.push({ name: 'force', description: 're-dress this layer' })
    // One picture stamped across an entire hive is the combination rerolling
    // cannot undo. Not a member once a picture is walked into.
    if (!pinned && walked.has('force') && !walked.has('global')) {
      out.push({ name: 'global', description: 're-dress every tile in the hive', leaf: true })
    }
    if (!pinned && !walked.has('force') && !walked.has('force-global')) {
      out.push({ name: 'force-global', description: 're-dress every tile', leaf: true })
    }
    return out
  },
}
registerCommandRoot('background', backgroundObject)

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

  // No argument parsing of its own — the walk is the protocol's, and this is
  // the whole of what used to be twenty lines of hand-rolled dot splitting.
  // Kept as the fallback path for shells that ask the behaviour directly.
  override slashComplete(args: string): readonly string[] {
    return completeCommandPath(backgroundObject, args)
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
