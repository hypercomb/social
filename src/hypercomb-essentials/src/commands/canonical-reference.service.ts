// commands/canonical-reference.service.ts
//
// The one write door for Portals. A reference is a child tile under the
// holder that points at where its target LIVES. It moves nothing, copies
// nothing, and lists nothing anywhere else.
//
// THE ROOT IS A STORE, NOT A COLLECTION. This door used to "promote" every
// referenced item to a fixed-name root child — flatten a copy to `/<name>`,
// append it to the root hive's children, re-link it whenever it went missing,
// and point the reference at the copy. Four people chosen through a portal
// appeared on the root hive uninvited, and the reference pointed at copies of
// them. Being referenced never makes something a member of the root hive;
// membership is a mark the participant made. Identity is the target's
// MOLECULE address (`moleculeAddress(name)`), which no hive has to list.
// documentation/reference-designer.md, sections 4–5.

import {
  CANONICAL_REFERENCE_SERVICE_KEY,
  CHILD_SLOTS,
  EffectBus,
  buildCanonicalReferenceRecord,
  buildCanonicalVariantRecord,
  SignatureService,
  canonicalReferenceName,
  canonicalReferenceRoute,
  moleculeAddress,
  type CanonicalReferenceService,
  type PlaceCanonicalReferenceOptions,
} from '@hypercomb/core'
import {
  childLayerOf,
  resolveLayerAt,
  type PlacementHistory,
  type PlacementLayer,
} from '../history/layer-placement.js'
import { referenceTargetAt } from './decoration-kind-index.js'

/** Colon-scoped: a tile name can never produce it. */
const CANONICAL_VARIANTS_MEANING = 'canonical:variants'

type StoreLike = {
  putResource(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type LineageLike = { readonly domain?: unknown }
type CommitterLike = {
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
  /** Retain the target's current meaning as an immutable same-name candidate. */
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
    // NOT `getPool(name)`. Deriving a pool address from a RAW TILE NAME put
    // foreign 64-hex records at the TOP LEVEL of what the molecule model says
    // is that tile's own molecule. `canonical:variants` carries a colon, which
    // no tile name can produce, and the name becomes a sub-bucket inside it.
    const pool = await store.getPool(CANONICAL_VARIANTS_MEANING)
    if (!pool) return
    // sign(name) as the SUB-BUCKET, derived not registered: the tile name is
    // not a pool meaning and must never enter the registry, or `isPoolAddress`
    // would start answering true for an ordinary tile's own lineage bag.
    const nameKey = await SignatureService.sign(new TextEncoder().encode(name).buffer as ArrayBuffer)
    const bucket = await pool.getDirectoryHandle(nameKey, { create: true })
      .catch(() => null)
    if (!bucket) return
    const handle = await bucket.getFileHandle(recordSig, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
  }

  async place(options: PlaceCanonicalReferenceOptions): Promise<string | null> {
    const name = canonicalReferenceName(options.name)
    if (!name) return null
    const sourceSegments = canonicalReferenceRoute(options.sourceSegments ?? [])
    // The hive itself is never an item to point at.
    if (sourceSegments.length === 0) return null
    const parentSegments = canonicalReferenceRoute(options.parentSegments ?? [])
    const childSegments = [...parentSegments, name]
    // Never reference yourself.
    if (sameSegments(childSegments, sourceSegments)) return null

    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    const store = get<StoreLike>('@hypercomb.social/Store')
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    if (!history || !committer?.commitChildrenDeltas || !store?.putResource) return null

    // The target must exist where the route says. Nothing is minted for it.
    const sourceLayer = await resolveLayerAt(history, lineage?.domain, sourceSegments)
    if (!sourceLayer) return null

    // A doorway is not a holder: a reference tile's children live behind its
    // pointer, so nothing may be gathered under it.
    if (parentSegments.length > 0 && referenceTargetAt(parentSegments) !== null) return null
    const parent = await resolveLayerAt(history, lineage?.domain, parentSegments)
    if (await childLayerOf(history, parent, name)) return null

    // IDENTITY = the target's molecule, `sign(fold(canon(name)))`. Not the
    // path-keyed bag of a root child — the route is the fallback, not the name.
    const targetName = sourceSegments[sourceSegments.length - 1] ?? name
    const targetSig = await moleculeAddress(targetName)

    const record = buildCanonicalReferenceRecord({
      targetSegments: sourceSegments,
      targetSig,
      requiredMarks: options.requiredMarks,
      requiredBouquet: options.requiredBouquet,
      editsRootDefault: options.editsRootDefault,
    })
    const decorationSig = await store.putResource(
      new Blob([JSON.stringify(record)], { type: 'application/json' }),
    )

    const childLocationSig = await history.sign({
      domain: lineage?.domain,
      explorerSegments: () => childSegments,
    })
    // An ordinary activation takes a SNAPSHOT OF THE TARGET'S DETAILS. It
    // shares the exact same resource/decorations/notes signatures — no bytes
    // are copied — but its appearance head is independent: creating or editing
    // `/team/jaime` can never repaint `/friends/jaime`. Structure stays behind
    // the pointer: navigation enters the target, so no child slot is carried.
    //
    // The Portal inventory row is the exception. It is the explicit default-
    // authoring surface, so it remains a slim live pointer and its editor is
    // routed to the target. Changing the target seeds FUTURE activations only.
    let childLayer: PlacementLayer = { name, decorations: [decorationSig] }
    if (options.editsRootDefault !== true) {
      const details: PlacementLayer = { name }
      for (const [slot, value] of Object.entries(sourceLayer)) {
        if (slot === 'name' || (CHILD_SLOTS as readonly string[]).includes(slot)) continue
        details[slot] = value
      }
      const inheritedDecorations = Array.isArray(details['decorations'])
        ? details['decorations'].filter((sig): sig is string => typeof sig === 'string')
        : []
      childLayer = {
        ...details,
        decorations: [...new Set([...inheritedDecorations, decorationSig])],
      }
    }
    const childMarkerSig = await history.commitLayer(childLocationSig, childLayer)
    await committer.commitChildrenDeltas(parentSegments, { appends: [childMarkerSig] })

    // Retain what the target meant at the moment it was referenced — a record
    // in a colon pool, never a membership anywhere.
    const sourceParent = await resolveLayerAt(history, lineage?.domain, sourceSegments.slice(0, -1))
    const sourceChild = await childLayerOf(history, sourceParent, targetName)
    await this.#retainVariant(targetName, history, sourceLayer, sourceChild?.sig)

    EffectBus.emit('decorations:changed', {
      segments: childSegments, op: 'append', sig: decorationSig,
    })
    EffectBus.emit('cell:added', {
      cell: name, segments: [...parentSegments], viaUpdate: true, reference: true,
    })
    return name
  }
}

const canonicalReferenceService = new CanonicalReferenceServiceImpl()
window.ioc.register(CANONICAL_REFERENCE_SERVICE_KEY, canonicalReferenceService)
