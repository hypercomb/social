// presentation/tiles/site-context-menu.ts
//
// THE WEBSITE'S RIGHT-CLICK, on a PUBLISHED door. A site reads like a website,
// so the right button does what it does on any website: it opens a menu and
// changes nothing on the page. The menu is where a visitor learns Hypercomb is
// behind the page: it says how to reach the hexagon view (and goes there), how
// to open the creation in their own hive, and holds the few things a reader of
// a page wants — up a level, the page's link, a link's address. The hexagons
// keep the hive's own right-click (come back out), and so does a site in the
// reader's own hive; only the website view on a published door opens this.
//
// Raw DOM in an open shadow root on <body>: a page's linked stylesheets are
// hoisted unscoped and style `*`, `a` and `nav`, so the menu keeps its own
// sheet out of their reach while the theme's custom properties still inherit
// through. Sized from the reader's own default (`medium` on the host), never
// rem — a page's `html{font-size:62.5%}` reset would otherwise shrink it. Its
// glyphs are inline SVG: a published door never loads the icon font. It weighs
// nothing on a published site's arrival — no IoC, no registration (a
// dependency registers nothing); the website view owns it.
//
// While it is up it holds the keyboard: the hive's keymap would otherwise
// answer Enter (paste), Space, the arrows and its single-letter words behind
// it — `keymap:suppress` leaves only the piercing Escape, and the escape
// cascade stands aside for `data-escape-local`.
//
// A row that opens the hive is a DOOR (`data-hc-approach` on the host): the
// visitor runtime starts preloading the sleeping hive the moment the menu is
// focused or approached, so choosing it wakes warm.

import { consumePointerGesture, EffectBus } from '@hypercomb/core'

export type SiteMenuItem = {
  /** A glyph from GLYPHS by name; an unknown name draws none. */
  readonly icon: string
  readonly label: string
  /** Shown in place of the label for a beat once the act succeeds (Copied). */
  readonly done?: string
  /** Shown in place of the label for a beat when the act fails. */
  readonly failed?: string
  /** A door into the hive — approaching the menu preloads what it opens. */
  readonly door?: boolean
  /** Starts a new group: a hairline above the row. */
  readonly rule?: boolean
  readonly act: () => unknown
}

export const SITE_MENU_ID = 'hc-site-menu'

/** Kept off the viewport's edges, in px. */
const MARGIN = 8
/** How long a row says it is done before the menu goes. */
const DONE_MS = 700
/** Above the site host (59988) and its exit button (2147483600). */
const Z = 2147483601
const KEYMAP_REASON = 'site-menu'

/** The menu's glyphs, drawn on a 24-unit grid in the current text colour. */
const GLYPHS: Readonly<Record<string, string>> = {
  arrow_upward: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  hexagon: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  content_copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  open_in_new: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
}

const CSS = `
:host{all:initial;direction:inherit;font-size:medium}
.menu{min-width:15em;max-width:min(22em,calc(100vw - ${MARGIN * 2}px));box-sizing:border-box;padding:0.3em 0;background:rgb(var(--hc-chrome-glass,250,251,253));color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-plain,0.92));border:1px solid rgba(var(--hc-chrome-rule,62,74,94),0.34);border-radius:var(--hc-radius-floating,4px);box-shadow:0 8px 28px rgba(0,0,0,0.22);font-family:var(--hc-font,system-ui,-apple-system,'Segoe UI',sans-serif);font-size:0.875em;line-height:1.3;outline:none;-webkit-user-select:none;user-select:none}
.item{all:unset;box-sizing:border-box;display:grid;grid-template-columns:1.8em 1fr;align-items:center;gap:0.55em;width:100%;min-height:2.3em;padding:0 0.9em 0 0.7em;cursor:pointer;color:inherit}
.item:hover{background:rgba(var(--hc-chrome-accent,20,96,180),0.1)}
.item:focus-visible{background:rgba(var(--hc-chrome-accent,20,96,180),0.1);outline:2px solid rgb(var(--hc-chrome-accent,20,96,180));outline-offset:-2px}
.glyph{width:1.25em;height:1.25em;justify-self:center;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;color:rgba(var(--hc-chrome-ink,26,33,48),var(--hc-ink-a-quiet,0.7))}
.rule{height:1px;margin:0.35em 0;background:rgba(var(--hc-chrome-rule,62,74,94),0.16)}
.said{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

let current: { close(): void } | null = null

/** Is the menu up? */
export const isSiteContextMenuOpen = (): boolean => current !== null

/** Did this event happen on the menu itself (through its shadow root)? */
export const isOnSiteContextMenu = (e: Event): boolean =>
  e.composedPath().some(node => node instanceof Element && node.id === SITE_MENU_ID)

/** Put the menu away, if it is up. */
export function closeSiteContextMenu(): void {
  current?.close()
}

/** Open the menu at a viewport point. One menu at a time: a second right-click
 *  moves it. `name` is what a screen reader calls the menu. */
export function openSiteContextMenu(at: { x: number; y: number }, items: readonly SiteMenuItem[], name = ''): void {
  closeSiteContextMenu()
  if (!items.length) return

  // Focus goes back where it was — down through any shadow root it sat in.
  let previous: Element | null = document.activeElement
  while (previous?.shadowRoot?.activeElement) previous = previous.shadowRoot.activeElement
  const host = document.createElement('div')
  host.id = SITE_MENU_ID
  // Escape belongs to the menu while it is focused — the shell's own Escape
  // (leave the website, the escape cascade) stands aside for it.
  host.dataset['escapeLocal'] = ''
  if (items.some(item => item.door)) host.dataset['hcApproach'] = ''
  host.style.cssText = `position:fixed;left:0;top:0;z-index:${Z}`
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  const panel = document.createElement('div')
  panel.className = 'menu'
  panel.setAttribute('role', 'menu')
  if (name) panel.setAttribute('aria-label', name)
  panel.tabIndex = -1
  // What a row's beat says (Copied, Couldn't copy), for a screen reader too.
  const said = document.createElement('div')
  said.className = 'said'
  said.setAttribute('aria-live', 'polite')
  root.append(style, panel, said)

  const rows: { row: HTMLButtonElement; item: SiteMenuItem; label: HTMLSpanElement }[] = []
  for (const item of items) {
    if (item.rule && rows.length) {
      const rule = document.createElement('div')
      rule.className = 'rule'
      rule.setAttribute('role', 'separator')
      panel.appendChild(rule)
    }
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'item'
    row.setAttribute('role', 'menuitem')
    const label = document.createElement('span')
    label.textContent = item.label
    row.append(glyph(item.icon), label)
    row.addEventListener('click', () => run(item, label))
    rows.push({ row, item, label })
    panel.appendChild(row)
  }

  /** A beat in the row, then the menu goes. */
  const beat = (label: HTMLSpanElement, text: string): void => {
    label.textContent = text
    said.textContent = text
    window.setTimeout(close, DONE_MS)
  }
  const run = (item: SiteMenuItem, label: HTMLSpanElement): void => {
    if (!item.done) {
      close()
      item.act()
      return
    }
    const { done, failed } = item
    void Promise.resolve()
      .then(() => item.act())
      .then(() => beat(label, done), () => (failed ? beat(label, failed) : close()))
  }

  const onKey = (e: KeyboardEvent): void => {
    const at = rows.findIndex(entry => entry.row === root.activeElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      const entry = rows[at]
      if (entry) run(entry.item, entry.label)
      return
    }
    const next = e.key === 'ArrowDown' ? (at + 1) % rows.length
      : e.key === 'ArrowUp' ? (at <= 0 ? rows.length - 1 : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? rows.length - 1
      : -1
    if (next < 0) return
    e.preventDefault()
    e.stopPropagation()
    rows[next]?.row.focus()
  }
  panel.addEventListener('keydown', onKey)

  // Anything outside puts the menu away — and, like a browser's own menu, the
  // press that dismissed it does nothing else on the page: not its start
  // (stopped here, before the page hears it, and no compat mouse events) and
  // not its end (the consumer swallows the release and the click). A page
  // that heard only half a press would be left mid-drag.
  const onOutside = (e: PointerEvent): void => {
    if (e.composedPath().includes(host)) return
    if (e.button === 0) {
      e.preventDefault()
      e.stopPropagation()
      consumePointerGesture(e.pointerId)
    }
    close()
  }
  // A wheel is the reader scrolling; a page that scrolls itself (a carousel, a
  // ticker) is not a reason to put the menu away.
  const onWheel = (e: WheelEvent): void => {
    if (!e.composedPath().includes(host)) close()
  }
  const away = (): void => close()

  const close = (): void => {
    if (current !== handle) return
    current = null
    window.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('wheel', onWheel, true)
    window.removeEventListener('resize', away)
    window.removeEventListener('blur', away)
    EffectBus.emitTransient('keymap:unsuppress', { reason: KEYMAP_REASON })
    const hadFocus = document.activeElement === host
    host.remove()
    if (hadFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
  }
  const handle = { close }
  current = handle

  document.body.appendChild(host)
  place(host, panel, at)
  window.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('wheel', onWheel, { capture: true, passive: true })
  window.addEventListener('resize', away)
  window.addEventListener('blur', away)
  EffectBus.emitTransient('keymap:suppress', { reason: KEYMAP_REASON })
  // The first row takes focus, so the keys work at once and a screen reader
  // lands on a choice. A script focus after a pointer draws no ring, so the
  // mouse sees nothing; a keyboard reader sees where they are. Focusing a door
  // also starts the hive's preload (script-preloader #watchRange hears the
  // focusin on the host).
  ;(rows[0]?.row ?? panel).focus({ preventScroll: true })
}

/** A row's glyph, inline — nothing to load. */
function glyph(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'glyph')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const d = GLYPHS[name]
  if (d) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

/** Seat the menu at the point, flipped and clamped to stay on screen. */
function place(host: HTMLElement, panel: HTMLElement, at: { x: number; y: number }): void {
  const { width, height } = panel.getBoundingClientRect()
  const maxX = window.innerWidth - MARGIN
  const maxY = window.innerHeight - MARGIN
  let x = at.x
  let y = at.y
  if (x + width > maxX) x = at.x - width
  if (y + height > maxY) y = at.y - height
  x = Math.max(MARGIN, Math.min(x, maxX - width))
  y = Math.max(MARGIN, Math.min(y, maxY - height))
  host.style.left = `${Math.round(x)}px`
  host.style.top = `${Math.round(y)}px`
}
