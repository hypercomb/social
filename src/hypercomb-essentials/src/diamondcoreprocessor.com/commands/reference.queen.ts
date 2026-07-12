// diamondcoreprocessor.com/commands/reference.queen.ts
//
// `/reference` (alias `/ref`) — drop a REFERENCE tile at the current location:
// a live pointer to another lineage. Clicking the tile portals to the target
// (see tile-overlay #navigateInto). This is the
// atom that lets a set collect references to your own tiles without
// duplicating their content — the same target can be referenced from many
// places (reference sets / pools of meaning).
//
// Syntax:
//   /reference <path>            — tile named after the target leaf
//   /reference <name> = <path>   — explicit tile name
//   /ref <path>                  — alias
//
// <path> is a full hive path (slash-separated names from the root), e.g.
//   /reference interests/music/jazz
// creates a tile "jazz" here that portals to /interests/music/jazz.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { REFERENCE_DECORATION_KIND } from './decoration-kind-index.js'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const BACKSLASH = String.fromCharCode(92)

/** Names become path segments — drop separators and control characters
 *  (mirrors the UNSAFE_CELL_NAME guard in layer-placement.ts). */
const safeName = (raw: string): string =>
  [...raw].filter(ch => ch !== '/' && ch !== BACKSLASH && ch.charCodeAt(0) > 31).join('').trim()

/** Parse a slash path into clean segments (drops separators, control chars,
 *  and empty parts — so a leading '/' is fine). */
const parsePath = (raw: string): string[] =>
  raw.split('/').map(safeName).filter(Boolean)

type LineageShape = { explorerSegments?: () => readonly string[] }
type StoreShape = { putResource(blob: Blob, options?: { emit?: boolean }): Promise<string> }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
  commitLayer(locationSig: string, layer: Record<string, unknown>): Promise<string>
}
type CursorShape = { refreshForLocation?(sig: string): Promise<void>; jumpToLatest?(): void }
type CommitterShape = {
  commitChildrenDeltas(
    segments: readonly string[],
    changes: { removes?: readonly { sig?: string; label?: string }[]; appends?: readonly string[] },
  ): Promise<void>
}

export class ReferenceQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'reference'
  override readonly aliases = ['ref']
  override description = 'Drop a reference tile here — a live pointer to another location'
  override descriptionKey = 'slash.reference'
  override options = ['<path>', '<name> = <path>']
  override examples = [
    { input: '/reference interests/music/jazz', result: 'Adds a "jazz" tile that portals to /interests/music/jazz' },
    { input: '/ref favourites = interests/music', result: 'Adds a "favourites" reference to /interests/music' },
  ]

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (!raw) { this.#log('Reference — usage: /reference <path>  or  /reference <name> = <path>'); return }

    // Split explicit "name = path"; otherwise the whole arg is the path and the
    // tile takes the target's leaf name.
    let namePart = ''
    let pathPart = raw
    const eq = raw.indexOf('=')
    if (eq !== -1) {
      namePart = safeName(raw.slice(0, eq))
      pathPart = raw.slice(eq + 1)
    }

    const targetSegments = parsePath(pathPart)
    if (targetSegments.length === 0) { this.#log('Reference — needs a target path (e.g. /reference music/jazz)'); return }

    const name = namePart || targetSegments[targetSegments.length - 1]
    if (!name) { this.#log('Reference — could not derive a name; try /reference <name> = <path>'); return }

    await this.#createReference(name, targetSegments)
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Create a child tile carrying a `reference` decoration — baked into the
   *  same commit (the race-free create+decorate shape). The child's own bag
   *  is fresh (no contention), so its commit stays direct; the PARENT link
   *  rides the LayerCommitter FIFO as a surgical children append — a direct
   *  read-modify-write commitLayer of the parent would clobber any
   *  interleaved FIFO commit's child (true tile loss). */
  async #createReference(name: string, targetSegments: readonly string[]): Promise<void> {
    const store = get<StoreShape>('@hypercomb.social/Store')
    const history = get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')
    if (!store?.putResource || !history || !committer?.commitChildrenDeltas) { this.#log('Reference — unavailable'); return }

    const parentSegments = this.#segments()
    try {
      const parentSig = await history.sign({ explorerSegments: () => parentSegments })
      const parentLayer = (await history.currentLayerAt(parentSig)) ?? {}
      const existingChildren = Array.isArray(parentLayer['children'])
        ? (parentLayer['children'] as unknown[]).map(s => String(s))
        : []
      const existingNames = await this.#childNames(history, existingChildren)
      if (existingNames.includes(name)) {
        this.#log(`Reference — a tile named "${name}" already lives here`)
        return
      }

      // appliesTo:[] so identical references (same target) dedup to ONE sig —
      // the same location can be referenced from many tiles at zero extra cost.
      const record = { kind: REFERENCE_DECORATION_KIND, appliesTo: [], payload: { targetSegments: [...targetSegments] } }
      const decorationSig = await store.putResource(
        new Blob([JSON.stringify(record)], { type: 'application/json' }))

      const childSegments = [...parentSegments, name]
      const childSig = await history.sign({ explorerSegments: () => childSegments })
      const childMarkerSig = await history.commitLayer(childSig, { name, decorations: [decorationSig] })
      EffectBus.emit('decorations:changed', { segments: childSegments, op: 'append', sig: decorationSig })

      await committer.commitChildrenDeltas(parentSegments, { appends: [childMarkerSig] })
      EffectBus.emit('cell:added', { cell: name, segments: [...parentSegments], viaUpdate: true })

      get<{ invalidate?: () => void }>('@hypercomb.social/Lineage')?.invalidate?.()
      const cursor = get<CursorShape>('@diamondcoreprocessor.com/HistoryCursorService')
      await cursor?.refreshForLocation?.(parentSig)
      cursor?.jumpToLatest?.()

      this.#log(`Reference — "${name}" → /${targetSegments.join('/')}`, '⇥')
    } catch (err) {
      console.warn('[/reference] failed', err)
      this.#log('Reference — could not create (see console)')
    }
  }

  async #childNames(history: HistoryShape, childSigs: readonly string[]): Promise<string[]> {
    const names: string[] = []
    for (const sig of childSigs) {
      const child = await history.getLayerBySig(String(sig))
      const n = child && typeof child['name'] === 'string' ? String(child['name']) : ''
      if (n) names.push(n)
    }
    return names
  }

  #log(message: string, icon = '⇥'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _reference = new ReferenceQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ReferenceQueenBee', _reference)
