// diamondcoreprocessor.com/presentation/background/canvas-background.service.ts
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
// The backdrops are drawn entirely with CSS (gradients + one tiny inline-SVG
// tile for honeycomb) — no image files. That makes them resolution-independent
// and ALWAYS cover the full viewport in both landscape AND portrait, with no
// cropping margins, no seams, and no banding. Choosing one is purely cosmetic
// and per-participant; see the /canvas queen.
//
// Default: contour (steel on dark, daylight on light).

import { EffectBus } from '@hypercomb/core'
import { isPublishedVisitorShell } from '../../sharing/behavior-enablement.js'

const STORAGE_KEY = 'hc:canvas-bg'

export const CANVAS_BG_ARCHETYPES = ['depth', 'honeycomb', 'sheen', 'mesh', 'dots', 'contour', 'grid'] as const
export const CANVAS_BG_PALETTES = ['steel', 'daylight', 'indigo', 'teal', 'ember', 'honey', 'bloom', 'sherbet'] as const

type Archetype = typeof CANVAS_BG_ARCHETYPES[number]
type Palette = typeof CANVAS_BG_PALETTES[number]

// A token is an archetype only if it IS one. There are deliberately no built-in
// synonyms: a second word for a thing that already has a word is confusion the
// participant did not ask for, and it makes the vocabulary something you have to
// learn rather than read. Aliases are the participant's to mint, never ours.
const archetypeOf = (token: string): Archetype | null =>
  CANVAS_BG_ARCHETYPES.includes(token as Archetype) ? token as Archetype : null

const DEFAULT_ARCHETYPE: Archetype = 'contour'

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
  #auroraEl: HTMLDivElement | null = null
  #glowEl: HTMLDivElement | null = null

  constructor() {
    super()
    this.#restore()
    // Re-apply when the colour theme flips so an auto palette tracks it.
    EffectBus.on('theme:changed', () => { if (!this.#palette) this.apply() })
    // matchMedia covers the 'system' theme (no data-theme attribute).
    try {
      window.matchMedia?.('(prefers-color-scheme: light)')
        ?.addEventListener?.('change', () => { if (!this.#palette) this.apply() })
    } catch { /* matchMedia unavailable */ }
    this.apply()
  }

  // ── public API (backs the /canvas queen) ──────────────────────────

  get archetype(): Archetype { return this.#archetype }
  get palette(): Palette | null { return this.#palette }
  get enabled(): boolean { return this.#enabled }
  get archetypes(): readonly string[] { return CANVAS_BG_ARCHETYPES }
  get palettes(): readonly string[] { return CANVAS_BG_PALETTES }

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
    return `canvas background → ${this.#archetype} (${this.resolvedPalette()})`
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
    if (!this.#enabled) {
      this.#hideAurora()
      this.#hideGlow()
      EffectBus.emit('canvas:lines', { kind: null, accent: '', alpha: 0 })
      this.dispatchEvent(new CustomEvent('change'))
      return
    }

    const p = PAL[this.resolvedPalette()]

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

  // ── internals ──────────────────────────────────────────────────────

  // The chrome theme SAYS how bright it is (`--md-is-light`, set by every
  // value-set in _material-tokens.scss) rather than being recognised by name.
  // Matching on the name answered correctly for exactly two themes and fell
  // through to the OS preference for every other one — so a bright look on a
  // dark-OS machine got the steel backdrop behind its cream panels. Reading
  // the token means a theme nobody here has heard of, including one a
  // community module registered at runtime, still answers for itself.
  #isLight(): boolean {
    try {
      const declared = getComputedStyle(document.documentElement)
        .getPropertyValue('--md-is-light').trim()
      if (declared === '1') return true
      if (declared === '0') return false
    } catch { /* no computed style — fall through to the OS */ }
    try { return !!window.matchMedia?.('(prefers-color-scheme: light)')?.matches } catch { return false }
  }

  #restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { archetype?: string; palette?: string | null; enabled?: boolean }
      if (parsed.archetype && CANVAS_BG_ARCHETYPES.includes(parsed.archetype as Archetype)) this.#archetype = parsed.archetype as Archetype
      if (parsed.palette && CANVAS_BG_PALETTES.includes(parsed.palette as Palette)) this.#palette = parsed.palette as Palette
      if (typeof parsed.enabled === 'boolean') this.#enabled = parsed.enabled
    } catch { /* corrupt pref — keep defaults */ }
  }

  #persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        archetype: this.#archetype, palette: this.#palette, enabled: this.#enabled,
      }))
    } catch { /* storage unavailable */ }
  }
}

const _canvasBackground = new CanvasBackgroundService()
;(window as any).ioc?.register?.('@diamondcoreprocessor.com/CanvasBackground', _canvasBackground)
