// A cross-window tile drag carries one public layer signature. The signature
// is encoded in a custom MIME TYPE because browsers expose types, but protect
// values, during dragover. That lets this destination resolve and paint the
// tile before release; drop merely commits the already-previewed layer.

import {
  Drone,
  EffectBus,
  hypercomb,
  portableTileSignatureFromTypes,
} from '@hypercomb/core'
import { tilePictureCandidates } from '../editor/tile-properties.js'
import { childNamesOf } from '../history/layer-placement.js'

type Layer = { name?: string; properties?: readonly string[]; [slot: string]: unknown }
type DropTarget = {
  q: number
  r: number
  occupied: boolean
  label: string | null
  index: number
  over?: boolean
}
type HistoryLike = {
  sign(lineage: { domain?: unknown; explorerSegments: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Layer | null>
  getLayerBySig(sig: string): Promise<Layer | null>
}
type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  fetchLayerFromHost?(
    sig: string,
    options?: { bypassMissWindow?: boolean },
  ): Promise<Uint8Array | null>
}
type LineageLike = { readonly domain?: unknown; explorerSegments(): readonly string[] }
type CommitterLike = {
  commitChildrenDeltas(segments: readonly string[], changes: { appends?: readonly string[] }): Promise<string>
}
type AxialLike = { items?: Map<number, { q: number; r: number }> }

const SIG = /^[0-9a-f]{64}$/i

export class PortableTileDropDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  override description =
    'Resolves a signature-addressed tile as it enters another browser, previews it under the pointer, and adopts it on drop.'

  protected override listens = ['drop:target']
  protected override emits = ['drop:dragging', 'portable-tile:preview', 'cell:added', 'cell:place-at']

  #activeSig: string | null = null
  #layer: Layer | null = null
  #imageSig: string | null = null
  #target: DropTarget | null = null
  #resolveToken = 0
  #resolvePromise: Promise<Layer | null> | null = null
  #effectsRegistered = false

  constructor() {
    super()
    document.addEventListener('dragenter', this.#onDragOver)
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('dragleave', this.#onDragLeave)
    document.addEventListener('drop', this.#onDrop)
    document.addEventListener('dragend', this.#clear)
  }

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true
    this.onEffect<DropTarget>('drop:target', target => {
      this.#target = target
      this.#paint()
    })
  }

  protected override dispose(): void {
    document.removeEventListener('dragenter', this.#onDragOver)
    document.removeEventListener('dragover', this.#onDragOver)
    document.removeEventListener('dragleave', this.#onDragLeave)
    document.removeEventListener('drop', this.#onDrop)
    document.removeEventListener('dragend', this.#clear)
    this.#clear()
  }

  #onDragOver = (event: DragEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, textarea, select, [contenteditable]')) return
    const signature = portableTileSignatureFromTypes(event.dataTransfer?.types ?? [])
    if (!signature) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    if (signature === this.#activeSig) return

    this.#activeSig = signature
    this.#layer = null
    this.#imageSig = null
    this.#target = null
    const token = ++this.#resolveToken
    EffectBus.emit('drop:dragging', { active: true })
    this.#resolvePromise = resolvePortableLayer(signature, this.#history, this.#store)
    void this.#resolve(signature, token, this.#resolvePromise)
  }

  #onDragLeave = (event: DragEvent): void => {
    if (event.relatedTarget === null) this.#clear()
  }

  #onDrop = (event: DragEvent): void => {
    const signature = portableTileSignatureFromTypes(event.dataTransfer?.types ?? [])
      ?? this.#plainSignature(event.dataTransfer)
    if (!signature || signature !== this.#activeSig) return
    event.preventDefault()
    const target = this.#target
    const layer = this.#layer
    const pending = this.#resolvePromise
    this.#clear()
    if (!target || target.over === false) return
    if (layer) void this.#commit(signature, layer, target)
    else if (pending) void pending.then(resolved => {
      if (resolved) void this.#commit(signature, resolved, target)
    })
  }

  async #resolve(
    signature: string,
    token: number,
    pending: Promise<Layer | null>,
  ): Promise<void> {
    const layer = await pending
    if (token !== this.#resolveToken || signature !== this.#activeSig || !layer) return
    this.#layer = layer
    this.#imageSig = await this.#pictureSig(layer)
    if (token !== this.#resolveToken || signature !== this.#activeSig) return
    this.#paint()
  }

  #paint(): void {
    const target = this.#target
    if (!this.#activeSig || !target || target.over === false) return
    const label = typeof this.#layer?.name === 'string' && this.#layer.name
      ? this.#layer.name
      : this.#activeSig.slice(0, 8)
    EffectBus.emit('portable-tile:preview', {
      signature: this.#activeSig,
      label,
      imageSig: this.#imageSig,
      q: target.q,
      r: target.r,
    })
  }

  async #pictureSig(layer: Layer): Promise<string | null> {
    const store = this.#store
    const propsSig = layer.properties?.find(sig => typeof sig === 'string' && SIG.test(sig))
    if (!store || !propsSig) return null
    try {
      const blob = await store.getResource(propsSig)
      if (!blob) return null
      const candidates = tilePictureCandidates(JSON.parse(await blob.text()))
      for (const sig of candidates) {
        if (await store.getResource(sig)) return sig
      }
    } catch { /* a labelled hex is the complete fallback */ }
    return null
  }

  async #commit(signature: string, layer: Layer, target: DropTarget): Promise<void> {
    const history = this.#history
    const lineage = this.#lineage
    const committer = this.#committer
    const name = typeof layer.name === 'string' ? layer.name.trim() : ''
    if (!history || !lineage || !committer || !name) return
    const segments = [...lineage.explorerSegments()]
    const locationSig = await history.sign({ domain: lineage.domain, explorerSegments: () => segments })
    const parent = await history.currentLayerAt(locationSig)
    if (parent && (await childNamesOf(history as never, parent as never)).includes(name)) return

    await committer.commitChildrenDeltas(segments, { appends: [signature] })
    EffectBus.emit('fs:changed', { segments })
    EffectBus.emit('cell:added', { cell: name, segments, viaUpdate: true })
    const index = target.index >= 0 ? target.index : this.#indexOf(target.q, target.r)
    if (index >= 0) EffectBus.emit('cell:place-at', { cell: name, index })
    await new hypercomb().act()
  }

  #indexOf(q: number, r: number): number {
    const items = window.ioc.get<AxialLike>('@diamondcoreprocessor.com/AxialService')?.items
    if (!items) return -1
    for (const [index, axial] of items) {
      if (axial.q === q && axial.r === r) return index
    }
    return -1
  }

  #plainSignature(transfer: DataTransfer | null): string | null {
    const value = transfer?.getData('text/plain')?.trim() ?? ''
    return SIG.test(value) ? value.toLowerCase() : null
  }

  #clear = (): void => {
    if (!this.#activeSig) return
    this.#activeSig = null
    this.#layer = null
    this.#imageSig = null
    this.#target = null
    this.#resolvePromise = null
    this.#resolveToken++
    EffectBus.emit('portable-tile:preview', null)
    EffectBus.emit('drop:dragging', { active: false })
  }

  get #history(): HistoryLike | undefined {
    return window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  }
  get #store(): StoreLike | undefined {
    return window.ioc.get<StoreLike>('@hypercomb.social/Store')
  }
  get #lineage(): LineageLike | undefined {
    return window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
  }
  get #committer(): CommitterLike | undefined {
    return window.ioc.get<CommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
  }
}

/**
 * A drag is an explicit acquisition gesture, so unlike ordinary rendering it
 * awaits the existing verified domain cascade. Store/ContentBroker checks the
 * SHA-256 before writing the bytes; the second history read is therefore local.
 */
export async function resolvePortableLayer(
  signature: string,
  history: HistoryLike | undefined,
  store: StoreLike | undefined,
): Promise<Layer | null> {
  if (!history) return null
  const local = await history.getLayerBySig(signature).catch(() => null)
  if (local) return local
  const fetch = store?.fetchLayerFromHost?.(signature, { bypassMissWindow: true })
  const bytes = fetch ? await fetch.catch(() => null) : null
  if (!bytes) return null
  return history.getLayerBySig(signature).catch(() => null)
}

const _portableTileDrop = new PortableTileDropDrone()
window.ioc.register('@diamondcoreprocessor.com/PortableTileDropDrone', _portableTileDrop)
