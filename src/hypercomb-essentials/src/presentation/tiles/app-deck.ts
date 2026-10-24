// presentation/tiles/app-deck.ts
//
// THE PHONE'S MENU LANGUAGE — one builder, every surface that speaks it.
//
// A phone draws a menu as EXPANSION ROWS. Each of the caller's groups is one
// row: its name, how many it holds, and a chevron. Tap the row and it opens to
// its items in ONE sideways strip; tap another and that one opens instead (one
// open at a time, the accordion rule). A group too long for the screen scrolls
// sideways inside its own strip, and the deck as a whole scrolls with the
// column it sits in — so nothing is ever a page away and nothing needs dots.
//
// jwize 2026-10-23: "our mobile application needs to be simplified. Let's make
// expansion menu rows and not have another icon view. when there are too many
// we can scroll horizontally or vertically whatever is the best experience."
// This replaced the paged app-icon deck (four across, two rows, dots, arrows):
// a second home screen inside the app was one more thing to learn.
//
// Two surfaces speak it:
//
//   • the tile CLOSE-UP (tile-view.drone.ts) — what THIS TILE opens as, what
//     can be made on it, what can be done to it;
//   • the LAYER DECK (layer-deck.drone.ts) — what THIS LAYER opens as, what
//     can be added here, how you see it.
//
// They must never drift into two dialects, so the deck is built HERE and both
// call in. Each caller brings its own chips and its own `run`; this module
// owns the shape: the rows, the strips, the dock that stays put, the tones,
// the hit boxes.
//
// TONE IS THE ONLY THING CARRYING MEANING: steel-FILLED = what it opens as,
// plain = what it can do, rust = destructive.
//
// THUMB-SIZED, ALL OF IT: every row head is at least `APP_HIT` tall.
//
// THE OPEN ROW SURVIVES. Which row is open is readable (`appDeckPage`) and
// restorable (`page` option), so a surface that tears itself down and
// re-mounts — the close-up after a suspend, the sheet after a rotation —
// opens the row it left.
//
// Data markers (`data-role`, `data-hc-tv-*`) are a CONTRACT: the Playwright
// harnesses `scripts/drive-mobile-deck.cjs` and `scripts/drive-layer-deck.cjs`
// read them. Keep them.

export type AppChip = {
  action: string
  /** A Material Symbols ligature. Exactly one of `glyph` / `svg`. */
  glyph?: string
  /** Raw 24×24 white-filled markup, which is what the overlay's registered
   *  affordances carry. */
  svg?: string
  labelKey: string
  fallback: string
  /** Shades the plate inert while its bee is still registering — a tap that
   *  silently no-ops during boot is worse than a visibly unavailable control. */
  backingKey?: string
  when?: () => boolean
  /** Steel-filled: what this opens AS. */
  accent?: boolean
  /** Rust: remove, block — the one cell you must not hit by accident. */
  danger?: boolean
  /** A small mark in the plate's corner — the lane rung's digit. */
  badge?: string
  /** What the plate does. A chip without one is handed to the caller's
   *  `onActivate` alone, which decides the default. */
  run?: () => void
}

export type AppDeckGroup = { readonly title: string; readonly chips: readonly AppChip[] }

export type AppDeckOptions = {
  readonly groups: readonly AppDeckGroup[]
  /** Items that stay put under the rows — about the SURFACE (back, close,
   *  the sideways walk), not about any one group. */
  readonly dock?: readonly AppChip[]
  readonly onActivate: (chip: AppChip) => void
  /** The caller's caption resolver — `t()` echoes the key when it cannot
   *  resolve one, so the caller guards and this module never sees a key. */
  readonly t: (key: string, fallback: string) => string
  /** The row to open, by index among the non-empty groups; -1 opens none.
   *  Clamped. */
  readonly page?: number
}

export const STEEL = 'rgba(126,182,214,0.92)'
export const DIM = 'rgba(207,226,238,0.62)'
/** Between plates and their heading, between the blocks of a deck. */
export const TIGHT_GAP = '0.5rem'
/** An item's plate in a strip — small enough that a phone's width shows five
 *  or so, big enough that the tone still reads. */
export const APP_PLATE = '2.6rem'
/** The dock's plates, the same step. */
export const APP_DOCK_PLATE = '2.6rem'
/** ~23% of the plate: the squircle proportion. Not a circle (that is a
 *  button) and not a box (that is a form field). */
export const APP_PLATE_RADIUS = '0.62rem'
/** Glyph inside the plate — just over half of it. */
export const APP_GLYPH = '1.4rem'
export const APP_DOCK_GLYPH = '1.4rem'
/** One item in a strip: the plate and two lines of name. FIXED, so a strip
 *  never changes width under a finger that is swiping it. */
export const APP_ITEM_W = '4.4rem'
/** The thumb floor for a row head. */
export const APP_HIT = '2.75rem'
/** The three plate tones. Cold steel throughout — an ACCENT is the same steel
 *  turned up, never a second hue — with one exception: destructive verbs wear
 *  a desaturated rust, because `remove` must not look like `note`. */
export const APP_TONES = {
  plain: {
    fill: 'linear-gradient(180deg, rgba(126,182,214,0.155), rgba(126,182,214,0.055))',
    edge: 'rgba(126,182,214,0.22)',
    glyph: 'rgba(233,240,246,0.92)',
  },
  accent: {
    fill: 'linear-gradient(180deg, rgba(126,182,214,0.46), rgba(126,182,214,0.20))',
    edge: 'rgba(126,182,214,0.58)',
    glyph: 'rgba(248,252,255,0.98)',
  },
  danger: {
    fill: 'linear-gradient(180deg, rgba(214,126,126,0.30), rgba(214,126,126,0.11))',
    edge: 'rgba(214,126,126,0.36)',
    glyph: 'rgba(247,228,228,0.94)',
  },
} as const
// ── the pure parts ─────────────────────────────────────────

/**
 * THE TAP DOOR. On a phone a tile that carries a view IS an icon that opens
 * it: one view → open it; several → the close-up on its "open as" page, which
 * is the screen for choosing; none → the tap does what it always did and goes
 * inside. Decided here, pure, so the overlay's tap branch stays one line.
 */
export function viewDoorFor(views: readonly string[]): 'view' | 'menu' | 'enter' {
  if (views.length === 1) return 'view'
  if (views.length > 1) return 'menu'
  return 'enter'
}

// ── the stylesheet ─────────────────────────────────────────

/** Chrome the inline styles cannot express — pressed feedback, the name
 *  clamp, the hidden scrollbar, the chevron's turn — scoped to the surface
 *  that installs it. */
export function appDeckCss(scope: string): string {
  return `
${scope} [data-hc-tv-app] { transition: transform 0.13s ease, opacity 0.13s ease; -webkit-tap-highlight-color: transparent; }
${scope} [data-hc-tv-app]:active { transform: scale(0.9); }
${scope} [data-hc-tv-app] [data-role="app-name"] { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
${scope} [data-hc-tv-deck] { scrollbar-width: none; }
${scope} [data-hc-tv-deck]::-webkit-scrollbar { width: 0; height: 0; display: none; }
${scope} [data-hc-tv-deck][data-more] { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 2.2rem), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 2.2rem), transparent); }
${scope} [data-hc-tv-group] { -webkit-tap-highlight-color: transparent; }
${scope} [data-hc-tv-group] [data-role="deck-chevron"] { transition: transform 0.16s ease; }
${scope} [data-hc-tv-group][aria-expanded="true"] [data-role="deck-chevron"] { transform: rotate(180deg); }
`
}

const installed = new Set<string>()

/** Install the deck's stylesheet once per scope (`#hc-tile-view-host`,
 *  `hc-layer-deck`). Idempotent. */
export function installAppDeckCss(scope: string): void {
  if (installed.has(scope) || typeof document === 'undefined') return
  installed.add(scope)
  const style = document.createElement('style')
  style.setAttribute('data-hc-app-deck-css', scope)
  style.textContent = appDeckCss(scope)
  document.head.appendChild(style)
}

// ── the DOM ────────────────────────────────────────────────

/** The row a built deck has open — what a caller stashes before tearing its
 *  surface down, and hands back as `page` on the next build. -1 when every
 *  row is shut, 0 for no deck. */
export function appDeckPage(deck: Element | null | undefined): number {
  const n = Number((deck as HTMLElement | null | undefined)?.dataset?.['open'] ?? '0')
  return Number.isFinite(n) && n >= -1 ? Math.floor(n) : 0
}

/**
 * ONE APP ICON: a plate you can see, and its name under it.
 *
 * The PLATE is the whole change from a rail. A bare glyph is a mark on black
 * — at arm's length twenty of them are one texture, and picking one out means
 * reading every caption. A filled plate has an outline, a size and a tone,
 * which is what turns "the bright one, top left" into something a hand learns
 * once and then never re-reads. An icon whose bee has not registered yet is
 * shaded and inert.
 */
export function buildAppCell(
  chip: AppChip,
  t: AppDeckOptions['t'],
  onActivate: (chip: AppChip) => void,
  opts: { size?: string; glyph?: string; named?: boolean } = {},
): HTMLElement {
  const inert = !!chip.backingKey && !window.ioc?.has?.(chip.backingKey)
  const text = t(chip.labelKey, chip.fallback)
  const size = opts.size ?? APP_PLATE
  const glyphSize = opts.glyph ?? APP_GLYPH
  const tone = chip.danger ? APP_TONES.danger : chip.accent ? APP_TONES.accent : APP_TONES.plain

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.setAttribute('aria-label', text)
  btn.setAttribute('data-hc-tv-app', '')
  btn.dataset['action'] = chip.action
  btn.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;' +
    'gap:0.34rem;min-width:0;padding:0;background:none;border:none;cursor:pointer;' +
    `color:${tone.glyph};`
  btn.style.opacity = inert ? '0.32' : '1'
  btn.style.pointerEvents = inert ? 'none' : 'auto'

  // THE PLATE IS THE BUTTON'S FIRST CHILD — the harness reads its tone off
  // `firstElementChild.style.background`.
  const plate = document.createElement('span')
  plate.dataset['tone'] = chip.danger ? 'danger' : chip.accent ? 'accent' : 'plain'
  plate.style.cssText =
    `flex:0 0 auto;position:relative;width:${size};height:${size};border-radius:${APP_PLATE_RADIUS};` +
    'box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
    `background:${tone.fill};border:1px solid ${tone.edge};` +
    // One hairline of light along the top edge is the entire relief. More
    // than that and it stops being a plate and starts being a button from
    // somebody else's application.
    'box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);'

  const icon = document.createElement('span')
  icon.style.cssText =
    `display:flex;align-items:center;justify-content:center;width:${glyphSize};height:${glyphSize};`
  if (chip.svg) {
    // Provider markup: 24×24, `fill="white"`. Sized to the plate's glyph box
    // and recoloured through `currentColor`, so the tone tints it.
    icon.innerHTML = chip.svg
    const svg = icon.firstElementChild as SVGElement | null
    if (svg) {
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.setAttribute('fill', 'currentColor')
    }
  } else {
    icon.textContent = chip.glyph ?? ''
    icon.style.cssText += `font-family:'Material Symbols Outlined';font-size:${glyphSize};line-height:1;`
  }
  plate.appendChild(icon)
  if (chip.badge) {
    // The rung's digit: a small mark in the corner of the plate, over its own
    // dark ground so it reads on any tone.
    const badge = document.createElement('span')
    badge.dataset['role'] = 'app-badge'
    badge.textContent = chip.badge
    badge.style.cssText =
      'position:absolute;right:0.18rem;bottom:0.14rem;font-size:0.7rem;font-weight:700;' +
      'line-height:1;padding:0.1rem 0.2rem;border-radius:2px;background:rgba(5,4,15,0.62);' +
      `color:${tone.glyph};`
    plate.appendChild(badge)
  }
  btn.appendChild(plate)

  if (opts.named !== false) {
    const name = document.createElement('span')
    name.dataset['role'] = 'app-name'
    name.textContent = text
    // TWO lines, clipped after (the clamp lives in the stylesheet). "break
    // apart" and "make it public" are two words each and both have to survive;
    // the fixed cell height means a second line costs the row below nothing.
    name.style.cssText =
      'font-size:0.7rem;font-weight:600;line-height:1.18;letter-spacing:0.01em;' +
      'width:100%;text-align:center;word-break:break-word;text-transform:lowercase;' +
      'color:rgba(233,240,246,0.74);'
    btn.appendChild(name)
  }

  btn.addEventListener('click', () => { onActivate(chip) })
  return btn
}

/** One group's strip: its items in a single sideways line, scrolling inside
 *  itself when there are more than the width holds. */
function buildStrip(
  chips: readonly AppChip[],
  t: AppDeckOptions['t'],
  onActivate: (chip: AppChip) => void,
): HTMLElement {
  const strip = document.createElement('div')
  strip.dataset['role'] = 'deck-strip'
  strip.setAttribute('data-hc-tv-deck', '')
  strip.style.cssText =
    'display:flex;gap:0.25rem;width:100%;overflow-x:auto;overflow-y:hidden;' +
    // BOTH AXES. The strip is a scroll container, which is where a host's
    // blanket `touch-action:none` gets re-granted: sideways for the strip,
    // downward so a drag that lands on an item still scrolls the column.
    'touch-action:pan-x pan-y;overscroll-behavior-x:contain;padding:0.2rem 0 0.45rem;'
  for (const chip of chips) {
    const cell = buildAppCell(chip, t, onActivate)
    cell.style.flex = `0 0 ${APP_ITEM_W}`
    strip.appendChild(cell)
  }
  // THERE IS MORE TO THE RIGHT — the one thing a strip cannot say by itself.
  // The far edge fades while anything is still hidden past it, and stops
  // fading at the end so the last item is never half-veiled.
  const sync = (): void => {
    const more = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2
    if (more) strip.setAttribute('data-more', '')
    else strip.removeAttribute('data-more')
  }
  // Three reads and an attribute: cheap enough to run on every scroll event,
  // and a frame-gated version never runs in a tab the browser is not drawing.
  strip.addEventListener('scroll', sync, { passive: true })
  // A swipe along the strip is a scroll, and the click it leaves behind would
  // fire whichever item the finger came up over. Capture phase.
  let from = 0
  strip.addEventListener('pointerdown', () => { from = strip.scrollLeft })
  strip.addEventListener('click', e => {
    if (Math.abs(strip.scrollLeft - from) < 4) return
    e.preventDefault()
    e.stopPropagation()
  }, true)
  ;(strip as HTMLElement & { hcSync?: () => void }).hcSync = sync
  return strip
}

/**
 * EXPANSION ROWS, ONE OPEN AT A TIME.
 *
 * A row head is a full-width button: the group's name, how many it holds, and
 * a chevron. Tapping it opens its strip and shuts the one that was open;
 * tapping the open one shuts it. Every group is visible as a row at all times,
 * so "is there more?" is answered by looking — the old paged deck needed a
 * count, dots and arrows to say the same thing.
 *
 * THE DOCK stays under the rows, and its items are NAMED: the one way out of
 * a full screen is not something to make anyone guess at.
 */
export function buildAppDeck(opts: AppDeckOptions): HTMLElement {
  const { t, onActivate } = opts
  const groups = opts.groups.filter(group => group.chips.length > 0)

  const section = document.createElement('section')
  section.dataset['role'] = 'app-deck'
  section.style.cssText =
    `display:flex;flex-direction:column;align-items:stretch;gap:${TIGHT_GAP};width:100%;`
  // A drag that starts in here is a scroll — never the host's step to the
  // next tile. Same claim the hex zone makes for its faces.
  section.addEventListener('pointerdown', e => { e.stopPropagation() })

  const requested = Math.floor(opts.page ?? 0) || 0
  const landing = requested < 0 ? -1 : Math.min(groups.length - 1, requested)
  section.dataset['open'] = String(landing)

  if (groups.length > 0) {
    const list = document.createElement('div')
    list.dataset['role'] = 'deck-rows'
    list.style.cssText = 'display:flex;flex-direction:column;width:100%;'
    const heads: HTMLElement[] = []
    const strips: Array<HTMLElement & { hcSync?: () => void }> = []
    const paint = (open: number): void => {
      section.dataset['open'] = String(open)
      heads.forEach((head, i) => { head.setAttribute('aria-expanded', i === open ? 'true' : 'false') })
      strips.forEach((strip, i) => { strip.style.display = i === open ? 'flex' : 'none' })
      // A strip measures only once it is shown: now when the deck is already
      // on screen, and next frame on the first build, which is still detached.
      const shown = strips[open]
      shown?.hcSync?.()
      if (shown?.hcSync && typeof requestAnimationFrame === 'function') requestAnimationFrame(shown.hcSync)
    }
    groups.forEach((group, index) => {
      const row = document.createElement('div')
      row.dataset['role'] = 'deck-row'
      row.style.cssText =
        'display:flex;flex-direction:column;width:100%;' +
        (index > 0 ? 'border-top:1px solid rgba(255,255,255,0.07);' : '')
      const head = document.createElement('button')
      head.type = 'button'
      head.dataset['role'] = 'deck-row-head'
      head.setAttribute('data-hc-tv-group', '')
      head.setAttribute('aria-label', group.title)
      head.style.cssText =
        'display:flex;align-items:center;gap:0.6rem;width:100%;' +
        'padding:0 0.1rem;background:none;border:none;cursor:pointer;text-align:left;' +
        `color:${DIM};font:inherit;`
      head.style.minHeight = APP_HIT
      const title = document.createElement('span')
      title.dataset['role'] = 'deck-title'
      title.textContent = group.title
      title.style.cssText =
        'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
        'font-size:0.78rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;'
      const count = document.createElement('span')
      count.dataset['role'] = 'deck-count'
      count.textContent = String(group.chips.length)
      count.style.cssText = 'flex:0 0 auto;font-size:0.74rem;font-weight:600;opacity:0.6;'
      const chevron = document.createElement('span')
      chevron.dataset['role'] = 'deck-chevron'
      chevron.textContent = 'expand_more'
      chevron.style.cssText =
        `flex:0 0 auto;font-family:'Material Symbols Outlined';font-size:1.25rem;line-height:1;color:${STEEL};`
      head.append(title, count, chevron)
      head.addEventListener('click', () => {
        paint(Number(section.dataset['open']) === index ? -1 : index)
      })
      const strip = buildStrip(group.chips, t, onActivate)
      heads.push(head)
      strips.push(strip)
      row.append(head, strip)
      list.appendChild(row)
    })
    paint(landing)
    section.appendChild(list)
  }

  // THE DOCK — what is about the surface rather than any one group, so it
  // stays put whichever row is open.
  if (opts.dock && opts.dock.length > 0) {
    const dock = document.createElement('div')
    dock.dataset['role'] = 'deck-dock'
    dock.style.cssText =
      'display:flex;align-items:flex-start;justify-content:center;gap:1.15rem;width:100%;' +
      'border-top:1px solid rgba(255,255,255,0.07);padding-top:0.7rem;'
    for (const chip of opts.dock) {
      const cell = buildAppCell(chip, t, onActivate, {
        size: APP_DOCK_PLATE,
        glyph: APP_DOCK_GLYPH,
        named: true,
      })
      cell.style.width = APP_ITEM_W
      dock.appendChild(cell)
    }
    section.appendChild(dock)
  }
  return section
}
