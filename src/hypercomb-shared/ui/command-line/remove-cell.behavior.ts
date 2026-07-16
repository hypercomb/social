// hypercomb-shared/ui/command-line/remove-cell.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'
import type { CompletionUtility } from '@hypercomb/shared/core/completion-utility'
import type { Lineage } from '../../core/lineage'
import type { Navigation } from '../../core/navigation'
import { EffectBus, hypercomb } from '@hypercomb/core'
import { parseArrayItems, parseOneItem } from '../../core/array-parser'

// Module services reached through IoC — this is shell UI, so it must NOT import
// essentials (essentials is runtime-loaded from OPFS in the web shell; a
// compile-time import would bundle it into shared and break that model).
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const COMMITTER_KEY = '@diamondcoreprocessor.com/LayerCommitter'
const CURSOR_KEY = '@diamondcoreprocessor.com/HistoryCursorService'

type LayerLike = { name?: string; children?: readonly string[]; [slot: string]: unknown }
type HistoryLike = {
  sign: (lineage: { explorerSegments: () => readonly string[] }) => Promise<string>
  currentLayerAt: (locationSig: string) => Promise<LayerLike | null>
  getLayerBySig: (sig: string) => Promise<LayerLike | null>
}
type CommitterLike = {
  update: (
    segments: readonly string[],
    layer: { [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
}

/** Resolve the layer AT an absolute path, robustly — mirrors essentials'
 *  resolveLayerAt. The own-bag read (currentLayerAt) is authoritative when
 *  warm; a location that exists only as a child sig in its parent (never
 *  committed into, or cold after a reload) falls back to the parent chain.
 *  Copied here rather than imported (shell UI must not import essentials). */
async function resolveLayerAt(history: HistoryLike, segments: readonly string[]): Promise<LayerLike | null> {
  const locSig = await history.sign({ explorerSegments: () => segments })
  const direct = await history.currentLayerAt(locSig)
  if (direct) return direct
  if (segments.length === 0) return null
  const parent = await resolveLayerAt(history, segments.slice(0, -1))
  const childSigs = Array.isArray(parent?.children) ? parent!.children : []
  const leaf = segments[segments.length - 1]
  for (const sig of childSigs) {
    const child = await history.getLayerBySig(String(sig))
    if (child && child.name === leaf) return child
  }
  return null
}

/** Like resolveLayerAt but with a cursor fallback for the CURRENT location:
 *  its own bag may be cold after a reload while the cursor holds the layer the
 *  user is actually looking at. Mirrors essentials' resolveCurrentLayer — the
 *  cursor is only valid for the current location, so it is only consulted when
 *  `segments` IS that location. */
async function resolveParentLayer(
  history: HistoryLike,
  segments: readonly string[],
  currentLayerSig: string | undefined,
  currentSegments: readonly string[],
): Promise<LayerLike | null> {
  const viaChain = await resolveLayerAt(history, segments)
  if (viaChain) return viaChain
  if (currentLayerSig && segments.join('/') === currentSegments.join('/')) {
    return await history.getLayerBySig(currentLayerSig)
  }
  return null
}

/**
 * Enter with `~` prefix → remove a cell from the current level.
 *
 * Layer-as-primitive: drops the target(s) from the parent layer's `children`
 * slot via LayerCommitter and commits the next marker. The cells' OPFS data
 * (history bags, body resources, sub-trees) is left intact — undoing restores
 * them. Removes from the visible hierarchy only.
 *
 * Examples:
 *   "~cellname"        → removes cellname from current directory
 *   "~parent/child"    → removes child from parent (parent stays)
 *   "~[foo,bar]"       → removes foo and bar from current directory
 *   "~[foo, bar:tag]"  → removes foo, removes tag from bar
 *
 * Note: `~label:tag` is handled by the universal tag pre-processor (removes a tag),
 * so this behavior only fires when there's no colon after the label.
 */
export class RemoveCellBehavior implements CommandLineBehavior {

  readonly name = 'remove-cell'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^~.+/,
      description: 'Remove cells from the current directory',
      examples: [
        { input: '~cellname', key: 'Enter', result: 'Removes cellname from current directory' },
        { input: '~parent/child', key: 'Enter', result: 'Removes child from parent (parent stays)' },
        { input: '~[foo,bar]', key: 'Enter', result: 'Removes foo and bar from current directory' }
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    return event.key === 'Enter' && !event.shiftKey && input.startsWith('~')
  }

  async execute(input: string): Promise<void> {
    const completions = get('@hypercomb.social/CompletionUtility') as CompletionUtility
    const lineage = get('@hypercomb.social/Lineage') as Lineage

    const body = input.slice(1).trim() // strip leading ~
    if (!body) return

    // bracket syntax: ~[foo,bar,baz:tag]
    const bracketMatch = body.match(/^\[(.+)\]$/)
    const items = bracketMatch
      ? parseArrayItems(bracketMatch[1], completions.normalize)
      : (() => {
          const single = parseOneItem(body, completions.normalize)
          return single ? [single] : []
        })()

    if (!items.length) return

    const history = get(HISTORY_KEY) as HistoryLike | undefined
    const committer = get(COMMITTER_KEY) as CommitterLike | undefined
    const cursor = get(CURSOR_KEY) as { currentLayerSig?: string } | undefined
    if (!history || !committer) return

    const baseSegments = ((lineage as { explorerSegments?: () => readonly string[] }).explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)

    // Group targets by the PARENT they leave, so each affected parent commits
    // ONCE (vs one marker per cell). `~name` removes from the current dir;
    // `~parent/child` removes child from parent.
    const removalsByParent = new Map<string, { segments: string[]; names: string[] }>()
    for (const item of items) {
      // Folder-based tag persistence retired (the layer is the only source of
      // truth for tag state) — tag mutations in ~ context are dropped.
      if (item.op === 'tag-add' || item.op === 'tag-remove') continue
      const leafName = item.segments[item.segments.length - 1]
      if (!leafName) continue
      const parentSegs = [...baseSegments, ...item.segments.slice(0, -1)]
      const key = parentSegs.join('/')
      const entry = removalsByParent.get(key) ?? { segments: parentSegs, names: [] }
      entry.names.push(leafName)
      removalsByParent.set(key, entry)
    }
    if (removalsByParent.size === 0) return

    // ONE sig-preserving commit per affected parent. Keep every surviving
    // child's EXACT stored sig and drop only the targets — do NOT rebuild
    // `children` from survivor NAMES (nor from an OPFS directory scan, which is
    // meaningless under the flat sig-pool model). A NAME slot makes the committer
    // re-resolve each survivor via latestMarkerSigFor on its own bag, which
    // AUTO-MINTS an empty {name} layer for any survivor whose own bag is cold
    // (freshly-installed content) — the renderer then paints it as a no-image
    // tile. Mirrors RemoveQueenBee / TileActionsDrone#removeTile.
    for (const { segments, names } of removalsByParent.values()) {
      const parent = await resolveParentLayer(history, segments, cursor?.currentLayerSig, baseSegments)
      if (!parent) continue
      const childSigs = Array.isArray(parent.children) ? parent.children : []
      const targetSet = new Set(names)
      const survivorSigs: string[] = []
      for (const sig of childSigs) {
        const child = await history.getLayerBySig(String(sig))
        // Drop only sigs we can positively identify as a target; keep everything
        // else (incl. an unreadable sibling) so a cold miss never wipes a tile.
        if (child && typeof child.name === 'string' && targetSet.has(child.name)) continue
        survivorSigs.push(String(sig))
      }
      // Eager visual unmount BEFORE awaiting the commit; `viaUpdate` so the
      // committer's own cell:removed listener doesn't queue a second marker.
      for (const name of names) EffectBus.emit('cell:removed', { cell: name, segments, viaUpdate: true })
      // Empty nameSlots → SET `children` to these exact sigs (no re-resolution,
      // no auto-mint); other slots hydrate from the previous layer.
      await committer.update(segments, { children: survivorSigs }, new Set<string>())
    }

    await new hypercomb().act()

    // If the CURRENT directory emptied, step up to its parent — read emptiness
    // from the layer, not an OPFS dir scan. Only meaningful when the current
    // location was itself an affected parent (the `~name` case).
    if (baseSegments.length > 0) {
      const current = await resolveParentLayer(history, baseSegments, cursor?.currentLayerSig, baseSegments)
      const kids = Array.isArray(current?.children) ? current!.children : []
      if (kids.length === 0) {
        const navigation = get('@hypercomb.social/Navigation') as Navigation
        const segments = navigation.segmentsRaw()
        if (segments.length > 0) {
          navigation.goRaw(segments.slice(0, -1))
        }
      }
    }
  }
}
