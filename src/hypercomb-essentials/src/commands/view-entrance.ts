// commands/view-entrance.ts
//
// Where a branch-scoped view is ENTERED from.
//
// A `scope: 'branch'` behaviour (the website) is declared at a ROOT and every
// descendant is a member of it. So the cell you click is not necessarily the
// cell that HOLDS the surface: standing outside a site and clicking a member
// tile's behaviour icon used to navigate to that tile and flip the mode there,
// which mounts a page-less cell — website mode comes up with nothing on it and
// the home page never shows.
//
// The entrance is THE CELL YOU ENTER FROM when it carries the view's content
// — a sub page opens as that sub page, the root as the root (jwize
// 2026-11-08: "You enter in webview from the page you enter and you can
// navigate around … sub = sub, root = root"). Only a cell that carries
// nothing of its own climbs, and then to the NEAREST ancestor that does, so
// the click still lands on a page rather than a page-less dead end. It used
// to climb to the OUTERMOST carrier in every case — the site root — which
// turned every sub-page icon into a trip to the home page.
//
// Node-scoped behaviours (a deck, a post-it) have no root above them: their
// content is the cell it was declared on, so the entrance is the cell itself.
//
// The probe is deliberately the same three questions ViewBee's scope walk and
// the features panel ask — the behaviour's first-class `slot`, the website
// slot (the one behaviour whose slot the descriptor cannot name), or a record
// of its `decorationKind`.

import { SITE_VIEW_IOC_KEY } from '@hypercomb/core'
import type { VisualBeeDescriptor } from './visual-bee-registry.js'
import { WEBSITE_SLOT } from './website-slot.js'

const SIG_RE = /^[0-9a-f]{64}$/

type HistoryLike = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<Record<string, unknown> | null>
}

type StoreLike = { getResource(sig: string): Promise<Blob | null> }

function nonEmptySigArray(value: unknown): boolean {
  return Array.isArray(value) && value.some(s => typeof s === 'string' && SIG_RE.test(s))
}

type PageResolver = { resolvePageSig?(segments: readonly string[]): Promise<string | null> }

/** Does the cell at `segments` HOLD this behaviour's content? */
async function carriesView(
  segments: readonly string[],
  bee: VisualBeeDescriptor,
  history: HistoryLike,
  store: StoreLike | undefined,
): Promise<boolean> {
  // THE WEBSITE ASKS THE SITE VIEW. A page lives in one of three places (the
  // `website` slot, a page decoration, the legacy `context` slot) and the
  // renderer's own lookup is the one question every page surface asks. A
  // narrower copy here read a section whose page sits in a slot it did not
  // know as page-less, and the entrance climbed to the existing website
  // instead of opening the section (jwize 2026-11-08). Falls through to the
  // probe below when the site view is not up.
  if (bee.view === 'website') {
    const resolver = window.ioc?.get<PageResolver>(SITE_VIEW_IOC_KEY)
    if (typeof resolver?.resolvePageSig === 'function') {
      try { if (await resolver.resolvePageSig(segments)) return true } catch { /* fall through */ }
    }
  }
  let layer: Record<string, unknown> | null
  try {
    layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
  } catch {
    return false
  }
  if (!layer) return false

  if (bee.slot && nonEmptySigArray(layer[bee.slot])) return true
  if (bee.view === 'website' && nonEmptySigArray(layer[WEBSITE_SLOT])) return true
  if (!bee.decorationKind || !store?.getResource) return false

  const decorations = layer['decorations']
  const sigs: string[] = Array.isArray(decorations)
    ? decorations.map(s => String(s)).filter(s => SIG_RE.test(s))
    : []
  for (const sig of sigs) {
    try {
      const blob = await store.getResource(sig)
      if (!blob) continue
      const record = JSON.parse(await blob.text()) as { kind?: string }
      if (record?.kind === bee.decorationKind) return true
    } catch { /* malformed / missing record — not a carrier */ }
  }
  return false
}

/** The cell to navigate to before opening `bee`'s surface at `target`.
 *
 *  `target` itself when it carries the behaviour — the page you enter from is
 *  the page you enter. Otherwise the NEAREST strict ancestor that carries it,
 *  walked innermost-first, so a member tile with no page of its own opens on
 *  the closest page above it. Never returns the hive root (`d` stops at 1),
 *  and falls back to `target` unchanged when nothing carries the view, when
 *  the behaviour is node-scoped, or when the probe can't run — a cold history
 *  or an unreadable layer degrades to opening right here rather than to a
 *  dead click. */
export async function resolveViewEntrance(
  bee: VisualBeeDescriptor,
  target: readonly string[],
): Promise<readonly string[]> {
  if (bee.scope !== 'branch' || target.length < 2) return target
  const ioc = window.ioc
  const history = ioc?.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return target
  const store = ioc?.get<StoreLike>('@hypercomb.social/Store')

  if (await carriesView(target, bee, history, store)) return target
  for (let d = target.length - 1; d >= 1; d--) {
    const ancestor = target.slice(0, d)
    if (await carriesView(ancestor, bee, history, store)) return ancestor
  }
  return target
}
