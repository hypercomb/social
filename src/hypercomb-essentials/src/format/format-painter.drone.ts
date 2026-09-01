// format/format-painter.drone.ts
import { EffectBus } from '@hypercomb/core'
import type { FormatEntry, FormatProvider } from './format.provider.js'
import { cellLocationSig, readTilePropsIndex, lookupTilePropsSig, readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'
import { referenceEditsRootDefaultForLabel, referenceTargetForLabel } from '../commands/decoration-kind-index.js'
import { portalEditTarget } from '../editor/portal-edit-target.js'

// ── built-in providers ──────────────────────────────────

const borderColorProvider: FormatProvider = {
  key: 'border.color',
  extract(props) {
    const color = (props as any).border?.color
    if (!color || typeof color !== 'string') return null
    return { key: 'border.color', label: 'Border', value: color, preview: color }
  },
  apply(props, value) {
    const next = { ...props }
    if (!(next as any).border) (next as any).border = {}
    ;(next as any).border = { ...(next as any).border, color: value }
    return next
  },
}

const backgroundColorProvider: FormatProvider = {
  key: 'background.color',
  extract(props) {
    const color = (props as any).background?.color
    if (!color || typeof color !== 'string') return null
    return { key: 'background.color', label: 'Background', value: color, preview: color }
  },
  apply(props, value) {
    const next = { ...props }
    if (!(next as any).background) (next as any).background = {}
    ;(next as any).background = { ...(next as any).background, color: value }
    return next
  },
}

// ── state type ──────────────────────────────────────────

export interface FormatPainterState {
  open: boolean
  sourceCell: string | null
  entries: Array<FormatEntry & { enabled: boolean }>
}

// ── store type (matches TileEditorDrone's local type) ───

type Store = {
  resources: FileSystemDirectoryHandle
  putResource: (blob: Blob) => Promise<string>
  getResource: (signature: string) => Promise<Blob | null>
}

// ── drone ───────────────────────────────────────────────

export class FormatPainterDrone extends EventTarget {

  #open = false
  #sourceCell: string | null = null
  #entries: Array<FormatEntry & { enabled: boolean }> = []
  #providers: FormatProvider[] = [borderColorProvider, backgroundColorProvider]

  get state(): FormatPainterState {
    return {
      open: this.#open,
      sourceCell: this.#sourceCell,
      entries: this.#entries.map(e => ({ ...e })),
    }
  }

  // ── load source tile's properties ──────────────────────

  async #loadSource(cell: string): Promise<void> {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return

    // Canonical slot first, derived index as a fast path — a cache miss must
    // never present the tile as unformatted (see #paint for why that matters).
    let properties: Record<string, unknown> = {}
    const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const segments = lineage?.explorerSegments?.() ?? []
    const target = portalEditTarget(
      segments,
      cell,
      referenceEditsRootDefaultForLabel(cell) ? referenceTargetForLabel(cell) : null,
    )
    try {
      const layerProps = await readTilePropertiesAt(target.parentSegments, target.cell)
      if (Object.keys(layerProps).length === 0) throw new Error('no layer-slot properties')
      properties = layerProps
    } catch {
      try {
        const index = readTilePropsIndex()
        const propsSig = lookupTilePropsSig(
          index,
          await cellLocationSig(target.parentSegments, target.cell),
          target.throughPortal ? '' : target.cell,
        )
        if (!propsSig) throw new Error('no index entry')
        const propsBlob = await store.getResource(propsSig)
        if (!propsBlob) throw new Error('props blob missing')
        properties = JSON.parse(await propsBlob.text())
      } catch {
        // no properties
      }
    }

    this.#openPainter(cell, properties)
  }

  constructor() {
    super()

    EffectBus.on<{ cell: string; properties: Record<string, unknown> }>('format:open', (payload) => {
      this.#openPainter(payload.cell, payload.properties)
    })

    EffectBus.on('format:close', () => {
      this.#close()
    })

    EffectBus.on<{ key: string }>('format:toggle-entry', (payload) => {
      this.#toggleEntry(payload.key)
    })

    EffectBus.on('format:apply', () => {
      void this.#applyFormat()
    })

    // when panel is open and user clicks a different tile, load its properties
    EffectBus.on<{ selected: string[]; active: string | null }>('selection:changed', (payload) => {
      if (!this.#open || !payload?.active) return
      if (payload.active === this.#sourceCell) return
      void this.#loadSource(payload.active)
    })
  }

  addProvider(provider: FormatProvider): void {
    this.#providers.push(provider)
  }

  // ── open ────────────────────────────────────────────────

  #openPainter(cell: string, props: Record<string, unknown>): void {
    this.#sourceCell = cell
    this.#entries = []

    for (const provider of this.#providers) {
      const entry = provider.extract(props)
      if (entry) {
        this.#entries.push({ ...entry, enabled: true })
      }
    }

    this.#open = true
    this.#emit()
  }

  // ── close ───────────────────────────────────────────────

  #close(): void {
    this.#open = false
    this.#sourceCell = null
    this.#entries = []
    this.#emit()
  }

  // ── toggle checkbox ─────────────────────────────────────

  #toggleEntry(key: string): void {
    const entry = this.#entries.find(e => e.key === key)
    if (entry) {
      entry.enabled = !entry.enabled
      this.#emit()
    }
  }

  // ── apply to selection ──────────────────────────────────

  async #applyFormat(): Promise<void> {
    const selection = window.ioc.get<{ selected: ReadonlySet<string> }>('@diamondcoreprocessor.com/SelectionService')
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!selection || !store) return

    const enabled = this.#entries.filter(e => e.enabled)
    if (enabled.length === 0) return

    const lineage = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
    const segments = lineage?.explorerSegments?.() ?? []
    const index = readTilePropsIndex()

    for (const cell of selection.selected) {
      // skip source tile
      if (cell === this.#sourceCell) continue

      // 1. read current props — CANONICAL SLOT FIRST, the index as a
      // legacy drain fallback (an old index-only tile the reconciler
      // hasn't stamped yet still deserves a correct merge base).
      let props: Record<string, unknown> = {}
      const target = portalEditTarget(
        segments,
        cell,
        referenceEditsRootDefaultForLabel(cell) ? referenceTargetForLabel(cell) : null,
      )
      try {
        const layerProps = await readTilePropertiesAt(target.parentSegments, target.cell)
        if (Object.keys(layerProps).length === 0) throw new Error('no layer-slot properties')
        props = layerProps
      } catch {
        try {
          const cellKey = await cellLocationSig(target.parentSegments, target.cell)
          const propsSig = lookupTilePropsSig(index, cellKey, target.throughPortal ? '' : target.cell)
          if (!propsSig) throw new Error('no index entry')
          const propsBlob = await store.getResource(propsSig)
          if (!propsBlob) throw new Error('props blob missing')
          props = JSON.parse(await propsBlob.text())
        } catch {
          // no existing props — start fresh
        }
      }

      // 2. apply each enabled entry via its provider
      let painted: Record<string, unknown> = props
      for (const entry of enabled) {
        const provider = this.#providers.find(p => p.key === entry.key)
        if (provider) {
          painted = provider.apply(painted, entry.value)
        }
      }

      // 3. commit the CHANGED fields canonically (Phase B,
      // visuals-across-lineages.md): the paint becomes a normal layer
      // commit — undoable, it travels, it survives canonical heals (an
      // index-only paint used to revert on the next reconcile) — and the
      // props index follows via the central layer-keyed seed. Passing
      // only the diff keeps concurrent writers' untouched fields intact
      // through writeTilePropertiesAt's read-merge-commit.
      const updates: Record<string, unknown> = {}
      for (const k of Object.keys(painted)) {
        if (JSON.stringify(painted[k]) !== JSON.stringify(props[k])) updates[k] = painted[k]
      }
      for (const k of Object.keys(props)) {
        if (!(k in painted)) updates[k] = undefined     // provider removed it
      }
      if (Object.keys(updates).length === 0) continue
      await writeTilePropertiesAt(target.parentSegments, target.cell, updates)

      // 4. notify renderer
      EffectBus.emit<{ cell: string; segments: readonly string[] }>('tile:saved', {
        cell: target.cell,
        segments: target.parentSegments,
      })
    }
  }

  // ── emit state ──────────────────────────────────────────

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit<FormatPainterState>('format:state', this.state)
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/FormatPainterDrone',
  new FormatPainterDrone(),
)
