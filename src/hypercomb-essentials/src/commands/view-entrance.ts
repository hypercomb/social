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
// The entrance is the OUTERMOST self-or-ancestor that actually carries the
// view's content — for a website, the site root, whose page IS the home page.
// Same rule the site-view renderer already uses on the way OUT (`#entranceOf`),
// applied on the way IN so both ends of the gesture agree on where the site
// begins.
//
// Node-scoped behaviours (a deck, a post-it) have no root above them: their
// content is the cell it was declared on, so the entrance is the cell itself.
//
// The probe is deliberately the same three questions ViewBee's scope walk and
// the features panel ask — the behaviour's first-class `slot`, the website
// slot (the one behaviour whose slot the descriptor cannot name), or a record
// of its `decorationKind`.

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

/** Does the cell at `segments` HOLD this behaviour's content? */
async function carriesView(
  segments: readonly string[],
  bee: VisualBeeDescriptor,
  history: HistoryLike,
  store: StoreLike | undefined,
): Promise<boolean> {
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
 *  Walks STRICT ancestors outermost-first and returns the first that carries
 *  the behaviour — the scope root. Never returns the hive root (`d` starts at
 *  1), and falls back to `target` unchanged when nothing above it carries the
 *  view, when the behaviour is node-scoped, or when the probe can't run. The
 *  fallback is the old behaviour, so a cold history or an unreadable layer
 *  degrades to today rather than to a dead click. */
export async function resolveViewEntrance(
  bee: VisualBeeDescriptor,
  target: readonly string[],
): Promise<readonly string[]> {
  if (bee.scope !== 'branch' || target.length < 2) return target
  const ioc = window.ioc
  const history = ioc?.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return target
  const store = ioc?.get<StoreLike>('@hypercomb.social/Store')

  for (let d = 1; d < target.length; d++) {
    const ancestor = target.slice(0, d)
    if (await carriesView(ancestor, bee, history, store)) return ancestor
  }
  return target
}
