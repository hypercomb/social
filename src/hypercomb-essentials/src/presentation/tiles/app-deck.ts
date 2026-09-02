// presentation/tiles/app-deck.ts
//
// THE PHONE'S PLATE LANGUAGE — one builder, every surface that speaks it.
//
// A phone draws a menu as APP ICONS, not as a rail of glyphs. A rail is right
// for a pointer — a cursor hits a 34px mark, and a whole column of them is
// read at a glance. On a phone the same rail is twenty small marks that all
// look alike at arm's length, and the one you wanted is somewhere in row four.
//
// So on mobile: plates you can SEE, four across, two rows under whatever the
// screen is about, and everything beyond that one page away — the layout
// every phone already taught its owner. Two surfaces speak it:
//
//   • the tile CLOSE-UP (tile-view.drone.ts) — what THIS TILE opens as, what
//     can be made on it, what can be done to it;
//   • the LAYER DECK (layer-deck.drone.ts) — what THIS LAYER opens as, what
//     can be added here, how you see it.
//
// They must never drift into two dialects — the plate a hand learns on one
// screen has to be the plate it finds on the other — so the deck is built
// HERE and both call in. Each caller brings its own chips and its own `run`;
// this module owns the shape: balanced pages, the dots and arrows that say
// there is more, the dock that never pages, the tones, the hit boxes.
//
// THE PAGES ARE THE CALLER'S OWN GROUPS. A group starts a page and flows onto
// as many as it needs, so the heading over the grid is true of every plate
// under it. Sideways is therefore "the next question", not "eight more of
// whatever was left over". A group spreads EVENLY over the pages it needs
// (9 → 5 + 4, never 8 + 1), and a page splits evenly over its centred rows
// (5 → 3 + 2) while cells keep the column width — see `balancePages` and
// `splitRows`, which are pure so they can be pinned by a spec.
//
// TONE IS THE ONLY THING CARRYING MEANING: steel-FILLED = what it opens as,
// plain = what it can do, rust = destructive.
//
// THUMB-SIZED, ALL OF IT. The page dots were 6.7px and the arrows 17px —
// discoverable in a screenshot and unhittable by a hand. Every control here
// has a hit box of at least `APP_HIT` (2.75rem); the visible dot is an inner
// span, so what the eye sees stays small while what the thumb hits does not.
//
// THE PAGE SURVIVES. The pager's current index is readable (`appDeckPage`)
// and restorable (`page` option), so a surface that tears itself down and
// re-mounts — the close-up after a suspend, the sheet after a rotation —
// lands on the page it left, not on page one.
//
// Data markers (`data-role`, `data-hc-tv-*`) are a CONTRACT: the Playwright
// harness `scripts/drive-mobile-deck.cjs` reads them. Keep them.

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
  /** Plates that never page — about the ROW or the SHEET, not the page. */
  readonly dock?: readonly AppChip[]
  readonly onActivate: (chip: AppChip) => void
  /** The caller's caption resolver — `t()` echoes the key when it cannot
   *  resolve one, so the caller guards and this module never sees a key. */
  readonly t: (key: string, fallback: string) => string
  /** The page to land on. Clamped. */
  readonly page?: number
  readonly cols?: number
  readonly rows?: number
}

export const STEEL = 'rgba(126,182,214,0.92)'
export const DIM = 'rgba(207,226,238,0.62)'
/** Between plates and their heading, between the blocks of a deck. */
export const TIGHT_GAP = '0.5rem'
/** Portrait: four across, two rows. */
export const APP_COLS = 4
export const APP_ROWS = 2
/** Landscape is short: ONE row, six across, beside the picture — so the dock,
 *  the only way back, is never below the fold. */
export const APP_LANDSCAPE_COLS = 6
export const APP_LANDSCAPE_ROWS = 1
/** Plate edge — near enough the 60pt icon a home screen uses that the hand
 *  already knows the target. */
export const APP_PLATE = '3.4rem'
/** The dock's plates, one step down, the way a dock's are. */
export const APP_DOCK_PLATE = '2.9rem'
/** ~23% of the plate: the squircle proportion. Not a circle (that is a
 *  button) and not a box (that is a form field) — the one place the cold
 *  near-square chrome radius does not apply, because a home-screen icon that
 *  is not squircular reads as a broken one. */
export const APP_PLATE_RADIUS = '0.8rem'
/** Glyph inside the plate — just over half of it, as a phone icon's is. */
export const APP_GLYPH = '1.75rem'
export const APP_DOCK_GLYPH = '1.5rem'
/** One cell: plate, its gap, and two lines of name. FIXED, so every row of
 *  every page lands on the same baseline and the pager never changes height
 *  under a finger that is swiping it. */
export const APP_CELL_H = '5.5rem'
export const APP_ROW_GAP = '0.35rem'
export const APP_COL_GAP = '0.2rem'
/** The thumb floor for a control you page with. */
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
/** Idle dot in the page row. */
export const DOT_IDLE = 'rgba(207,226,238,0.30)'

// ── the pure parts ─────────────────────────────────────────

/**
 * BALANCED, NOT GREEDY. Filling each page to `per` leaves a group of nine as
 * a full page and then a single lonely icon, which reads as a mistake.
 * Spreading the group over the same number of pages costs nothing and gives
 * 5 + 4. Every group starts a page of its own.
 */
export function balancePages<T>(
  groups: ReadonlyArray<{ readonly title: string; readonly chips: readonly T[] }>,
  per: number,
): Array<{ title: string; chips: T[] }> {
  const size = Math.max(1, Math.floor(per))
  const pages: Array<{ title: string; chips: T[] }> = []
  for (const group of groups) {
    const total = group.chips.length
    if (total === 0) continue
    const sheets = Math.max(1, Math.ceil(total / size))
    // An EVEN spread, remainder to the first pages: 13 over 3 is 5 + 4 + 4,
    // not 5 + 5 + 3 — the last page is never the thin one.
    const base = Math.floor(total / sheets)
    const extra = total % sheets
    let at = 0
    for (let sheet = 0; sheet < sheets; sheet++) {
      const each = base + (sheet < extra ? 1 : 0)
      pages.push({ title: group.title, chips: group.chips.slice(at, at + each) })
      at += each
    }
  }
  return pages
}

/**
 * ONE PAGE'S ROWS — centred rows, not a grid. A four-column grid fills left
 * to right and leaves five icons as four and then a lone one hanging off the
 * left edge; on a centred column the orphan reads as a mistake. So a page
 * splits its icons EVENLY over the rows it needs (5 → 3 + 2, 7 → 4 + 3) and
 * centres each, while every cell keeps the column width so icons still line
 * up down the deck from page to page. A page that fits one row is one row.
 */
export function splitRows<T>(chips: readonly T[], cols: number, rows: number): T[][] {
  const width = Math.max(1, Math.floor(cols))
  const depth = Math.max(1, Math.floor(rows))
  if (chips.length === 0) return []
  const count = Math.min(depth, Math.ceil(chips.length / width))
  const each = Math.ceil(chips.length / count)
  const out: T[][] = []
  for (let i = 0; i < chips.length; i += each) out.push(chips.slice(i, i + each))
  return out
}

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
 *  clamp, the hidden scrollbar — scoped to the surface that installs it. */
export function appDeckCss(scope: string): string {
  return `
${scope} [data-hc-tv-app] { transition: transform 0.13s ease, opacity 0.13s ease; -webkit-tap-highlight-color: transparent; }
${scope} [data-hc-tv-app]:active { transform: scale(0.9); }
${scope} [data-hc-tv-app] [data-role="app-name"] { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
${scope} [data-hc-tv-deck] { scrollbar-width: none; }
${scope} [data-hc-tv-deck]::-webkit-scrollbar { width: 0; height: 0; display: none; }
${scope} [data-hc-tv-dot] { -webkit-tap-highlight-color: transparent; }
${scope} [data-hc-tv-dot] > span { transition: background 0.16s ease; }
${scope} [data-hc-tv-page-arrow] { transition: opacity 0.16s ease; -webkit-tap-highlight-color: transparent; }
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

/** The page a built deck is on — what a caller stashes before tearing its
 *  surface down, and hands back as `page` on the next build. 0 for no deck. */
export function appDeckPage(deck: Element | null | undefined): number {
  const pager = deck?.querySelector?.('[data-role="deck-pager"]') as HTMLElement | null | undefined
  const n = Number(pager?.dataset?.['page'] ?? '0')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
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

/** One page of the deck: its centred rows. */
function buildAppPage(
  chips: readonly AppChip[],
  cols: number,
  rows: number,
  t: AppDeckOptions['t'],
  onActivate: (chip: AppChip) => void,
): HTMLElement {
  const page = document.createElement('div')
  page.dataset['role'] = 'deck-page'
  page.style.cssText =
    'flex:0 0 100%;scroll-snap-align:start;display:flex;flex-direction:column;' +
    `justify-content:flex-start;gap:${APP_ROW_GAP};`
  for (const rowChips of splitRows(chips, cols, rows)) {
    const row = document.createElement('div')
    row.style.cssText =
      `display:flex;justify-content:center;gap:${APP_COL_GAP};height:${APP_CELL_H};width:100%;`
    for (const chip of rowChips) {
      const cell = buildAppCell(chip, t, onActivate)
      // The column width, whatever this row happens to hold.
      cell.style.flex = `0 0 calc((100% - ${cols - 1} * ${APP_COL_GAP}) / ${cols})`
      row.appendChild(cell)
    }
    page.appendChild(row)
  }
  return page
}

/**
 * ROWS OF APP ICONS, AND A PAGE FOR THE REST.
 *
 * HOW YOU FIND OUT THERE IS MORE — the one thing a phone cannot infer, and the
 * reason a paged menu is usually a menu with half its verbs missing: a live
 * count beside the heading, a row of page dots that are also the way to jump,
 * and an arrow at each end that fades out when there is nothing that way.
 * Three signals for one fact, deliberately.
 *
 * THE DOCK never pages, and its plates are NAMED: a dock of unnamed glyphs
 * assumes icons you already know, and the one way out of a full screen is
 * not something to make anyone guess at.
 */
export function buildAppDeck(opts: AppDeckOptions): HTMLElement {
  const cols = Math.max(1, Math.floor(opts.cols ?? APP_COLS))
  const rows = Math.max(1, Math.floor(opts.rows ?? APP_ROWS))
  const { t, onActivate } = opts

  const section = document.createElement('section')
  section.dataset['role'] = 'app-deck'
  section.dataset['cols'] = String(cols)
  section.dataset['rows'] = String(rows)
  section.style.cssText =
    `display:flex;flex-direction:column;align-items:stretch;gap:${TIGHT_GAP};width:100%;`
  // A drag that starts in here is a page turn or a scroll — never the host's
  // step to the next tile. Same claim the hex zone makes for its faces.
  section.addEventListener('pointerdown', e => { e.stopPropagation() })

  const pages = balancePages(opts.groups, cols * rows)

  if (pages.length > 0) {
    const head = document.createElement('div')
    head.dataset['role'] = 'deck-head'
    head.style.cssText =
      'display:flex;align-items:baseline;justify-content:space-between;gap:0.6rem;width:100%;'
    const title = document.createElement('div')
    title.dataset['role'] = 'deck-title'
    title.style.cssText =
      'font-size:0.74rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;' +
      `color:${DIM};opacity:0.75;min-width:0;overflow:hidden;text-overflow:ellipsis;` +
      'white-space:nowrap;text-align:left;'
    head.appendChild(title)
    // The count is the plainest of the three "there is more" signals, and the
    // only one that says HOW MUCH more. Hidden (not removed) on a single-page
    // deck, so the heading never shifts sideways between builds.
    const count = document.createElement('div')
    count.dataset['role'] = 'deck-count'
    count.style.cssText =
      `font-size:0.7rem;font-weight:600;letter-spacing:0.08em;color:${DIM};opacity:0.6;` +
      `flex:0 0 auto;visibility:${pages.length > 1 ? 'visible' : 'hidden'};`
    head.appendChild(count)
    section.appendChild(head)

    const pager = document.createElement('div')
    pager.dataset['role'] = 'deck-pager'
    pager.setAttribute('data-hc-tv-deck', '')
    const landing = Math.max(0, Math.min(pages.length - 1, Math.floor(opts.page ?? 0) || 0))
    pager.dataset['page'] = String(landing)
    pager.style.cssText =
      'display:flex;width:100%;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;' +
      // BOTH AXES. The pager is a scroll container, which is where a host's
      // blanket `touch-action:none` gets re-granted: sideways for the pages,
      // downward so a drag that lands on an icon still scrolls the column
      // instead of dying.
      'touch-action:pan-x pan-y;overscroll-behavior-x:contain;' +
      // FIXED HEIGHT, always the full rows' worth. A page holding three icons
      // must be exactly as tall as one holding eight, or the dots and the dock
      // jump under the finger that is swiping between them.
      `height:calc(${rows} * ${APP_CELL_H} + ${rows - 1} * ${APP_ROW_GAP});`
    for (const page of pages) {
      pager.appendChild(buildAppPage(page.chips, cols, rows, t, onActivate))
    }
    section.appendChild(pager)

    const to = (index: number, behavior: ScrollBehavior = 'smooth'): void => {
      const at = Math.max(0, Math.min(pages.length - 1, index))
      const left = at * pager.clientWidth
      if (typeof pager.scrollTo === 'function') pager.scrollTo({ left, behavior })
      else pager.scrollLeft = left
    }
    const nav = document.createElement('div')
    nav.dataset['role'] = 'deck-nav'
    nav.style.cssText =
      'display:flex;align-items:center;justify-content:center;gap:0;width:100%;' +
      `min-height:${APP_HIT};visibility:${pages.length > 1 ? 'visible' : 'hidden'};`
    const arrow = (delta: -1 | 1): HTMLElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.setAttribute('data-hc-tv-page-arrow', delta < 0 ? 'prev' : 'next')
      btn.setAttribute('aria-label', t(
        delta < 0 ? 'tile-view.page-previous' : 'tile-view.page-next',
        delta < 0 ? 'previous page' : 'more',
      ))
      btn.textContent = delta < 0 ? 'chevron_left' : 'chevron_right'
      // A thumb-sized box around a small glyph: the mark stays quiet, the
      // target does not.
      btn.style.cssText =
        `font-family:'Material Symbols Outlined';font-size:1.15rem;line-height:1;color:${STEEL};` +
        'background:none;border:none;padding:0;cursor:pointer;opacity:0.55;flex:0 0 auto;' +
        'display:flex;align-items:center;justify-content:center;'
      btn.style.width = APP_HIT
      btn.style.height = APP_HIT
      btn.addEventListener('click', () => { to(Number(pager.dataset['page'] ?? '0') + delta) })
      return btn
    }
    const prev = arrow(-1)
    nav.appendChild(prev)
    const dots: HTMLElement[] = []
    pages.forEach((page, index) => {
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.setAttribute('data-hc-tv-dot', '')
      dot.setAttribute('aria-label', page.title)
      // The BUTTON is the hit box; the dot the eye sees is the span inside.
      // The box may give up width on a deck with many pages, never height.
      dot.style.cssText =
        `flex:0 1 ${APP_HIT};min-width:1.6rem;height:${APP_HIT};border:none;padding:0;` +
        'display:flex;align-items:center;justify-content:center;cursor:pointer;background:none;'
      const mark = document.createElement('span')
      mark.style.cssText =
        `width:0.42rem;height:0.42rem;flex:0 0 auto;border-radius:50%;background:${DOT_IDLE};`
      dot.appendChild(mark)
      dot.addEventListener('click', () => { to(index) })
      nav.appendChild(dot)
      dots.push(dot)
    })
    const next = arrow(1)
    nav.appendChild(next)
    section.appendChild(nav)

    /** Everything that says WHERE YOU ARE, from one number. */
    const paint = (index: number): void => {
      pager.dataset['page'] = String(index)
      title.textContent = pages[index]?.title ?? ''
      count.textContent = `${index + 1}/${pages.length}`
      dots.forEach((dot, i) => {
        const mark = dot.firstElementChild as HTMLElement | null
        if (mark) mark.style.background = i === index ? STEEL : DOT_IDLE
      })
      prev.style.opacity = index === 0 ? '0' : '0.55'
      prev.style.pointerEvents = index === 0 ? 'none' : 'auto'
      next.style.opacity = index === pages.length - 1 ? '0' : '0.55'
      next.style.pointerEvents = index === pages.length - 1 ? 'none' : 'auto'
    }
    const sync = (): void => {
      const width = pager.clientWidth || 1
      paint(Math.max(0, Math.min(pages.length - 1, Math.round(pager.scrollLeft / width))))
    }
    paint(landing)
    let queued = false
    pager.addEventListener('scroll', () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; sync() })
    }, { passive: true })
    // THE PAGE IS A SCROLL OFFSET IN A BOX THAT HAS NO WIDTH YET. The section
    // is built detached; the landing page can only be scrolled to once the
    // caller has put it on screen — next frame, without animation, so a
    // re-mount lands where it left rather than sliding there.
    if (landing > 0 && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { to(landing, 'instant' as ScrollBehavior) })
    }
    // A page turn is a scroll, and the click it leaves behind would fire
    // whichever icon the finger happened to come up over. Capture phase.
    let from = 0
    pager.addEventListener('pointerdown', () => { from = pager.scrollLeft })
    pager.addEventListener('click', e => {
      if (Math.abs(pager.scrollLeft - from) < 4) return
      e.preventDefault()
      e.stopPropagation()
    }, true)
  }

  // THE DOCK — what is about the row or the sheet rather than the page, so it
  // stays put whatever page you are on.
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
      cell.style.width = '4.4rem'
      dock.appendChild(cell)
    }
    section.appendChild(dock)
  }
  return section
}
