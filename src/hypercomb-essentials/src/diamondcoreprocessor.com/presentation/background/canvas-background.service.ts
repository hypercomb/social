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
// Default: carbon grid (steel on dark, daylight on light).

import { EffectBus } from '@hypercomb/core'

const STORAGE_KEY = 'hc:canvas-bg'

export const CANVAS_BG_ARCHETYPES = ['depth', 'honeycomb', 'sheen', 'mesh', 'dots', 'contour', 'grid'] as const
export const CANVAS_BG_PALETTES = ['steel', 'daylight', 'indigo', 'teal', 'ember'] as const

type Archetype = typeof CANVAS_BG_ARCHETYPES[number]
type Palette = typeof CANVAS_BG_PALETTES[number]

// User-typed token → canonical archetype. Friendly aliases so `/canvas hexdots`
// and `/canvas rings` resolve.
const ARCH_ALIASES: Record<string, Archetype> = {
  depth: 'depth',
  honeycomb: 'honeycomb', comb: 'honeycomb', hive: 'honeycomb',
  sheen: 'sheen', brushed: 'sheen',
  mesh: 'mesh', aurora: 'mesh',
  dots: 'dots', hexdots: 'dots', 'hex-dots': 'dots',
  contour: 'contour', rings: 'contour',
  grid: 'grid', carbon: 'grid', carbongrid: 'grid', 'carbon-grid': 'grid',
}

const DEFAULT_ARCHETYPE: Archetype = 'grid'

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
  resolvedPalette(): Palette { return this.#palette ?? (this.#isLight() ? 'daylight' : 'steel') }

  /**
   * Apply one or more space-separated tokens: an archetype (depth, honeycomb,
   * sheen, mesh, dots, contour — plus aliases), a palette (steel, daylight,
   * indigo, teal, ember), or `off`. Unknown tokens are ignored. Returns a short
   * status describing the new state, or null when nothing matched.
   */
  set(input: string): string | null {
    const tokens = input.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return null
    let matched = false
    for (const tok of tokens) {
      if (tok === 'off' || tok === 'none' || tok === 'hide') { this.#enabled = false; matched = true; continue }
      if (tok === 'on' || tok === 'show') { this.#enabled = true; matched = true; continue }
      const arch = ARCH_ALIASES[tok] ?? (CANVAS_BG_ARCHETYPES.includes(tok as Archetype) ? tok as Archetype : null)
      if (arch) { this.#archetype = arch; this.#enabled = true; matched = true; continue }
      if (tok === 'auto') { this.#palette = null; matched = true; continue }
      if (CANVAS_BG_PALETTES.includes(tok as Palette)) { this.#palette = tok as Palette; matched = true; continue }
    }
    if (!matched) return null
    this.#persist()
    this.apply()
    return this.status()
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

  #isLight(): boolean {
    const t = document.documentElement.getAttribute('data-theme')
    if (t === 'light') return true
    if (t === 'dark') return false
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
