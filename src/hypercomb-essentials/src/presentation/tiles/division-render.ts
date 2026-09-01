// presentation/tiles/division-render.ts
//
// SEATING A WHOLE'S PARTS INTO ITS PAGE.
//
// division-assembly.ts is the pure composition — a container and some
// fragments in, one document out. This is what feeds it from the hive: the
// whole's frame, its members, and each member's own page, resolved through the
// content hop.
//
// It is the OTHER FACE of what already happens. Walk into a child and its page
// replaces the parent's (documentation/embedded-sites.md). Stay on the parent
// and the child's page is seated into a hole instead, and the two read as one
// document. Same relation, two views — the way slides and the lightbox are two
// faces of one set.
//
// ── EVERY FAILURE RETURNS THE PAGE UNCHANGED ────────────────────────────
//
// There is one return value for "no frame", "no holes", "no members", "a
// member's page would not load" and "something threw": the whole's own page,
// exactly as authored. A page that cannot be composed must still RENDER —
// that is rule 11 at runtime, and it is also what keeps a part that cannot be
// served right now from taking the page down with it. Composition is an
// enhancement over a document that was already complete.
//
// ── THE WHOLE IS NOT ONE OF ITS OWN PARTS ───────────────────────────────
//
// A naming artifact wears the membership mark of the relation it names —
// naming a set means belonging to it (pheromones/enrollment.ts). So the whole
// comes back in its own member list, and seating it would mount its page
// inside itself. It is filtered by location, once, here.

import { SITE_VIEW_IOC_KEY } from '@hypercomb/core'
import { listDecorations } from '../../commands/decoration-manifest.js'
import { enrolledCells, ordered, orderIn } from '../../pheromones/enrollment.js'
import { divisionGroupOf } from '../../assistant/visual-distribution.js'
import { fetchThroughContentHop } from './artifact-content.js'
import { assemble, containerFor, type SlotFill } from './division-assembly.js'
import { readTemplateTarget, resolveTemplateAt } from './template-target.js'
import { targetsIn } from './meaning-target.js'
import { DIVISION_KIND, planOfPayload } from './visual-division.js'

type StoreLike = {
  getResource?: (sig: string) => Promise<Blob | null>
  getResourceLocal(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}
/** Site-view owns the website-slot → decoration → legacy-context cascade, and
 *  there must not be a second copy of it. Resolved through the ONE registry by
 *  key, like every other dependency here — late-bound, so nothing imports
 *  anything and a publisher that holds no reference to the renderer gets the
 *  same cascade for free. */
type PageResolver = { resolvePageSig?: (segments: readonly string[]) => Promise<string | null> }

const SIG = /^[0-9a-f]{64}$/

/**
 * The whole's page with its parts seated into it.
 *
 * `authored` is what the whole's own page slot holds. Hand it back untouched
 * whenever composition cannot happen — see the header.
 */
export async function composeDivision(
  segments: readonly string[],
  authored: string,
): Promise<string> {
  try {
    if (segments.length === 0 || !authored) return authored

    const records = await listDecorations<Record<string, unknown>>({
      kind: DIVISION_KIND, segments,
    })
    const plan = planOfPayload(records[0]?.record?.payload)

    // The layout this container is plugged into, if it has been targeted. It
    // is resolved BEFORE the members because it decides the container, and a
    // bound layout is a design decision rather than a fallback: a page with a
    // template and no parts yet still lays out through it.
    const resolved = await resolveTemplateAt(segments)
    // The page states its interfaces too — a published container advertises
    // what belongs in each hole, which is what lets somebody else's artifact
    // answer it.
    const bound = resolved
      ? { node: resolved.node, targets: await targetsIn(resolved.node) }
      : null

    // A spiral divides a PICTURE, not a document — its holes are regions, and
    // `containerFor` gives it no container by design.
    const container = containerFor(plan, authored, bound)
    if (!container) return authored
    if (container.slots.length === 0 && !bound) return authored

    const store = get<StoreLike>('@hypercomb.social/Store')
    const history = get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    if (!store?.getResource || !history) return authored

    const group = await divisionGroupOf(segments)
    // No relation means no members to seat. With a layout bound that is still
    // a composition — the container IS the design, and its holes are simply
    // all empty, which rule 11 says is a finished state.
    if (!group) return bound ? container.html : authored

    const here = segments.join('\0')
    const members = ordered(
      await enrolledCells(history, store, [group.sig]),
      [group.sig],
    ).filter(cell => cell.segments.join('\0') !== here)
    if (members.length === 0) return bound ? container.html : authored

    const wanted = new Set(group.sig ? [group.sig] : [])
    const fills: SlotFill[] = []
    for (const member of members) {
      const index = orderIn(member, wanted)
      if (!Number.isFinite(index) || !container.slots.includes(index)) continue
      const html = await pageHtml(store, member.segments)
      // An absent fill is not skipped silently into a different hole — it just
      // is not added, and `assemble` leaves that hole as the container drew it.
      if (html) fills.push({ index, html })
    }
    if (fills.length === 0) return bound ? container.html : authored

    return assemble(container.html, fills)
  } catch (err) {
    console.warn('[division-render] could not compose', segments.join('/'), err)
    return authored
  }
}

/** One member's own page, as text. Through the content hop, because
 *  `Store.getResource` does not follow a meta envelope and a caller that
 *  hands it a payload reference gets the envelope's JSON. */
async function pageHtml(
  store: StoreLike,
  segments: readonly string[],
): Promise<string | null> {
  try {
    const siteView = get<PageResolver>(SITE_VIEW_IOC_KEY)
    if (!siteView?.resolvePageSig) return null
    const sig = await siteView.resolvePageSig(segments)
    if (!sig || !SIG.test(sig)) return null
    const blob = await fetchThroughContentHop(sig, s => store.getResource!(s))
    if (!blob || blob.size === 0) return null
    return await blob.text()
  } catch {
    return null
  }
}

/** Does this cell's page get composed at all? Cheap enough to ask before
 *  paying for a compose, and it is the same question a publisher asks when
 *  deciding whether a page needs assembling before it is written out. */
export async function hasDivision(segments: readonly string[]): Promise<boolean> {
  try {
    // A bound layout composes on its own — the container comes from the
    // template, so a page can be laid out before it has ever been broken apart.
    if (await readTemplateTarget(segments)) return true
    const records = await listDecorations<Record<string, unknown>>({
      kind: DIVISION_KIND, segments,
    })
    const plan = planOfPayload(records[0]?.record?.payload)
    return plan.arity > 0 && plan.flow !== 'spiral'
  } catch {
    return false
  }
}

/**
 * Attach the shadow roots a seated part was wrapped in.
 *
 * `assemble` emits DECLARATIVE shadow roots — `<template shadowrootmode>` —
 * because that is static HTML: a hosted page carries the part's own text in
 * the document and a crawler reads it with no JavaScript.
 *
 * But a declarative shadow root is only attached by parse paths that opt in.
 * `Document.parseHTMLUnsafe()` does; `DOMParser.parseFromString()` — which is
 * how a cell page is turned into a document here — does NOT, and leaves the
 * template inert. Inert means INVISIBLE: the part's markup is present and
 * renders nothing.
 *
 * So the renderer finishes what the parser declined to do. Idempotent by
 * construction: a parser that DID attach the root consumed the template, so
 * there is nothing left for this to find.
 */
export function hydrateSeatedParts(root: ParentNode | null | undefined): number {
  if (!root?.querySelectorAll) return 0
  let attached = 0
  const templates = root.querySelectorAll('template[shadowrootmode]')
  for (const node of Array.from(templates)) {
    const template = node as HTMLTemplateElement
    const holder = template.parentElement
    if (!holder || holder.shadowRoot) continue
    const mode = template.getAttribute('shadowrootmode') === 'closed' ? 'closed' : 'open'
    try {
      const shadow = holder.attachShadow({ mode })
      shadow.appendChild(template.content.cloneNode(true))
      template.remove()
      attached++
    } catch {
      // Already has a root, or the element cannot host one. The part stays
      // where it is rather than being lost — an unstyled part beats none.
      template.replaceWith(template.content.cloneNode(true))
    }
  }
  return attached
}
