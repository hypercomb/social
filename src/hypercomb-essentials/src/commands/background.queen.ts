// commands/background.queen.ts
//
// /background — choose how the app is dressed.
//
//   /background                        — open the Backgrounds window
//   /background screen                 — the screen half, in the window
//   /background screen.ember           — dress the screen in Ember
//   /background screen.picture         — put a picture of your own behind it
//   /background screen.picture.remove  — back to a drawn look
//   /background screen.opacity.60      — how much of the picture shows
//   /background screen.off             — bare surface
//   /background tiles                  — the tiles half, in the window
//   /background tiles.ember            — fill blank tiles from the Ember group
//   /background tiles.ember.items      — show that group's pictures
//   /background tiles.ember.dots       — pin ONE picture onto every tile
//   /background tiles.ember.force      — also re-dress this layer's tiles
//   /background tiles.ember.force.global — … every tile in the hive
//   /background tiles.hidden           — the pictures you have taken out
//   /background tiles.hidden.clear     — put them all back
//
// TWO HALVES, SAID OUT LOUD. A theme dresses the screen behind the hive, the
// pictures that fill blank tiles, or both — and until now the only place that
// distinction appeared was a description string in the dropdown. It is the
// first fork of the grammar now, because "the backdrop" and "the pictures on
// my tiles" are two different questions and one flat list of theme names
// answered neither: someone looking for a backdrop image found a list of words
// with no way to tell which of them was even about the screen.
//
// The window is the other door onto exactly this. The bare word opens it, and
// `screen` / `tiles` open it ON that section — a command that lands you in the
// same place as the surface is one feature with two doors, not two features.
//
// DOT SYNTAX: a half is an object, a theme is one of its members, and a
// theme's pictures are ITS members, so you walk in with dots and the dropdown
// completes the segment after the last one. A flat row of space-separated
// words could not say whether "dots" was a theme, a picture or a flag; the
// position after a dot says it. Spaces still parse, so nothing that used to
// work stops working — and a bare theme name still applies, unoffered, so
// every `/background ember` anyone has in their fingers keeps landing.
//
// Curating which pictures are in a SOURCE is a different job and still lives
// in the substrate organizer — /substrate. Taking one picture out of the
// rotation is not: that is `tiles.hidden`, and the eye in the window.
//
// There are no aliases. Every word means exactly itself; a second word for the
// same thing is confusion nobody asked for, and naming is the participant's.

import {
  QueenBee, EffectBus,
  registerCommandRoot, completeCommandPath,
  type CommandObject, type CommandMember,
} from '@hypercomb/core'
import type { BackgroundThemeService } from '../presentation/background/background-theme.service.js'
import type { CanvasBackgroundService } from '../presentation/background/canvas-background.service.js'
import type { SubstrateService } from '../substrate/substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)
const SVC = '@diamondcoreprocessor.com/BackgroundThemes'
const CANVAS = '@diamondcoreprocessor.com/CanvasBackground'
const SUBSTRATE = '@diamondcoreprocessor.com/SubstrateService'

/** The opacity offered as members. A number is a poor member — there are a
 *  hundred of them and none is discoverable — so five stops stand for the
 *  range, and anything else you type still parses. */
const OPACITY_STOPS = ['0', '25', '50', '75', '100'] as const

/**
 * `/background` as an OBJECT — the first citizen of the command-object
 * protocol. It does not parse its own arguments: it says what its members are
 * at each depth and the command line does the walking.
 *
 * Depth 0 — the two halves. Nothing else lives here, so the first thing the
 *           dropdown ever shows you is the question you actually have.
 * Depth 1 — that half's looks (a code registry: they ship with their assets),
 *           each carrying the swatch that draws it in the dropdown.
 * Depth 2+ — a tiles group's own pictures, its group viewer, and the reaches.
 */
const backgroundObject: CommandObject = {
  members(path: readonly string[]): readonly CommandMember[] {
    const svc = get(SVC) as BackgroundThemeService | undefined
    if (!svc) return []

    if (path.length === 0) {
      return [
        { name: 'screen', description: 'what is behind the hive' },
        { name: 'tiles', description: 'what fills a blank tile' },
      ]
    }

    const half = path[0]
    const rest = path.slice(1)

    if (half === 'screen') return screenMembers(svc, rest)
    if (half === 'tiles') return tilesMembers(svc, rest)
    return []
  },
}

/** The screen's members: your own picture, the drawn looks, and off. */
function screenMembers(svc: BackgroundThemeService, path: readonly string[]): readonly CommandMember[] {
  const canvas = get(CANVAS) as CanvasBackgroundService | undefined

  if (path.length === 0) {
    const out: CommandMember[] = [{
      name: 'picture',
      description: canvas?.picture ? 'the picture behind the hive' : 'put a picture of your own behind the hive',
      swatch: canvas?.pictureSwatch() || undefined,
      // With no picture showing there is nothing below this word — `remove`
      // is the only member it ever has. Saying so is what lets the line be
      // SENT: a member the walk still considers open keeps the dropdown up
      // and swallows the press that should have run the command.
      leaf: !canvas?.picture,
    }]
    // The opacity only means something while a picture is showing — with a
    // drawn look there is nothing to fade, so it is not a member.
    if (canvas?.picture) out.push({ name: 'opacity', description: 'how much of the picture shows' })
    // THE SAME FILTER THE WINDOW USES, asked of the same service: the looks
    // that go with the chrome you are wearing. `all` is not offered here —
    // typing a name still applies it, so nothing is out of reach.
    for (const theme of svc.half('screen')) {
      out.push({
        name: theme.id,
        description: [theme.screen ? 'screen' : null, theme.tiles ? 'tiles' : null, theme.chrome ? 'chrome' : null]
          .filter(Boolean).join(' + '),
        swatch: svc.swatch(theme.id) || undefined,
        leaf: true,
      })
    }
    out.push({ name: 'off', description: 'bare surface', leaf: true })
    return out
  }

  if (path[0] === 'picture' && path.length === 1) {
    return canvas?.picture ? [{ name: 'remove', description: 'back to a drawn look', leaf: true }] : []
  }
  if (path[0] === 'opacity' && path.length === 1) {
    return OPACITY_STOPS.map(stop => ({ name: stop, description: `${stop}% of the picture`, leaf: true }))
  }
  return []
}

/** The tiles half: the groups, their pictures, the reaches, and the hidden. */
function tilesMembers(svc: BackgroundThemeService, path: readonly string[]): readonly CommandMember[] {
  if (path.length === 0) {
    // The same filter the window uses, asked of the same service.
    const out: CommandMember[] = svc.half('tiles').map(theme => ({
      name: theme.id,
      description: [theme.screen ? 'screen' : null, theme.tiles ? 'tiles' : null, theme.chrome ? 'chrome' : null]
        .filter(Boolean).join(' + '),
      swatch: svc.swatch(theme.id) || undefined,
    }))
    const hidden = (get(SUBSTRATE) as SubstrateService | undefined)?.hiddenImages?.() ?? []
    out.push({
      name: 'hidden',
      description: hidden.length ? `${hidden.length} taken out of the rotation` : 'nothing is hidden',
    })
    return out
  }

  if (path[0] === 'hidden') {
    return path.length === 1 ? [{ name: 'clear', description: 'put them all back', leaf: true }] : []
  }

  const pictures = svc.items(path[0])
  const walked = new Set(path.slice(1))
  const pinned = path.slice(1).some(word => pictures.includes(word))
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
  // offers `global`, which is the shape the dot syntax invites.
  if (!walked.has('force')) out.push({ name: 'force', description: 're-dress this layer' })
  // One picture stamped across an entire hive is the combination rerolling
  // cannot undo. Not a member once a picture is walked into.
  if (!pinned && walked.has('force') && !walked.has('global')) {
    out.push({ name: 'global', description: 're-dress every tile in the hive', leaf: true })
  }
  return out
}

registerCommandRoot('background', backgroundObject)

export class BackgroundQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'background'
  override readonly aliases = []
  override description = 'Choose what is behind the hive and what fills a blank tile'
  override descriptionKey = 'slash.background'
  override options = [
    'screen', 'screen.<look>', 'screen.picture', 'screen.opacity.<0-100>', 'screen.off',
    'tiles', 'tiles.<group>', 'tiles.<group>.<picture>', 'tiles.<group>.force', 'tiles.<group>.items',
    'tiles.hidden',
  ]
  override examples = [
    { input: '/background', result: 'Opens the Backgrounds window' },
    { input: '/background screen.picture', result: 'Choose a picture to put behind the hive' },
    { input: '/background tiles.ember.dots.force', result: 'One picture on every tile of this layer' },
  ]

  // No argument parsing of its own for completion — the walk is the
  // protocol's. Kept as the fallback path for shells that ask directly.
  override slashComplete(args: string): readonly string[] {
    return completeCommandPath(backgroundObject, args)
  }

  protected async execute(args: string): Promise<void> {
    const svc = get(SVC) as BackgroundThemeService | undefined
    if (!svc) { this.#log('background themes not ready'); return }

    const words = args.trim().toLowerCase().split(/[.\s]+/).filter(Boolean)

    // THE BARE WORD OPENS THE WINDOW. It used to print the whole list into the
    // activity log, which is a list you cannot look at while you choose from
    // it — and none of those lines could show you what the look actually was.
    if (words.length === 0) { EffectBus.emit('backgrounds:open', {}); return }

    if (words[0] === 'screen') return await this.#screen(svc, words.slice(1))
    if (words[0] === 'tiles') return await this.#tiles(svc, words.slice(1))

    // LEGACY, AND DELIBERATELY UNOFFERED. A bare theme name is what this
    // behaviour took for its whole life; it still applies exactly as it did,
    // it is simply not what the dropdown teaches any more.
    return await this.#applyTheme(svc, words)
  }

  // ── the screen half ─────────────────────────────────────────────────

  async #screen(svc: BackgroundThemeService, words: readonly string[]): Promise<void> {
    const canvas = get(CANVAS) as CanvasBackgroundService | undefined

    if (words.length === 0) { EffectBus.emit('backgrounds:reveal', { section: 'screen' }); return }

    if (words[0] === 'picture') {
      if (words[1] === 'remove') {
        if (!canvas?.picture) { this.#log('no picture is showing'); return }
        canvas.clearPicture()
        this.#log('picture removed — back to the drawn look')
        return
      }
      // A file has to be CHOSEN, and a command line cannot choose one. The
      // window can, so the word opens it where the picker is rather than
      // failing at a thing the participant plainly meant.
      EffectBus.emit('backgrounds:reveal', { section: 'screen' })
      return
    }

    if (words[0] === 'opacity') {
      if (!canvas) { this.#log('the screen is not ready'); return }
      const value = Number(words[1])
      if (!Number.isFinite(value)) { this.#log(`opacity is 0–100 — got "${words[1] ?? ''}"`); return }
      canvas.setDim((100 - value) / 100)
      this.#log(canvas.status())
      return
    }

    // LEGACY, AND DELIBERATELY UNOFFERED. `wash` is opacity said the other way
    // round (wash 60 = opacity 40); it still parses exactly as it always did.
    if (words[0] === 'wash') {
      if (!canvas) { this.#log('the screen is not ready'); return }
      const value = Number(words[1])
      if (!Number.isFinite(value)) { this.#log(`wash is 0–100 — got "${words[1] ?? ''}"`); return }
      canvas.setDim(value / 100)
      this.#log(canvas.status())
      return
    }

    if (words[0] === 'off') {
      const result = await svc.set('off')
      this.#log(result ?? 'screen cleared')
      return
    }

    const theme = svc.theme(words[0])
    if (!theme?.screen) { this.#log(`no screen look named "${words[0]}"`); return }
    await this.#applyTheme(svc, words)
  }

  // ── the tiles half ──────────────────────────────────────────────────

  async #tiles(svc: BackgroundThemeService, words: readonly string[]): Promise<void> {
    if (words.length === 0) { EffectBus.emit('backgrounds:reveal', { section: 'tiles' }); return }

    if (words[0] === 'hidden') {
      const substrate = get(SUBSTRATE) as SubstrateService | undefined
      if (!substrate) { this.#log('the substrate is not ready'); return }
      if (words[1] === 'clear') {
        const count = substrate.hiddenImages().length
        substrate.showAllImages()
        this.#log(count ? `${count} picture${count === 1 ? '' : 's'} back in the rotation` : 'nothing was hidden')
        return
      }
      const hidden = new Set(substrate.hiddenImages())
      if (hidden.size === 0) { this.#log('nothing is hidden'); return }
      this.#log(`${hidden.size} picture${hidden.size === 1 ? '' : 's'} out of the rotation`)
      for (const image of substrate.listImages()) {
        if (hidden.has(image.imageSig)) this.#log(image.name, '▫')
      }
      return
    }

    const theme = svc.theme(words[0])
    if (!theme?.tiles) { this.#log(`no picture group named "${words[0]}"`); return }
    await this.#applyTheme(svc, words)
  }

  // ── shared application ──────────────────────────────────────────────

  /** The theme path, exactly as it has always worked: `<theme>` applies,
   *  `<theme> items` shows the group, and everything else is the service's own
   *  dot grammar. Called from both halves so there is ONE application. */
  async #applyTheme(svc: BackgroundThemeService, words: readonly string[]): Promise<void> {
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
      EffectBus.emit('backgrounds:reveal', { section: 'tiles' })
      return
    }

    const result = await svc.set(words.join('.'))
    this.#log(result ?? `no theme named "${words[0]}"`)
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _background = new BackgroundQueenBee()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/BackgroundQueenBee', _background)
