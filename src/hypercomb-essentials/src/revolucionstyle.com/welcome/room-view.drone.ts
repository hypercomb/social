// The Revolución room — a child's OWN view behind its frame on the wall.
//
// The children of the threshold already carry their pages (the three.js
// lounge, the interactive flavor wheel, the parchment journal — all
// `visual:website:page` decorations). Stepping through a frame must land
// in THAT child's own view, not on bare hexagons and not in the global
// website mode. This drone mounts the child's page full-viewport as the
// cell's presence: the page is an artifact (its CSS scoped to the host,
// its scripts re-executed, its `resource:` refs rewritten), and Escape
// walks back out to the wall. A child with no page falls through to the
// hexagons — the view never traps.
//
// One layer at a time, still: this is the generic room. When a child
// earns a bespoke view implementation, that view takes over its frame
// and this one steps aside.

import { Drone, RESOURCE_URL_PREFIX } from '@hypercomb/core'
import { titleForLabel } from '../../diamondcoreprocessor.com/commands/decoration-kind-index.js'
import { isFeatureHidden } from '../../diamondcoreprocessor.com/sharing/feature-hidden.js'
import { rewritePageRefs } from '../../diamondcoreprocessor.com/sharing/decoration-closure.js'
import { scopeCellPageCss } from '../../diamondcoreprocessor.com/presentation/tiles/cell-page-css-scope.js'
import { WELCOME_VIEW } from './welcome.queen.js'

export const ROOM_VIEW = 'revolucion-room'
/** The room shows the cell's existing page — the website behaviour's kind. */
export const ROOM_PAGE_KIND = 'visual:website:page'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type StoreShape = { getResource(sig: string): Promise<Blob | null> }
type SiteViewShape = { resolvePageSig(segments: readonly string[]): Promise<string | null> }

export class RoomViewDrone extends Drone {
  readonly namespace = 'revolucionstyle.com'
  override genotype = 'presentation'
  override description =
    'Revolución room renderer — mounts a child cell\'s own page as its view behind the welcome wall; Escape returns to the wall.'

  #host: HTMLElement | null = null
  #undo: Array<() => void> = []
  #targetSegments: string[] | null = null
  #bound = false
  #active = false
  #gen = 0

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== ROOM_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(ROOM_VIEW)
        void this.#reconcile()
      })
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.removeEventListener('keydown', this.#key, true)
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== ROOM_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#backToWall()
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  /** Escape / ‹ — out of the room, back onto the wall of the parent layer. */
  #backToWall(): void {
    const segments = this.#targetSegments ?? []
    const parent = segments.slice(0, -1)
    if (!parent.length) { this.#vm()?.setMode('hexagons'); return }
    window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(parent)
    this.emitEffect('view:open-for-tile', { view: WELCOME_VIEW, segments: parent })
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === ROOM_VIEW) { await this.#mount(gen); return }
    this.#targetSegments = null
    this.#teardown()
  }

  async #mount(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    this.#targetSegments = segments

    const site = window.ioc?.get<SiteViewShape>('@diamondcoreprocessor.com/SiteViewDrone')
    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    const hidden = await isFeatureHidden(segments, ROOM_PAGE_KIND)
    const pageSig = (!hidden && site) ? await site.resolvePageSig(segments) : null
    if (gen !== this.#gen || this.#vm()?.mode !== ROOM_VIEW) return
    if (!pageSig || !store) {
      // No page here — the ordinary hive owns the cell. Never trap.
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }
    const blob = await store.getResource(pageSig)
    if (gen !== this.#gen || this.#vm()?.mode !== ROOM_VIEW) return
    if (!blob) {
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }

    this.#teardown()
    const raw = rewritePageRefs(await blob.text(), RESOURCE_URL_PREFIX)
    if (gen !== this.#gen || this.#vm()?.mode !== ROOM_VIEW) return

    // ── Mount the page as an artifact (the site view's proven mechanics,
    //    trimmed): scoped CSS inside the host, root class/theme mirrored,
    //    scripts re-created so they execute, theme write undone on unmount.
    const prevTheme = document.documentElement.getAttribute('data-theme')
    const parsed = new DOMParser().parseFromString(raw, 'text/html')

    const host = document.createElement('div')
    host.id = 'hc-revolucion-room-host'
    host.style.cssText =
      'position:fixed;top:0;bottom:0;' +
      'left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);' +
      'z-index:150;overflow:auto;background:#0c0805;'
    // Same hatch the site view uses: without it the hex wheel-zoom handler
    // preventDefaults every wheel event and tall pages cannot scroll.
    host.setAttribute('data-consumes-wheel', '')

    for (const link of Array.from(parsed.querySelectorAll('link[rel="stylesheet"]'))) {
      const live = document.createElement('link')
      live.setAttribute('data-hc-cell-page', pageSig)
      for (const attr of Array.from(link.attributes)) live.setAttribute(attr.name, attr.value)
      document.head.appendChild(live)
      this.#undo.push(() => live.remove())
    }
    for (const style of Array.from(parsed.querySelectorAll('style'))) {
      const live = document.createElement('style')
      live.setAttribute('data-hc-cell-page', pageSig)
      live.textContent = scopeCellPageCss(style.textContent ?? '', `#${host.id}`)
      host.appendChild(live)
    }

    const authoredClass = [
      parsed.documentElement?.className ?? '',
      parsed.body?.className ?? '',
    ].join(' ').trim()
    const mirrorRoot = (): void => {
      const theme = document.documentElement.getAttribute('data-theme')
      if (theme === null) host.removeAttribute('data-theme')
      else host.setAttribute('data-theme', theme)
      host.className = [authoredClass, document.documentElement.className, document.body.className]
        .join(' ').trim()
    }
    mirrorRoot()
    const observer = new MutationObserver(mirrorRoot)
    const watch = { attributes: true, attributeFilter: ['class', 'data-theme'] }
    observer.observe(document.documentElement, watch)
    observer.observe(document.body, watch)
    this.#undo.push(() => observer.disconnect())
    this.#undo.push(() => {
      if (prevTheme === null) document.documentElement.removeAttribute('data-theme')
      else document.documentElement.setAttribute('data-theme', prevTheme)
    })

    const body = parsed.body
    if (body) while (body.firstChild) host.appendChild(body.firstChild)

    // Announce the context BEFORE the page's scripts run: mounted as the
    // cell's own view, a page may skip its website interface entirely (the
    // lounge walks straight into the 3D room). A page that walks in may
    // also write `documentElement.style.overflow` — snapshot and restore
    // it, since leaving via Escape never runs the page's own "leave".
    ;(window as { __hcRoomView?: boolean }).__hcRoomView = true
    const prevOverflow = document.documentElement.style.overflow
    this.#undo.push(() => {
      delete (window as { __hcRoomView?: boolean }).__hcRoomView
      document.documentElement.style.overflow = prevOverflow
    })

    const runScripts = (sources: readonly HTMLScriptElement[]): void => {
      for (const inert of sources) {
        const live = document.createElement('script')
        for (const attr of Array.from(inert.attributes)) live.setAttribute(attr.name, attr.value)
        live.textContent = inert.textContent ?? ''
        inert.isConnected ? inert.replaceWith(live) : host.appendChild(live)
      }
    }
    runScripts(Array.from(parsed.head.querySelectorAll('script')))
    runScripts(Array.from(host.querySelectorAll('script')))

    // The site's internal links become room-to-room passage: an absolute
    // in-app href re-targets the room at that path (its own page resolves
    // there, or it falls through to hexagons — never a document navigation,
    // per the view link policy).
    const onClick = (event: MouseEvent): void => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!anchor || !host.contains(anchor)) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href.startsWith('/')) return
      event.preventDefault()
      const next = href.split('#')[0].split('/').filter(Boolean)
      if (!next.length) return
      window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(next)
      this.#targetSegments = next
      void this.#reconcile()
    }
    host.addEventListener('click', onClick)

    // ‹ back to the wall + × to the hexagons — the room's only chrome.
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'hc-room-back'
    back.textContent = '‹'
    const label = segments.at(-1) ?? ''
    back.title = 'Back to the wall'
    back.setAttribute('aria-label', 'Back to the wall')
    back.onclick = () => this.#backToWall()
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-room-close'
    close.setAttribute('aria-label', `Leave ${titleForLabel(label, navigator.language) || label}`)
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')
    const chrome = document.createElement('style')
    chrome.textContent = ROOM_CHROME_CSS
    host.append(chrome, back, close)

    document.body.appendChild(host)
    this.#host = host
    this.#setActive(true)
  }

  #teardown(): void {
    for (const undo of this.#undo.splice(0)) { try { undo() } catch { /* ignore */ } }
    this.#host?.remove()
    this.#host = null
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'revolucion-room')
    else modes?.exit('view:active', 'revolucion-room')
  }
}

const ROOM_CHROME_CSS = `
.hc-room-back,.hc-room-close{position:fixed;z-index:2147483600;top:calc(.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(20,12,7,.82);border:1px solid rgba(212,175,55,.45);backdrop-filter:blur(6px);color:#e8d9ae;cursor:pointer;padding:0;opacity:.55;transition:opacity .16s ease}
.hc-room-back{left:calc(.75rem + var(--hc-inset-left,0px) + env(safe-area-inset-left,0px));font:1.5rem/1 serif}
.hc-room-close{right:calc(.75rem + env(safe-area-inset-right,0px));font:1.3rem/1 serif}
.hc-room-back:hover,.hc-room-close:hover{opacity:1}
`

const _roomView = new RoomViewDrone()
window.ioc.register('@revolucionstyle.com/RoomViewDrone', _roomView)
