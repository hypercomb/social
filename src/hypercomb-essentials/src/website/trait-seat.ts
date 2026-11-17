// website/trait-seat.ts
//
// A PAGE'S TRAITS, FILLED WHEN IT IS DRAWN.
//
// A page states a trait on the element that is its own version of it:
//
//     <header data-hc-trait="header"> … </header>
//
// The trait is the placeholder: the word names a kind of part and says nothing
// about which tile fills it (documentation/traits.md). When the tile that
// wears the page has that trait and something fills it (a filler it chose, or
// a child named the word), that tile's own page is seated in the element's
// place. When nothing fills it the page's own version stands, untouched. So a
// page is complete with every trait unfilled, and swapping a header is filling
// one trait.
//
// WHAT IT DOES NOT COST. The answer comes from the tile's own marks and its
// own children (commands/trait-read.ts). No other tile of the hive is read, so
// a page of traits draws as fast on a hive of thousands as on an empty one.
// (The numbered holes of a division find their parts by walking the hive;
// that walk is why this is the way a cut page is put together.)
//
// A FILLER KEEPS ITS OWN LOOK. It is seated in a shadow root, exactly as a
// division's part is (presentation/tiles/division-assembly.ts), so its CSS
// cannot leak into the page and the page's cannot leak into it.
//
// EVERY FAILURE RETURNS THE PAGE UNCHANGED. A filler that cannot be read costs
// nothing: the page's own version of that trait is still there.

import { SITE_VIEW_IOC_KEY, TRAITS_IOC_KEY, moleculeKey, traitFiller, type TraitProvider, type TraitResolution } from '@hypercomb/core'
import { fetchThroughContentHop } from '../presentation/tiles/artifact-content.js'
import { TRAIT_ATTR } from './page-cut.js'

const SIG = /^[0-9a-f]{64}$/
const PAGE_KIND = 'visual:website:page'
const WEBSITE_SLOT = 'website'

type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }
type HistoryLike = { getLayerBySig?: (sig: string) => Promise<Record<string, unknown> | null> }
type PageResolver = { resolvePageSig?: (segments: readonly string[]) => Promise<string | null> }

const service = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

const sigsIn = (slot: unknown): string[] =>
  Array.isArray(slot) ? slot.map(String).filter(s => SIG.test(s)) : []

/**
 * Seat fillers into the traits a page states. `fillerFor` answers the filler's
 * own page for a trait word, or nothing when the page's own version stands.
 * Pure: text in, text out.
 */
export function seatFillers(html: string, fillerFor: (word: string) => string | undefined): string {
  const source = String(html ?? '')
  if (!source.includes(TRAIT_ATTR) || typeof DOMParser === 'undefined') return source
  const doc = new DOMParser().parseFromString(source, 'text/html')
  let seated = 0
  for (const el of Array.from(doc.querySelectorAll(`[${TRAIT_ATTR}]`))) {
    // A trait stated inside one already filled left with it.
    if (!doc.documentElement.contains(el)) continue
    const word = el.getAttribute(TRAIT_ATTR) ?? ''
    const filler = word ? fillerFor(word) : undefined
    if (!filler) continue
    const holder = doc.createElement('div')
    holder.setAttribute(TRAIT_ATTR, word)
    holder.setAttribute('data-hc-filled', '')
    const template = doc.createElement('template')
    template.setAttribute('shadowrootmode', 'open')
    template.innerHTML = filler
    holder.appendChild(template)
    el.replaceWith(holder)
    seated++
  }
  return seated === 0 ? source : `<!doctype html>\n${doc.documentElement.outerHTML}\n`
}

/** The page a filler tile wears, by its route when the resolution knows it,
 *  else read off its layer. */
async function fillerPage(resolution: TraitResolution, sig: string, seats: SeatsPart, at: readonly string[]): Promise<string | null> {
  const store = service<StoreLike>('@hypercomb.social/Store')
  if (!store?.getResource) return null
  let pageSig: string | null = null
  if ('route' in resolution && resolution.route.length) {
    pageSig = await service<PageResolver>(SITE_VIEW_IOC_KEY)?.resolvePageSig?.(resolution.route).catch(() => null) ?? null
  }
  if (!pageSig) {
    const layer = await service<HistoryLike>('@diamondcoreprocessor.com/HistoryService')?.getLayerBySig?.(sig).catch(() => null)
    pageSig = sigsIn(layer?.[WEBSITE_SLOT]).pop() ?? null
    if (!pageSig) {
      for (const mark of sigsIn(layer?.['decorations'])) {
        try {
          const record = JSON.parse(await (await store.getResource(mark))!.text()) as { kind?: string; payload?: { htmlSig?: unknown } }
          if (record.kind === PAGE_KIND && SIG.test(String(record.payload?.htmlSig))) pageSig = String(record.payload!.htmlSig)
        } catch { /* not a record */ }
      }
    }
  }
  if (!pageSig || !SIG.test(pageSig)) return null
  if (!seats('route' in resolution && resolution.route.length ? resolution.route : at, pageSig)) return null
  const blob = await fetchThroughContentHop(pageSig, s => store.getResource!(s)).catch(() => null)
  return blob && blob.size > 0 ? blob.text() : null
}

/** The page worn at `segments`, with each trait it states filled by what the
 *  tile's traits resolve to. Handed back untouched whenever nothing fills. */
/** May the page `pageSig`, worn at `route`, be seated into this page? Every
 *  part a surface seats runs where the page runs: the website view seats only
 *  its own parts into a page of its own (it runs as the hive), and anything
 *  into a sealed page (2026-11-16, page-run-gate.ts). Unasked, every part seats. */
export type SeatsPart = (route: readonly string[], pageSig: string) => boolean

export async function composeTraits(segments: readonly string[], html: string, seats: SeatsPart = () => true): Promise<string> {
  try {
    if (segments.length === 0 || !html || !html.includes(TRAIT_ATTR)) return html
    const traits = service<TraitProvider>(TRAITS_IOC_KEY)
    if (!traits?.resolveAt) return html
    const pages = new Map<string, string>()
    for (const resolution of await traits.resolveAt(segments)) {
      const sig = traitFiller(resolution)
      if (!sig) continue
      const page = await fillerPage(resolution, sig, seats, segments)
      if (page) pages.set(moleculeKey(resolution.word), page)
    }
    if (pages.size === 0) return html
    return seatFillers(html, word => pages.get(moleculeKey(word)))
  } catch (err) {
    console.warn('[trait-seat] could not fill', segments.join('/'), err)
    return html
  }
}
