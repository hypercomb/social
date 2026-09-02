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

/** A picture that is READY: decoded, measured, with its strip built. The
 *  handles belong to the prepared cache, not to whatever is on screen — the
 *  screen only points at one of these. */
type Prepared = {
  url: string
  size: { width: number; height: number } | null
  mirror: string | null
  panel: { width: number; height: number } | null
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

// A BACKDROP DOES NOT ARRIVE IN PIECES. The picture used to be painted the
// moment its bytes resolved and then twice more: once when the image had
// loaded and its zoom could finally be honoured, and once when the mirrored
// strip had finished encoding and it could span the full width. What the
// participant saw was a small picture growing out to the edges — a backdrop
// animating itself into place, which is not a thing a backdrop should ever
// do. It is prepared whole now and shown once. This is the cap on that wait:
// a picture nothing can decode is shown as best we can rather than holding
// the screen forever.
const PICTURE_READY_DEADLINE_MS = 4000

// `decode()` only WARMS the bitmap — it is never allowed to decide whether a
// picture is ready. A tab that is not being shown has no reason to rasterise
// anything, and its decode promise can stay pending for as long as it likes;
// waiting on that one cost the picture its measured size, which is the whole
// thing this file is for. Loaded is ready; warm is a bonus, briefly waited on.
const PICTURE_WARM_MS = 500

// THE STRIP IS BUILT FOR THE SCREEN, NOT FOR THE FILE. A picture mirrored at
// its own resolution is a canvas nobody sees a pixel of — a 2560-wide backdrop
// becomes a 5120-wide sheet that has to be encoded before anything can be
// painted, and a photograph straight off a camera is far worse. It is drawn at
// the size it will be SHOWN instead, in device pixels, capped by what the
// picture actually has. The bytes at the content root are never touched: they
// are content, other things point at them, and a peer's screen is not this one.
const STRIP_PIXEL_RATIO_CAP = 2
// WebP, because the strip is a paint buffer rather than a stored picture: the
// same image at a fraction of PNG's encode time and memory.
const STRIP_TYPE = 'image/webp'
const STRIP_QUALITY = 0.92
// Zoom in far enough, or open the window wider, and the strip owes more pixels
// than it was built with. Rebuilt then — same size on screen, only sharper.
const STRIP_REBUILD_FACTOR = 1.25
const STRIP_REBUILD_DEBOUNCE = 300

// WALKING BACK IS NOT A NEW PICTURE. A signature names the same bytes forever,
// so a page you were just on can be re-dressed from what is already prepared
// rather than read, decoded and re-encoded again — which is the whole gap
// between the page changing and the backdrop catching up. The last few
// pictures keep their handles; a return trip swaps in the same frame.
const PREPARED_KEPT = 5

// AND THE PAGES YOU CAN WALK TO ARE GOT READY BEFORE YOU WALK. The screen
// records already name the backdrop of every page that has one, so the way
// out and the ways in can be read and built while nothing else is happening.
// A first visit then costs what a return visit costs: nothing. Bounded on
// purpose — this is idle work for the pages next door, not a sweep of the
// hive, and it never touches what is on screen.
const PRELOAD_NEIGHBOURS = 2
const PRELOAD_IDLE_MS = 1200

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
// TWO RULES HOLD THIS TABLE TOGETHER, and every palette that broke one of them
// read as a cheaper look than the ones that didn't:
//
//   • `deep` IS THE PALETTE'S OWN DARKEST TONE, never a neutral. It is the
//     vignette and the aurora's far corner; a beige `deep` under a paper
//     ground is the same soot-instead-of-daylight mistake the chrome tokens
//     name, seen from the other side.
//   • `accent2` IS A DIFFERENT HUE, not the accent one step darker. Four of
//     these used to be one hue at two values, so a mesh with two blobs looked
//     like one blob out of focus. bloom and sherbet were already right —
//     primary plus the second note of that look's chord — and the rest follow
//     them now.
//
// `steel` and `daylight` are the NEUTRAL PAIR: the backdrops for the plain
// dark and light chrome, carrying the same azure / clay chord those two wear.
// Before this, dark had a neutral backdrop and light did not — `daylight` was
// a beige office under paper panels.
const PAL: Record<Palette, Pal> = {
  steel:    { light: false, base: '#0d151e', base2: '#1b2836', deep: '2,8,14',      accent: '126,195,238', accent2: '235,167,107' },
  daylight: { light: true,  base: '#f2f4f8', base2: '#fdfeff', deep: '120,134,155', accent: '22,104,196',  accent2: '180,90,34' },
  indigo:   { light: false, base: '#0d1226', base2: '#181f3d', deep: '4,6,15',      accent: '123,139,224', accent2: '214,120,190' },
  teal:     { light: false, base: '#07201c', base2: '#0c2e28', deep: '2,15,12',     accent: '69,199,165',  accent2: '226,170,92' },
  ember:    { light: false, base: '#1a1410', base2: '#2a1d12', deep: '11,7,4',      accent: '211,164,122', accent2: '104,142,186' },
  // The three bright looks — the backdrops that go with the honey / bloom /
  // sherbet chrome, each carrying that theme's own primary as its accent so
  // the screen behind the hive and the panels over it are the same colour.
  honey:    { light: true,  base: '#fdf3dd', base2: '#fffaf0', deep: '196,160,86',  accent: '181,115,10',  accent2: '212,86,47' },
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
    // NO `mesh` CASE. Mesh is the animated aurora and returns from `#apply`
    // before this function is reached — it is painted by `#showAurora`, which
    // is where its colours are. A static mesh branch lived here for a while
    // and was pure decoy: unreachable, and exactly the place someone goes to
    // "fix" a mesh backdrop that is actually broken in the aurora.
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
  // ALWAYS THE ACCENT — the lattice, the sheen band and the contour ring are
  // all drawn in `accent` on the real screen, so a chip drawn in `accent2` was
  // showing a colour that appears nowhere in the look it stands for. It read
  // as tolerable only because the light palettes' accent2 used to be their own
  // accent lightened; now that accent2 is a second HUE, the chip would be
  // plainly wrong. (`mesh` still names accent2 for its second blob, which is
  // exactly what the backdrop does.)
  const a = (alpha: number) => `rgba(${p.accent},${alpha})`
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
  /** Pictures already prepared, by signature, oldest first. The session owns
   *  these handles; the screen only borrows one. */
  #prepared = new Map<string, Prepared>()
  /** Preparations in flight, so a preload and a choice for the same picture
   *  share one build rather than racing and leaking a set of handles. */
  #preparing = new Map<string, Promise<Prepared>>()
  #preloadWork: ReturnType<typeof setTimeout> | null = null
  /** Which preparation the screen is waiting on. Bumped by every new choice,
   *  so a picture that was still getting ready when a newer one was chosen is
   *  dropped without ever having been seen. */
  #pictureEpoch = 0
  /** A picture is named and on its way. The screen is HELD for it — see the
   *  hold in `apply()` — rather than painting a pattern it is about to lose. */
  #picturePending = false
  /** Two-panel original + horizontally flipped copy, repeated along x. */
  #mirrorUrl: string | null = null
  /** The device-pixel size ONE panel of that strip was built at, so a zoom or
   *  a wider window can tell when it owes more than it has. */
  #stripPanel: { width: number; height: number } | null = null
  #stripWork: ReturnType<typeof setTimeout> | null = null
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
    window.addEventListener('resize', () => {
      if (!this.#pictureUrl) return
      this.apply()
      this.#refreshStrip()
    })
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
    this.#pictureSig = clean
    this.#screenSourceKey = this.#currentPathKey()
    this.#cascade = true
    this.#enabled = true
    this.#persist()
    // NOTHING REPAINTS HERE — and that is the fix, not an omission.
    //
    // Choosing a picture used to drop the one showing on the spot: its size
    // and its mirrored strip went with it, so the screen fell back to the
    // whole-picture `contain` fit — the same photograph, suddenly small and
    // centred — held there for as long as the new one took to arrive, and
    // then flipped. "It resizes to the middle and then flips to the other
    // one." There is always latency in getting a photograph onto a screen;
    // what there is no excuse for is spending it on a wrong-sized picture.
    //
    // The picture that is showing stays EXACTLY as it is, untouched, until
    // the new one can be shown whole. One change on screen, and it is the
    // one the participant asked for.
    void this.#preparePicture(clean, blob)
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
    this.#cancelPreparing()
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
    // Zoomed in past what the strip was drawn for: it is rebuilt sharper,
    // at the same size, once the slider settles.
    this.#refreshStrip()
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

    // A PICTURE THAT IS COMING GETS THE SCREEN HELD FOR IT. Painting the
    // pattern first and swapping it for a photograph a second later is the
    // same flicker as growing the picture into place — the participant chose a
    // picture, and a lattice they never asked to see is not a better wait.
    // Until it is ready (or until the ladder gives up on the bytes), the
    // screen is the palette's own base colour: the same colour the picture
    // will sit on, so its arrival is the only change there is to see.
    if (!this.#pictureUrl && this.#picturePending) {
      s.backgroundColor = p.base
      this.#hideAurora()
      this.#hideGlow()
      EffectBus.emit('canvas:lines', { kind: null, accent: '', alpha: 0 })
      this.dispatchEvent(new CustomEvent('change'))
      return
    }

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
      // THE BODY MUST NOT PAINT HERE, and this is the whole reason the aurora
      // was never once seen: `#hc-aurora` is `position:fixed; z-index:-1`, and
      // a negative-z element paints after the ROOT's background but BEFORE the
      // background of any in-flow block descendant — body included. `html, body`
      // both carry `background-color: var(--md-surface)` in the shell's
      // styles.scss, so body's background does not propagate to the canvas; it
      // paints in place, opaquely, directly over the blooms. Every mesh look
      // (bloom, indigo) has been a flat rectangle. The aurora element sets
      // `p.base` on itself, so handing it the ground costs nothing.
      s.backgroundColor = 'transparent'
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
    // Same fix as the light `mesh` in cssFor: these were a pale blue and a
    // cream regardless of palette. Under `multiply` a saturated accent only
    // needs a fifth of the alpha to land where those washed literals did —
    // 0.22 of #1668c4 multiplies paper to about the blue the old 0.7 of
    // #ccE0f2 did, but in whichever hue the look actually chose.
    const cols = p.light
      ? [`rgba(${p.accent},0.22)`, `rgba(${p.accent2},0.20)`, `rgba(${p.accent},0.14)`]
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

  /** Stop showing the picture. The handles are NOT revoked here — they belong
   *  to the prepared cache, which is what makes walking back instant; they go
   *  when that cache lets them go. The BYTES behind them are content and are
   *  never touched at all: a tile, the references pool or a peer may well be
   *  pointing at them. */
  #revokePicture(): void {
    this.#pictureUrl = null
    this.#mirrorUrl = null
    this.#pictureSize = null
    this.#stripPanel = null
    if (this.#stripWork !== null) { clearTimeout(this.#stripWork); this.#stripWork = null }
  }

  /** Wear a picture already prepared this session, if there is one. Answers
   *  whether it did — and it does it WITHOUT touching the store, which is what
   *  turns walking back into a page you were just on from a read, a decode and
   *  an encode into a single repaint. */
  #wearPrepared(sig: string): boolean {
    const ready = this.#prepared.get(sig)
    if (!ready) return false
    // Anything still getting ready is overtaken by this.
    this.#pictureEpoch++
    this.#revokePicture()
    this.#showPrepared(sig, ready)
    return true
  }

  /** Wear a picture that is already prepared. Synchronous, by design: this is
   *  the same-frame half of the swap. */
  #showPrepared(sig: string, ready: Prepared): void {
    // Re-inserted so the map stays oldest-first for eviction.
    this.#prepared.delete(sig)
    this.#prepared.set(sig, ready)
    this.#pictureUrl = ready.url
    this.#pictureSize = ready.size
    this.#mirrorUrl = ready.mirror
    this.#stripPanel = ready.panel
    this.#picturePending = false
    this.apply()
    // This screen may owe more pixels than the strip was built with — a
    // bigger window, or a deeper zoom on this page than on the last one.
    this.#refreshStrip()
    this.#forgetOldPrepared(sig)
  }

  /** Let go of everything past the last few, never the one being worn. */
  #forgetOldPrepared(keep: string): void {
    while (this.#prepared.size > PREPARED_KEPT) {
      const oldest = this.#prepared.keys().next().value
      if (oldest === undefined) return
      const spent = this.#prepared.get(oldest)
      this.#prepared.delete(oldest)
      if (oldest === keep) {
        // Worn, so it goes back on as the newest instead of being dropped.
        if (spent) this.#prepared.set(oldest, spent)
        continue
      }
      if (!spent) continue
      try { URL.revokeObjectURL(spent.url) } catch { /* already gone */ }
      if (spent.mirror) { try { URL.revokeObjectURL(spent.mirror) } catch { /* already gone */ } }
    }
  }

  /** Get a picture COMPLETELY ready before it is ever shown, then swap it in
   *  with a single paint.
   *
   *  Decode it, measure it, build its mirrored strip, decode that too — and
   *  only then does anything change on screen. Whatever is showing meanwhile
   *  keeps showing: the picture before it when one is being replaced, the held
   *  base colour at boot. That is the whole point — nothing is ever seen at a
   *  size it is about to grow out of.
   *
   *  Nothing awaits this. A choice is answered the moment its bytes resolve;
   *  the screen changes when the picture is worth looking at — and for a
   *  picture already prepared this session, that is the same frame. */
  async #preparePicture(sig: string, blob: Blob): Promise<void> {
    const epoch = ++this.#pictureEpoch
    this.#picturePending = true
    if (this.#wearPrepared(sig)) return
    const prepared = await this.#prepareHandles(sig, blob)
    // A newer choice landed while this one was getting ready — that one wins.
    // The work is KEPT either way: the bytes are named by a signature and will
    // not change, and the choice that overtook this one may be overtaken back.
    if (epoch !== this.#pictureEpoch) return
    this.#revokePicture()
    this.#showPrepared(sig, prepared)
  }

  /** Build a picture's handles and keep them. Shows NOTHING — this is the
   *  half a preload uses, and the half a choice waits on. */
  #prepareHandles(sig: string, blob: Blob): Promise<Prepared> {
    const held = this.#prepared.get(sig)
    if (held) return Promise.resolve(held)
    const already = this.#preparing.get(sig)
    if (already) return already
    const work = (async (): Promise<Prepared> => {
      const url = URL.createObjectURL(blob)
      const image = await this.#decoded(url)
      const size = image ? { width: image.naturalWidth, height: image.naturalHeight } : null
      const panel = size ? this.#panelPixels(size) : null
      const mirror = image && panel ? await this.#mirrorStrip(image, panel) : null
      if (mirror) await this.#decoded(mirror)
      const prepared: Prepared = { url, size, mirror, panel: mirror ? panel : null }
      this.#prepared.set(sig, prepared)
      this.#forgetOldPrepared(this.#pictureSig ?? '')
      return prepared
    })().finally(() => { this.#preparing.delete(sig) })
    this.#preparing.set(sig, work)
    return work
  }

  /** Get the pages next door ready, once things have gone quiet. */
  #preloadNeighbours(): void {
    if (this.#preloadWork !== null) clearTimeout(this.#preloadWork)
    this.#preloadWork = setTimeout(() => {
      this.#preloadWork = null
      void this.#preloadRun()
    }, PRELOAD_IDLE_MS)
  }

  /** Prepare the backdrops of the nearest pages ON THIS BRANCH — the way out
   *  and the ways in, nearest first. Nothing here changes what is showing: a
   *  preloaded picture is worn only if the participant walks onto its page. */
  async #preloadRun(): Promise<void> {
    const segments = this.#currentSegments()
    const here = JSON.stringify(segments)
    const near: { distance: number; picture: string }[] = []
    for (const [key, record] of Object.entries(this.#screenRecords)) {
      if (key === here || !record || !SIG_RE.test(record.picture)) continue
      if (this.#prepared.has(record.picture)) continue
      let path: string[]
      try { path = JSON.parse(key) as string[] } catch { continue }
      if (!Array.isArray(path)) continue
      let shared = 0
      while (shared < path.length && shared < segments.length && path[shared] === segments[shared]) shared++
      // On this branch only: an ancestor of here, or a descendant of it. A
      // page off in another arm of the hive is not somewhere you can step.
      if (shared !== Math.min(path.length, segments.length)) continue
      near.push({ distance: Math.abs(path.length - segments.length), picture: record.picture })
    }
    near.sort((a, b) => a.distance - b.distance)
    const wanted: string[] = []
    for (const { picture } of near) {
      if (wanted.includes(picture)) continue
      wanted.push(picture)
      if (wanted.length === PRELOAD_NEIGHBOURS) break
    }
    for (const picture of wanted) {
      if (this.#prepared.has(picture)) continue
      const blob = await this.#readResource(picture)
      if (!blob) continue
      await this.#prepareHandles(picture, blob)
    }
  }

  /** An image, loaded and (where it is worth waiting for) decoded — or null if
   *  it will not load at all. Capped: a picture the browser cannot read must
   *  not hold the screen forever. The cap answers with whatever HAS loaded,
   *  because the size is the point and a warm bitmap is only a nicety. */
  #decoded(url: string): Promise<HTMLImageElement | null> {
    return new Promise<HTMLImageElement | null>(resolve => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let loaded: HTMLImageElement | null = null
      let settled = false
      const done = (value: HTMLImageElement | null): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(value)
      }
      const image = new Image()
      // LOADED IS READY. `decode()` only warms the bitmap so the body is not
      // carrying an image the compositor has still to unpack — worth a short
      // wait, never worth the picture's own dimensions, and not worth asking
      // for at all in a tab nobody is looking at (see PICTURE_WARM_MS).
      image.onload = () => {
        loaded = image
        const warm = document.visibilityState === 'hidden'
          ? Promise.resolve()
          : Promise.resolve(image.decode?.()).catch(() => { /* loaded is enough */ })
        void Promise.race([warm, new Promise(resolve => setTimeout(resolve, PICTURE_WARM_MS))]).then(() => done(image))
      }
      image.onerror = () => done(null)
      timer = setTimeout(() => done(loaded), PICTURE_READY_DEADLINE_MS)
      image.src = url
    })
  }

  /** Drop a preparation that has been undone — a picture the participant has
   *  since cleared or navigated away from must not land a moment later. */
  #cancelPreparing(): void {
    this.#pictureEpoch++
    this.#picturePending = false
  }

  #pictureBackgroundSize(): string {
    const metrics = this.#pictureMetrics()
    if (!metrics) return 'cover'
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
    const fit = this.#fitFor(size) * this.#zoom
    return { width: size.width * fit, height: size.height * fit }
  }

  /** The two-panel [original][mirror] strip that lets a picture narrower than
   *  the screen repeat outwards without a seam. Drawn at the size it will be
   *  SHOWN — see #panelPixels — so a photograph straight off a camera costs
   *  the same as one that was already the right size. Null when the canvas
   *  will not give it up: the picture then shows on its own, which is honest. */
  async #mirrorStrip(image: HTMLImageElement, panel: { width: number; height: number }): Promise<string | null> {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = panel.width * 2
      canvas.height = panel.height
      const context = canvas.getContext('2d')
      if (!context) return null
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, panel.width, panel.height)
      context.save()
      context.translate(canvas.width, 0)
      context.scale(-1, 1)
      context.drawImage(image, 0, 0, panel.width, panel.height)
      context.restore()
      const encode = (type: string, quality?: number): Promise<Blob | null> =>
        new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality))
      // A browser without WebP answers null (or hands back a PNG regardless);
      // either way the picture still gets its strip.
      const blob = await encode(STRIP_TYPE, STRIP_QUALITY) ?? await encode('image/png')
      return blob ? URL.createObjectURL(blob) : null
    } catch { return null }
  }

  /** How many device pixels ONE panel of the strip is worth right now: the
   *  size it is displayed at, never more than the picture actually has. This
   *  is where a 24-megapixel photograph stops being a 24-megapixel paint
   *  buffer — the stored bytes are untouched, only this session's strip. */
  #panelPixels(size: { width: number; height: number }): { width: number; height: number } {
    const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), STRIP_PIXEL_RATIO_CAP)
    const scale = Math.min(1, this.#fitFor(size) * this.#zoom * ratio)
    return {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    }
  }

  /** The FILLING (`cover`) fit for this viewport — the scale at which the
   *  picture covers the whole screen with nothing stretched. It was the
   *  whole-picture `contain` fit, and on a screen wider than the photograph
   *  that left a band of the theme's ground above and below it: under a
   *  bright look, two cream bars across the top and bottom of the workspace,
   *  read as chrome cramping the hive (Jaime, 2026-09-02: "the bottom of the
   *  screen should not have any horizontal background for any of the
   *  themes"). A picture is cropped at its edges now, never letterboxed;
   *  the participant's zoom and pan still move it from here. A viewport that
   *  measures nothing (a window not yet laid out, a hidden host) is not a
   *  fit of zero: the picture keeps its own scale until a resize says
   *  otherwise. */
  #fitFor(size: { width: number; height: number }): number {
    const width = window.innerWidth
    const height = window.innerHeight
    if (!(width > 0) || !(height > 0)) return 1
    return Math.max(width / size.width, height / size.height)
  }

  /** The strip owes more pixels than it was built with — zoomed in, or a
   *  bigger window. Rebuilt at the new resolution and swapped in place: the
   *  same size on screen, only sharper, so nothing moves. Never for a small
   *  change, and never past what the picture itself has. */
  #refreshStrip(): void {
    const size = this.#pictureSize
    const url = this.#pictureUrl
    const built = this.#stripPanel
    if (!size || !url || !this.#mirrorUrl || !built) return
    if (built.width >= size.width) return
    const want = this.#panelPixels(size)
    if (want.width <= Math.round(built.width * STRIP_REBUILD_FACTOR)) return
    if (this.#stripWork !== null) clearTimeout(this.#stripWork)
    this.#stripWork = setTimeout(() => {
      this.#stripWork = null
      void this.#rebuildStrip(url, want)
    }, STRIP_REBUILD_DEBOUNCE)
  }

  async #rebuildStrip(url: string, panel: { width: number; height: number }): Promise<void> {
    const epoch = this.#pictureEpoch
    const image = await this.#decoded(url)
    const current = (): boolean => epoch === this.#pictureEpoch && this.#pictureUrl === url
    if (!image || !current()) return
    const mirror = await this.#mirrorStrip(image, panel)
    if (!mirror) return
    if (!current()) {
      try { URL.revokeObjectURL(mirror) } catch { /* already gone */ }
      return
    }
    const spent = this.#mirrorUrl
    this.#mirrorUrl = mirror
    this.#stripPanel = panel
    // The prepared copy holds the same handles the screen is wearing, so it
    // moves with it — otherwise walking back would bring the coarser strip
    // (or a revoked one) with it.
    const held = this.#pictureSig ? this.#prepared.get(this.#pictureSig) : undefined
    if (held && held.url === url) { held.mirror = mirror; held.panel = panel }
    this.apply()
    if (spent && spent !== mirror) { try { URL.revokeObjectURL(spent) } catch { /* already gone */ } }
  }

  /** Resolve the stored signature's bytes at boot. The signature is the truth
   *  and survives a reload; the object URL never does. The store is SETTLED
   *  before this runs — see #storeReady — so a miss here is about the bytes,
   *  not about the timing. */
  async #loadPicture(): Promise<void> {
    const sig = this.#pictureSig
    if (!sig) return
    // Walked back onto a picture this session already prepared: worn now, in
    // the same frame the page changed, with no read at all.
    if (this.#wearPrepared(sig)) return
    // A picture is NAMED, so the screen is held for it rather than painting a
    // pattern it is about to lose. Released either way below.
    if (!this.#pictureUrl) this.#picturePending = true
    for (const wait of SETTLED_RETRIES) {
      // A newer choice landed while this one was resolving — that one wins.
      if (this.#pictureSig !== sig) return
      const blob = await this.#readResource(sig)
      if (blob) {
        if (this.#pictureSig !== sig) return
        // Not awaited: the bytes are here, and the screen changes when the
        // picture is ready to be looked at rather than while it is arriving.
        void this.#preparePicture(sig, blob)
        return
      }
      await new Promise(resolve => setTimeout(resolve, wait))
    }
    // THE SIGNATURE IS KEPT. The preference is not wrong — the bytes are
    // missing — and clearing it would turn an absence a replication or a
    // drain can still heal into a choice the participant has to make again.
    console.warn(`[canvas-bg] picture ${sig.slice(0, 12)}… names no bytes in this hive — the backdrop is showing its pattern`)
    // And the hold is released, so it can: a picture that never arrives must
    // not leave the screen a bare field forever, nor leave the picture before
    // it standing in for a choice that has already moved on.
    if (this.#pictureSig !== sig) return
    this.#picturePending = false
    this.#revokePicture()
    this.apply()
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
    // No store will ever appear, so no picture will either — release the hold
    // the pref asked for rather than leaving a bare field on screen.
    if (!store) {
      if (this.#picturePending) { this.#picturePending = false; this.apply() }
      return
    }
    await this.#loadScreen(store)
    await this.#loadPicture()
    // The pref's "a picture is coming" hint has been answered by now, one way
    // or the other. Anything still holding is holding for nothing.
    if (this.#picturePending && !this.#pictureSig) { this.#picturePending = false; this.apply() }
    await this.#loadSaved(store)
    // Everything this page needed is on screen; the pages next to it can be
    // got ready in the quiet after.
    this.#preloadNeighbours()
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
    if (!found) {
      this.#cancelPreparing()
      this.#revokePicture()
      this.#pictureSig = null
      this.apply()
      // No backdrop HERE still means new neighbours — one of them may have one.
      this.#preloadNeighbours()
      return
    }
    const { key, record } = found
    this.#screenSourceKey = key
    this.#cascade = record.cascade !== false
    this.#dim = record.dim
    this.#zoom = record.zoom
    this.#panX = record.panX
    this.#panY = record.panY
    if (this.#pictureSig !== record.picture || !this.#pictureUrl) {
      // The picture on screen is NOT dropped first: it holds this layer's look
      // until the next one is ready, so walking into a page with its own
      // backdrop is one change rather than a blank field and then a photograph.
      this.#pictureSig = record.picture
      await this.#loadPicture()
    } else this.apply()
    // The pref carries what this page is wearing, so the NEXT boot knows a
    // picture is coming before the store has said a word — that hint is what
    // holds the screen instead of flashing a pattern. See #restore.
    this.#persist()
    // Walked somewhere: the neighbours are different neighbours now.
    this.#preloadNeighbours()
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
      if (typeof parsed.picture === 'string' && SIG_RE.test(parsed.picture)) {
        if (parsed.v !== 3) this.#pictureSig = parsed.picture
        // WHICH picture belongs to this page is the pool's to say (v3 keeps a
        // record per path), but THAT one is coming is known from the first
        // tick — so the very first paint of the session already holds the
        // screen. The pattern never gets a frame it is only going to lose.
        this.#picturePending = true
      }
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
