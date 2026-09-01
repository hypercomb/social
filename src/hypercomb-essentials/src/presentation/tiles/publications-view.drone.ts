// The PUBLICATION DIRECTORY VIEW — a bright page built from the ledger.
//
// One plate per site the host's publication ledger reports as published:
// warm ivory paper, espresso ink, gold hairlines — the same gallery
// language as the square tile view, because the directory and the sites it
// opens onto are kin. Each plate wears a honeycomb monogram (the ledger
// carries no imagery, and cross-origin bytes are gated in the visitor
// profile), the site's title, its address, and who shared it when.
// Stepping through a plate LEAVES for that site — an external door, opened
// through `openExternalLink` (never a hand-rolled anchor; the native shell
// would lose its whole window to one).
//
// The ledger is the only source of plates. Publish adds one, unpublish
// removes one, an empty ledger is an honest welcome — nothing on the page
// is hand-maintained. See publications-ledger.ts for the read.

import { Drone, EffectBus } from '@hypercomb/core'
import { titleForLabel } from '../../commands/decoration-kind-index.js'
import { isFeatureHiddenWithin } from '../../sharing/feature-hidden.js'
import { isBehaviorDormant } from '../../sharing/behavior-enablement.js'
import { listDecorations } from '../../commands/decoration-manifest.js'
import { fetchPublicationCards, type PublicationCard } from '../../sharing/publications-ledger.js'
import { lineageKey } from '../../history/lineage-key.js'
import { trackScrollGutter } from './scroll-gutter.js'
import { openExternalLink } from './document-view-links.js'
import {
  PUBLICATIONS_KIND, PUBLICATIONS_VIEW,
  type PublicationsPayload,
} from '../../commands/publications-view.queen.js'
import { DISCOVER_EFFECT, type DiscoverPayload } from '../../sharing/discover.queen.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

export class PublicationsViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Publication directory renderer — the marked cell opens as a bright page whose plates are the host\'s published sites.'

  #host: HTMLElement | null = null
  #targetSegments: string[] | null = null
  /** Set by /discover — the page renders a FOREIGN domain's ledger instead
   *  of this host's. Cleared whenever the view is left. */
  #directory: { origin: string; host: string } | null = null
  #bound = false
  #active = false
  #gen = 0
  /** Unregisters the right-click way out (back-gesture.service.ts). */
  #backOff: (() => void) | null = null
  /** Stops the scrollbar-width tracker that keeps the × clear of the
   *  sheet's own scrollbar (scroll-gutter.ts). */
  #gutterOff: (() => void) | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
        ?.addEventListener?.('change', this.#lineageChange)
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== PUBLICATIONS_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#directory = null
        this.#vm()?.setMode(PUBLICATIONS_VIEW)
        void this.#reconcile()
      })
      this.onEffect<DiscoverPayload>(DISCOVER_EFFECT, payload => {
        // The bus replays its last value to late subscribers — without the
        // freshness gate a reload would reopen a stale discovery unbidden.
        if (!payload?.origin || !payload?.host) return
        if (Math.abs(Date.now() - (payload.at ?? 0)) > 10_000) return
        this.#directory = { origin: String(payload.origin), host: String(payload.host) }
        this.#targetSegments = null
        this.#vm()?.setMode(PUBLICATIONS_VIEW)
        void this.#reconcile()
      })
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({
          owner: 'publications-view',
          back: () => this.#vm()?.setMode('hexagons'),
        }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
      ?.removeEventListener?.('change', this.#lineageChange)
    window.removeEventListener('keydown', this.#key, true)
    this.#backOff?.()
    this.#backOff = null
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #lineageChange = (): void => {
    this.#targetSegments = null
    void this.#reconcile()
  }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== PUBLICATIONS_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#vm()?.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === PUBLICATIONS_VIEW) { await this.#mount(gen); return }
    this.#targetSegments = null
    this.#directory = null
    this.#teardown()
  }

  async #mount(gen: number): Promise<void> {
    const directory = this.#directory
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    // isBehaviorDormant, not raw isKindGloballyOff: the published visitor
    // shell is a cold install whose roster starts DARK, and there publishing
    // the mark IS the enablement — the dormancy check carries that exception,
    // the raw roster read does not (a raw read blanks the whole site).
    // A /discover gesture is its own enablement — an explicit verb must not
    // bounce off a roster that never listed the kind.
    if (!directory
      && (isBehaviorDormant(PUBLICATIONS_KIND, segments) || await isFeatureHiddenWithin(segments, PUBLICATIONS_KIND))) {
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }

    let title: string
    let tagline: string
    let cards: PublicationCard[] | null
    if (directory) {
      // Discovery: the FOREIGN domain's ledger, verbatim — nothing excluded,
      // the page titles itself with the door it was pointed at.
      cards = await fetchPublicationCards({}, directory.origin)
      if (gen !== this.#gen || this.#vm()?.mode !== PUBLICATIONS_VIEW) return
      title = directory.host
      tagline = this.#t('publications.discoverTagline', 'everything this domain shares')
    } else {
      const records = await listDecorations<PublicationsPayload>({ kind: PUBLICATIONS_KIND, segments })
      if (gen !== this.#gen || this.#vm()?.mode !== PUBLICATIONS_VIEW) return
      const payload = records.at(-1)?.record.payload
      const label = segments.at(-1) ?? ''
      title = payload?.title
        || (label ? titleForLabel(label, navigator.language) || label : 'Publications')
      tagline = payload?.tagline ?? ''

      // The directory never lists itself — by origin when deployed, by the
      // lineage the view stands on everywhere else (the authoring hive and
      // the dev shell have no directory origin to match).
      cards = await fetchPublicationCards({
        host: window.location.host,
        lineage: segments.length ? lineageKey(segments) : undefined,
      })
      if (gen !== this.#gen || this.#vm()?.mode !== PUBLICATIONS_VIEW) return
    }

    this.#teardown()
    this.#host = this.#build(title, tagline, cards)
    document.body.appendChild(this.#host)
    this.#gutterOff = trackScrollGutter(this.#host)
    this.#setActive(true)
  }

  // ── The page ─────────────────────────────────────────────────────────

  #build(title: string, tagline: string, cards: PublicationCard[] | null): HTMLElement {
    const host = document.createElement('section')
    host.className = 'hc-publications-view'
    host.innerHTML = `<style>${SCENE_CSS}</style>`
    // The page scrolls like a page; the hex wheel-zoom handler must not
    // preventDefault our wheel events (same hatch the site view uses).
    host.setAttribute('data-consumes-wheel', '')

    const sheet = document.createElement('div')
    sheet.className = 'pv-sheet'
    host.appendChild(sheet)

    const crest = document.createElement('header')
    crest.className = 'pv-crest'
    const heading = document.createElement('h1')
    heading.className = 'pv-title'
    heading.textContent = title
    crest.appendChild(heading)
    const rule = document.createElement('div')
    rule.className = 'pv-rule'
    crest.appendChild(rule)
    const sub = document.createElement('p')
    sub.className = 'pv-tagline'
    sub.textContent = tagline || this.#t('publications.tagline', 'creations shared with the world')
    crest.appendChild(sub)
    sheet.appendChild(crest)

    if (cards?.length) {
      const grid = document.createElement('main')
      grid.className = 'pv-grid'
      cards.forEach((card, index) => grid.appendChild(this.#plate(card, index)))
      sheet.appendChild(grid)
      const hint = document.createElement('p')
      hint.className = 'pv-hint'
      hint.textContent = this.#t('publications.hint', 'step through a plate to visit a creation')
      sheet.appendChild(hint)
    } else {
      const still = document.createElement('main')
      still.className = 'pv-still'
      const line = document.createElement('p')
      line.className = 'pv-still-line'
      line.textContent = cards
        ? this.#t('publications.empty', 'Nothing has been shared here yet.')
        : this.#t('publications.unreachable', 'The ledger cannot be read right now.')
      still.appendChild(line)
      if (cards) {
        const under = document.createElement('p')
        under.className = 'pv-still-sub'
        under.textContent = this.#t('publications.emptySub',
          'When a creation is published, its plate appears on this page by itself.')
        still.appendChild(under)
      }
      sheet.appendChild(still)
    }

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'pv-close'
    close.setAttribute('aria-label', 'Return to hexagons')
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')
    host.appendChild(close)

    return host
  }

  /** One published site, one plate: honeycomb monogram, title, address,
   *  who shared it when. The click is an EXTERNAL door. */
  #plate(card: PublicationCard, index: number): HTMLElement {
    const plate = document.createElement('button')
    plate.type = 'button'
    plate.className = 'pv-plate'
    plate.style.setProperty('--i', String(index))
    plate.title = card.url

    const mat = document.createElement('span')
    mat.className = 'pv-mat'
    const art = document.createElement('span')
    art.className = 'pv-art'
    const monogram = document.createElement('span')
    monogram.className = 'pv-monogram'
    monogram.textContent = (card.title.trim()[0] ?? '·').toUpperCase()
    art.appendChild(monogram)
    mat.appendChild(art)
    plate.appendChild(mat)

    const caption = document.createElement('span')
    caption.className = 'pv-caption'
    caption.textContent = card.title
    plate.appendChild(caption)

    const address = document.createElement('span')
    address.className = 'pv-address'
    address.textContent = card.host
    plate.appendChild(address)

    if (card.publishedAt) {
      const shared = document.createElement('span')
      shared.className = 'pv-shared'
      const date = new Date(card.publishedAt * 1000).toLocaleDateString(
        navigator.language, { year: 'numeric', month: 'long', day: 'numeric' })
      shared.textContent = this.#t('publications.sharedBy', 'shared {date} · {label}')
        .replace('{date}', date)
        .replace('{label}', card.publisherLabel)
      plate.appendChild(shared)
    }

    plate.onclick = () => openExternalLink(card.url)
    return plate
  }

  /** Localized text with the echo guard — `t()` hands the key back when it
   *  cannot resolve one. */
  #t(key: string, fallback: string): string {
    const i18n = window.ioc?.get<{ t(k: string): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key)
    return text && text !== key ? text : fallback
  }

  #teardown(): void {
    this.#gutterOff?.()
    this.#gutterOff = null
    this.#host?.remove()
    this.#host = null
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'publications-view')
    else modes?.exit('view:active', 'publications-view')
  }
}

// The square-tile gallery's paper, worn by the directory: warm ivory,
// espresso ink, gold hairlines. The monogram sits on a honeycomb wash —
// the one place the hexagon shows through the plate.
const SCENE_CSS = `
.hc-publications-view{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:150;overflow:auto;background:
 radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.75),transparent 60%),
 linear-gradient(180deg,#f8f3e8 0%,#f3ecdd 60%,#ede4d1 100%);
 color:#31241a}
.pv-sheet{box-sizing:border-box;max-width:1180px;margin:0 auto;padding:clamp(2.2rem,6vh,4.5rem) clamp(1.2rem,4vw,3rem) 4rem;min-height:100%;display:flex;flex-direction:column}
.pv-crest{text-align:center;margin-bottom:clamp(1.8rem,4.5vh,3.2rem);animation:pv-rise .7s cubic-bezier(.2,.7,.2,1) backwards}
.pv-title{margin:0;font:italic 700 clamp(2.6rem,6vw,4.2rem)/1.08 Georgia,'Times New Roman',serif;letter-spacing:.04em;color:#3a2a1c}
.pv-rule{width:7.5rem;height:2px;margin:1.05rem auto 0;background:linear-gradient(90deg,transparent,#b8933f 18%,#d9b96a 50%,#b8933f 82%,transparent)}
.pv-tagline{margin:.95rem 0 0;color:#8a7657;font:400 .95rem/1.5 Georgia,serif;letter-spacing:.24em;text-transform:uppercase}
.pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:clamp(1.2rem,2.6vw,2rem);justify-items:stretch;align-content:start;max-width:920px;margin:0 auto;width:100%}
.pv-plate{display:flex;flex-direction:column;gap:.55rem;padding:0;border:0;background:none;cursor:pointer;text-align:center;animation:pv-rise .6s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(.05s * var(--i,0));transition:transform .18s ease}
.pv-plate:hover,.pv-plate:focus-visible{transform:translateY(-5px);outline:none}
.pv-mat{display:block;background:#fffdf7;border:1px solid rgba(184,147,63,.55);padding:9px;box-shadow:0 1px 2px rgba(58,42,28,.08),0 10px 24px -12px rgba(58,42,28,.28);transition:box-shadow .18s ease,border-color .18s ease}
.pv-plate:hover .pv-mat,.pv-plate:focus-visible .pv-mat{border-color:#b8933f;box-shadow:0 2px 3px rgba(58,42,28,.1),0 18px 34px -14px rgba(58,42,28,.4),0 0 0 1px rgba(184,147,63,.35)}
.pv-art{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1/1;background:
 radial-gradient(46% 46% at 50% 44%,rgba(184,147,63,.2),transparent 72%),
 repeating-linear-gradient(60deg,rgba(184,147,63,.1) 0 1px,transparent 1px 17px),
 repeating-linear-gradient(-60deg,rgba(184,147,63,.1) 0 1px,transparent 1px 17px),
 repeating-linear-gradient(0deg,rgba(184,147,63,.07) 0 1px,transparent 1px 17px),
 #f4edde}
.pv-monogram{font:italic 700 clamp(3.4rem,8vw,5rem)/1 Georgia,'Times New Roman',serif;color:rgba(92,70,48,.82);text-shadow:0 1px 0 rgba(255,255,255,.6)}
.pv-plate:hover .pv-monogram{color:#3a2a1c}
.pv-caption{color:#3a2a1c;font:600 .92rem/1.3 Georgia,'Times New Roman',serif;letter-spacing:.1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-address{color:#8a7657;font:400 .72rem/1.3 Georgia,serif;letter-spacing:.12em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pv-shared{color:rgba(138,118,87,.85);font:400 .68rem/1.4 Georgia,serif;letter-spacing:.06em}
.pv-still{margin:auto;max-width:34rem;text-align:center;animation:pv-fade 1s ease .2s backwards}
.pv-still-line{margin:0;color:#5c4630;font:italic 400 1.35rem/1.5 Georgia,serif}
.pv-still-sub{margin:.9rem 0 0;color:rgba(138,118,87,.9);font:400 .9rem/1.6 Georgia,serif}
.pv-hint{margin:auto auto 0;padding-top:2.6rem;text-align:center;color:rgba(138,118,87,.75);font:400 .74rem/1 Georgia,serif;letter-spacing:.26em;text-transform:uppercase;animation:pv-fade 1s ease .6s backwards}
.pv-close{position:fixed;z-index:2147483600;right:calc(.75rem + env(safe-area-inset-right,0px) + var(--hc-scroll-gutter,0px));top:calc(.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,253,247,.85);border:1px solid rgba(184,147,63,.5);backdrop-filter:blur(6px);color:#5c4630;cursor:pointer;font:1.3rem/1 serif;padding:0;opacity:.6;transition:opacity .16s ease}
.pv-close:hover{opacity:1}
@keyframes pv-rise{from{opacity:0;translate:0 14px}to{opacity:1;translate:0 0}}
@keyframes pv-fade{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.pv-plate,.pv-crest{animation:none}.pv-hint,.pv-still{animation:none}}
@media(max-width:560px){.pv-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}.pv-mat{padding:6px}.pv-caption{font-size:.8rem}.pv-monogram{font-size:2.8rem}}
`

const _publicationsView = new PublicationsViewDrone()
window.ioc.register('@diamondcoreprocessor.com/PublicationsViewDrone', _publicationsView)
