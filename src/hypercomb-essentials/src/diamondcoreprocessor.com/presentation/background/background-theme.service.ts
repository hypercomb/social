// diamondcoreprocessor.com/presentation/background/background-theme.service.ts
//
// BackgroundThemeService — ONE list of named looks, and the only way to choose
// how the app is dressed.
//
// Before this there were four ways to change what you see and no way to see
// them: `/canvas` drew the screen from an ARCHETYPE × PALETTE pair (two axes
// you had to hold in your head), `/backgrounds` toggled individual default
// pictures, `/substrate set` switched image collections, and several sets of
// generated theme assets were shipped but wired to nothing at all. This service
// replaces the choosing with a flat list of THEMES.
//
// A theme is a named look that declares what it dresses:
//
//   screen — the backdrop behind the hive (handed to CanvasBackgroundService)
//   tiles  — the pictures that fill blank tiles (a SubstrateService source id)
//
// A theme may declare either half or both. A theme that names no screen leaves
// the screen alone, so an image theme can be laid over any backdrop. Nothing
// here is a new renderer: the two services that already paint each half do the
// painting, and this only decides what to tell them.
//
// The list is DATA. Nothing about a theme is special-cased in code, so any
// number can be added — a set of pictures anywhere the substrate can reach, a
// screen look, or both — without touching this file's logic.
//
// Participant-local, like everything about appearance: the choice persists to
// localStorage and is never written to a layer.

import { EffectBus } from '@hypercomb/core'
import type { CanvasBackgroundService } from './canvas-background.service.js'

const STORAGE_KEY = 'hc:background-theme'
const get = (key: string) => (window as any).ioc?.get?.(key)

type SubstrateLike = {
  ensureLoaded(): Promise<void>
  setActive(id: string | null): Promise<void>
  listSources(): readonly { id: string; label?: string; builtin?: boolean }[]
  activeSource: { id: string } | null
}

export type BackgroundTheme = {
  /** The one word the participant types. Also the localStorage value. */
  id: string
  /** How it reads in the dropdown and the activity log. */
  label: string
  /** The backdrop behind the hive. Omit to leave the screen untouched. */
  screen?: { archetype: string; palette: string }
  /** SubstrateService source id for blank-tile pictures. Omit to leave tiles. */
  tiles?: string
  /** One picture from the tiles set, for the chip on a theme with no screen.
   *  Named rather than discovered: a manifest lookup would make the swatch
   *  asynchronous, and the dropdown draws now. */
  preview?: string
}

// The shipped themes. Five dress BOTH halves — a drawn backdrop plus the tile
// rasters generated in the same palette, so the screen and the tiles agree.
// Four dress tiles only, and are meant to be laid over whichever backdrop is
// already showing. `photos` is the original mixed collection.
//
// The archetype on each palette theme is that palette's signature pattern; it
// is data, not doctrine — changing one changes the theme, and adding a new
// entry here adds a theme with no other edit anywhere.
export const BACKGROUND_THEMES: readonly BackgroundTheme[] = [
  { id: 'steel',     label: 'Steel',     screen: { archetype: 'contour', palette: 'steel' },      tiles: 'builtin:steel' },
  { id: 'daylight',  label: 'Daylight',  screen: { archetype: 'honeycomb', palette: 'daylight' }, tiles: 'builtin:daylight' },
  { id: 'indigo',    label: 'Indigo',    screen: { archetype: 'mesh', palette: 'indigo' },        tiles: 'builtin:indigo' },
  { id: 'teal',      label: 'Teal',      screen: { archetype: 'dots', palette: 'teal' },          tiles: 'builtin:teal' },
  { id: 'ember',     label: 'Ember',     screen: { archetype: 'sheen', palette: 'ember' },        tiles: 'builtin:ember' },
  { id: 'photos',    label: 'Photos',    tiles: 'builtin:defaults',        preview: '/substrate/sunset.webp' },
  { id: 'minimal',   label: 'Minimal',   tiles: 'builtin:theme-minimal',   preview: '/substrate/theme-minimal/1.png' },
  { id: 'geometric', label: 'Geometric', tiles: 'builtin:theme-geometric', preview: '/substrate/theme-geometric/1.png' },
  { id: 'abstract',  label: 'Abstract',  tiles: 'builtin:theme-abstract',  preview: '/substrate/theme-abstract/1.png' },
  { id: 'nature',    label: 'Nature',    tiles: 'builtin:theme-nature',    preview: '/substrate/theme-nature/1.png' },
]

export class BackgroundThemeService extends EventTarget {
  #themes: BackgroundTheme[] = [...BACKGROUND_THEMES]
  #active: string | null = null

  constructor() {
    super()
    try { this.#active = localStorage.getItem(STORAGE_KEY) } catch { /* storage unavailable */ }
  }

  get themes(): readonly BackgroundTheme[] { return this.#themes }
  get active(): string | null { return this.#active }
  /** Every word `set()` accepts — the theme names plus `off`. */
  get names(): readonly string[] { return [...this.#themes.map(t => t.id), 'off'] }

  theme(id: string): BackgroundTheme | undefined {
    return this.#themes.find(t => t.id === id.toLowerCase().trim())
  }

  /**
   * Add a theme, or replace one of the same id. This is the seam that makes the
   * list data: a module — or a participant's own module — can ship a look
   * without this file knowing about it.
   */
  register(theme: BackgroundTheme): void {
    const at = this.#themes.findIndex(t => t.id === theme.id)
    if (at >= 0) this.#themes[at] = theme
    else this.#themes.push(theme)
    this.dispatchEvent(new CustomEvent('change'))
  }

  /**
   * Dress the app in a theme. `off` clears the screen backdrop and leaves the
   * tiles as they are — an empty screen is a look, an empty tile is a gap.
   * Returns a short status, or null when the word names no theme.
   */
  async set(input: string): Promise<string | null> {
    const token = input.toLowerCase().trim()
    if (!token) return null

    const canvas = get('@diamondcoreprocessor.com/CanvasBackground') as CanvasBackgroundService | undefined
    if (token === 'off') {
      canvas?.set('off')
      this.#active = 'off'
      this.#persist()
      this.dispatchEvent(new CustomEvent('change'))
      return 'background off — bare surface'
    }

    const theme = this.theme(token)
    if (!theme) return null

    const dressed: string[] = []
    if (theme.screen && canvas) {
      canvas.set(`${theme.screen.palette} ${theme.screen.archetype}`)
      dressed.push('screen')
    }
    if (theme.tiles) {
      const substrate = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateLike | undefined
      if (substrate) {
        await substrate.ensureLoaded()
        // A theme naming a source that isn't registered dresses what it can
        // rather than failing the whole change.
        if (substrate.listSources().some(s => s.id === theme.tiles)) {
          await substrate.setActive(theme.tiles)
          dressed.push('tiles')
        }
      }
    }

    this.#active = theme.id
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('background:theme', { id: theme.id })
    return dressed.length
      ? `background → ${theme.label} (${dressed.join(' + ')})`
      : `background → ${theme.label}`
  }

  status(): string {
    if (this.#active === 'off') return 'background off'
    const theme = this.#active ? this.theme(this.#active) : undefined
    if (!theme) return 'background — no theme chosen yet'
    const halves = [theme.screen ? 'screen' : null, theme.tiles ? 'tiles' : null].filter(Boolean)
    return `background → ${theme.label} (${halves.join(' + ')})`
  }

  /**
   * A CSS `background` shorthand previewing a theme, for the autocomplete chip.
   * A theme with a screen shows that backdrop drawn at chip scale; a tiles-only
   * theme shows one of its own pictures, which is the honest preview of what it
   * would put on a tile. Returns '' for `off`.
   */
  swatch(input: string): string {
    const token = input.toLowerCase().trim()
    if (token === 'off') return ''
    const theme = this.theme(token)
    if (!theme) return ''
    if (theme.screen) {
      const canvas = get('@diamondcoreprocessor.com/CanvasBackground') as CanvasBackgroundService | undefined
      const css = canvas?.swatch(`${theme.screen.palette} ${theme.screen.archetype}`)
      if (css) return css
    }
    return theme.preview ? `url("${theme.preview}") center/cover no-repeat` : ''
  }

  #persist(): void {
    try {
      if (this.#active) localStorage.setItem(STORAGE_KEY, this.#active)
      else localStorage.removeItem(STORAGE_KEY)
    } catch { /* storage unavailable */ }
  }
}

const _backgroundThemes = new BackgroundThemeService()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/BackgroundThemes', _backgroundThemes)
