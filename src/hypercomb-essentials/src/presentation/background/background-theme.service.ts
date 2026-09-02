// presentation/background/background-theme.service.ts
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
//   chrome — the `--md-*` value-set the panels wear (handed to ThemeService)
//
// ── THE THIRD HALF ────────────────────────────────────────────────────────
//
// `chrome` closes the last seam. Appearance was still TWO choices that knew
// nothing about each other: this service dressed the screen and the tiles,
// and `/theme` dressed the panels — so a bright daylight backdrop under dark
// steel panels was not just reachable, it was what you got by changing one of
// them. That is the same "two axes you had to hold in your head" this file was
// written to end, left standing in the middle of it.
//
// Now a look dresses the whole app, and it is still data: a theme names the
// chrome it wears, the same way it names its backdrop. A theme that names no
// chrome leaves the panels alone — which is exactly right for the twelve
// picture-only themes, because a set of tile photographs has no opinion about
// what the command line should look like.
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

import { EffectBus, THEME_IOC_KEY, type ThemeProvider } from '@hypercomb/core'
import { chromeIsLight, paletteIsLight, type CanvasBackgroundService } from './canvas-background.service.js'

const STORAGE_KEY = 'hc:background-theme'
const get = (key: string) => (window as any).ioc?.get?.(key)

type SubstrateLike = {
  ensureLoaded(): Promise<void>
  warmUp(): Promise<void>
  setActive(id: string | null): Promise<void>
  listSources(): readonly { id: string; label?: string; builtin?: boolean }[]
  listImages(): { name: string; imageSig: string; enabled: boolean }[]
  previewSourceImages?(id: string): Promise<{ name: string; imageSig: string }[]>
  activeSource: { id: string } | null
  defaultSigs: ReadonlySet<string>
  pinImage(token: string): { name: string } | null
  unpinImages(): void
  restyle(labels: string[], ownedSigs?: ReadonlySet<string>, segments?: readonly string[]): Promise<string[]>
  restyleEverywhere(): Promise<string[]>
  allLabels(): Promise<string[]>
}

/** How far an overwrite reaches. `none` is the default: a theme change dresses
 *  tiles that have no picture yet and leaves the dressed ones alone. */
type Reach = 'none' | 'layer' | 'global'

export type BackgroundTheme = {
  /** The one word the participant types. Also the localStorage value. */
  id: string
  /** How it reads in the dropdown and the activity log. */
  label: string
  /** The backdrop behind the hive. Omit to leave the screen untouched. */
  screen?: { archetype: string; palette: string }
  /** SubstrateService source id for blank-tile pictures. Omit to leave tiles. */
  tiles?: string
  /** The `--md-*` chrome theme worn with this look — the panels, the command
   *  line, the notes strip. Omit to leave the chrome alone, which is what
   *  every picture-only theme wants. See THE THIRD HALF below. */
  chrome?: string
  /** One picture from the tiles set, for the chip on a theme with no screen.
   *  Named rather than discovered: a manifest lookup would make the swatch
   *  asynchronous, and the dropdown draws now. */
  preview?: string
  /** WHICH WORLD THIS LOOK BELONGS TO.
   *
   *  A wall of deep-space plates under cream panels is not a choice anyone
   *  makes on purpose, and neither is a set of paper washes under near-black
   *  chrome — so the list follows the chrome and offers the looks that go with
   *  it. Omit it and the look suits BOTH, which is the honest answer for a
   *  mixed collection: `photos` has bright and dark pictures in the same set,
   *  and pretending otherwise would take it off half the world's list.
   *
   *  A SCREEN look never needs to declare this — its palette already knows
   *  whether it is bright, and `mood()` reads it from there. Declaring it is
   *  only for TILE groups, whose pictures the palettes say nothing about. */
  mood?: 'light' | 'dark'
}

// The shipped themes. Five dress BOTH halves — a drawn backdrop plus the tile
// rasters generated in the same palette, so the screen and the tiles agree.
// Seven dress tiles only, and are meant to be laid over whichever backdrop is
// already showing. `photos` is the original mixed collection.
//
// The archetype on each palette theme is that palette's signature pattern; it
// is data, not doctrine — changing one changes the theme, and adding a new
// entry here adds a theme with no other edit anywhere.
export const BACKGROUND_THEMES: readonly BackgroundTheme[] = [
  // ── the bright three ──────────────────────────────────────────────────
  // The only three that dress all THREE halves. Each pairs a light backdrop
  // with the chrome theme of the same name, so the screen behind the hive and
  // the panels over it are lit by the same colour. They name no tiles: a look
  // this saturated wants to sit over whatever pictures are already there, and
  // forcing a picture set would overwrite a choice the participant made.
  { id: 'honey',   label: 'Honey',   screen: { archetype: 'honeycomb', palette: 'honey' },   chrome: 'honey' },
  { id: 'bloom',   label: 'Bloom',   screen: { archetype: 'mesh',      palette: 'bloom' },   chrome: 'bloom' },
  { id: 'sherbet', label: 'Sherbet', screen: { archetype: 'dots',      palette: 'sherbet' }, chrome: 'sherbet' },

  // Nature is the SHIP DEFAULT — twenty scenes, first in the list, and what an
  // unchosen `active` reads as. Its tiles set is the substrate's default too.
  { id: 'nature',    label: 'Nature',    tiles: 'builtin:theme-nature',    preview: '/substrate/theme-nature/1.jpg', mood: 'dark' },
  // THE NEUTRAL PAIR. steel and daylight are the backdrops for the plain dark
  // and light chrome — same azure/clay chord, same grounds — so they name that
  // chrome for the same reason the bright three do: typed by name, a paper
  // backdrop under honey panels (or a slate one under bloom) is not a choice
  // anyone makes on purpose. The five below have no chrome theme of their own
  // and leave the panels alone, which is right — they are a dressed screen,
  // not a look.
  { id: 'steel',     label: 'Steel',     screen: { archetype: 'contour', palette: 'steel' },      tiles: 'builtin:steel',    chrome: 'dark' },
  { id: 'daylight',  label: 'Daylight',  screen: { archetype: 'honeycomb', palette: 'daylight' }, tiles: 'builtin:daylight', chrome: 'light' },
  { id: 'indigo',    label: 'Indigo',    screen: { archetype: 'mesh', palette: 'indigo' },        tiles: 'builtin:indigo' },
  { id: 'teal',      label: 'Teal',      screen: { archetype: 'dots', palette: 'teal' },          tiles: 'builtin:teal' },
  { id: 'ember',     label: 'Ember',     screen: { archetype: 'sheen', palette: 'ember' },        tiles: 'builtin:ember' },
  { id: 'photos',    label: 'Photos',    tiles: 'builtin:defaults',        preview: '/substrate/sunset.webp' },
  { id: 'minimal',   label: 'Minimal',   tiles: 'builtin:theme-minimal',   preview: '/substrate/theme-minimal/1.jpg', mood: 'light' },
  { id: 'geometric', label: 'Geometric', tiles: 'builtin:theme-geometric', preview: '/substrate/theme-geometric/1.jpg' },
  { id: 'abstract',  label: 'Abstract',  tiles: 'builtin:theme-abstract',  preview: '/substrate/theme-abstract/1.jpg' },
  { id: 'cosmos',    label: 'Cosmos',    tiles: 'builtin:theme-cosmos',    preview: '/substrate/theme-cosmos/1.jpg', mood: 'dark' },
  { id: 'ink',       label: 'Ink',       tiles: 'builtin:theme-ink',       preview: '/substrate/theme-ink/1.jpg', mood: 'light' },
  { id: 'botanical', label: 'Botanical', tiles: 'builtin:theme-botanical', preview: '/substrate/theme-botanical/1.jpg', mood: 'dark' },
]

/** What `active` reads as before anyone has chosen — the ship default. */
export const DEFAULT_BACKGROUND_THEME = 'nature'

export class BackgroundThemeService extends EventTarget {
  #themes: BackgroundTheme[] = [...BACKGROUND_THEMES]
  #active: string | null = DEFAULT_BACKGROUND_THEME
  #activeItem: string | null = null

  constructor() {
    super()
    // A stored value — including the word `off` — is a choice and wins. Only the
    // absence of one falls through to the default.
    try { this.#active = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_BACKGROUND_THEME } catch { /* storage unavailable */ }
    // The chrome moving between the bright and the dark world changes which
    // looks are on offer, so anything drawing that list has to be told. The
    // matchMedia arm covers the `system` theme, which sets no attribute at all
    // and would otherwise flip at dusk with nothing announcing it.
    EffectBus.on('theme:changed', () => { this.dispatchEvent(new CustomEvent('change')) })
    try {
      window.matchMedia?.('(prefers-color-scheme: light)')
        ?.addEventListener?.('change', () => { this.dispatchEvent(new CustomEvent('change')) })
    } catch { /* matchMedia unavailable */ }
  }

  get themes(): readonly BackgroundTheme[] { return this.#themes }
  get active(): string | null { return this.#active }
  /** The mutually-exclusive picture pinned inside the active theme. */
  get activeItem(): string | null { return this.#activeItem }
  /** Every word `set()` accepts — the theme names plus `off`. */
  get names(): readonly string[] { return [...this.#themes.map(t => t.id), 'off'] }

  /** Is the chrome currently a bright look? The one question the light/dark
   *  filter turns on, asked of the chrome itself rather than of a list of
   *  theme names — a look a community module registered at runtime answers
   *  for itself, and so does a look nobody here has heard of. */
  get lightWorld(): boolean { return chromeIsLight() }

  /**
   * WHICH WORLD A LOOK BELONGS TO, or null for one that belongs to both.
   *
   * A screen look never declares it: its palette already knows whether it is
   * bright, so asking twice is a second source of truth that can only ever
   * drift out of step with the first. A tile group has no palette, so it says
   * so in its own entry — and one that says nothing suits both, which is the
   * honest answer for a mixed collection rather than a coin toss.
   */
  mood(id: string): 'light' | 'dark' | null {
    const theme = this.theme(id)
    if (!theme) return null
    if (theme.mood) return theme.mood
    if (theme.screen) return paletteIsLight(theme.screen.palette) ? 'light' : 'dark'
    return null
  }

  /** Does this look go with the chrome you are wearing? A look with no mood
   *  goes with everything. */
  suits(id: string): boolean {
    const mood = this.mood(id)
    return mood === null || (mood === 'light') === this.lightWorld
  }

  /**
   * The looks that dress a given half, filtered to the world the chrome is in.
   * ONE rule, asked in one place, so the window and the command dropdown can
   * never disagree about what is on offer — the bug that story always becomes.
   *
   * `all` is the escape hatch, not the default: filtering that cannot be
   * turned off is a list that has quietly decided something for you, and a
   * dark theme you deliberately want under a bright chrome must stay
   * reachable. Typing its name still applies it either way — the filter is
   * about what is OFFERED, never about what is allowed.
   */
  half(which: 'screen' | 'tiles', all = false): readonly BackgroundTheme[] {
    const wanted = this.#themes.filter(theme => (which === 'screen' ? theme.screen : theme.tiles))
    if (all) return wanted
    // THE LOOK YOU ARE WEARING IS ALWAYS ON THE LIST. Nature is the ship
    // default and is a dark group, so under a bright chrome the filter took
    // the active group off its own list — leaving a section that showed six
    // groups, none of them marked, above the twenty pictures the seventh was
    // actually handing out. You must be able to see what you have on.
    const suited = wanted.filter(theme => this.suits(theme.id) || theme.id === this.#active)
    // Never filter a half down to nothing: an empty list is not a filter, it
    // is a broken window.
    return suited.length ? suited : wanted
  }

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
   * Dress the app in a theme.
   *
   *   <theme>                     the group dresses tiles that have none yet;
   *                               each tile draws its own picture, so a wall of
   *                               them is varied but coherent
   *   <theme> <item>              pin ONE picture from the group — every tile
   *                               wears the same one
   *   <theme> force               also overwrite the tiles on this layer
   *   <theme> force-global        also overwrite every tile in the hive
   *   off                         clear the screen backdrop
   *
   * An overwrite replaces ONLY pictures a substrate pool put there. A picture
   * the participant attached is never touched, at any reach — that is the whole
   * point of force being safe to type.
   *
   * `<item> force-global` is refused: one picture stamped across an entire hive
   * is not a look, it is damage, and it is the one combination that cannot be
   * undone by rerolling.
   *
   * Returns a short status, or null when the words name no theme.
   */
  async set(input: string): Promise<string | null> {
    // DOT SYNTAX. A theme is an object and its pictures are its members, so the
    // words are walked into with dots — `ember.dots.force` — the way member
    // completion works everywhere else. Spaces are still split on, because a
    // sentence that used to work should not start failing, but the dots are
    // what the completion offers and what the shape actually is.
    const tokens = input.toLowerCase().split(/[.\s]+/).filter(Boolean)
    if (tokens.length === 0) return null

    let reach: Reach = 'none'
    const rest: string[] = []
    for (const tok of tokens) {
      if (tok === 'force') { reach = 'layer'; continue }
      if (tok === 'force-global') { reach = 'global'; continue }
      // `force.global` is the shape the dot syntax INVITES — force is an
      // object and global is how far it reaches — and it used to parse as
      // "force this layer, with a picture called global", which no theme has,
      // so the whole command bailed with a message about a missing picture
      // and the hive was never re-dressed. The reach is a word after `force`;
      // the hyphenated spelling stays because it is what completion offers.
      if (tok === 'global' && reach === 'layer') { reach = 'global'; continue }
      rest.push(tok)
    }
    const [name, item] = rest

    const canvas = get('@diamondcoreprocessor.com/CanvasBackground') as CanvasBackgroundService | undefined
    if (name === 'off') {
      canvas?.set('off')
      this.#active = 'off'
      this.#activeItem = null
      this.#persist()
      this.dispatchEvent(new CustomEvent('change'))
      return 'background off — bare surface'
    }

    const theme = name ? this.theme(name) : undefined
    if (!theme) return null
    if (item && reach === 'global') {
      return `"${item}" is one picture — it can dress this layer, but not the whole hive. Drop force-global, or drop the picture.`
    }

    const dressed: string[] = []
    if (theme.screen && canvas) {
      canvas.set(`${theme.screen.palette} ${theme.screen.archetype}`)
      dressed.push('screen')
    }

    // The chrome goes on BEFORE the screen settles rather than after: the
    // canvas re-reads its own palette off `theme:changed`, so setting the
    // chrome second would repaint a backdrop this theme had just chosen. The
    // pinned palette above wins either way — this only keeps the panels from
    // arguing with it.
    if (theme.chrome) {
      const chrome = get(THEME_IOC_KEY) as ThemeProvider | undefined
      if (chrome) { chrome.setTheme(theme.chrome); dressed.push('chrome') }
    }

    let tail = ''
    const substrate = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateLike | undefined
    if (theme.tiles && substrate) {
      await substrate.ensureLoaded()
      // A theme naming a source that isn't registered dresses what it can
      // rather than failing the whole change.
      if (substrate.listSources().some(s => s.id === theme.tiles)) {
        await substrate.setActive(theme.tiles)
        await substrate.warmUp()
        dressed.push('tiles')

        if (item) {
          const pinned = substrate.pinImage(item)
          if (!pinned) {
            substrate.unpinImages()
            return `${theme.label} has no picture called "${item}" — try /background ${theme.id} items`
          }
          tail = ` · ${pinned.name} on every tile`
          this.#activeItem = pinned.name
        } else {
          substrate.unpinImages()
          this.#activeItem = null
        }

        if (reach !== 'none') {
          // No signature set is passed: the substrate is the authority on what
          // is a default — its ledger, its live pool, and the `substrate: true`
          // mark in the props record itself, which is what recognises a picture
          // placed before the ledger existed. A picture placed by ANY earlier
          // theme is replaced; a picture the participant put there is not, no
          // matter which theme is arriving.
          //
          // Global goes through restyleEverywhere, NOT restyle(allLabels()):
          // index entries are keyed by full lineage, so a flat list of names
          // re-dressed against the current location misses every other page.
          const redressed = reach === 'global'
            ? await substrate.restyleEverywhere()
            : await substrate.restyle(await this.#layerLabels())
          for (const cell of redressed) EffectBus.emit('substrate:rerolled', { cell })
          tail += ` · ${redressed.length} tile${redressed.length === 1 ? '' : 's'} re-dressed${reach === 'global' ? ' hive-wide' : ''}`
        }
      }
    }

    this.#active = theme.id
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('background:theme', { id: theme.id })
    return dressed.length
      ? `background → ${theme.label} (${dressed.join(' + ')})${tail}`
      : `background → ${theme.label}${tail}`
  }

  /** Read a theme's pictures for visual choosers without activating it. */
  async choices(id: string): Promise<{ name: string; imageSig: string }[]> {
    const theme = this.theme(id)
    const substrate = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateLike | undefined
    if (!theme?.tiles || !substrate) return []
    await substrate.ensureLoaded()
    if (substrate.activeSource?.id === theme.tiles) {
      return substrate.listImages().map(({ name, imageSig }) => ({ name, imageSig }))
    }
    return await substrate.previewSourceImages?.(theme.tiles) ?? []
  }

  /** The pictures in a theme's group, by name. Empty until the group is the
   *  active one — a pool is only warmed when it is in use. */
  items(id: string): string[] {
    const theme = this.theme(id)
    const substrate = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateLike | undefined
    if (!theme?.tiles || !substrate) return []
    if (substrate.activeSource?.id !== theme.tiles) return []
    return substrate.listImages().map(i => i.name)
  }

  /** The tiles on the layer the participant is looking at. */
  async #layerLabels(): Promise<string[]> {
    const show = get('@diamondcoreprocessor.com/ShowCellDrone') as
      { renderedCells?: Map<string, unknown> } | undefined
    return [...(show?.renderedCells?.keys() ?? [])]
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
