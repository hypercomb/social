// diamondcoreprocessor.com/games/arkanoid/theme.ts
//
// The pluggable THEME slot for the arkanoid scene. A theme owns its palette bands
// and paints the background + atmosphere; the renderer delegates the WHOLE scene to
// whichever theme is active and knows nothing else about it. Themes self-register
// into an IoC-held registry, so the community can ship a theme as its own module and
// have it appear in the picker — the same plug-and-replace pattern used everywhere
// else in the hive. Swapping the look never touches gameplay.

/** One palette band. Skies are `[top, mid, bottom]`; the `*Rgb` strings are the same
 *  hue as comma-separated channels so a theme can build `rgba(...)` glows cheaply. */
export interface ThemeBand {
  name: string
  neon: string; neonRgb: string
  accent: string; accentRgb: string
  sky: [string, string, string]
  mist: string
}

/** Per-frame context handed to a theme's painters: canvas size, the clock, the shared
 *  candle/breath pulse (0..1), the active band, and the level index so a theme can
 *  vary with depth. Painters get everything they need here — no renderer state. */
export interface ThemeEnv {
  W: number; H: number
  time: number; pulse: number
  band: ThemeBand; levelIndex: number
}

/** A community-authorable scene theme: a palette + two self-contained painters. Keep
 *  both painters pure (draw only from `ctx` + `env`) so ANY module can supply one. */
export interface ArkanoidTheme {
  id: string
  name: string
  bands: ThemeBand[]
  /** Paint the full background (sky, scenery, horizon) before the play field. */
  background(ctx: CanvasRenderingContext2D, env: ThemeEnv): void
  /** Paint ambient life over the field (drifters, weather, glows). */
  atmosphere(ctx: CanvasRenderingContext2D, env: ThemeEnv): void
}

/** The band for a level: each band spans 4 levels, then the set cycles. */
export function bandFor(theme: ArkanoidTheme, levelIndex: number): ThemeBand {
  return theme.bands[Math.floor(levelIndex / 4) % theme.bands.length]
}

/** Darken a '#rrggbb' toward black (k=0..1). Shared so every theme's gradient edges
 *  match the look of the built-ins. */
export function darkenHex(hex: string, k = 0.45): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${Math.floor(((n >> 16) & 255) * k)},${Math.floor(((n >> 8) & 255) * k)},${Math.floor((n & 255) * k)})`
}

const IOC_KEY = '@diamondcoreprocessor.com/ArkanoidThemes'
const LS_KEY = 'ark:theme'

/** Holds every registered theme + the participant's active pick. The pick lives in
 *  localStorage (a view preference, like difficulty — never in the layer, so it can't
 *  skew a signature). Registered in IoC so themes shipped as separate modules can
 *  register into the SAME instance at load and show up in the picker. */
export class ThemeRegistry extends EventTarget {
  #themes: ArkanoidTheme[] = []
  #activeId: string | null = null

  /** Add a theme (idempotent by id). The first registered theme — or the stored pick,
   *  once it registers — becomes active. Announces 'change' so an open picker refreshes. */
  register(theme: ArkanoidTheme): void {
    if (this.#themes.some(t => t.id === theme.id)) return
    this.#themes.push(theme)
    const stored = this.#stored()
    if (this.#activeId === null || theme.id === stored) this.#activeId = stored ?? this.#activeId ?? theme.id
    this.dispatchEvent(new CustomEvent('change'))
  }

  list(): ArkanoidTheme[] { return this.#themes.slice() }
  get(id: string): ArkanoidTheme | undefined { return this.#themes.find(t => t.id === id) }

  /** The active theme, falling back to the first registered (or null if none yet). */
  active(): ArkanoidTheme | null { return this.get(this.#activeId ?? '') ?? this.#themes[0] ?? null }
  activeId(): string | null { return this.active()?.id ?? null }

  setActive(id: string): void {
    if (!this.get(id)) return
    this.#activeId = id
    try { localStorage.setItem(LS_KEY, id) } catch { /* private mode / quota — non-fatal */ }
    this.dispatchEvent(new CustomEvent('change'))
  }

  #stored(): string | null { try { return localStorage.getItem(LS_KEY) } catch { return null } }
}

/** The singleton registry, shared via IoC so any module — built-in or community —
 *  finds and feeds the same one. */
export const arkanoidThemes: ThemeRegistry = ((): ThemeRegistry => {
  const existing = window.ioc?.get<ThemeRegistry>(IOC_KEY)
  if (existing) return existing
  const reg = new ThemeRegistry()
  window.ioc?.register(IOC_KEY, reg)
  return reg
})()
