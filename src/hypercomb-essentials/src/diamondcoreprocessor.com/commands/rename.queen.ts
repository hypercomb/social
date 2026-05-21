// diamondcoreprocessor.com/commands/rename.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

/**
 * /rename — rename a tile (cell directory) at the current location.
 *
 * Syntax:
 *   /rename newName                     — rename currently selected tile
 *   [old-name]/rename newName           — chained: select then rename
 *
 * The rename operation:
 * 1. Reads all content from the old directory
 * 2. Writes it to a new directory with the new name
 * 3. Removes the old directory
 * 4. Emits cell:removed + cell:added so LayerCommitter rewrites the
 *    parent's `children` slot (oldName sig → newName sig) and cascades
 *    to root. The rename is captured in the layer marker chain itself.
 * 5. Emits `cell:renamed` for reactive UI consumers.
 */
export class RenameQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'rename'
  override readonly aliases = []
  override description = 'Rename a tile'

  protected async execute(args: string): Promise<void> {
    const newName = normalizeName(args.trim())
    if (!newName) return

    // Get the selected tile (exactly one required)
    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string>; clear: () => void } | undefined
    if (!selection || selection.selected.size !== 1) return

    const oldName = [...selection.selected][0]
    if (oldName === newName) return

    // Pure layer-only rename. No OPFS dir copy, no removeEntry. The
    // tile's identity is its layer in the merkle tree; renaming = pull
    // the old layer's slots forward into a new layer with the new
    // name, then remove the old name from the parent's children.
    const lineage = get('@hypercomb.social/Lineage') as
      { explorerSegments?: () => readonly string[] } | undefined
    const history = get('@diamondcoreprocessor.com/HistoryService') as
      {
        sign?: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
        currentLayerAt?: (s: string) => Promise<unknown>
        getLayerBySig?: (s: string) => Promise<{ name?: string; [slot: string]: unknown } | null>
      } | undefined
    const committer = get('@diamondcoreprocessor.com/LayerCommitter') as
      { update?: (segments: readonly string[], layer: { name?: string; [slot: string]: unknown }) => Promise<string> } | undefined
    if (!history?.sign || !history?.currentLayerAt || !history?.getLayerBySig || !committer?.update) return

    const parentSegments = lineage?.explorerSegments?.() ?? []

    try {
      const parentSig = await history.sign({ explorerSegments: () => parentSegments })
      const parentLayer = await history.currentLayerAt(parentSig) as { children?: readonly unknown[] } | null
      const childSigs = (parentLayer?.children ?? []) as readonly unknown[]

      // Find the old layer by walking the parent's children. Bail if a
      // sibling already carries the new name.
      let oldLayer: { name?: string; [slot: string]: unknown } | null = null
      for (const cs of childSigs) {
        if (typeof cs !== 'string') continue
        const cl = await history.getLayerBySig(cs)
        if (!cl) continue
        if (cl.name === newName) return // name taken
        if (cl.name === oldName) oldLayer = cl
      }
      if (!oldLayer) return // old name not in parent's children

      // Build the new layer: same slots, new name. `name` is intrinsic
      // identity; the rest copies over verbatim so every slot survives.
      const renamedLayer: { name: string; [slot: string]: unknown } = { name: newName }
      for (const [k, v] of Object.entries(oldLayer)) {
        if (k === 'name') continue
        renamedLayer[k] = v
      }

      // Commit the new layer at [...parent, newName]. The committer
      // cascade folds the new sig into parent.children alongside the
      // old one (transient state — next step removes the old).
      await committer.update([...parentSegments, newName], renamedLayer)

      // Drop the old name from parent.children via the cascade.
      const groupId = `rename:${Date.now().toString(36)}`
      EffectBus.emit('cell:removed', { cell: oldName, segments: parentSegments, groupId })
      EffectBus.emit('cell:renamed', { oldName, newName })

      selection.clear()
      void new hypercomb().act()
    } catch (err) {
      console.warn('[rename] failed', err)
    }
  }
}

// ── name normalization ──────────────────────────────────

function normalizeName(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

// ── registration ────────────────────────────────────────

const _rename = new RenameQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RenameQueenBee', _rename)
