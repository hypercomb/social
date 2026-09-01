// presentation/tiles/division-assembly.ts
//
// THE WHOLE IS A CONTAINER. A PART FILLS A HOLE. THE FILL IS A SIGNATURE.
//
// A page is already an artifact here: every cell carries its own HTML and the
// lineage IS the route (documentation/embedded-sites.md). This is the other
// face of that relation — instead of a child's page REPLACING the parent's
// when you walk in, the child's page can be SEATED INTO A HOLE in the parent's
// page and read as one document.
//
// The structure is the Life Primitive, unchanged: a hole holds a SIGNATURE to
// a meta envelope, and the envelope's one typed hop reaches the part's bytes.
// Nothing about a hole says whose bytes those are.
//
//     container HTML  →  [data-hc-slot="k"]  →  order k  →  a member's
//     content signature  →  meta envelope  →  the part's fragment
//
// ── WHY THERE IS NO HEIGHT ANYWHERE IN HERE ─────────────────────────────
//
// A hole declares WIDTH relative to its siblings and nothing else. That single
// omission is what makes a part interchangeable: a hole that says "a column
// that grows" accepts any content, a hole that says 300×200 accepts almost
// none — and a part that fits only one whole is a part that can live in only
// one whole, which is rule 2 broken through the back door of layout.
//
// So: intrinsic height, everywhere, always. If a part is taller than the
// designer imagined, the whole gets taller. It does not clip and it does not
// scroll inside its hole.
//
// ── A PART BRINGS ITS OWN STYLING, OR IT IS NOT A PART ──────────────────
//
// A fragment that renders correctly only inside its parent's stylesheet is the
// inheritance anti-pattern in a new medium: it looks right where it was made
// and arrives naked everywhere else. So every fill is mounted in a DECLARATIVE
// SHADOW ROOT — the part's CSS cannot leak out and the container's cannot leak
// in, and the part therefore looks like itself in any whole that seats it.
//
// Declarative (`<template shadowrootmode="open">`) rather than scripted, for
// two reasons: the composed page is then static HTML that a crawler reads with
// no JavaScript, and a hosted page carries the parts' own text in the document
// rather than assembling it after load.
//
// ── AN ABSENT PART IS NOT AN ERROR ──────────────────────────────────────
//
// Assembly NEVER fails on a missing fill. A hole with nothing for it stays
// exactly as the container drew it — which is rule 11, and which is also how
// this degrades when a part cannot be served: the page still renders, one hole
// empty, instead of going blank. That is the load-shedding behaviour, and it
// falls out of the authoring rule rather than being bolted on.
//
// This module is PURE — strings in, strings out. No IoC, no DOM, no store, so
// the same function assembles at publish time and in the browser.

import {
  SLOT_ATTR,
  spanAt,
  type DivisionPlan,
} from './visual-division.js'
import {
  composeLayout,
  seatSelf,
  type LayoutNode,
  type TargetResolver,
} from './layout-template.js'

/** One hole's content, ready to seat. `html` absent = the hole stays empty. */
export interface SlotFill {
  readonly index: number
  readonly html?: string
}

/** Escape for an attribute value. Slot indices are numbers, but a container
 *  may be authored by anyone and an id may not be. */
const attr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

/**
 * The container a whole gets when nobody has authored one.
 *
 * Derived entirely from the frame, so a tile broken apart before anyone has
 * designed anything still has somewhere for its parts to go — structure first,
 * appearance maturing into it.
 *
 * `spiral` has no container: its holes are regions of a picture, not boxes in
 * a document, and pretending otherwise would invent a layout nobody asked for.
 */
export function derivedContainer(plan: DivisionPlan): string | null {
  if (plan.flow === 'spiral' || plan.arity <= 0) return null

  const holes: string[] = []
  for (let k = 0; k < plan.arity; k++) {
    // `min-width:0` is load-bearing in every flex/grid track: without it a
    // long unbroken word in a part forces the track wider than its share and
    // the division stops being the division.
    const basis = plan.flow === 'stack'
      ? 'flex:1 1 100%;min-width:0'
      : `flex:${spanAt(plan, k)} 1 0;min-width:0`
    holes.push(`<div ${SLOT_ATTR}="${k}" style="${basis}"></div>`)
  }

  // Same 1rem it always was, but as a VARIABLE and with the container bounded
  // — a hardcoded gap is a length flex cannot absorb, so five holes at 1rem is
  // 64px of container before a single hole exists. Inheritable now, which is
  // how a small box zeroes it.
  const bounds = 'min-width:0;max-width:100%;box-sizing:border-box'
  const wrap = plan.flow === 'stack'
    ? `display:flex;flex-direction:column;gap:var(--hc-layout-space,1rem);${bounds}`
    : `display:flex;flex-wrap:wrap;gap:var(--hc-layout-space,1rem);align-items:flex-start;${bounds}`
  return `<div data-hc-container="${attr(plan.flow)}" style="${wrap}">${holes.join('')}</div>`
}

/**
 * The slot indices a container declares, in the order they appear.
 *
 * Deliberately a scan for the attribute rather than a parse: this runs at
 * publish time in node and in the browser, the container may be hand-authored,
 * and anything it cannot understand it simply does not treat as a hole.
 */
export function slotsIn(containerHtml: string): number[] {
  const found: number[] = []
  const pattern = new RegExp(`${SLOT_ATTR}\\s*=\\s*["']?(\\d+)["']?`, 'g')
  for (const match of String(containerHtml ?? '').matchAll(pattern)) {
    const index = Number(match[1])
    if (Number.isInteger(index) && index >= 0 && !found.includes(index)) found.push(index)
  }
  return found
}

/** Wrap a part's fragment so it carries its own styling into any whole. */
export function isolate(html: string): string {
  return `<template shadowrootmode="open">${html}</template>`
}

/**
 * Seat each fill into its hole and return the composed document.
 *
 * A hole with no fill is left exactly as the container drew it. A fill whose
 * hole the container does not declare is DROPPED rather than appended: the
 * container decides where content can go, and inventing a position for a part
 * the designer made no room for is how a layout silently stops being one.
 */
export function assemble(containerHtml: string, fills: readonly SlotFill[]): string {
  const source = String(containerHtml ?? '')
  const byIndex = new Map<number, string>()
  for (const fill of fills) {
    if (typeof fill?.html === 'string' && fill.html.length > 0) byIndex.set(fill.index, fill.html)
  }
  if (byIndex.size === 0) return source

  // Match an empty hole element and fill it. Only empty holes are filled — a
  // container that already carries content in a hole is showing something the
  // designer put there, and overwriting it is not seating, it is clobbering.
  const hole = new RegExp(
    `(<([a-zA-Z][\\w-]*)([^>]*\\s${SLOT_ATTR}\\s*=\\s*["']?(\\d+)["']?[^>]*)>)\\s*(</\\2>)`,
    'g',
  )
  return source.replace(hole, (whole, open: string, _tag: string, _attrs: string, raw: string, close: string) => {
    const html = byIndex.get(Number(raw))
    return html === undefined ? whole : `${open}${isolate(html)}${close}`
  })
}

/** The arrangement a whole is plugged into — the resolved `layout:template`
 *  mark, nested to whatever depth it was designed at (layout-piece.ts). */
export interface BoundLayout {
  readonly node: LayoutNode
  /** Resolves each hole's conventional name to the signature that addresses
   *  it. Absent = holes keep their names and state no target, which is a page
   *  nobody can contribute to yet rather than a broken one. */
  readonly targets?: TargetResolver
}

/**
 * Everything a renderer or a publisher needs for one whole: the container it
 * will fill, and which holes it declares.
 *
 * THREE SOURCES, in this order, and the order is the argument:
 *
 *   1. the whole's own page, WHEN IT DECLARES HOLES — a designer who wrote
 *      `data-hc-slot` said where content goes, and nothing may overrule that;
 *   2. a bound LAYOUT TEMPLATE — a named, shared container the whole is
 *      plugged into, with the whole's own page seated into its self hole so
 *      binding a layout never costs the page (layout-template.ts);
 *   3. the frame's derived container — so parts have somewhere to sit before
 *      anyone has designed anything at all.
 *
 * A page WITHOUT holes used to end the search at (1) and silently compose
 * nothing, which is why every whole that wanted a designed layout had to
 * hand-author slot divs. That is the gap the template fills.
 */
export function containerFor(
  plan: DivisionPlan,
  authored?: string | null,
  bound?: BoundLayout | null,
): { readonly html: string; readonly slots: readonly number[] } | null {
  const own = (typeof authored === 'string' && authored.trim().length > 0) ? authored : ''

  if (own && slotsIn(own).length > 0) return { html: own, slots: slotsIn(own) }

  if (bound?.node) {
    // The page goes in isolated, like every other fill: the container's design
    // is the arrangement's, and a page that restyled its own container from
    // the inside would look right here and nowhere else.
    const composed = composeLayout(bound.node, bound.targets)
    const html = seatSelf(composed.html, own ? isolate(own) : '')
    // The leaves ARE the seating positions — a hole with a layout nested in it
    // is not one, its own leaves are. Read off the composition rather than off
    // any single template, which is what keeps the numbering stable when
    // somebody nests three levels down.
    return { html, slots: composed.leaves.map(leaf => leaf.index) }
  }

  const html = own || derivedContainer(plan)
  if (html === null) return null
  return { html, slots: slotsIn(html) }
}
