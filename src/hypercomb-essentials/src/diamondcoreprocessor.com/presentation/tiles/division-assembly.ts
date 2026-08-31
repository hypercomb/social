// diamondcoreprocessor.com/presentation/tiles/division-assembly.ts
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

  const wrap = plan.flow === 'stack'
    ? 'display:flex;flex-direction:column;gap:1rem'
    : 'display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start'
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

/**
 * Everything a renderer or a publisher needs for one whole: the container it
 * will fill, and which holes it declares.
 *
 * `authored` is the whole's own page when it has one. Absent, the frame's
 * derived container stands in — so the parts have somewhere to sit before
 * anyone has designed the page they sit in.
 */
export function containerFor(
  plan: DivisionPlan,
  authored?: string | null,
): { readonly html: string; readonly slots: readonly number[] } | null {
  const html = (typeof authored === 'string' && authored.trim().length > 0)
    ? authored
    : derivedContainer(plan)
  if (html === null) return null
  return { html, slots: slotsIn(html) }
}
