// presentation/background/canvas-background.service.ts
//
// CanvasBackgroundService — the screen backdrop the whole hive sits on.
//
// The Pixi canvas is transparent (backgroundAlpha:0), so whatever paints on
// <body> shows BEHIND the tiles. This service paints a chosen themed backdrop
// there: screen-fixed (it never pans or zooms with the grid), theme-aware
// (palette follows the colour theme unless one is pinned), and participant-
// local (persisted to localStorage, NEVER the layer — same rule as theme,
// locale, viewport, clipboard).
//
// The PATTERNED backdrops are drawn entirely with CSS (gradients + one tiny
// inline-SVG tile for honeycomb) — no image files. That makes them resolution-
// independent and ALWAYS cover the full viewport in both landscape AND
// portrait, with no cropping margins, no seams, and no banding.
//
// A PICTURE IS THE OTHER HALF. The participant can put their own image behind
// the hive, and it is held the way every other piece of content is held: the
// preference stores a SIGNATURE, the bytes stay at the content root, and the
// object URL is a session handle on them. Nothing is copied into localStorage
// and nothing is written to a layer — a peer opening the same hive sees their
// own screen, exactly as with the colour theme.
//
// A picture STANDS IN FOR the pattern rather than sitting under it: contour
// rings over a photograph are two backdrops fighting. While one is showing,
// the lattice layer is told there is nothing to draw and the palette survives
// as the wash the picture is read through.
//
// Default: contour (steel on dark, daylight on light), no picture.

import { EffectBus } from '@hypercomb/core'
import { isPublishedVisitorShell } from '../../sharing/behavior-enablement.js'

const STORAGE_KEY = 'hc:canvas-bg'

export const CANVAS_BG_ARCHETYPES = ['depth', 'honeycomb', 'sheen', 'mesh', 'dots', 'contour', 'grid'] as const
export const CANVAS_BG_PALETTES = ['steel', 'daylight', 'indigo', 'teal', 'ember', 'honey', 'bloom', 'sherbet'] as const

type Archetype = typeof CANVAS_BG_ARCHETYPES[number]
type Palette = typeof CANVAS_BG_PALETTES[number]
type ScreenRecord = {
  picture: string; dim: number; zoom: number; panX: number; panY: number
  cascade: boolean
}

/** The two worlds a saved backdrop can be sorted into — the same split the
 *  looks already live by. */
export type BackdropWorld = 'light' | 'dark'

const SIG_RE = /^[0-9a-f]{64}$/

// A token is an archetype only if it IS one. There are deliberately no built-in
// synonyms: a second word for a thing that already has a word is confusion the
// participant did not ask for, and it makes the vocabulary something you have to
// learn rather than read. Aliases are the participant's to mint, never ours.
const archetypeOf = (token: string): Archetype | null =>
  CANVAS_BG_ARCHETYPES.includes(token as Archetype) ? token as Archetype : null

const DEFAULT_ARCHETYPE: Archetype = 'contour'

// The picture arrives exactly as chosen: full opacity, no wash. Washing it
// toward the palette is an adjustment the participant reaches for (the
// window's Opacity slider, `screen.opacity` on the line), never a levy taken
// up front.
const DEFAULT_DIM = 0

// WAITING FOR THE STORE, NOT TIMING IT. This service is constructed at module
// load, long before the shell has built a Store or opened OPFS, so everything
// it reads has to wait for that. It used to wait on a fixed eight-second
// ladder — and on a large hive the ladder ran out BEFORE the store settled,
// the picture never resolved, and the screen quietly fell back to a pattern
// with the preference still naming it. That is the "I keep losing my
// background" bug: nothing was lost, it was given up on.
//
// Now the wait is exact. Registration is polled (a service locator cannot
// announce a registration that already happened), and readiness is the
// store's OWN initialize promise — idempotent, and the same promise the shell
// is already awaiting.
const STORE_POLL_MS = 100
const STORE_POLL_TRIES = 300

// Retries AFTER the store is settled. A miss there is close to a real miss,
// but a legacy drain can still be relocating content off the boot path, so
// ask three more times over five seconds before believing it.
const SETTLED_RETRIES = [250, 1000, 4000] as const

// One pan drag is hundreds of persists. The pref takes them all (localStorage
// is free); the pool takes one, trailing.
const SCREEN_WRITE_DEBOUNCE = 400

// The store, structurally. This service is presentation and has no business
// importing the shell's Store — it names exactly the methods it needs.
// Resources are addressed by signature; nothing here knows a path.
const STORE_KEY = '@hypercomb.social/Store'
type StoreHandle = {
  /** Idempotent: hands back the SAME promise the shell is already awaiting,
   *  so asking for it is a wait rather than a second initialization. */
  initialize?(): Promise<void>
  getResource(sig: string): Promise<Blob | null>
  putResource?(blob: Blob): Promise<string>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
  putPoolDoc?(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string): Promise<string | null>
  getPoolDoc?(pool: FileSystemDirectoryHandle | undefined, subKey?: string): Promise<ArrayBuffer | null>
}

// THE SHELVES LIVE IN A POOL OF MEANING, not in the preference. The
// distinction: anything that should be queryable across the network belongs
// in a pool — a sorted backdrop collection is exactly that kind of content —
// while which picture is showing, and how washed, stays a participant-local
// pref like theme and viewport. One content-addressed JSON doc
// ({ light: [sigs], dark: [sigs] }), the mobile-roots pattern. Colon meaning,
// as every NEW pool meaning must be — a location can never mint this address.
const SAVED_POOL_MEANING = 'backgrounds:saved'

// AND THE SCREEN ITSELF IS A POOL RECORD. What is showing stays a
// participant-local choice — but participant-local has never meant
// localStorage-only here (the viewport is participant-local and lives in a
// pool), and holding this one ONLY in localStorage had two real costs:
//
//   1. Nothing in the hive referenced the picture's bytes. A resource that no
//      marker and no pool member names is, to every collector in this system,
//      litter from an abandoned gesture — indistinguishable from a paste that
//      was escaped. A pool member naming the signature makes it reachable
//      content, which is what it always was.
//   2. The choice could not travel. A replicated hive, a second origin, a
//      browser that dropped its storage — each arrives with the picture
//      present in the store and no idea it was the backdrop.
//
// localStorage stays the instant read: the first paint cannot wait for OPFS.
// The pool is the durable half, and it fills the gap when the pref has
// nothing to say.
const SCREEN_POOL_MEANING = 'backgrounds:screen'

// Per-palette colours for the CSS backdrops. `accent`/`accent2`/`deep` are
// "r,g,b" triples so alpha can be tuned inline. Everything is rendered with CSS
// gradients (percentage-positioned, so they adapt to any aspect ratio) plus —
// for honeycomb only — a tiny inline-SVG pattern tile.
type Pal = { light: boolean; base: string; base2: string; deep: string; accent: string; accent2: string }
const PAL: Record<Palette, Pal> = {
  steel:    { light: false, base: '#0e161c', base2: '#15242f', deep: '5,8,12',      accent: '126,182,214', accent2: '31,79,118' },
  daylight: { light: true,  base: '#f4ecde', base2: '#fdf7ea', deep: '199,183,154', accent: '31,67,118',   accent2: '111,158,201' },
  indigo:   { light: false, base: '#0d1226', base2: '#161d3a', deep: '4,6,15',      accent: '123,139,224', accent2: '36,48,121' },
  teal:     { light: false, base: '#07201c', base2: '#0c2e28', deep: '2,15,12',     accent: '69,199,165',  accent2: '13,77,64' },
  ember:    { light: false, base: '#1a1410', base2: '#2a1d12', deep: '11,7,4',      accent: '211,164,122', accent2: '90,58,24' },
  // The three bright looks. `daylight` was the only light palette here, and it
  // is a beige office — these are the backdrops that go with the honey / bloom
  // / sherbet chrome, each carrying that theme's own primary as its accent so
  // the screen behind the hive and the panels over it are the same colour.
  honey:    { light: true,  base: '#fdf3dd', base2: '#fffaf0', deep: '196,160,86',  accent: '181,115,10',  accent2: '240,196,102' },
  bloom:    { light: true,  base: '#eefaf4', base2: '#fbfffd', deep: '150,190,175', accent: '13,122,95',   accent2: '224,86,63' },
  sherbet:  { light: true,  base: '#faf0fc', base2: '#fffdff', deep: '196,168,208', accent: '194,17,143',  accent2: '10,165,201' },
}

/** Is this palette a bright one? The one place that knows, so a look never has
 *  to be told twice which world it belongs to. */
export const paletteIsLight = (palette: string): boolean => PAL[palette as Palette]?.light === true

/** Is the chrome currently a bright look? Read from the `--md-is-light` token
 *  every value-set declares, falling back to the OS preference — a theme
 *  nobody here has heard of, including one a community module registered at
 *  runtime, still answers for itself. */
export const chromeIsLight = (): boolean => {
  try {
    const declared = getComputedStyle(document.documentElement).getPropertyValue('--md-is-light').trim()
    if (declared === '1') return true
    if (declared === '0') return false
  } catch { /* no computed style — fall through to the OS */ }
  try { return !!window.matchMedia?.('(prefers-color-scheme: light)')?.matches } catch { return false }
}

const glowC = (p: Pal, a: number) => (p.light ? `rgba(255,255,255,${a})` : `rgba(${p.accent},${a})`)
// Gentle, EVEN lighting — the glow is a faint top lift and the vignette stays
// transparent across most of the screen, only whispering at the far corners.
// This keeps the pattern visible edge-to-edge (no "centered spotlight" look).
const GLOW = (p: Pal) => `radial-gradient(135% 100% at 50% 0%, ${glowC(p, p.light ? 0.4 : 0.06)} 0%, transparent 66%)`
const VIG = (p: Pal, a = p.light ? 0.1 : 0.2) => `radial-gradient(150% 135% at 50% 50%, transparent 66%, rgba(${p.deep},${a}) 100%)`

// The lattice patterns (grid / dots / honeycomb) are NOT painted in CSS — they
// live in the Pixi zoom container (GridLinesDrone) so they pan and scale WITH
// the grid. For those archetypes CSS paints only the lighting; the pattern
// choice is broadcast to the lines layer via the `canvas:lines` effect.
const LINE_KINDS: ReadonlySet<string> = new Set(['grid', 'dots', 'honeycomb'])
const lineAlpha = (arch: string, light: boolean): number =>
  arch === 'grid' ? (light ? 0.14 : 0.11)
    : arch === 'dots' ? (light ? 0.13 : 0.18)
      : (light ? 0.11 : 0.16) // honeycomb

// Archetypes whose lighting is the top glow — for these the glow is rendered by
// the gently-breathing #hc-glow element (animated) instead of a static body
// gradient. Sheen/contour have their own bespoke lighting; mesh is the aurora.
const GLOW_ARCHETYPES: ReadonlySet<string> = new Set(['grid', 'dots', 'honeycomb', 'depth'])

type Css = { color: string; image: string; size: string; repeat: string; position: string }
const cssFor = (arch: string, p: Pal): Css => {
  const L = (imgs: string[], sizes: string[], reps: string[], pos: string[]): Css =>
    ({ color: p.base, image: imgs.join(', '), size: sizes.join(', '), repeat: reps.join(', '), position: pos.join(', ') })
  switch (arch) {
    case 'grid':
    case 'dots':
    case 'honeycomb':
      // Vignette only — the lattice is drawn in the zoom container
      // (GridLinesDrone) and the glow is the animated #hc-glow element.
      return L([VIG(p)], ['cover'], ['no-repeat'], ['center'])
    case 'sheen': {
      const band = `rgba(${p.accent},${p.light ? 0.06 : 0.11})`
      return L([VIG(p, p.light ? 0.1 : 0.2), `linear-gradient(135deg, transparent 32%, ${band} 50%, transparent 68%)`, `linear-gradient(135deg, ${p.base} 0%, ${p.base2} 100%)`],
        ['cover', 'cover', 'cover'], ['no-repeat', 'no-repeat', 'no-repeat'], ['center', 'center', 'center'])
    }
    case 'mesh':
      return p.light
        ? L([`radial-gradient(60% 60% at 20% 18%, rgba(204,224,242,0.55) 0%, transparent 70%)`, `radial-gradient(62% 62% at 82% 84%, rgba(243,220,192,0.6) 0%, transparent 70%)`, VIG(p, 0.1)],
            ['cover', 'cover', 'cover'], ['no-repeat', 'no-repeat', 'no-repeat'], ['center', 'center', 'center'])
        : L([`radial-gradient(55% 55% at 20% 16%, rgba(${p.accent},0.14) 0%, transparent 70%)`, `radial-gradient(62% 62% at 84% 82%, rgba(${p.accent2},0.42) 0%, transparent 70%)`, `radial-gradient(46% 46% at 60% 28%, rgba(${p.accent},0.12) 0%, transparent 70%)`, VIG(p, 0.22)],
            ['cover', 'cover', 'cover', 'cover'], ['no-repeat', 'no-repeat', 'no-repeat', 'no-repeat'], ['center', 'center', 'center', 'center'])
    case 'contour': {
      const ring = `rgba(${p.accent},0.11)`
      return L([`radial-gradient(60% 60% at 50% 50%, ${glowC(p, p.light ? 0.45 : 0.06)} 0%, transparent 70%)`, `repeating-radial-gradient(circle at 50% 50%, transparent 0 39px, ${ring} 39px 40px)`, VIG(p)],
        ['cover', 'cover', 'cover'], ['no-repeat', 'no-repeat', 'no-repeat'], ['center', 'center', 'center'])
    }
    default: // depth
      return L([VIG(p, p.light ? 0.12 : 0.3)], ['cover'], ['no-repeat'], ['center'])
  }
}

// A tiny standalone rendering of a backdrop, sized for a dropdown chip rather
// than the viewport. The full backdrops split their look across three surfaces
// (body CSS, the animated #hc-glow / #hc-aurora elements, and the Pixi lattice
// in GridLinesDrone), so a swatch cannot simply reuse `cssFor` — it has to
// fold all three back into one `background` shorthand at chip scale.
//
// A swatch is a LEGIBLE MINIATURE, not a scale model. The live alphas (0.06 …
// 0.18) are tuned for a whole screen, where a whisper of a pattern is still
// thousands of pixels of it; in a 36×18 chip the same values are a flat dark
// rectangle and every option looks identical. So the chip keeps the archetype's
// SHAPE and its palette's colours, and pushes the contrast far enough that the
// difference between two options is visible at a glance. The pattern pitch is
// likewise fixed in chip pixels (4–5px, three to eight repeats across) rather
// than inherited from the live backdrop.
const swatchFor = (arch: string, p: Pal): string => {
  const a = (alpha: number) => (p.light ? `rgba(${p.accent2},${alpha})` : `rgba(${p.accent},${alpha})`)
  // base2 on top, base at the bottom — a visible ramp even with no pattern.
  const base = `linear-gradient(160deg, ${p.base2} 0%, ${p.base} 100%) ${p.base}`
  const lit = `radial-gradient(120% 120% at 50% -10%, ${glowC(p, p.light ? 0.65 : 0.42)} 0%, transparent 72%) 0 0/cover no-repeat`
  switch (arch) {
    case 'grid':
      return `${lit}, linear-gradient(${a(0.65)} 1px, transparent 1px) 0 0/5px 5px,
        linear-gradient(90deg, ${a(0.65)} 1px, transparent 1px) 0 0/5px 5px, ${base}`
    case 'dots':
      return `${lit}, radial-gradient(${a(0.95)} 1.2px, transparent 1.5px) 0 0/5px 5px, ${base}`
    case 'honeycomb':
      return `${lit}, repeating-linear-gradient(60deg, ${a(0.6)} 0 1px, transparent 1px 5px) 0 0/cover,
        repeating-linear-gradient(-60deg, ${a(0.6)} 0 1px, transparent 1px 5px) 0 0/cover,
        repeating-linear-gradient(0deg, ${a(0.6)} 0 1px, transparent 1px 5px) 0 0/cover, ${base}`
    case 'sheen':
      return `linear-gradient(115deg, transparent 22%, ${a(0.75)} 48%, transparent 74%) 0 0/cover no-repeat, ${base}`
    case 'mesh':
      return `radial-gradient(80% 90% at 20% 10%, ${a(0.9)} 0%, transparent 70%) 0 0/cover no-repeat,
        radial-gradient(85% 95% at 84% 90%, rgba(${p.accent2},${p.light ? 0.8 : 1}) 0%, transparent 70%) 0 0/cover no-repeat, ${base}`
    case 'contour':
      return `radial-gradient(60% 90% at 50% 50%, ${glowC(p, p.light ? 0.6 : 0.35)} 0%, transparent 74%) 0 0/cover no-repeat,
        repeating-radial-gradient(circle at 50% 50%, transparent 0 2px, ${a(0.7)} 2px 3px) 0 0/cover, ${base}`
    default: // depth — no pattern at all, so its identity IS the lit dome
      return `radial-gradient(110% 130% at 50% -20%, ${glowC(p, p.light ? 0.75 : 0.6)} 0%, transparent 78%) 0 0/cover no-repeat,
        radial-gradient(150% 130% at 50% 50%, transparent 40%, rgba(${p.deep},${p.light ? 0.35 : 0.9}) 100%) 0 0/cover no-repeat, ${base}`
  }
}

// Animated aurora backdrop — a few large, blurred, slowly-drifting blooms in a
// fixed screen layer behind the canvas. Pure transforms (GPU-composited, so the
// blur is rasterised once and only cheaply moved) and paused under
// prefers-reduced-motion. Bloom colours are set per palette at runtime.
const AURORA_CSS = `
#hc-aurora{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
#hc-aurora .blob{position:absolute;border-radius:50%;filter:blur(70px);will-change:transform}
#hc-aurora .b1{width:70vmax;height:70vmax;left:-15vmax;top:-18vmax}
#hc-aurora .b2{width:75vmax;height:75vmax;right:-18vmax;bottom:-20vmax}
#hc-aurora .b3{width:55vmax;height:55vmax;left:30vw;top:5vh}
#hc-aurora .vig{position:absolute;inset:0}
@media (prefers-reduced-motion: no-preference){
  #hc-aurora .b1{animation:hc-aur1 26s ease-in-out infinite alternate}
  #hc-aurora .b2{animation:hc-aur2 34s ease-in-out infinite alternate}
  #hc-aurora .b3{animation:hc-aur3 30s ease-in-out infinite alternate}
}
@keyframes hc-aur1{from{transform:translate(-6%,-4%) scale(1)}to{transform:translate(12%,9%) scale(1.25)}}
@keyframes hc-aur2{from{transform:translate(8%,6%) scale(1.1)}to{transform:translate(-10%,-7%) scale(0.92)}}
@keyframes hc-aur3{from{transform:translate(4%,-8%) scale(1)}to{transform:translate(-7%,11%) scale(1.2)}}
#hc-glow{position:fixed;inset:0;z-index:-1;pointer-events:none;will-change:opacity,transform}
@media (prefers-reduced-motion: no-preference){#hc-glow{animation:hc-glow-breathe 16s ease-in-out infinite alternate}}
@keyframes hc-glow-breathe{from{opacity:.65;transform:scale(1)}to{opacity:1;transform:scale(1.05)}}
`

export class CanvasBackgroundService extends EventTarget {
  #archetype: Archetype = DEFAULT_ARCHETYPE
  /** Pinned palette, or null to follow the colour theme. */
  #palette: Palette | null = null
  #enabled = true
  /** The picture behind the hive, as a SIGNATURE — the bytes live at the
   *  content root and are resolved on demand, never held in the preference. */
  #pictureSig: string | null = null
  /** A session handle on those bytes. Null until they resolve. */
  #pictureUrl: string | null = null
  /** How far the picture is washed toward the palette, 0..1. The ONE number
   *  this surface exposes: a photograph that a white tile label has to sit on
   *  needs a calm field, and how much is a matter of the picture. */
  #dim = DEFAULT_DIM
  /** Scale relative to a whole-picture (`contain`) fit. */
  #zoom = 1
  #panX = 0
  #panY = 0
  /** Intrinsic picture size, used to turn the contain fit into a zoomable
   *  pixel size without stretching portrait or landscape images. */
  #pictureSize: { width: number; height: number } | null = null
  /** Two-panel original + horizontally flipped copy, repeated along x. */
  #mirrorUrl: string | null = null
  /** The participant's saved backdrops, sorted by the world they suit. A
   *  picture says NOTHING by default — dragging it onto a shelf in the
   *  backgrounds window IS the sorting. Signatures only, never bytes. This is
   *  the in-memory copy of the `backgrounds:saved` pool doc. */
  #saved: Record<BackdropWorld, string[]> = { light: [], dark: [] }
  /** True when the localStorage pref still carried shelf entries — a legacy
   *  source to adopt into the pool once, then stop writing forever. */
  #prefCarriedSaved = false
  /** The boot read, as a promise — a pool write must never land before it. */
  #hydration: Promise<void> = Promise.resolve()
  #screenWrite: ReturnType<typeof setTimeout> | null = null
  #screenRecords: Record<string, ScreenRecord> = {}
  #screenSourceKey = '[]'
  #cascade = true
  #navigationEpoch = 0
  #auroraEl: HTMLDivElement | null = null
  #glowEl: HTMLDivElement | null = null
  #previewEl: HTMLDivElement | null = null
  #previewing = false

  constructor() {
    super()
    this.#restore()
    this.#hydration = this.#hydrate()
    void this.#hydration.then(() => this.#followLineage())
    // Re-apply when the colour theme flips so an auto palette tracks it.
    EffectBus.on('theme:changed', () => { if (!this.#palette) this.apply() })
    // matchMedia covers the 'system' theme (no data-theme attribute).
    try {
      window.matchMedia?.('(prefers-color-scheme: light)')
        ?.addEventListener?.('change', () => { if (!this.#palette) this.apply() })
    } catch { /* matchMedia unavailable */ }
    window.addEventListener('resize', () => { if (this.#pictureUrl) this.apply() })
    this.apply()
  }

  // ── public API (backs the /canvas queen) ──────────────────────────

  get archetype(): Archetype { return this.#archetype }
  get palette(): Palette | null { return this.#palette }
  get enabled(): boolean { return this.#enabled }
  get archetypes(): readonly string[] { return CANVAS_BG_ARCHETYPES }
  get palettes(): readonly string[] { return CANVAS_BG_PALETTES }
  /** The signature of the picture behind the hive, or null for a pattern. */
  get picture(): string | null { return this.#pictureSig }
  get dim(): number { return this.#dim }
  get zoom(): number { return this.#zoom }
  get panX(): number { return this.#panX }
  get panY(): number { return this.#panY }
  get cascade(): boolean { return this.#cascade }
  /** The saved backdrops, by world. Signature arrays — resolve on demand. */
  get saved(): Record<BackdropWorld, readonly string[]> {
    return { light: [...this.#saved.light], dark: [...this.#saved.dark] }
  }

  /** Which shelf holds this picture, or null — the honest default. */
  worldOf(sig: string): BackdropWorld | null {
    const clean = sig.trim().toLowerCase()
    if (this.#saved.light.includes(clean)) return 'light'
    if (this.#saved.dark.includes(clean)) return 'dark'
    return null
  }

  /** Put a picture on the light or dark shelf. Saving is a SORT, not a copy:
   *  one signature lives on at most one shelf, so dropping a picture that is
   *  already saved onto the other shelf moves it there. */
  savePicture(sig: string, world: BackdropWorld): boolean {
    const clean = sig.trim().toLowerCase()
    if (!SIG_RE.test(clean) || (world !== 'light' && world !== 'dark')) return false
    if (this.#saved[world].includes(clean)) return true
    this.#saved.light = this.#saved.light.filter(s => s !== clean)
    this.#saved.dark = this.#saved.dark.filter(s => s !== clean)
    this.#saved[world].push(clean)
    this.#writeSaved()
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }

  /** Take a picture off whichever shelf holds it. The bytes are content and
   *  are left alone — something else may well be pointing at them. */
  unsavePicture(sig: string): void {
    const clean = sig.trim().toLowerCase()
    if (!this.#saved.light.includes(clean) && !this.#saved.dark.includes(clean)) return
    this.#saved.light = this.#saved.light.filter(s => s !== clean)
    this.#saved.dark = this.#saved.dark.filter(s => s !== clean)
    this.#writeSaved()
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Hydrate the shelves from their pool of meaning. The pref briefly carried
   *  them; anything still found there is adopted into the pool ONCE and the
   *  pref stops carrying it — reads union the legacy source, writes never
   *  target it. */
  async #loadSaved(store: StoreHandle): Promise<void> {
    for (const wait of SETTLED_RETRIES) {
      if (store.getPool && store.getPoolDoc) {
        try {
          // A null pool would mean the store answered before OPFS was open.
          // It is settled by the time this runs, so this is belt and braces
          // rather than the boot trap it used to be.
          const pool = await store.getPool(SAVED_POOL_MEANING)
          if (!pool) throw new Error('store not settled')
          const buf = await store.getPoolDoc(pool)
          const shelf = (list: unknown): string[] =>
            Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s)) : []
          let doc: Record<BackdropWorld, string[]> = { light: [], dark: [] }
          if (buf) {
            try {
              const parsed = JSON.parse(new TextDecoder().decode(buf)) as { light?: unknown; dark?: unknown }
              doc = { light: shelf(parsed.light), dark: shelf(parsed.dark) }
            } catch { /* corrupt doc — rebuilt whole on the next write */ }
          }
          // Union: the doc is the truth; anything sorted in memory meanwhile
          // (a legacy pref entry, a drag that beat the ladder) lands as a
          // MOVE on top of it, because the hand is newer than the doc.
          const merged: Record<BackdropWorld, string[]> = { light: [...doc.light], dark: [...doc.dark] }
          for (const world of ['light', 'dark'] as const) {
            for (const sig of this.#saved[world]) {
              merged.light = merged.light.filter(s => s !== sig)
              merged.dark = merged.dark.filter(s => s !== sig)
              merged[world].push(sig)
            }
          }
          const changed = JSON.stringify(merged) !== JSON.stringify(doc)
          this.#saved = merged
          if (changed && (buf || merged.light.length + merged.dark.length > 0)) this.#writeSaved()
          if (this.#prefCarriedSaved) { this.#prefCarriedSaved = false; this.#persist() }
          this.dispatchEvent(new CustomEvent('change'))
          return
        } catch { /* not settled after all — ask again */ }
      }
      await new Promise(resolve => setTimeout(resolve, wait))
    }
  }

  /** Write the whole shelf state as the pool's one content-addressed doc.
   *  Whole-state every time, so a write the store was not ready for is healed
   *  by the next one rather than leaving a partial record. */
  #writeSaved(): void {
    void (async () => {
      const store = await this.#storeReady()
      if (!store?.getPool || !store.putPoolDoc) return
      try {
        const pool = await store.getPool(SAVED_POOL_MEANING)
        if (!pool) return
        const bytes = new TextEncoder().encode(JSON.stringify(this.#saved)).buffer as ArrayBuffer
        await store.putPoolDoc(pool, bytes)
      } catch { /* not ready — the next whole-state write covers this one */ }
    })()
  }

  /**
   * Put a picture behind the hive. `sig` NAMES a resource at the content root:
   * the bytes are pointed at, never copied, so the same picture on a tile, in
   * the references pool and behind the hive is one set of bytes with three
   * references. Answers false when nothing resolves — a signature that names
   * nothing is not a picture, and failing loudly here beats a blank screen.
   */
  async setPicture(sig: string): Promise<boolean> {
    const clean = sig.trim().toLowerCase()
    if (!clean) return false
    const blob = await this.#readResource(clean)
    if (!blob) return false
    this.#revokePicture()
    this.#pictureSig = clean
    this.#screenSourceKey = this.#currentPathKey()
    this.#cascade = true
    this.#pictureUrl = URL.createObjectURL(blob)
    this.#measurePicture()
    this.#enabled = true
    this.#persist()
    this.apply()
    return true
  }

  /** Adopt bytes the participant brought in — a file, a paste, a drop. They
   *  become a signed resource FIRST, because a picture behind the hive is
   *  content like any other: deduplicated, shareable, and addressable. */
  async adoptPicture(blob: Blob): Promise<string | null> {
    const store = this.#store()
    if (!store?.putResource) return null
    try {
      const sig = await store.putResource(blob)
      return (await this.setPicture(sig)) ? sig : null
    } catch { return null }
  }

  /** Back to the pattern. The bytes are left alone — they are content, and
   *  something else may well be pointing at them. */
  clearPicture(): void {
    if (!this.#pictureSig && !this.#pictureUrl) return
    delete this.#screenRecords[this.#screenSourceKey]
    this.#revokePicture()
    this.#pictureSig = null
    this.#persist()
    void this.#resolveScreenForCurrentPath()
  }

  /** How far the picture is washed toward the palette, 0..1. */
  setDim(value: number): void {
    const next = Math.min(1, Math.max(0, Number.isFinite(value) ? value : DEFAULT_DIM))
    if (next === this.#dim) return
    this.#dim = next
    this.#persist()
    this.apply()
  }

  /** Scale the backdrop relative to its whole-picture fit. */
  setZoom(value: number): void {
    const next = Math.min(4, Math.max(0.5, Number.isFinite(value) ? value : 1))
    const rounded = Math.round(next * 20) / 20
    if (rounded === this.#zoom) return
    this.#zoom = rounded
    this.#persist()
    this.apply()
  }

  /** Offset the picture from viewport centre. Readability layers stay fixed. */
  setPan(x: number, y: number): void {
    const nextX = Number.isFinite(x) ? Math.round(x) : 0
    const nextY = Number.isFinite(y) ? Math.round(y) : 0
    if (nextX === this.#panX && nextY === this.#panY) return
    this.#panX = nextX
    this.#panY = nextY
    this.#persist()
    this.apply()
  }

  setCascade(value: boolean): void {
    if (value === this.#cascade) return
    this.#cascade = value
    this.#persist()
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Show the backdrop above the hive while it is being framed. */
  setPreview(active: boolean): void {
    this.#previewing = active
    this.#syncPreview()
  }

  /** The picture at chip scale, for a dropdown or a card. Empty when none. */
  pictureSwatch(): string {
    return this.#pictureUrl ? `center/cover no-repeat url("${this.#pictureUrl}")` : ''
  }

  /** Resolve which palette is actually showing (pinned, else theme-derived). */
  /** The palette actually showing: the pinned one, else the one that goes with
   *  the chrome's brightness. The bright side answers `honey` because that is
   *  what the shell now opens as — an unpinned backdrop should be lit by the
   *  same colour as the panels over it, not by the beige `daylight` that used
   *  to be the only light option. */
  resolvedPalette(): Palette { return this.#palette ?? (this.#isLight() ? 'honey' : 'steel') }

  /**
   * Apply one or more space-separated tokens: an archetype (depth, honeycomb,
   * sheen, mesh, dots, contour, grid), a palette (steel, daylight, indigo,
   * teal, ember), or `off`/`on`. Each word means exactly itself — there are no
   * synonyms. Unknown tokens are ignored. Returns a short
   * status describing the new state, or null when nothing matched.
   */
  set(input: string): string | null {
    const tokens = input.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return null
    let matched = false
    for (const tok of tokens) {
      if (tok === 'off') { this.#enabled = false; matched = true; continue }
      if (tok === 'on') { this.#enabled = true; matched = true; continue }
      const arch = archetypeOf(tok)
      if (arch) { this.#archetype = arch; this.#enabled = true; matched = true; continue }
      if (tok === 'auto') { this.#palette = null; matched = true; continue }
      if (CANVAS_BG_PALETTES.includes(tok as Palette)) { this.#palette = tok as Palette; matched = true; continue }
    }
    if (!matched) return null
    this.#persist()
    this.apply()
    return this.status()
  }

  /**
   * A CSS `background` shorthand previewing what the given tokens WOULD look
   * like, without applying anything. Accepts exactly what `set()` accepts — an
   * archetype, a palette, `auto`, or a pair ("indigo dots") — and fills the
   * unspecified half from what is showing now, so `/canvas indigo` previews
   * indigo in the current archetype and `/canvas dots` previews dots in the
   * current palette. Returns '' for `off` and for tokens that mean nothing.
   * Backs the swatches in the command-line autocomplete.
   */
  swatch(input: string): string {
    const tokens = input.toLowerCase().split(/\s+/).filter(Boolean)
    let arch: Archetype = this.#archetype
    let pal: Palette = this.resolvedPalette()
    let known = false
    for (const tok of tokens) {
      if (tok === 'off') return ''
      const a = archetypeOf(tok)
      if (a) { arch = a; known = true; continue }
      if (tok === 'auto') { pal = this.#isLight() ? 'honey' : 'steel'; known = true; continue }
      if (CANVAS_BG_PALETTES.includes(tok as Palette)) { pal = tok as Palette; known = true; continue }
    }
    return known ? swatchFor(arch, PAL[pal]) : ''
  }

  status(): string {
    if (!this.#enabled) return 'canvas background off'
    if (this.#pictureSig) {
      const held = this.#pictureUrl ? '' : ' (resolving)'
      // Said as OPACITY — the way round people ask for it. 100% is the picture
      // exactly as chosen; anything less is the wash toward the palette.
      return `screen → picture ${this.#pictureSig.slice(0, 8)}${held}, opacity ${100 - Math.round(this.#dim * 100)}%, zoom ${Math.round(this.#zoom * 100)}%`
    }
    return `screen → ${this.#archetype} (${this.resolvedPalette()})`
  }

  // ── application ────────────────────────────────────────────────────

  /** Paint (or clear) the chosen backdrop on <body>, screen-fixed. All CSS:
   *  gradients fill the viewport and patterns repeat, so it always covers the
   *  whole screen in any orientation — no image files, no cropping, no seams. */
  apply(): void {
    // A published site's look belongs to the creation, not the shell: this
    // backdrop is participant-local appearance with no source of truth on a
    // visitor origin, so it must not paint over what the creation supplies.
    if (isPublishedVisitorShell()) return
    const body = document.body
    if (!body) return
    const s = body.style
    s.backgroundColor = ''
    s.backgroundImage = ''
    s.backgroundRepeat = ''
    s.backgroundSize = ''
    s.backgroundPosition = ''
    s.backgroundAttachment = ''
    // Also hides a framing preview immediately when the picture was cleared.
    if (!this.#pictureUrl) this.#syncPreview()
    if (!this.#enabled) {
      this.#hideAurora()
      this.#hideGlow()
      EffectBus.emit('canvas:lines', { kind: null, accent: '', alpha: 0 })
      this.dispatchEvent(new CustomEvent('change'))
      this.#syncPreview()
      return
    }

    const p = PAL[this.resolvedPalette()]

    // A PICTURE STANDS IN FOR THE PATTERN. Contour rings or a dot lattice over
    // a photograph is two backdrops fighting for the same screen, so while a
    // picture is showing the patterned half steps aside whole: the body carries
    // only the base colour, the lattice layer is told there is nothing to draw,
    // and the palette survives as the wash the picture is read through.
    if (this.#pictureUrl) {
      // Painted as BODY LAYERS, the way every other backdrop here is painted.
      // It was briefly its own fixed element so the blur could be live, and
      // that element measured 0×0 on the shell's real page — a fixed box whose
      // containing block is not the viewport is a whole class of bug this file
      // had already avoided by never leaving the body in the first place.
      // AT FULL OPACITY THE PICTURE IS EXACTLY THE PICTURE. Both readability
      // layers — the wash AND the vignette — ride the one number, so 100%
      // means the bytes as chosen with nothing of ours painted over them. A
      // dark wallpaper under a bright chrome used to come out milky grey (a
      // white wash at half strength plus a standing vignette), which read as
      // "the image is over the tiles" when it was only ever being tinted.
      // `fixed` attachment so it stays put while the hive pans.
      const layers: string[] = []
      if (this.#dim > 0) {
        const wash = p.light ? `rgba(255,255,255,${this.#dim})` : `rgba(${p.deep},${this.#dim})`
        layers.push(VIG(p, (p.light ? 0.16 : 0.34) * this.#dim))
        layers.push(`linear-gradient(${wash}, ${wash})`)
      }
      layers.push(`url("${this.#mirrorUrl ?? this.#pictureUrl}")`)
      s.backgroundColor = p.base
      s.backgroundImage = layers.join(', ')
      // Readability gradients stay full-screen; only the final picture layer
      // is zoomed. At 100%, this is the same whole-picture `contain` fit.
      const overlaySizes = layers.slice(0, -1).map(() => 'cover')
      s.backgroundSize = [...overlaySizes, this.#pictureBackgroundSize()].join(', ')
      s.backgroundRepeat = [
        ...layers.slice(0, -1).map(() => 'no-repeat'),
        this.#mirrorUrl ? 'repeat-x' : 'no-repeat',
      ].join(', ')
      const overlayPositions = layers.slice(0, -1).map(() => 'center')
      s.backgroundPosition = [
        ...overlayPositions,
        this.#pictureBackgroundPosition(),
      ].join(', ')
      s.backgroundAttachment = 'fixed'
      this.#syncPreview()
      this.#hideAurora()
      this.#hideGlow()
      EffectBus.emit('canvas:lines', { kind: null, accent: '', alpha: 0 })
      this.dispatchEvent(new CustomEvent('change'))
      return
    }

    // Aurora mesh is ANIMATED — a drifting-bloom screen layer rather than a
    // static gradient. Render it in its own element; the body just carries the
    // base colour behind it. No content-space lines.
    if (this.#archetype === 'mesh') {
      s.backgroundColor = p.base
      this.#showAurora(p)
      this.#hideGlow()
      EffectBus.emit('canvas:lines', { kind: null, accent: '', alpha: 0 })
      this.dispatchEvent(new CustomEvent('change'))
      return
    }
    this.#hideAurora()

    // For glow-lit archetypes the glow is the gently-breathing #hc-glow element;
    // others (sheen, contour) keep their bespoke lighting baked in the body CSS.
    if (GLOW_ARCHETYPES.has(this.#archetype)) this.#showGlow(p)
    else this.#hideGlow()

    const css = cssFor(this.#archetype, p)
    s.backgroundColor = css.color
    s.backgroundImage = css.image
    s.backgroundSize = css.size
    s.backgroundRepeat = css.repeat
    s.backgroundPosition = css.position
    s.backgroundAttachment = 'fixed'

    // Hand the lattice pattern to the content-space lines layer (GridLinesDrone),
    // which draws it in the zoom container so it pans + scales with the grid.
    // Gradient-only archetypes (depth/sheen/mesh/contour) send `kind: null`.
    const kind = LINE_KINDS.has(this.#archetype) ? this.#archetype : null
    EffectBus.emit('canvas:lines', kind
      ? { kind, accent: p.accent, alpha: lineAlpha(this.#archetype, p.light) }
      : { kind: null, accent: '', alpha: 0 })

    this.dispatchEvent(new CustomEvent('change'))
  }

  #syncPreview(): void {
    if (!this.#previewing || !this.#pictureUrl) {
      if (this.#previewEl) this.#previewEl.style.display = 'none'
      return
    }
    let el = this.#previewEl
    if (!el) {
      el = document.createElement('div')
      el.id = 'hc-background-position-preview'
      Object.assign(el.style, {
        position: 'fixed', inset: '0', zIndex: '100001', pointerEvents: 'none',
        opacity: '0.46', display: 'block',
      })
      document.body.appendChild(el)
      this.#previewEl = el
    }
    el.style.display = 'block'
    el.style.backgroundImage = `url("${this.#mirrorUrl ?? this.#pictureUrl}")`
    el.style.backgroundSize = this.#pictureBackgroundSize()
    el.style.backgroundRepeat = this.#mirrorUrl ? 'repeat-x' : 'no-repeat'
    el.style.backgroundPosition = this.#pictureBackgroundPosition()
  }

  // ── animated aurora ─────────────────────────────────────────────────

  /** Inject the shared FX keyframe stylesheet once (aurora + breathing glow). */
  #ensureFxStyle(): void {
    if (document.getElementById('hc-canvas-fx-style')) return
    const style = document.createElement('style')
    style.id = 'hc-canvas-fx-style'
    style.textContent = AURORA_CSS
    document.head.appendChild(style)
  }

  /** Create the fixed aurora element once. */
  #ensureAurora(): HTMLDivElement {
    if (this.#auroraEl) return this.#auroraEl
    this.#ensureFxStyle()
    const el = document.createElement('div')
    el.id = 'hc-aurora'
    el.innerHTML = '<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="vig"></div>'
    document.body.appendChild(el)
    this.#auroraEl = el
    return el
  }

  /** Create the fixed breathing-glow element once. */
  #ensureGlow(): HTMLDivElement {
    if (this.#glowEl) return this.#glowEl
    this.#ensureFxStyle()
    const el = document.createElement('div')
    el.id = 'hc-glow'
    document.body.appendChild(el)
    this.#glowEl = el
    return el
  }

  /** Colour + reveal the gently-breathing top glow for the given palette.
   *  Reuses the GLOW gradient builder so static + animated glow match. */
  #showGlow(p: Pal): void {
    const el = this.#ensureGlow()
    el.style.display = 'block'
    el.style.background = GLOW(p)
  }

  #hideGlow(): void {
    if (this.#glowEl) this.#glowEl.style.display = 'none'
  }

  /** Colour + reveal the aurora for the given palette. Dark palettes glow
   *  additively (screen); light tints gently (multiply). */
  #showAurora(p: Pal): void {
    const el = this.#ensureAurora()
    el.style.display = 'block'
    el.style.backgroundColor = p.base
    const blend = p.light ? 'multiply' : 'screen'
    const cols = p.light
      ? ['rgba(204,224,242,0.7)', 'rgba(243,220,192,0.7)', 'rgba(214,226,242,0.6)']
      : [`rgba(${p.accent},0.45)`, `rgba(${p.accent2},0.6)`, `rgba(${p.accent},0.35)`]
    el.querySelectorAll('.blob').forEach((b, i) => {
      const d = b as HTMLDivElement
      d.style.background = `radial-gradient(circle, ${cols[i]} 0%, transparent 70%)`
      d.style.mixBlendMode = blend
    })
    const vig = el.querySelector('.vig') as HTMLDivElement | null
    if (vig) vig.style.background = `radial-gradient(140% 120% at 50% 50%, transparent 58%, rgba(${p.deep},${p.light ? 0.12 : 0.42}) 100%)`
  }

  #hideAurora(): void {
    if (this.#auroraEl) this.#auroraEl.style.display = 'none'
  }

  // ── the participant's own picture ───────────────────────────────────

  /** Drop the session handle. The BYTES are content and are never touched —
   *  a tile, the references pool or a peer may well be pointing at them. */
  #revokePicture(): void {
    if (!this.#pictureUrl) return
    try { URL.revokeObjectURL(this.#pictureUrl) } catch { /* already gone */ }
    this.#pictureUrl = null
    if (this.#mirrorUrl) {
      try { URL.revokeObjectURL(this.#mirrorUrl) } catch { /* already gone */ }
      this.#mirrorUrl = null
    }
    this.#pictureSize = null
  }

  #measurePicture(): void {
    const url = this.#pictureUrl
    this.#pictureSize = null
    if (!url) return
    const image = new Image()
    image.onload = () => {
      if (this.#pictureUrl !== url) return
      this.#pictureSize = { width: image.naturalWidth, height: image.naturalHeight }
      this.apply()
      void this.#buildMirrorStrip(image, url)
    }
    image.src = url
  }

  #pictureBackgroundSize(): string {
    const metrics = this.#pictureMetrics()
    if (!metrics) return 'contain'
    return `${Math.round(metrics.width * (this.#mirrorUrl ? 2 : 1))}px ${Math.round(metrics.height)}px`
  }

  #pictureBackgroundPosition(): string {
    const metrics = this.#pictureMetrics()
    if (!metrics || !this.#mirrorUrl) {
      return `calc(50% + ${this.#panX}px) calc(50% + ${this.#panY}px)`
    }
    // The strip is [original][mirror]. Place the original itself at centre;
    // repeat-x then supplies a mirrored neighbour from both of its edges.
    const left = Math.round((window.innerWidth - metrics.width) / 2 + this.#panX)
    return `${left}px calc(50% + ${this.#panY}px)`
  }

  #pictureMetrics(): { width: number; height: number } | null {
    const size = this.#pictureSize
    if (!size) return null
    const fit = Math.min(window.innerWidth / size.width, window.innerHeight / size.height)
    return { width: size.width * fit * this.#zoom, height: size.height * fit * this.#zoom }
  }

  async #buildMirrorStrip(image: HTMLImageElement, sourceUrl: string): Promise<void> {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth * 2
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(image, 0, 0)
    context.save()
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
    context.drawImage(image, 0, 0)
    context.restore()
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob || this.#pictureUrl !== sourceUrl) return
    if (this.#mirrorUrl) URL.revokeObjectURL(this.#mirrorUrl)
    this.#mirrorUrl = URL.createObjectURL(blob)
    this.apply()
  }

  /** Resolve the stored signature's bytes at boot. The signature is the truth
   *  and survives a reload; the object URL never does. The store is SETTLED
   *  before this runs — see #storeReady — so a miss here is about the bytes,
   *  not about the timing. */
  async #loadPicture(): Promise<void> {
    const sig = this.#pictureSig
    if (!sig) return
    for (const wait of SETTLED_RETRIES) {
      // A newer choice landed while this one was resolving — that one wins.
      if (this.#pictureSig !== sig) return
      const blob = await this.#readResource(sig)
      if (blob) {
        if (this.#pictureSig !== sig) return
        this.#revokePicture()
        this.#pictureUrl = URL.createObjectURL(blob)
        this.#measurePicture()
        this.apply()
        return
      }
      await new Promise(resolve => setTimeout(resolve, wait))
    }
    // THE SIGNATURE IS KEPT. The preference is not wrong — the bytes are
    // missing — and clearing it would turn an absence a replication or a
    // drain can still heal into a choice the participant has to make again.
    console.warn(`[canvas-bg] picture ${sig.slice(0, 12)}… names no bytes in this hive — the backdrop is showing its pattern`)
  }

  /** The store, once it exists. */
  #store(): StoreHandle | undefined {
    return (window as { ioc?: { get?(key: string): unknown } }).ioc?.get?.(STORE_KEY) as StoreHandle | undefined
  }

  /** The store, REGISTERED AND SETTLED. Polls IoC for the registration (a
   *  promise parked on `whenReady` never settles when the registration it is
   *  waiting for has already happened), then awaits the store's own
   *  idempotent initialize. Null only if no Store ever appears at all. */
  async #storeReady(): Promise<StoreHandle | null> {
    for (let attempt = 0; attempt < STORE_POLL_TRIES; attempt++) {
      const store = this.#store()
      if (store) {
        try { await store.initialize?.() } catch { /* a wedged OPFS answers null; that is an answer */ }
        return store
      }
      await new Promise(resolve => setTimeout(resolve, STORE_POLL_MS))
    }
    return null
  }

  /** Everything this service needs from the store, in the one order that
   *  works: settle, adopt the record, resolve the bytes, hydrate the shelves. */
  async #hydrate(): Promise<void> {
    const store = await this.#storeReady()
    if (!store) return
    await this.#loadScreen(store)
    await this.#loadPicture()
    await this.#loadSaved(store)
  }

  /** Read the screen record out of its pool of meaning.
   *
   *  The local pref is this origin's own hand and is rewritten on every
   *  change, so it WINS whenever it names a picture. The pool speaks for a
   *  hive that arrived carrying one — replicated, opened on a second origin,
   *  reopened after the browser dropped its storage — and fills the gap
   *  rather than overruling anything. */
  async #loadScreen(store: StoreHandle): Promise<void> {
    if (!store.getPool || !store.getPoolDoc) return
    // A pref that already names a picture, or that says the backdrop is off,
    // is an answer — the pool only speaks where nothing local does.
    try {
      const pool = await store.getPool(SCREEN_POOL_MEANING)
      const buf = await store.getPoolDoc(pool ?? undefined)
      if (buf) {
        const doc = JSON.parse(new TextDecoder().decode(buf)) as {
          records?: Record<string, ScreenRecord>
          picture?: unknown; dim?: unknown; zoom?: unknown; panX?: unknown; panY?: unknown
        }
        if (doc.records && typeof doc.records === 'object') this.#screenRecords = doc.records
        else if (typeof doc.picture === 'string' && SIG_RE.test(doc.picture)) {
          this.#screenRecords['[]'] = {
            picture: doc.picture,
            dim: typeof doc.dim === 'number' ? doc.dim : 0,
            zoom: typeof doc.zoom === 'number' ? doc.zoom : 1,
            panX: typeof doc.panX === 'number' ? doc.panX : 0,
            panY: typeof doc.panY === 'number' ? doc.panY : 0,
            cascade: true,
          }
        }
      }
      if (this.#pictureSig) this.#screenRecords['[]'] = this.#currentRecord()
      await this.#resolveScreenForCurrentPath()
    } catch { /* absent or corrupt — the pref stands */ }
  }

  /** Mirror the screen record into its pool of meaning. Whole state every
   *  time, so a write the store was not ready for is healed by the next one
   *  rather than leaving a partial record — and never before #loadScreen has
   *  read, or an empty pref on a fresh origin would erase a hive's backdrop
   *  before anybody had looked at it. */
  #writeScreen(): void {
    if (this.#pictureSig) this.#screenRecords[this.#screenSourceKey] = this.#currentRecord()
    if (this.#screenWrite !== null) clearTimeout(this.#screenWrite)
    this.#screenWrite = setTimeout(() => {
      this.#screenWrite = null
      void (async () => {
        await this.#hydration
        const store = await this.#storeReady()
        if (!store?.getPool || !store.putPoolDoc) return
        try {
          const pool = await store.getPool(SCREEN_POOL_MEANING)
          if (!pool) return
          const bytes = new TextEncoder().encode(JSON.stringify({ v: 2, records: this.#screenRecords })).buffer as ArrayBuffer
          await store.putPoolDoc(pool, bytes)
        } catch { /* not ready — the next whole-state write covers this one */ }
      })()
    }, SCREEN_WRITE_DEBOUNCE)
  }

  #currentRecord(): ScreenRecord {
    return { picture: this.#pictureSig ?? '', dim: this.#dim, zoom: this.#zoom,
      panX: this.#panX, panY: this.#panY, cascade: this.#cascade }
  }

  #currentSegments(): string[] {
    const lineage = (window as { ioc?: { get?(key: string): unknown } }).ioc?.get?.('@hypercomb.social/Lineage') as
      { explorerSegments?(): readonly string[] } | undefined
    return [...(lineage?.explorerSegments?.() ?? [])]
  }

  #currentPathKey(): string { return JSON.stringify(this.#currentSegments()) }

  async #resolveScreenForCurrentPath(): Promise<void> {
    const epoch = ++this.#navigationEpoch
    const segments = this.#currentSegments()
    let found: { key: string; record: ScreenRecord } | null = null
    for (let length = segments.length; length >= 0; length--) {
      const key = JSON.stringify(segments.slice(0, length))
      const record = this.#screenRecords[key]
      if (!record || !SIG_RE.test(record.picture)) continue
      if (length === segments.length || record.cascade !== false) { found = { key, record }; break }
    }
    if (epoch !== this.#navigationEpoch) return
    if (!found) { this.#revokePicture(); this.#pictureSig = null; this.apply(); return }
    const { key, record } = found
    this.#screenSourceKey = key
    this.#cascade = record.cascade !== false
    this.#dim = record.dim
    this.#zoom = record.zoom
    this.#panX = record.panX
    this.#panY = record.panY
    if (this.#pictureSig !== record.picture || !this.#pictureUrl) {
      this.#revokePicture()
      this.#pictureSig = record.picture
      await this.#loadPicture()
    } else this.apply()
    this.dispatchEvent(new CustomEvent('change'))
  }

  #followLineage(): void {
    const ioc = (window as { ioc?: { get?(key: string): unknown; whenReady?(key: string, cb: (value: unknown) => void): void } }).ioc
    const attach = (value: unknown): void => {
      const lineage = value as EventTarget | undefined
      lineage?.addEventListener?.('change', () => { void this.#resolveScreenForCurrentPath() })
    }
    const ready = ioc?.get?.('@hypercomb.social/Lineage')
    if (ready) attach(ready)
    else ioc?.whenReady?.('@hypercomb.social/Lineage', attach)
  }

  /** One read. Answers null rather than waiting — the caller that needs to
   *  wait owns the ladder, and a promise parked on `whenReady` never settles
   *  when the registration it is waiting for has already happened. */
  async #readResource(sig: string): Promise<Blob | null> {
    const store = this.#store()
    if (!store?.getResource) return null
    try { return await store.getResource(sig) } catch { return null }
  }

  // ── internals ──────────────────────────────────────────────────────

  // The chrome theme SAYS how bright it is (`--md-is-light`, set by every
  // value-set in _material-tokens.scss) rather than being recognised by name.
  // Matching on the name answered correctly for exactly two themes and fell
  // through to the OS preference for every other one — so a bright look on a
  // dark-OS machine got the steel backdrop behind its cream panels. Reading
  // the token means a theme nobody here has heard of, including one a
  // community module registered at runtime, still answers for itself.
  #isLight(): boolean { return chromeIsLight() }

  #restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        archetype?: string; palette?: string | null; enabled?: boolean
        picture?: string | null; dim?: number; zoom?: number; panX?: number; panY?: number; v?: number
        saved?: { light?: unknown; dark?: unknown }
      }
      if (parsed.archetype && CANVAS_BG_ARCHETYPES.includes(parsed.archetype as Archetype)) this.#archetype = parsed.archetype as Archetype
      if (parsed.palette && CANVAS_BG_PALETTES.includes(parsed.palette as Palette)) this.#palette = parsed.palette as Palette
      if (typeof parsed.enabled === 'boolean') this.#enabled = parsed.enabled
      // A signature, or nothing. Anything else in the slot is a corrupt pref,
      // not a picture, and asking the store for it would only fail later.
      if (parsed.v !== 3 && typeof parsed.picture === 'string' && SIG_RE.test(parsed.picture)) this.#pictureSig = parsed.picture
      // The retired build levied a half-strength wash BY DEFAULT and persisted
      // it, so a truly-legacy pref's 0.5 is that levy, not a choice — it takes
      // the new default (full opacity) instead. Later prefs are recognisable
      // (an interim build wrote `saved`; this build writes `v`), so a
      // deliberate 50% survives every reload.
      const legacyDefaultDim = parsed.v === undefined && parsed.saved === undefined && parsed.dim === 0.5
      if (typeof parsed.dim === 'number' && parsed.dim >= 0 && parsed.dim <= 1 && !legacyDefaultDim) this.#dim = parsed.dim
      if (typeof parsed.zoom === 'number' && parsed.zoom >= 0.5 && parsed.zoom <= 4) this.#zoom = parsed.zoom
      if (typeof parsed.panX === 'number' && Number.isFinite(parsed.panX)) this.#panX = Math.round(parsed.panX)
      if (typeof parsed.panY === 'number' && Number.isFinite(parsed.panY)) this.#panY = Math.round(parsed.panY)
      // Shelf entries still in the pref are a LEGACY SOURCE — an interim build
      // kept them here before they moved to the `backgrounds:saved` pool.
      // Read them for adoption (see #loadSaved); never write them back.
      const shelf = (list: unknown): string[] =>
        Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s)) : []
      if (parsed.saved) {
        this.#saved = { light: shelf(parsed.saved.light), dark: shelf(parsed.saved.dark) }
        this.#prefCarriedSaved = true
      }
    } catch { /* corrupt pref — keep defaults */ }
  }

  #persist(): void {
    try {
      // Participant-local ONLY: what is showing and how washed. The shelves
      // are network-queryable content and live in their pool of meaning —
      // `v` marks a pref this build wrote (the dim-amnesty reads it).
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        archetype: this.#archetype, palette: this.#palette, enabled: this.#enabled,
        picture: this.#pictureSig, dim: this.#dim, zoom: this.#zoom,
        panX: this.#panX, panY: this.#panY, v: 3,
      }))
    } catch { /* storage unavailable */ }
    // The durable half: a pool member naming the signature is what keeps the
    // picture's bytes REACHABLE, and what lets the choice travel with the hive.
    this.#writeScreen()
  }
}

const _canvasBackground = new CanvasBackgroundService()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CanvasBackground', _canvasBackground)
