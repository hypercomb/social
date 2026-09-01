// presentation/tiles/tile-brief.ts
//
// THE BRIEF OF A TILE — everything a surface needs to say what a tile IS,
// gathered at one address: its writing (the lists and the notes), the
// behaviours it carries, the pheromones on it, what it opens as, and the
// affordances the hexagon band would offer for it.
//
// Read-only and address-keyed: `readTileBrief(segments)` answers for that
// exact place, so a view can brief a tile it is only LOOKING at as easily as
// the one it is standing in. Nothing here renders — tile-brief-panel.ts is
// the paper; this is the ink.
//
// Everything resolves through IoC or through the commands layer; nothing is
// imported from the shell. Absent services collapse to empty sections rather
// than throwing: a brief with one section is still a brief, and a page that
// cannot read its notes must still show its behaviours.

import { titleForLabel, tagsForSegments } from '../../commands/decoration-kind-index.js'
import { defaultViewAt } from '../../commands/view-default.js'
import { isBehaviorDormant } from '../../sharing/behavior-enablement.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../history/layer-placement.js'
import { splitNoteRoots, paletteRoleResolver } from '../../notes/note-classify.js'
import type { Note } from '../../notes/note-tree.js'
import type { VisualBeeRegistry, VisualBeeDescriptor } from '../../commands/visual-bee-registry.js'
import type { I18nProvider } from '@hypercomb/core'

const SIG_RE = /^[0-9a-f]{64}$/

type HistoryShape = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
type StoreShape = { getResource(sig: string): Promise<Blob | null> }
type NotesShape = { getNotesAtSegments(segments: readonly string[]): Promise<Note[]> }

/** What the hexagon band lends a surface that is not the band — the same
 *  affordance set, resolved for one tile. Structurally typed so this module
 *  never imports the overlay. */
type OverlayShape = {
  actionsForTile(label: string): Array<{
    name: string
    svgMarkup: string
    labelKey?: string
    backingKey?: string
    dangerRow?: boolean
    featureRow?: boolean
  }>
  invokeActionForTile(name: string, label: string): void
}

/** Actions that take the tile away — never tucked in with the rest. The same
 *  set the phone deck tints, kept here so one list serves both. */
const DESTRUCTIVE: ReadonlySet<string> = new Set(['remove', 'block'])

/** A behaviour the tile CARRIES — a decoration kind owned by a registered
 *  visual bee, or a bee whose content rides a first-class layer slot. */
export type BriefBehavior = {
  kind: string
  view: string
  /** Material Symbols ligature — the behaviour's stable visual identity. */
  icon: string
  label: string
  description: string
  /** This is the view the layer OPENS AS. */
  opensAs: boolean
  /** Globally switched off, or dormant here — listed, but not offered. */
  dormant: boolean
}

/** An affordance from the hexagon band, ready to render and to run. */
export type BriefAffordance = {
  name: string
  svgMarkup: string
  label: string
  destructive: boolean
  /** Its bee has not registered yet — shown shaded and inert, the same
   *  readiness rule the band applies. */
  inert: boolean
  run(): void
}

export type TileBrief = {
  segments: readonly string[]
  label: string
  title: string
  /** The structure — roots carrying a heading/list mark, or roots with
   *  children. The annotations window calls this tab "lists". */
  lists: readonly Note[]
  /** The prose and the conversation. */
  notes: readonly Note[]
  behaviors: readonly BriefBehavior[]
  affordances: readonly BriefAffordance[]
  tags: readonly string[]
  /** How many tiles are behind this one — 0 makes it a leaf. */
  childCount: number
  /** The view this layer opens as, '' when it has none. */
  opensAs: string
}

export const briefIsEmpty = (brief: TileBrief): boolean =>
  brief.lists.length === 0 && brief.notes.length === 0 &&
  brief.behaviors.length === 0 && brief.tags.length === 0

/** Localized text with the echo guard: `t()` hands the KEY back when it
 *  cannot resolve one, and a behaviour with no `labelKey` asks it for ''. */
export function briefText(key: string | undefined, fallback: string): string {
  if (!key) return fallback
  const i18n = window.ioc?.get?.('@hypercomb.social/I18n') as I18nProvider | undefined
  const text = i18n?.t?.(key)
  return text && text !== key ? text : fallback
}

/** A view token as a person would read it — the last resort when a behaviour
 *  declares no label key and the catalogs have nothing for it. */
const humanize = (token: string): string =>
  token.replace(/^visual:/, '').replace(/[:_-]+/g, ' ').trim()

export async function readTileBrief(
  segments: readonly string[],
  options: { withAffordances?: boolean } = {},
): Promise<TileBrief> {
  const path = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  const label = path.at(-1) ?? ''
  const [layer, notes] = await Promise.all([layerAt(path), readNotes(path)])
  const split = splitNoteRoots(notes, paletteRoleResolver())
  const [behaviors, childCount, opensAs] = await Promise.all([
    readBehaviors(path, layer),
    countChildren(layer),
    readOpensAs(path),
  ])
  return {
    segments: path,
    label,
    title: (label ? titleForLabel(label, navigator.language) : '') || label,
    lists: split.lists,
    notes: split.notes,
    behaviors: behaviors.map(behavior => ({
      ...behavior,
      opensAs: !!opensAs && behavior.view === opensAs,
    })),
    affordances: options.withAffordances ? affordancesFor(label) : [],
    tags: tagsForSegments(path),
    childCount,
    opensAs,
  }
}

/** The hexagon band's affordances for a tile ON THE CURRENT LAYER, as
 *  runnable rows. Empty when the band is absent or the tile is not on this
 *  layer — an empty set is the right answer there, not a broken one. */
export function affordancesFor(label: string): BriefAffordance[] {
  let overlay: OverlayShape | undefined
  try {
    overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as OverlayShape | undefined
  } catch { return [] }
  let actions: ReturnType<OverlayShape['actionsForTile']> = []
  try { actions = overlay?.actionsForTile?.(label) ?? [] } catch { return [] }
  return actions.map(action => ({
    name: action.name,
    svgMarkup: action.svgMarkup,
    label: briefText(action.labelKey, action.name.replace(/-/g, ' ')),
    destructive: DESTRUCTIVE.has(action.name),
    inert: !!action.backingKey && !window.ioc?.has?.(action.backingKey),
    // Through the band, not a bare emit: it owns the `tile:action` payload
    // and the one action that is not an emit at all (break-apart shatters
    // first).
    run: () => {
      const live = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone') as OverlayShape | undefined
      live?.invokeActionForTile?.(action.name, label)
    },
  }))
}

async function layerAt(segments: readonly string[]): Promise<Record<string, unknown> | null> {
  const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return null
  try {
    return await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
  } catch { return null }
}

async function readNotes(segments: readonly string[]): Promise<Note[]> {
  const notes = window.ioc?.get<NotesShape>('@diamondcoreprocessor.com/NotesService')
  if (!notes?.getNotesAtSegments) return []
  try { return await notes.getNotesAtSegments(segments) } catch { return [] }
}

async function countChildren(layer: Record<string, unknown> | null): Promise<number> {
  const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
  if (!history || !layer) return 0
  try {
    const names = await childNamesOf(
      history as unknown as PlacementHistory,
      layer as unknown as PlacementLayer,
    )
    return names.length
  } catch { return 0 }
}

async function readOpensAs(segments: readonly string[]): Promise<string> {
  try { return await defaultViewAt(segments) } catch { return '' }
}

/**
 * The behaviours declared AT this exact address: the layer's own decoration
 * kinds recognised by the visual-bee registry, plus the bees whose content
 * rides a first-class slot (a website's `website`, a tutor's `tutor`) — the
 * same two sources the Beehaviors panel reads, so a tile never carries a
 * behaviour on one surface and not on the other.
 *
 * Read from the LAYER, never from the hot label index: that index is keyed by
 * label against the current parent, which is the wrong address for a tile you
 * are standing inside.
 */
async function readBehaviors(
  segments: readonly string[],
  layer: Record<string, unknown> | null,
): Promise<BriefBehavior[]> {
  const registry = window.ioc?.get<VisualBeeRegistry>('@diamondcoreprocessor.com/VisualBeeRegistry')
  if (!registry || !layer) return []
  const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
  const out: BriefBehavior[] = []
  const seen = new Set<string>()

  const push = (bee: VisualBeeDescriptor, kind: string): void => {
    if (seen.has(bee.view)) return
    seen.add(bee.view)
    out.push({
      kind,
      view: bee.view,
      icon: bee.toggleIcon || bee.iconName || 'extension',
      label: briefText(bee.labelKey, humanize(bee.view)),
      description: briefText(bee.descriptionKey, ''),
      opensAs: false,
      // The dormancy lens alone — it already reads the global roster, and a
      // raw isKindGloballyOff OR'd in front would defeat both the published
      // visitor shell's exception (dark cold-install roster ⇒ every brief row
      // dormant) and the local wake's escape hatch.
      dormant: isBehaviorDormant(kind, segments),
    })
  }

  const slot = (layer as { decorations?: unknown }).decorations
  if (Array.isArray(slot) && store?.getResource) {
    for (const sig of slot) {
      if (typeof sig !== 'string' || !SIG_RE.test(sig)) continue
      try {
        const blob = await store.getResource(sig)
        if (!blob) continue
        const record = JSON.parse(await blob.text()) as { kind?: unknown }
        const kind = typeof record?.kind === 'string' ? record.kind : ''
        if (!kind) continue
        const bee = registry.byDecorationKind?.(kind)
        if (bee) push(bee, kind)
      } catch { /* malformed record — skip */ }
    }
  }

  for (const bee of registry.all?.() ?? []) {
    if (!bee.slot || seen.has(bee.view)) continue
    const value = layer[bee.slot]
    if (!Array.isArray(value) || !value.some(s => typeof s === 'string' && SIG_RE.test(s))) continue
    push(bee, bee.decorationKind)
  }

  return out
}
