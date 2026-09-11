// editor/tile-editor.drone.ts
import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { readCellProperties, readTilePropertiesAt, writeTilePropertiesAt, cellLocationSig, readTilePropsIndex, lookupTilePropsSig } from './tile-properties.js'
import { referenceEditsRootDefaultForLabel, referenceTargetForLabel } from '../commands/decoration-kind-index.js'
import { portalEditTarget } from './portal-edit-target.js'
import { parseHexColour } from './hex-capture.js'
import { editorSurface } from './editor-surface.js'
import type { TileEditorService } from './tile-editor.service.js'
import type { ImageEditorService } from './image-editor.service.js'

// SVG markup for the pencil "edit" icon. Owned by this drone so that
// when the editor is toggled off in DCP the icon never reaches the
// tile overlay arranger and never appears on the hex. Material Design
// `edit` (filled) — solid white fill so the Pixi sprite-tint pipeline
// preserves colour; matches the rest of the tile-overlay icon set.
const EDIT_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`

type IconProvider = {
  name: string
  owner?: string
  svgMarkup: string
  profile: string
  hoverTint?: number
  labelKey?: string
  descriptionKey?: string
}

type IconProviderRegistry = {
  add(p: IconProvider): void
  remove(name: string): void
}

type TileActionPayload = {
  action: string
  label: string
  q: number
  r: number
  index: number
}

type Store = {
  putResource: (blob: Blob) => Promise<string>
  getResource: (signature: string) => Promise<Blob | null>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Props as a merge sees them: an `undefined` key is an absent key, and key
 *  order carries no meaning. */
const normalise = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalise)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = normalise(value[key])
  }
  return out
}

const sameProps = (a: unknown, b: unknown): boolean =>
  JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))

/** The orientation the hive is showing right now. The bus replays its last
 *  value to a new subscriber, so subscribing and letting go reads it. */
const hiveOrientation = (): 'point-top' | 'flat-top' => {
  let flat = false
  const off = EffectBus.on<{ flat?: boolean }>('render:set-orientation', payload => { flat = payload?.flat === true })
  off?.()
  return flat ? 'flat-top' : 'point-top'
}

const t = (key: string, fallback: string): string => {
  try {
    const text = window.ioc?.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return text && text !== key ? text : fallback
  } catch { return fallback }
}

export class TileEditorDrone {

  #saving = false

  constructor() {
    EffectBus.on<TileActionPayload>('tile:action', this.#onTileAction)

    // Self-register the 'edit' tile icon. The arranger (tile-actions)
    // merges this with its own catalog, computes positions, and emits
    // the final overlay descriptors. Toggling this drone off in DCP
    // skips construction → registry never receives the entry → icon
    // never appears.
    const registry = window.ioc.get<IconProviderRegistry>('@hypercomb.social/IconProviderRegistry')
    registry?.add({
      name: 'edit',
      owner: '@diamondcoreprocessor.com/TileEditorDrone',
      svgMarkup: EDIT_ICON_SVG,
      profile: 'private',
      hoverTint: 0xc8d8ff,
      labelKey: 'action.edit',
      descriptionKey: 'action.edit.description',
    })
  }

  // ── effect handler ─────────────────────────────────────────────

  #onTileAction = (payload: TileActionPayload): void => {
    if (payload.action !== 'edit') return
    void this.#openEditing(payload.label)
  }

  // ── open editor ────────────────────────────────────────────────

  async #openEditing(cell: string, options: { stash?: boolean } = {}): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!store || !service) return

    // A tile opened while another is being edited (a drop, a paste, the phone
    // bar's camera, a click on another tile): keep that draft before this one
    // replaces it — unless it was just saved.
    if (service.mode === 'editing' && options.stash !== false) this.#stashDraft()

    // 1. read tile properties — canonical path is the cell's layer's
    // `properties` slot (`readTilePropertiesAt`). Falls back to:
    //   - the localStorage label-keyed sig index (tile-editor save path
    //     not yet migrated to layer slots), and
    //   - the legacy 0000 file (pre-migration tiles whose properties
    //     were written to <cellDir>/0000).
    // The canonical-first ordering means freshly-edited tiles whose
    // properties live in the layer slot always show up correctly in
    // the editor without needing a label-keyed cache hit.
    const lineage = window.ioc.get<{
      explorerSegments?: () => readonly string[]
      explorerDir?: () => Promise<FileSystemDirectoryHandle | null>
    }>('@hypercomb.social/Lineage')
    const appearanceParent = lineage?.explorerSegments?.() ?? []
    // A Portal starts with the original canonical details and edits that
    // target as the participant's DEFAULT for future uses. The reference leaf
    // remains a lightweight appearance; an appearance-local override is a
    // separate explicit decoration contract.
    const target = portalEditTarget(
      appearanceParent,
      cell,
      referenceEditsRootDefaultForLabel(cell) ? referenceTargetForLabel(cell) : null,
    )
    const parentSegments = target.parentSegments
    const targetCell = target.cell
    let properties: Record<string, unknown> = {}
    try {
      const layerProps = await readTilePropertiesAt(parentSegments, targetCell)
      if (Object.keys(layerProps).length > 0) {
        properties = layerProps
      } else {
        throw new Error('no layer-slot properties')
      }
    } catch {
      try {
        const index = readTilePropsIndex()
        const propsSig = lookupTilePropsSig(
          index,
          await cellLocationSig(parentSegments, targetCell),
          // Bare-label entries predate lineage scoping and cannot prove which
          // same-name appearance they describe. A Portal default may only use
          // the canonical target's lineage-keyed cache.
          target.throughPortal ? '' : targetCell,
        )
        if (!propsSig) throw new Error('no index entry')
        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) throw new Error('props blob missing')
        const text = await propsBlob.text()
        properties = JSON.parse(text)
      } catch {
        try {
          if (target.throughPortal) throw new Error('portal target has no appearance-local legacy fallback')
          const dir = await lineage?.explorerDir?.()
          if (dir) {
            const cellDir = await dir.getDirectoryHandle(targetCell, { create: false })
            properties = await readCellProperties(cellDir)
          }
        } catch {
          // truly nothing — leave properties empty
        }
      }
    }

    // 2. load large image blob from the resource store (root sig file;
    //    legacy __resources__/ is a read-fallback inside Store) if present
    let largeBlob: Blob | null = null
    const largeSig = (properties as any).large?.image
    if (largeSig && typeof largeSig === 'string') {
      largeBlob = await store.getResource(largeSig)
    }

    // 3. open — the picture model first, so the view mounts onto the right
    //    orientation, then the session, then the tile's own picture with the
    //    framings it was saved at.
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    imageEditor?.reset?.(hiveOrientation())
    service.open(targetCell, properties, largeBlob, target.segments, editorSurface())
    if (largeBlob && imageEditor?.loadOriginal) {
      void imageEditor.loadOriginal(largeBlob, {
        point: (properties as any).large,
        flat: (properties as any).flat?.large,
      })
    }
  }

  // ── save (called by the editor view) ───────────────────────────
  //
  // WHAT A SAVE WRITES. The original picture's bytes, untouched, as
  // `large.image`; the framing per orientation as plain numbers; and two small
  // pictures captured OFF SCREEN from the original through `hex-capture.ts`,
  // which cannot draw anything but the picture. Colours, link and hideText are
  // whatever the session holds — nothing is stamped that the participant did
  // not set. A save that changes nothing writes nothing: no layer, no history
  // entry, no `tile:saved`.

  readonly saveAndComplete = async (): Promise<void> => {
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const outcome = await this.#persist()
    // A failed save keeps the editor open with the draft intact. Cancel is
    // always there, and it always closes.
    if (!outcome) return
    service?.close()
    imageEditor?.destroy()
    this.#announce(outcome)
  }

  // ── switch (called by the editor view) ─────────────────────────
  //
  // The docked editor sits beside a live hive, so a click on another tile
  // moves the session there without closing the window. `save` writes this
  // tile first and moves only if the write landed; otherwise this tile's
  // changed draft is kept, exactly as a cancel keeps it, and offered back
  // when the tile is opened again.

  readonly switchTo = async (label: string, options: { save?: boolean } = {}): Promise<boolean> => {
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    if (!service || service.mode !== 'editing' || this.#saving || !label) return false
    if (options.save) {
      const outcome = await this.#persist()
      if (!outcome) return false
      this.#announce(outcome)
    }
    await this.#openEditing(label, { stash: !options.save })
    return service.mode === 'editing' && service.cell !== ''
  }

  /** Write the open session. Null when nothing could be written — the error
   *  is on the session by then. */
  async #persist(): Promise<{ wrote: boolean; cell: string; segments: readonly string[] } | null> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')

    if (!store || !service || !imageEditor) return null
    if (service.mode !== 'editing' || this.#saving) return null
    this.#saving = true
    service.setSaving?.(true)

    // Bind the cell AND ITS ADDRESS at gesture time. The save spans captures
    // and several store writes; reading lineage at write time used to stamp
    // the edited props against wherever the participant had navigated to
    // mid-save — a cross-layer content graft.
    const savedCell = service.cell
    const lineageAtSave = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const targetSegments = service.targetSegments.length > 0
      ? [...service.targetSegments]
      : [...(lineageAtSave?.explorerSegments?.() ?? []), savedCell]
    const segmentsForSave: readonly string[] = targetSegments.slice(0, -1)
    let saved = false
    let wrote = false

    try {
      // A picture dropped a moment ago may still be decoding.
      await imageEditor.ready

      const props: Record<string, unknown> = { ...service.properties }
      const pictureChanged = imageEditor.pictureChanged === true

      if (imageEditor.removed) {
        props['large'] = undefined
        props['small'] = undefined
        props['flat'] = undefined
      } else if (imageEditor.hasImage && imageEditor.source && typeof imageEditor.capture === 'function') {
        // Fill behind the picture is only ever the participant's colour, and
        // the model only applies it to a picture set to Fit.
        const fill = parseHexColour((props['background'] as { color?: unknown } | undefined)?.color)
        const pointBlob = await imageEditor.capture('point-top', fill)
        const flatBlob = await imageEditor.capture('flat-top', fill)
        const largeSig = await store.putResource(imageEditor.source)
        const pointSig = await store.putResource(pointBlob)
        const flatSig = await store.putResource(flatBlob)
        const point = imageEditor.framingFor('point-top')
        const flat = imageEditor.framingFor('flat-top')
        const flatProps = isRecord(props['flat']) ? props['flat'] : {}
        props['large'] = { image: largeSig, x: point.x, y: point.y, scale: point.scale }
        props['small'] = { image: pointSig }
        props['flat'] = { ...flatProps, large: { x: flat.x, y: flat.y, scale: flat.scale }, small: { image: flatSig } }
        // A picture framed by hand is the participant's, whatever marked it
        // before — the merge earns the participant mark from the picture keys.
        if (props['substrate'] !== undefined) props['substrate'] = undefined
      }

      const baseline = (service as { baseline?: Record<string, unknown> }).baseline
      const unchanged = !!baseline && !pictureChanged && sameProps(props, baseline)
      if (!unchanged) {
        // segmentsForSave was bound at gesture start — never re-read here.
        await writeTilePropertiesAt(segmentsForSave, savedCell, props)
        wrote = true
      }
      saved = true
    } catch (err) {
      console.warn('[tile-editor] save failed', err)
      service.setError?.(t('editor.save-failed', 'Could not save — your changes are still here.'))
    } finally {
      this.#saving = false
      service.setSaving?.(false)
    }

    return saved ? { wrote, cell: savedCell, segments: segmentsForSave } : null
  }

  /** Notify via the effect bus (the processor owns synchronize; drones use
   *  effects). Carries the gesture-time segments so downstream commit
   *  listeners address the layer where the edit happened, not wherever the
   *  participant navigated to during the save. */
  #announce(outcome: { wrote: boolean; cell: string; segments: readonly string[] }): void {
    if (!outcome.wrote) return
    EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', { cell: outcome.cell, segments: outcome.segments })
  }

  // ── cancel ─────────────────────────────────────────────────────

  readonly cancelEditing = (): void => {
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    // A save in flight finishes and closes on its own; cancelling under it
    // would close the session the save is about to write.
    if (this.#saving) return
    this.#stashDraft()
    service?.close()
    imageEditor?.destroy()
  }

  /** Keep a changed draft that is about to be thrown away. */
  #stashDraft(): void {
    const service = window.ioc.get<TileEditorService>('@diamondcoreprocessor.com/TileEditorService')
    const imageEditor = window.ioc.get<ImageEditorService>('@diamondcoreprocessor.com/ImageEditorService')
    if (!service || service.mode !== 'editing' || typeof service.stash !== 'function') return
    const pictureDirty = !!imageEditor && (imageEditor.pictureChanged || imageEditor.framingChanged)
    if (!service.dirty && !pictureDirty) return
    const source = imageEditor?.hasImage ? imageEditor.source : null
    service.stash({
      cell: service.cell,
      segments: [...service.targetSegments],
      properties: service.properties,
      picture: source && imageEditor ? {
        source,
        point: imageEditor.framingFor('point-top'),
        flat: imageEditor.framingFor('flat-top'),
        linked: imageEditor.linked,
        mode: imageEditor.mode,
      } : null,
      pictureRemoved: imageEditor?.removed === true,
    })
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/TileEditorDrone',
  new TileEditorDrone(),
)
