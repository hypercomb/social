// sharing/visitor-door.view.ts
//
// THE OUTSIDE-IN DOOR, on somebody else's published site.
//
// Jaime: "I go to somebody's domain and I like that package, and I click that
// link and it brings me back to MY domain and redirects me back to adopting
// that package from where I was originally."
//
// This is that link, and it is a LINK on purpose. A published site is a
// read-only shell on the publisher's origin: `readonly-network.ts` refuses
// every non-GET and every cross-origin fetch, `memory-filesystem.ts` gives it
// a hive that lives for the length of the page, and `LayerCommitter` refuses
// every write while a preview is active. A door that tried to keep anything
// here would be refused, and there would be nowhere to keep it. So it carries
// COORDINATES to the reader's own hive and lets that hive do the holding.
//
// What arrives there is an OFFER — the creation stands shaded at the reader's
// top level, the first click takes that one tile, the second walks in
// (static-peers.ts). A link may put a creation in front of somebody; only
// they can hold it. There is no whole-branch adopt here and never will be.
//
// It mounts as a drone `element:` surface, which is the only door shape a
// published site has: the visitor build replaces the Angular surface barrel
// with an empty one, so the preview banner and every other shell panel are
// simply absent there.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { HIVE_APP_ORIGIN, MY_HIVE_KEY, hiveDoorUrl } from './hive-link.js'

const SURFACE = 'hc-visitor-door'
const STYLE_ID = 'hc-visitor-door-style'
const OWNER = '@diamondcoreprocessor.com/VisitorDoorView'

const STEEL = '126, 182, 214'
const ACCENT = '201, 162, 39'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const t = (key: string, fallback: string, params?: Record<string, string>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    // The runtime provider answers with THE KEY on a miss, so a bare truthy
    // check would render `door.open` at people.
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

const interpolate = (text: string, params?: Record<string, string>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => params[name] ?? whole) : text

/** The published site this page is showing, as `preview:mode` reports it. */
interface PreviewPayload {
  active?: boolean
  label?: string
  segments?: readonly string[]
  pubkey?: string
  hosts?: readonly string[]
}

interface NavLike { segments: () => string[] }

/**
 * WHERE THE READER'S HIVE IS.
 *
 * A published site knows everything about its publisher and nothing about its
 * reader, so this is the one thing the door has to assume. It asks the browser
 * first — a reader who runs their own hive puts its origin in `hc:my-hive` —
 * and otherwise names the app, which is where a hive lives unless somebody
 * chose otherwise. Nothing here ever WRITES that key: a site may not decide
 * where its readers keep their work.
 */
export const myHiveOrigin = (): string => {
  try {
    const held = String(globalThis.localStorage?.getItem(MY_HIVE_KEY) ?? '').trim()
    if (held) {
      const url = new URL(held)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    }
  } catch { /* an unreadable store is a reader with no answer, not an error */ }
  return HIVE_APP_ORIGIN
}

/** Where the reader is standing INSIDE the published creation — the mount is
 *  the publisher's own route to it, so the part past the mount is the part
 *  that means anything in somebody else's hive. */
export const routeWithin = (mount: readonly string[], here: readonly string[]): string[] => {
  const at: string[] = []
  for (let i = 0; i < here.length; i++) {
    if (i < mount.length && mount[i] === here[i]) continue
    at.push(String(here[i] ?? ''))
  }
  return at.filter(Boolean)
}

export class VisitorDoorElement extends HTMLElement {

  #cleanup: (() => void)[] = []
  #preview: PreviewPayload | null = null
  #anchor: HTMLAnchorElement | null = null

  /** SEAMS, replaced in the spec so no test reads a real store or a real URL. */
  origin: () => string = myHiveOrigin
  here: () => string[] = () => ioc<NavLike>('@hypercomb.social/Navigation')?.segments?.() ?? []

  connectedCallback(): void {
    ensureStyles()
    // `preview:mode` replays its last value, so a surface mounted after the
    // site has settled is never blank for want of having been listening.
    this.#cleanup.push(EffectBus.on<PreviewPayload>('preview:mode', (p) => {
      this.#preview = p?.active ? p : null
      this.#render()
    }))
    // Walking around the site changes where the door would take you.
    this.#cleanup.push(EffectBus.on('navigate', () => this.#render()))
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.replaceChildren()
    this.#anchor = null
  }

  /** The address the door points at, or '' when this page is not showing a
   *  published creation (nothing to offer anybody). */
  href(): string {
    const preview = this.#preview
    if (!preview?.pubkey || !preview.hosts?.length || !preview.segments?.length) return ''
    return hiveDoorUrl(
      this.origin(),
      { pubkey: preview.pubkey, hosts: [...preview.hosts], segments: [...preview.segments] },
      routeWithin(preview.segments, this.here()),
    )
  }

  #render(): void {
    const href = this.href()
    if (!href) { this.replaceChildren(); this.#anchor = null; return }

    if (!this.#anchor) {
      const anchor = document.createElement('a')
      anchor.className = 'hc-visitor-door'
      // A door LEAVES: it opens the reader's own hive in a tab of its own, so
      // pressing it never costs them the site they were reading.
      anchor.target = '_blank'
      anchor.rel = 'noopener'
      this.replaceChildren(anchor)
      this.#anchor = anchor
    }
    const label = this.#preview?.label ?? ''
    this.#anchor.href = href
    this.#anchor.textContent = t('door.open', 'open in my hive')
    this.#anchor.title = label
      ? t('door.open-title', 'Put “{name}” in your hive — it stands shaded until you walk into it', { name: label })
      : t('door.open', 'open in my hive')
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  // Bottom-trailing and small: this is somebody else's site, and the door is a
  // way out of it, not a banner across it.
  style.textContent = `
    .hc-visitor-door {
      position: fixed; z-index: 59980; right: 0.75rem; bottom: 0.75rem;
      padding: 0.35rem 0.7rem;
      font: inherit; font-size: 0.82rem; line-height: 1.2; text-decoration: none;
      color: rgba(238, 244, 248, 0.92);
      background: rgba(12, 16, 24, 0.82);
      border: 1px solid rgba(${STEEL}, 0.4); border-radius: 2px;
      backdrop-filter: blur(3px);
    }
    .hc-visitor-door:hover { border-color: rgba(${ACCENT}, 0.85); }
    .hc-visitor-door:focus-visible { outline: 1px solid rgba(${ACCENT}, 0.9); outline-offset: 2px; }
    @media (max-width: 640px) {
      .hc-visitor-door { left: 0.75rem; right: 0.75rem; text-align: center; }
    }
  `
  document.head.appendChild(style)
}

;(window as { ioc?: { whenReady?: (k: string, cb: (v: { add(s: unknown): void }) => void) => void } })
  .ioc?.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', registry => {
    if (!customElements.get(SURFACE)) customElements.define(SURFACE, VisitorDoorElement)
    try {
      registry.add({ name: SURFACE, owner: OWNER, element: SURFACE, order: 143 })
    } catch {
      // duplicate add (hot reload) — the mounted surface is already live
    }
  })
