// diamondcoreprocessor.com/commands/canonical-reference.service.ts
//
// The one write door for Portals. A source may be discovered anywhere, but its
// fixed name promotes it into one canonical root bag. Every lineage appearance
// minted afterwards is a small reference decoration to that root.

import {
  CANONICAL_REFERENCE_SERVICE_KEY,
  EffectBus,
  buildCanonicalReferenceRecord,
  buildCanonicalVariantRecord,
  canonicalReferenceName,
  canonicalRootSegments,
  type CanonicalReferenceService,
  type CanonicalRoot,
  type PlaceCanonicalReferenceOptions,
} from '@hypercomb/core'
import {
  childLayerOf,
  flattenLayerTree,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLayer,
} from '../history/layer-placement.js'

type StoreLike = {
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type LineageLike = { readonly domain?: unknown }
type CommitterLike = {
  importTree(
    updates: { segments: readonly string[]; layer: { name?: string; [slot: string]: unknown } }[],
    nameSlots?: ReadonlySet<string>,
  ): Promise<void>
  commitChildrenDeltas(
    segments: readonly string[],
    changes: { appends?: readonly string[] },
  ): Promise<string>
}

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

const sameSegments = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((segment, index) => segment === b[index])

export class CanonicalReferenceServiceImpl implements CanonicalReferenceService {
  /** Keep one immutable layer as a member of the fixed-name pool. The member
   * is content-addressed by its record sig, so discovering the same atomic
   * meaning through several lineages dedupes while a genuinely different layer
   * remains alongside it. This never advances the root head. */
  async #retainVariant(
    name: string,
    history: PlacementHistory,
    layer: PlacementLayer,
    knownLayerSig?: string,
  ): Promise<void> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getPool) return
    const layerSig = knownLayerSig
      ?? await history.materializeLayer?.(layer).catch(() => undefined)
    if (!layerSig) return
    const record = buildCanonicalVariantRecord({ name, layerSig })
    if (!record) return
    const bytes = new TextEncoder().encode(JSON.stringify(record))
    const recordSig = await store.putResource(
      new Blob([bytes], { type: 'application/json' }),
      { emit: false },
    )
    const pool = await store.getPool(name)
    if (!pool) return
    const handle = await pool.getFileHandle(recordSig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  }

  /** Resolve a discovery separately from the canonical root. It is a pool
   * candidate even when the root already has a chosen head. */
  async #discoveredVariant(
    history: PlacementHistory,
    domain: unknown,
    rootSegments: readonly string[],
    sourceSegments: readonly string[] | null,
  ): Promise<{ layer: PlacementLayer; sig?: string } | null> {
    if (!sourceSegments || sourceSegments.length === 0 || sameSegments(sourceSegments, rootSegments)) return null
    const layer = await resolveLayerAt(history, domain, sourceSegments)
    if (!layer) return null
    const parent = await resolveLayerAt(history, domain, sourceSegments.slice(0, -1))
    const child = await childLayerOf(history, parent, sourceSegments[sourceSegments.length - 1])
    return { layer, ...(child?.sig ? { sig: child.sig } : {}) }
  }

  /**
   * Promote one discovered item to its fixed-name root. The subtree is
   * re-homed by signatures through importTree: resource bytes are never copied,
   * but every descendant receives the matching root lineage needed for live
   * edits. importTree also links the promoted root into `/`, which makes the
   * hive root the complete canonical inventory.
   *
   * Existing root remains the chosen head. A later same-named discovery is
   * retained as another immutable member of the root's meaning pool; it never
   * silently replaces the participant's choice and never disappears.
   */
  async ensureRoot(
    rawName: string,
    sourceSegments: readonly string[] | null,
  ): Promise<CanonicalRoot | null> {
    const name = canonicalReferenceName(rawName)
    const segments = canonicalRootSegments(name)
    if (!name || segments.length !== 1) return null

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !committer?.importTree || !committer.commitChildrenDeltas) return null

    const targetSig = await history.sign({
      domain: lineage?.domain,
      explorerSegments: () => segments,
    })
    const discovered = await this.#discoveredVariant(
      history, lineage?.domain, segments, sourceSegments,
    )

    // Prefer the root's listed child: it is the authoritative membership and
    // already proves the canonical item is part of the full root complement.
    const hiveRoot = await resolveLayerAt(history, lineage?.domain, [])
    const listed = await childLayerOf(history, hiveRoot, name)
    if (listed) {
      // A child may exist only as its parent's carried content sig. Seed the
      // fixed-name history bag too, so every reference resolves one live head.
      await history.commitLayer(targetSig, listed.layer)
      await this.#retainVariant(name, history, listed.layer, listed.sig)
      if (discovered) await this.#retainVariant(name, history, discovered.layer, discovered.sig)
      return { name, segments, targetSig }
    }

    // A detached root can have a perfectly good bag (for example after its
    // index/root appearance was hidden or removed). Re-link its current head;
    // never replace it from a same-named source elsewhere.
    const direct = await history.currentLayerAt(targetSig)
    if (direct) {
      const layer: PlacementLayer = { ...direct, name }
      const headSig = await history.commitLayer(targetSig, layer)
      await committer.commitChildrenDeltas([], { appends: [headSig] })
      await this.#retainVariant(name, history, layer, headSig)
      if (discovered) await this.#retainVariant(name, history, discovered.layer, discovered.sig)
      return { name, segments, targetSig }
    }

    let source: PlacementLayer | null = null
    if (sourceSegments && sourceSegments.length > 0) {
      source = await resolveLayerAt(history, lineage?.domain, sourceSegments)
      if (!source) return null
    } else if (sourceSegments !== null) {
      // `[]` is the hive itself, never an item to promote.
      return null
    }

    if (source) {
      const updates = await flattenLayerTree(history, source, segments)
      if (updates.length === 0) return null
      updates[0] = { ...updates[0], layer: { ...updates[0].layer, name } }
      await committer.importTree(updates, new Set(['children']))
    } else {
      // Explicit create: one empty canonical item, linked into `/` by the same
      // primitive used for a promoted subtree.
      await committer.importTree([{ segments, layer: { name } }], new Set(['children']))
    }

    // importTree can refuse while rewound/previewing. Verify the postcondition;
    // a caller must never mint a leaf pointing at a root that did not land.
    const landed = await resolveLayerAt(history, lineage?.domain, segments)
    if (!landed) return null
    await this.#retainVariant(name, history, landed)
    if (discovered) await this.#retainVariant(name, history, discovered.layer, discovered.sig)
    return { name, segments, targetSig }
  }

  async place(options: PlaceCanonicalReferenceOptions): Promise<string | null> {
    const name = canonicalReferenceName(options.name)
    if (!name) return null

    const root = await this.ensureRoot(name, options.sourceSegments)
    if (!root) return null

    const parentSegments = options.parentSegments.map(s => String(s ?? '').trim()).filter(Boolean)
    // At `/`, the canonical item itself is the appearance. A reference with the
    // same fixed path would collide with it and add no information.
    if (sameSegments(parentSegments, [])) return root.name

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const store = get<StoreLike>('@hypercomb.social/Store')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !committer?.commitChildrenDeltas || !store?.putResource) return null

    // One fixed name addresses one child location. Refuse to overwrite an
    // existing appearance; callers may safely treat this as already active.
    const parent = await resolveLayerAt(history, lineage?.domain, parentSegments)
    if (await childLayerOf(history, parent, name)) return null

    const record = buildCanonicalReferenceRecord({
      name,
      targetSig: root.targetSig,
      requiredMarks: options.requiredMarks,
      requiredBouquet: options.requiredBouquet,
    })
    const decorationSig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }),
    )

    const childSegments = [...parentSegments, name]
    const childLocationSig = await history.sign({
      domain: lineage?.domain,
      explorerSegments: () => childSegments,
    })
    const childMarkerSig = await history.commitLayer(childLocationSig, {
      name,
      decorations: [decorationSig],
    })
    await committer.commitChildrenDeltas(parentSegments, { appends: [childMarkerSig] })

    EffectBus.emit('decorations:changed', {
      segments: childSegments,
      op: 'append',
      sig: decorationSig,
    })
    EffectBus.emit('cell:added', {
      cell: name,
      segments: [...parentSegments],
      viaUpdate: true,
      reference: true,
    })
    return name
  }
}

const canonicalReferenceService = new CanonicalReferenceServiceImpl()
window.ioc.register(CANONICAL_REFERENCE_SERVICE_KEY, canonicalReferenceService)
