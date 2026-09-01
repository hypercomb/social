// One hierarchy reader shared by every trusted document projection.

import {
  childSigsOf,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLayer,
} from '../../history/layer-placement.js'
import type { ViewSourceScope } from '../../commands/view-source-scope.js'
import type { Note } from '../../notes/notes.drone.js'

export type DocumentViewHistory = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}

export type DocumentViewNotes = {
  getNotesAtSegments(segments: readonly string[]): Promise<Note[]>
}

export type DocumentViewItem = {
  readonly name: string
  readonly title: string
  readonly source: string
  readonly segments: readonly string[]
  readonly depth: number
  readonly tags: string[]
  readonly notes: Note[]
  /** Children this item has of its own. A view reads it to know whether the
   *  item can be OPENED as a document in its own right — the hierarchy is
   *  what a document view descends, so a leaf must not offer the affordance. */
  readonly childCount: number
}

export const documentViewPathKey = (path: readonly string[]): string =>
  path.join('\u0000')

/** Apply a hierarchy curation selection. `undefined` is intentionally
 * different from `[]`: no saved selection means the complete live hierarchy,
 * while an empty saved selection means the participant chose no tiles. */
export function filterDocumentViewItems(
  items: readonly DocumentViewItem[],
  rootSegments: readonly string[],
  selectedRelativePaths: readonly (readonly string[])[] | undefined,
): DocumentViewItem[] {
  if (selectedRelativePaths === undefined) return [...items]
  const selected = new Set(selectedRelativePaths.map(documentViewPathKey))
  return items.filter(item =>
    selected.has(documentViewPathKey(item.segments.slice(rootSegments.length))))
}

/**
 * Read direct children for `layer`, or the complete descendant tree for
 * `hierarchy`, in stable depth-first layer order.
 *
 * A child first resolves through the parent's signed children slot (so an
 * unvisited/cold child still exists), then prefers its own live location head
 * when one is available (so deep edits do not wait for a parent rewrite).
 */
export async function readDocumentViewItems(opts: {
  history: DocumentViewHistory
  notes: DocumentViewNotes
  segments: readonly string[]
  scope: ViewSourceScope
  locale?: string
  ensureMetadata?: (labels: readonly string[], parentSegments: readonly string[]) => Promise<void>
  titleForSegments?: (segments: readonly string[], locale: string) => string
  tagsForSegments?: (segments: readonly string[]) => readonly string[]
}): Promise<DocumentViewItem[]> {
  // A view opened in place can target a child whose own history bag has never
  // been visited. Resolve through its parent-held layer as the cold fallback.
  const root = await resolveLayerAt(
    opts.history as unknown as PlacementHistory,
    undefined,
    opts.segments,
  )
  if (!root) return []

  const locale = opts.locale ?? 'en'
  const out: DocumentViewItem[] = []

  const walk = async (
    parent: PlacementLayer,
    parentSegments: readonly string[],
    depth: number,
    ancestors: ReadonlySet<string>,
  ): Promise<void> => {
    for (const rawSig of childSigsOf(parent)) {
      const childSig = String(rawSig)
      if (!childSig || ancestors.has(childSig)) continue
      const stored = await opts.history.getLayerBySig(childSig)
      const name = typeof stored?.['name'] === 'string' ? stored['name'].trim() : ''
      if (!name) continue

      const segments = [...parentSegments, name]
      await opts.ensureMetadata?.([name], parentSegments)
      let layer = stored
      try {
        const locationSig = await opts.history.sign({ explorerSegments: () => segments })
        layer = await opts.history.currentLayerAt(locationSig) ?? stored
      } catch {
        // The parent-held layer is still authoritative enough to render.
      }

      const relativeSegments = segments.slice(opts.segments.length)
      const titles = relativeSegments.map((label, index) => {
        const itemSegments = segments.slice(0, opts.segments.length + index + 1)
        return opts.titleForSegments?.(itemSegments, locale) || label
      })
      out.push({
        name,
        title: titles.at(-1) ?? name,
        source: titles.join(' › '),
        segments,
        depth,
        tags: [...(opts.tagsForSegments?.(segments) ?? [])],
        notes: await opts.notes.getNotesAtSegments(segments),
        childCount: childSigsOf((layer ?? stored) as PlacementLayer).length,
      })

      if (opts.scope === 'hierarchy' && layer) {
        const nextAncestors = new Set(ancestors)
        nextAncestors.add(childSig)
        await walk(layer as PlacementLayer, segments, depth + 1, nextAncestors)
      }
    }
  }

  await walk(root as PlacementLayer, opts.segments, 0, new Set())
  return out
}
