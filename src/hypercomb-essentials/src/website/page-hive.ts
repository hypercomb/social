// website/page-hive.ts
//
// What the page helpers (`parts`, `style`) share when they reach
// into the hive: where the participant stands, the page that tile wears, and
// putting the page's look as shared atoms. The cutting itself is pure and
// lives in page-cut.ts and page-style.ts; this is only the plumbing.

import { SignatureService, SITE_VIEW_IOC_KEY } from '@hypercomb/core'
import { fetchThroughContentHop } from '../presentation/tiles/artifact-content.js'
import type { PartStyle } from './page-cut.js'
import { ATOM_ORDER, atomLink, scopeAtoms, splitStyle, type StyleAtoms } from './page-style.js'

type StoreLike = {
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (sig: string) => Promise<Blob | null>
}
type LineageLike = { explorerSegments?: () => readonly string[] }
type PageResolver = { resolvePageSig?: (segments: readonly string[]) => Promise<string | null> }

const SIG = /^[0-9a-f]{64}$/

export const service = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** The tile the participant stands on, from the first page. */
export const standingAt = (): string[] =>
  [...(service<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]
    .map(segment => String(segment ?? '').trim())
    .filter(Boolean)

export const routeWords = (segments: readonly string[]): string =>
  segments.length ? `/${segments.join('/')}` : 'the first page'

/** The signature of the page a tile wears, through the one cascade the site
 *  view owns; null when it wears none. */
export async function pageSigAt(segments: readonly string[]): Promise<string | null> {
  const sig = await service<PageResolver>(SITE_VIEW_IOC_KEY)?.resolvePageSig?.(segments).catch(() => null)
  return sig && SIG.test(sig) ? sig : null
}

/** The page a tile wears, as text; null when it wears none or its bytes are
 *  not on this device. */
export async function pageHtmlAt(segments: readonly string[]): Promise<string | null> {
  const store = service<StoreLike>('@hypercomb.social/Store')
  const sig = await pageSigAt(segments)
  if (!sig || !store?.getResource) return null
  const blob = await fetchThroughContentHop(sig, s => store.getResource!(s)).catch(() => null)
  return blob && blob.size > 0 ? blob.text() : null
}

/** Put text as a resource and answer its signature. */
export async function putText(text: string): Promise<string> {
  const store = service<StoreLike>('@hypercomb.social/Store')
  if (!store?.putResource) throw new Error('the store is not available here; nothing was written')
  return store.putResource(new Blob([new TextEncoder().encode(text) as BlobPart]))
}

/**
 * The class a page's lifted look is confined to. Derived from the CSS itself,
 * so the same look always lands under the same class and mints the same atoms:
 * two pages cut from one design share them without anyone arranging it.
 */
export async function scopeFor(css: string): Promise<string> {
  const sig = await SignatureService.sign(new TextEncoder().encode(css).buffer as ArrayBuffer)
  return `page-${sig.slice(0, 12)}`
}

export interface SharedStyle extends PartStyle {
  /** Signature of each atom that holds anything. */
  readonly atoms: Partial<Record<keyof StyleAtoms, string>>
}

/**
 * Put a page's inline CSS as its shared atoms and answer how a document
 * reaches them. A page with no inline CSS shares nothing new: its documents
 * keep the sheets it already links, and nothing is confined.
 */
export async function shareStyle(css: string, links: readonly string[]): Promise<SharedStyle> {
  if (!css.trim()) return { head: links.join('\n'), atoms: {} }
  const scope = await scopeFor(css)
  const confined = scopeAtoms(splitStyle(css), scope)
  const atoms: Partial<Record<keyof StyleAtoms, string>> = {}
  const head = [...links]
  for (const atom of ATOM_ORDER) {
    if (!confined[atom]) continue
    atoms[atom] = await putText(confined[atom])
    head.push(atomLink(atom, atoms[atom]!))
  }
  return { head: head.join('\n'), scope, atoms }
}
